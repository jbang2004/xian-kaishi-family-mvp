import { env } from "cloudflare:workers";

export const runtime = "edge";

const FAMILY_TOKEN_PATTERN = /^family-[A-Za-z0-9._:-]{16,73}$/;

function privateJson(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

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
  const token = request.headers.get("x-family-token")?.slice(0, 80) ?? "";
  return FAMILY_TOKEN_PATTERN.test(token) ? token : "";
}

export async function GET(request: Request) {
  const familyId = familyIdFrom(request);
  if (!familyId) return privateJson({ error: "invalid_family_token" }, 401);
  try {
    await ensureTable();
    const row = await env.DB.prepare(
      "SELECT payload, updated_at, revision FROM family_state WHERE family_id = ?"
    ).bind(familyId).first<{ payload: string; updated_at: string; revision: number }>();
    return privateJson(row ? { data: JSON.parse(row.payload), updatedAt: row.updated_at, revision: row.revision } : { data: null, revision: 0 });
  } catch {
    return privateJson({ data: null, localOnly: true });
  }
}

export async function PUT(request: Request) {
  const familyId = familyIdFrom(request);
  if (!familyId) return privateJson({ error: "invalid_family_token" }, 401);
  try {
    const body = await request.json() as Record<string, unknown>;
    const isEnvelope = body && typeof body === "object" && "data" in body;
    const data = isEnvelope ? body.data : body;
    const payload = JSON.stringify(data);
    if (payload.length > 500_000) return privateJson({ error: "payload_too_large" }, 413);
    await ensureTable();
    const current = await env.DB.prepare(
      "SELECT payload, updated_at, revision FROM family_state WHERE family_id = ?"
    ).bind(familyId).first<{ payload: string; updated_at: string; revision: number }>();
    const requestedRevision = isEnvelope && Number.isFinite(Number(body.revision))
      ? Math.max(0, Math.floor(Number(body.revision)))
      : (current?.revision ?? 0) + 1;
    if (current && requestedRevision <= current.revision) {
      return privateJson({ conflict: true, data: JSON.parse(current.payload), updatedAt: current.updated_at, revision: current.revision }, 409);
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
      return privateJson({ conflict: true, data: latest ? JSON.parse(latest.payload) : null, updatedAt: latest?.updated_at, revision: latest?.revision ?? requestedRevision }, 409);
    }
    return privateJson({ ok: true, updatedAt: now, revision: requestedRevision });
  } catch {
    return privateJson({ ok: false, localOnly: true });
  }
}

export async function DELETE(request: Request) {
  const familyId = familyIdFrom(request);
  if (!familyId) return privateJson({ error: "invalid_family_token" }, 401);
  try {
    await ensureTable();
    await env.DB.prepare("DELETE FROM family_state WHERE family_id = ?").bind(familyId).run();
    return privateJson({ ok: true });
  } catch {
    return privateJson({ ok: false, localOnly: true }, 503);
  }
}
