# GOP Coin ⛏

A Telegram Mini App + bot where goblins **mine GOP coins automatically**. Players check in every
6 hours to keep their mine running, upgrade speed & daily capacity in the Goblin menu, invite
friends, complete tasks — and can buy GOP with **Telegram Stars** or **BNB (BEP-20)**.

The economy is fully documented in [ECONOMY.md](./ECONOMY.md) — 1 GOP ≈ 1 ⭐ ≈ $0.01 (design anchor),
base mining 0.5 GOP/h, daily cap 500 GOP (both upgradable), invite reward 50 GOP.

## Stack & architecture

- **Next.js 16** (App Router) — Mini App frontend + API routes + Telegram webhook in one process
- **PostgreSQL + Drizzle ORM** — server-authoritative balances, append-only coin ledger,
  unique idempotency keys on every mutation
- **Mining engine without cron** — accrual is computed from timestamps on demand; the only
  scheduled job is the daily 00:00 UTC backup (in-process timer)
- Deploy target: **Railway** from this GitHub repo (auto-deploy on push keeps Telegram in sync)

## Deploy on Railway

1. **Database:** add a PostgreSQL instance to the project and reference it:
   `DATABASE_URL = ${{Postgres.DATABASE_URL}}`
2. **Variables** on the app service:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
   | `BOT_TOKEN` | from @BotFather |
   | `TELEGRAM_ADMIN_ID` (or `ADMIN_ID`) | numeric Telegram id of the admin |
   | `BOT_USERNAME` / `NEXT_PUBLIC_BOT_USERNAME` | bot username without @ |
   | `WEBAPP_URL` | the public Railway domain (https) |
   | `SESSION_SECRET`, `WEBHOOK_SECRET` | `openssl rand -hex 32` (optional — derived from token if unset) |
   | `MINIAPP_SHORT_NAME` | optional: Mini App short name for direct-open referral links |
   | `BSCSCAN_API_KEY` | optional: free BscScan key for on-chain order verification |

3. **Deploy:** Railway builds with `npm ci && npm run build`, runs migrations
   (`node scripts/migrate.mjs` as pre-deploy), then starts `npm run start`.
   Healthcheck: `/api/health`.
   - The pre-deploy runner is **self-healing**: if it finds a database from an older schema
     generation (or a journal mismatch), it snapshots EVERY existing row, tries to send that
     snapshot to the admin via Telegram, then rebuilds the schema from the current migrations
     and migrates. Fresh databases just migrate normally.
4. On boot the app **auto-registers the webhook, commands and menu button** (needs `WEBAPP_URL`
   to be set). No manual setup needed; the admin panel also has a setup button.
5. **Channel task:** add the bot as an **admin** to `@GOPCOININFO` so the join-task can verify
   membership via `getChatMember`.

## Admin (private chat with the bot, admin only)

| Command | Action |
|---|---|
| `/BACKUP` | sends a **full** database backup (every table, JSON document) to the chat |
| `/RESTORE` | arms restore mode for 10 min → send a backup `.json` file → the bot saves a safety backup, then replaces the live database |
| `/ORDERS` | lists pending crypto orders with on-chain verify / approve / reject buttons |

**Daily backup:** every day at 00:00 UTC the bot automatically sends the admin a full backup
document — no command needed. A persisted day-marker guarantees at-most-once per UTC day, and a
boot catch-up sends the backup immediately if a restart landed on the scheduled moment.
(`DISABLE_AUTO_BACKUP=true` to opt out.)

The web admin panel (in-app for the admin id) covers config, users, tasks, broadcasts, audit.

## Payments

- **Telegram Stars:** packages in the shop → the bot sends a real Stars invoice → coins are
  credited only on Telegram's `successful_payment` webhook, keyed by the charge id (double-credit
  is database-impossible).
- **BNB (BEP-20):** user sends BNB to the configured address, submits the TXID in the app →
  admin verifies on-chain (BscScan) and approves → coins credited once (`crypto:<orderId>`).
  TX hashes are globally unique; expected amounts are locked at order creation (+3 % buffer).

## Local development

```bash
npm ci
cp .env.example .env   # fill DATABASE_URL etc.
npm run db:migrate     # or: node scripts/migrate.mjs
npm run dev
```

Demo mode (no `BOT_TOKEN`) is for previews only and auto-disables in production.

## Scripts

- `npm run build` / `npm run start` — production build & serve
- `npm run lint` / `npm run typecheck` / `npm test` — quality gates
- `node scripts/migrate.mjs` — apply SQL migrations (runs automatically before deploy on Railway)
