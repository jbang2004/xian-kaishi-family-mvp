import { env } from "cloudflare:workers";

export const runtime = "edge";

async function ensureTable() {
  if (!env.DB) throw new Error("D1 binding unavailable");
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS family_state (
      family_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0
    )
  `).run();
  const columns = await env.DB.prepare("PRAGMA table_info(family_state)").all<{ name: string }>();
  if (!columns.results.some(column => column.name === "revision")) {
    await env.DB.prepare("ALTER TABLE family_state ADD COLUMN revision INTEGER NOT NULL DEFAULT 0").run();
  }
}

function familyIdFrom(request: Request) {
  const url = new URL(request.url);
  return url.searchParams.get("familyId")?.slice(0, 80) ?? "";
}

export async function GET(request: Request) {
  const familyId = familyIdFrom(request);
  if (!familyId) return Response.json({ error: "missing_family_id" }, { status: 400 });
  try {
    await ensureTable();
    const row = await env.DB.prepare(
      "SELECT payload, updated_at, revision FROM family_state WHERE family_id = ?"
    ).bind(familyId).first<{ payload: string; updated_at: string; revision: number }>();
    return Response.json(row ? { data: JSON.parse(row.payload), updatedAt: row.updated_at, revision: row.revision } : { data: null, revision: 0 });
  } catch {
    return Response.json({ data: null, localOnly: true }, { status: 200 });
  }
}

export async function PUT(request: Request) {
  const familyId = familyIdFrom(request);
  if (!familyId) return Response.json({ error: "missing_family_id" }, { status: 400 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const isEnvelope = body && typeof body === "object" && "data" in body;
    const data = isEnvelope ? body.data : body;
    const payload = JSON.stringify(data);
    if (payload.length > 500_000) return Response.json({ error: "payload_too_large" }, { status: 413 });
    await ensureTable();
    const current = await env.DB.prepare(
      "SELECT payload, updated_at, revision FROM family_state WHERE family_id = ?"
    ).bind(familyId).first<{ payload: string; updated_at: string; revision: number }>();
    const requestedRevision = isEnvelope && Number.isFinite(Number(body.revision))
      ? Math.max(0, Math.floor(Number(body.revision)))
      : (current?.revision ?? 0) + 1;
    if (current && requestedRevision <= current.revision) {
      return Response.json({ conflict: true, data: JSON.parse(current.payload), updatedAt: current.updated_at, revision: current.revision }, { status: 409 });
    }
    const now = new Date().toISOString();
    const write = await env.DB.prepare(`
      INSERT INTO family_state (family_id, payload, updated_at, revision)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(family_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at, revision = excluded.revision
      WHERE excluded.revision > family_state.revision
    `).bind(familyId, payload, now, requestedRevision).run();
    if (!write.meta.changes) {
      const latest = await env.DB.prepare(
        "SELECT payload, updated_at, revision FROM family_state WHERE family_id = ?"
      ).bind(familyId).first<{ payload: string; updated_at: string; revision: number }>();
      return Response.json({ conflict: true, data: latest ? JSON.parse(latest.payload) : null, updatedAt: latest?.updated_at, revision: latest?.revision ?? requestedRevision }, { status: 409 });
    }
    return Response.json({ ok: true, updatedAt: now, revision: requestedRevision });
  } catch {
    return Response.json({ ok: false, localOnly: true }, { status: 200 });
  }
}

export async function DELETE(request: Request) {
  const familyId = familyIdFrom(request);
  if (!familyId) return Response.json({ error: "missing_family_id" }, { status: 400 });
  try {
    await ensureTable();
    await env.DB.prepare("DELETE FROM family_state WHERE family_id = ?").bind(familyId).run();
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: true, localOnly: true });
  }
}
