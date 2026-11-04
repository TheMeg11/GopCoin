import { sql } from "drizzle-orm";
import { db } from "@/db";
import { gameConfig } from "@/db/schema";
import { tgApi } from "@/lib/telegram";

/**
 * Full-database backup & restore, implemented in pure SQL so it works everywhere
 * the bot runs (no pg_dump binary needed). A backup contains EVERY table row —
 * the assumption is that the Railway account may be gone and this single JSON
 * file must be enough to resurrect the whole bot on a fresh deployment.
 *
 * The table list is discovered dynamically from information_schema, so tables added
 * in future releases are backed up automatically without touching this file.
 */

export const BACKUP_MARKER = "GOPCOIN_BACKUP";
export const BACKUP_VERSION = 1;

/** Readability-first ordering; dynamically discovered tables are appended at the end. */
const PRIORITY = [
  "game_config",
  "users",
  "referrals",
  "coin_transactions",
  "xp_events",
  "tasks",
  "task_claims",
  "crypto_orders",
  "security_events",
  "account_restrictions",
  "admin_audit_logs",
  "broadcasts",
  "broadcast_deliveries",
] as const;

type Exec = Pick<typeof db, "execute">;

/** All user tables in the public schema (drizzle's bookkeeping lives in its own schema). */
export async function listPublicTables(exec: Exec = db): Promise<string[]> {
  const res = await exec.execute<{ table_name: string }>(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name`);
  const names: string[] = res.rows.map((r) => r.table_name);
  const known: string[] = PRIORITY.filter((p) => names.includes(p));
  const extra: string[] = names.filter((n) => !known.includes(n));
  return [...known, ...extra];
}

export type Backup = {
  marker: typeof BACKUP_MARKER;
  version: number;
  createdAt: string;
  counts: Record<string, number>;
  data: Record<string, Record<string, unknown>[]>;
};

export async function buildBackup(): Promise<{ backup: Backup; json: string; bytes: number; tables: string[] }> {
  const tables = await listPublicTables();
  const data: Record<string, Record<string, unknown>[]> = {};
  const counts: Record<string, number> = {};
  for (const t of tables) {
    const res = await db.execute<Record<string, unknown>>(sql`SELECT * FROM ${sql.identifier(t)} ORDER BY 1`);
    data[t] = res.rows;
    counts[t] = res.rows.length;
  }
  const backup: Backup = { marker: BACKUP_MARKER, version: BACKUP_VERSION, createdAt: new Date().toISOString(), counts, data };
  const json = JSON.stringify(backup);
  return { backup, json, bytes: Buffer.byteLength(json), tables };
}

function isBackupObject(v: unknown): v is Backup {
  if (typeof v !== "object" || v === null) return false;
  const b = v as Record<string, unknown>;
  return b.marker === BACKUP_MARKER && typeof b.data === "object" && b.data !== null && !Array.isArray(b.data);
}

export function validateBackupJson(text: string): Backup {
  if (text.length > 512 * 1024 * 1024) throw new Error("File too large for a GOP Coin backup.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The file is not valid JSON.");
  }
  if (!isBackupObject(parsed)) throw new Error("This file is not a GOP Coin backup (missing marker).");
  return parsed;
}

/** All tables whose "id" column is database-generated (serial/bigserial) — sequences need fixing after restore. */
async function serialIdTables(exec: Exec): Promise<string[]> {
  const res = await exec.execute<{ table_name: string }>(sql`
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'id' AND column_default LIKE 'nextval%'
    ORDER BY table_name`);
  return res.rows.map((r) => r.table_name);
}

/**
 * Replace the live database with the backup inside ONE transaction:
 * TRUNCATE ... RESTART IDENTITY does not fire the append-only row triggers,
 * sequences are restored, and any failure rolls the whole restore back.
 * Tables missing from an older backup are restored as empty (forward-compatible).
 */
export async function restoreBackup(backup: Backup): Promise<{ counts: Record<string, number>; skipped: string[] }> {
  return db.transaction(async (tx) => {
    const tables = await listPublicTables(tx);
    await tx.execute(sql`TRUNCATE ${sql.join(tables.map((t) => sql.identifier(t)), sql`, `)} RESTART IDENTITY CASCADE`);
    const counts: Record<string, number> = {};
    const skipped: string[] = [];
    for (const t of tables) {
      const rows = backup.data[t] ?? [];
      if (!Array.isArray(backup.data[t])) skipped.push(t);
      counts[t] = rows.length;
      for (const row of rows) {
        const cols = Object.keys(row).filter((k) => row[k] !== undefined);
        if (cols.length === 0) continue;
        const values = cols.map((c) => row[c]);
        await tx.execute(
          sql`INSERT INTO ${sql.identifier(t)} (${sql.join(
            cols.map((c) => sql.identifier(c)),
            sql`, `,
          )}) VALUES (${sql.join(
            values.map((v) => sql`${v}`),
            sql`, `,
          )})`,
        );
      }
    }
    const serials = (await serialIdTables(tx)).filter((t) => tables.includes(t));
    for (const t of serials) {
      await tx.execute(
        sql`SELECT setval(pg_get_serial_sequence(${t}, 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM ${sql.identifier(t)}), 1))`,
      );
    }
    return { counts, skipped };
  });
}

export function backupFileName(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `gopcoin-backup-${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}UTC.json`;
}

/** Send a backup as a Telegram document (multipart upload). */
export async function sendBackupDocument(chatId: number, opts: { label?: string } = {}): Promise<{ ok: boolean; description?: string; bytes: number }> {
  const { json, bytes } = await buildBackup();
  const name = backupFileName();
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("caption", `${opts.label ?? "🗄 Full GOP Coin backup"}\n${new Date().toISOString()}\nKeep this file safe — it can restore the bot on any deployment.`);
  form.append("document", new Blob([json], { type: "application/json" }), name);
  const r = await tgApi("sendDocument", form);
  return { ok: r.ok, description: r.description, bytes };
}

/** Download a document the admin sent to the bot and return its text. */
export async function downloadTelegramFile(fileId: string): Promise<string> {
  const token = process.env.BOT_TOKEN;
  if (!token) throw new Error("BOT_TOKEN not configured");
  const info = await tgApi<{ file_path?: string }>("getFile", { file_id: fileId });
  if (!info.ok || !info.result?.file_path) throw new Error("Could not fetch the file from Telegram");
  const path = info.result.file_path;
  const res = await fetch(`https://api.telegram.org/file/bot${token}/${path}`, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`File download failed (${res.status})`);
  return await res.text();
}

/* --------------------- daily-backup day marker --------------------- */

const MARKER_KEY = "backup_scheduler";

async function lastBackupDay(): Promise<string | null> {
  const [row] = await db.select().from(gameConfig).where(sql`${gameConfig.key} = ${MARKER_KEY}`).limit(1);
  const v = row?.value as { day?: string } | null | undefined;
  return typeof v?.day === "string" ? v.day : null;
}

async function markBackupSent(day: string): Promise<void> {
  await db
    .insert(gameConfig)
    .values({ key: MARKER_KEY, value: { day }, updatedAt: new Date() })
    .onConflictDoUpdate({ target: gameConfig.key, set: { value: { day }, updatedAt: new Date() } });
}

/**
 * Runs the daily backup at most once per UTC day. Returns true when a backup was sent now.
 * Used both by the 00:00 UTC timer and the boot catch-up below.
 */
export async function runDailyBackupOnce(adminChatId: number, label = "⏰ Daily automatic backup (00:00 UTC)"): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10);
  if ((await lastBackupDay()) === today) return false;
  const r = await sendBackupDocument(adminChatId, { label });
  if (!r.ok) {
    console.error("[backup] daily backup delivery failed", r.description);
    return false;
  }
  await markBackupSent(today);
  console.log(`[backup] daily backup sent (${(r.bytes / 1024).toFixed(1)} KB)`);
  return true;
}
