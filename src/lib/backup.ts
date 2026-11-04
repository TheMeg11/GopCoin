import { sql } from "drizzle-orm";
import { db } from "@/db";
import { tgApi } from "@/lib/telegram";

/**
 * Full-database backup & restore, implemented in pure SQL so it works everywhere
 * the bot runs (no pg_dump binary needed). A backup contains EVERY table row —
 * the assumption is that the Railway account may be gone and this single JSON
 * file must be enough to resurrect the whole bot on a fresh deployment.
 */

export const BACKUP_MARKER = "GOPCOIN_BACKUP";
export const BACKUP_VERSION = 1;

/** Insert order matters only for readability; there are no enforced foreign keys. */
const TABLES = [
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

export type Backup = {
  marker: typeof BACKUP_MARKER;
  version: number;
  createdAt: string;
  counts: Record<string, number>;
  data: Record<string, Record<string, unknown>[]>;
};

export async function buildBackup(): Promise<{ backup: Backup; json: string; bytes: number }> {
  const data: Record<string, Record<string, unknown>[]> = {};
  const counts: Record<string, number> = {};
  for (const t of TABLES) {
    const res = await db.execute<Record<string, unknown>>(sql`SELECT * FROM ${sql.identifier(t)} ORDER BY 1`);
    data[t] = res.rows;
    counts[t] = res.rows.length;
  }
  const backup: Backup = { marker: BACKUP_MARKER, version: BACKUP_VERSION, createdAt: new Date().toISOString(), counts, data };
  const json = JSON.stringify(backup);
  return { backup, json, bytes: Buffer.byteLength(json) };
}

function isBackupObject(v: unknown): v is Backup {
  if (typeof v !== "object" || v === null) return false;
  const b = v as Record<string, unknown>;
  return b.marker === BACKUP_MARKER && typeof b.data === "object" && b.data !== null && !Array.isArray(b.data);
}

export function validateBackupJson(text: string): Backup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The file is not valid JSON.");
  }
  if (!isBackupObject(parsed)) throw new Error("This file is not a GOP Coin backup (missing marker).");
  const missing = TABLES.filter((t) => !Array.isArray((parsed as Backup).data[t]));
  if (missing.length) throw new Error(`Backup is missing tables: ${missing.join(", ")}`);
  return parsed;
}

const SERIAL_TABLES = ["users", "referrals", "tasks", "task_claims", "crypto_orders", "account_restrictions", "broadcasts"];

/**
 * Replace the live database with the backup inside ONE transaction:
 * TRUNCATE ... RESTART IDENTITY does not fire the append-only row triggers,
 * sequences are restored, and any failure rolls the whole restore back.
 */
export async function restoreBackup(backup: Backup): Promise<Record<string, number>> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`TRUNCATE ${sql.join(TABLES.map((t) => sql.identifier(t)), sql`, `)} RESTART IDENTITY CASCADE`);
    const counts: Record<string, number> = {};
    for (const t of TABLES) {
      const rows = backup.data[t] ?? [];
      counts[t] = rows.length;
      for (const row of rows) {
        const cols = Object.keys(row).filter((k) => row[k] !== undefined);
        if (cols.length === 0) continue;
        const values = cols.map((c) => {
          const v = row[c];
          return v === null ? null : v;
        });
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
    for (const t of SERIAL_TABLES) {
      await tx.execute(
        sql`SELECT setval(pg_get_serial_sequence(${t}, 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM ${sql.identifier(t)}), 1))`,
      );
    }
    return counts;
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
