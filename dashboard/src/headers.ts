/**
 * Clip header styles: a library (built-in presets + saved custom styles), a global default, a default
 * per channel and an optional override per clip. The style model itself is shared with the renderer
 * (remotion/src/header.ts), so the dashboard preview matches the video.
 */
import type { ClipRow } from "./db";
import { headerHash, normalizeHeader, type HeaderStyle } from "../../remotion/src/header";
import { DEFAULT_PRESET_ID } from "../../remotion/src/header-presets";

export type HeaderStyleRow = {
  id: string; name: string; note: string | null; style: string; builtin: number; created_at: string; updated_at: string;
};

export const parseStyle = (row: Pick<HeaderStyleRow, "style">): HeaderStyle => {
  try {
    return normalizeHeader(JSON.parse(row.style));
  } catch {
    return normalizeHeader({});
  }
};

export async function listStyles(db: D1Database): Promise<HeaderStyleRow[]> {
  const { results } = await db.prepare("SELECT * FROM header_styles ORDER BY builtin DESC, name").all<HeaderStyleRow>();
  return results;
}

export function getStyle(db: D1Database, id: string) {
  return db.prepare("SELECT * FROM header_styles WHERE id = ?").bind(id).first<HeaderStyleRow>();
}

export async function defaultStyleId(db: D1Database): Promise<string> {
  const r = await db.prepare("SELECT value FROM settings WHERE key = 'header_style_default'").first<{ value: string | null }>();
  return r?.value || DEFAULT_PRESET_ID;
}

export async function setDefaultStyle(db: D1Database, id: string) {
  await db.prepare(
    `INSERT INTO settings (key, value) VALUES ('header_style_default', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  ).bind(id).run();
}

/** Create (no id) or update a custom style. Built-ins can't be changed. Returns the id. */
export async function saveStyle(db: D1Database, f: { id?: string; name: string; style: unknown }): Promise<string> {
  const style = JSON.stringify(normalizeHeader(f.style));
  const name = f.name.trim().slice(0, 60) || "Custom style";
  if (f.id) {
    const cur = await getStyle(db, f.id);
    if (!cur) throw new Error("Style not found");
    if (cur.builtin) throw new Error("Built-in styles can't be edited; save a copy instead");
    await db.prepare("UPDATE header_styles SET name = ?, style = ?, updated_at = datetime('now') WHERE id = ?").bind(name, style, f.id).run();
    return f.id;
  }
  const id = `custom-${crypto.randomUUID().slice(0, 8)}`;
  await db.prepare("INSERT INTO header_styles (id, name, style, builtin) VALUES (?, ?, ?, 0)").bind(id, name, style).run();
  return id;
}

/** Delete a custom style; channels/clips using it fall back to their default. */
export async function deleteStyle(db: D1Database, id: string): Promise<void> {
  const cur = await getStyle(db, id);
  if (!cur || cur.builtin) throw new Error("Only custom styles can be deleted");
  const stmts = [
    db.prepare("UPDATE channels SET header_style_id = NULL WHERE header_style_id = ?").bind(id),
    db.prepare("UPDATE clips SET header_style_id = NULL WHERE header_style_id = ?").bind(id),
    db.prepare("DELETE FROM header_styles WHERE id = ?").bind(id),
  ];
  if ((await defaultStyleId(db)) === id)
    stmts.push(db.prepare("UPDATE settings SET value = ? WHERE key = 'header_style_default'").bind(DEFAULT_PRESET_ID));
  await db.batch(stmts);
}

export type ResolvedHeader = { row: HeaderStyleRow; style: HeaderStyle; from: "clip" | "channel" | "default"; hash: string };

/** The style a clip renders with: its own override → its channel's default → the global default. */
export async function resolveHeader(db: D1Database, clip: Pick<ClipRow, "header_style_id" | "channel_id" | "hook">): Promise<ResolvedHeader> {
  const tryId = async (id: string | null | undefined) => (id ? await getStyle(db, id) : null);
  let from: ResolvedHeader["from"] = "clip";
  let row = await tryId(clip.header_style_id);
  if (!row && clip.channel_id) {
    const ch = await db.prepare("SELECT header_style_id FROM channels WHERE id = ?").bind(clip.channel_id).first<{ header_style_id: string | null }>();
    row = await tryId(ch?.header_style_id);
    from = "channel";
  }
  if (!row) {
    row = (await tryId(await defaultStyleId(db))) ?? (await tryId(DEFAULT_PRESET_ID));
    from = "default";
  }
  if (!row) throw new Error("No header styles found (migration 0008 not applied?)");
  const style = parseStyle(row);
  return { row, style, from, hash: headerHash(style, clip.hook ?? "") };
}
