import { env } from "cloudflare:workers";

export const runtime = "edge";

async function ensureTable() {
  if (!env.DB) throw new Error("D1 binding unavailable");
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS family_state (
      family_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();
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
      "SELECT payload, updated_at FROM family_state WHERE family_id = ?"
    ).bind(familyId).first<{ payload: string; updated_at: string }>();
    return Response.json(row ? { data: JSON.parse(row.payload), updatedAt: row.updated_at } : { data: null });
  } catch {
    return Response.json({ data: null, localOnly: true }, { status: 200 });
  }
}

export async function PUT(request: Request) {
  const familyId = familyIdFrom(request);
  if (!familyId) return Response.json({ error: "missing_family_id" }, { status: 400 });
  try {
    const body = await request.json();
    const payload = JSON.stringify(body);
    if (payload.length > 500_000) return Response.json({ error: "payload_too_large" }, { status: 413 });
    await ensureTable();
    const now = new Date().toISOString();
    await env.DB.prepare(`
      INSERT INTO family_state (family_id, payload, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(family_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
    `).bind(familyId, payload, now).run();
    return Response.json({ ok: true, updatedAt: now });
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
