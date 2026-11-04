import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { cryptoOrders, users, type CryptoOrder, type User } from "@/db/schema";
import { MILLI } from "@/lib/mine";
import { getConfig, type GameConfig } from "@/lib/config";
import { ApiError } from "@/lib/http";
import { creditCoins, grantXp, type Tx } from "@/lib/ledger";
import { recordSecurityEvent } from "@/lib/risk";
import { tgApi } from "@/lib/telegram";
import { displayName } from "@/lib/users";

/* ------------------------------------------------------------------ */
/* Upgrades (goblin menu) — prices are looked up server-side, burn GOP */
/* ------------------------------------------------------------------ */

export type UpgradeKind = "speed" | "limit";

export type UpgradeView = {
  kind: UpgradeKind;
  tier: number;
  maxTier: number;
  currentValue: number; // current speed GOP/h or current cap GOP
  nextValue: number | null;
  price: number | null; // whole GOP to burn, null = maxed
};

export function upgradeView(u: Pick<User, "mineSpeedTier" | "mineLimitTier">, cfg: GameConfig, kind: UpgradeKind): UpgradeView {
  if (kind === "speed") {
    const tier = u.mineSpeedTier;
    const max = cfg.mine.speedTiers.length - 1;
    return {
      kind,
      tier,
      maxTier: max,
      currentValue: cfg.mine.speedTiers[Math.min(tier, max)],
      nextValue: tier < max ? cfg.mine.speedTiers[tier + 1] : null,
      price: tier < max ? cfg.mine.speedPrices[tier] : null,
    };
  }
  const tier = u.mineLimitTier;
  const max = cfg.mine.limitTiers.length - 1;
  return {
    kind,
    tier,
    maxTier: max,
    currentValue: cfg.mine.limitTiers[Math.min(tier, max)],
    nextValue: tier < max ? cfg.mine.limitTiers[tier + 1] : null,
    price: tier < max ? cfg.mine.limitPrices[tier] : null,
  };
}

/** Buy an upgrade with mined coins. The coins are burned (immutable negative ledger row). */
export async function purchaseUpgrade(o: { userId: number; kind: UpgradeKind; cfg?: GameConfig; now?: Date }): Promise<{ tier: number; price: number; balanceMilli: number }> {
  const cfg = o.cfg ?? (await getConfig());
  return db.transaction(async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.id, o.userId)).for("update");
    if (!u) throw new ApiError(404, "USER_NOT_FOUND");
    const view = upgradeView(u, cfg, o.kind);
    if (view.price === null || view.nextValue === null) throw new ApiError(400, "ALREADY_MAXED", "This upgrade is already at the highest tier");
    const priceMilli = view.price * MILLI;
    if (u.balance < priceMilli) throw new ApiError(400, "INSUFFICIENT_FUNDS", `You need ${view.price.toLocaleString("en-US")} GOP for this upgrade`);

    // The idempotency key pins the FROM-tier: a retried request after a successful purchase
    // resolves to a different key (new tier) and can never burn coins twice for one upgrade.
    const finalKey = o.kind === "speed" ? `upgrade:speed:${o.userId}:${u.mineSpeedTier}` : `upgrade:limit:${o.userId}:${u.mineLimitTier}`;
    const balanceMilli = await creditCoins(tx, {
      userId: o.userId,
      amount: -priceMilli,
      type: "upgrade",
      key: finalKey,
      sourceRef: `${o.kind}:${view.tier}->${view.tier + 1}`,
      reason: `Upgrade ${o.kind} tier ${view.tier} → ${view.tier + 1}`,
    });
    if (balanceMilli === null) throw new ApiError(409, "UPGRADE_ALREADY_APPLIED", "This upgrade was already purchased");
    const [updated] = await tx
      .update(users)
      .set(o.kind === "speed" ? { mineSpeedTier: view.tier + 1 } : { mineLimitTier: view.tier + 1 })
      .where(eq(users.id, o.userId))
      .returning();
    // Small engagement reward for progressing (does not affect supply — it is a level metric only).
    await grantXp(tx, { userId: o.userId, amount: 50, type: "upgrade", key: `upgrade_xp:${finalKey}`, levels: cfg.progression.levels });
    return { tier: o.kind === "speed" ? updated.mineSpeedTier : updated.mineLimitTier, price: view.price, balanceMilli };
  });
}

/* ------------------------------------------------------------------ */
/* Telegram Stars                                                      */
/* ------------------------------------------------------------------ */

export type StarsPackage = GameConfig["payments"]["stars"]["packages"][number];

export function findStarsPackage(cfg: GameConfig, id: string): StarsPackage | null {
  return cfg.payments.stars.packages.find((p) => p.id === id) ?? null;
}

/** Credit a paid Stars invoice exactly once, keyed by Telegram's unique charge id. */
export async function creditStarsPayment(o: { userId: number; packageId: string; chargeId: string; stars: number; cfg: GameConfig }): Promise<{ credited: boolean; gop: number }> {
  const pkg = findStarsPackage(o.cfg, o.packageId);
  if (!pkg || pkg.stars !== o.stars) {
    // The invoice was paid for a package that no longer matches config — credit the historic
    // gopPerStar conversion so the user is never charged without receiving coins.
    const gop = Math.floor(o.stars * o.cfg.payments.stars.gopPerStar);
    if (gop <= 0) return { credited: false, gop: 0 };
    await db.transaction(async (tx) => {
      await creditCoins(tx, { userId: o.userId, amount: gop * MILLI, type: "purchase_stars", key: `stars:${o.chargeId}`, sourceRef: o.chargeId, reason: `Stars fallback ${o.stars}⭐` });
    });
    return { credited: true, gop };
  }
  const res = await db.transaction(async (tx) => {
    const balance = await creditCoins(tx, {
      userId: o.userId,
      amount: pkg.gop * MILLI,
      type: "purchase_stars",
      key: `stars:${o.chargeId}`,
      sourceRef: o.chargeId,
      reason: `${pkg.stars} Stars → ${pkg.gop} GOP (${o.packageId})`,
    });
    return balance;
  });
  return { credited: res !== null, gop: pkg.gop };
}

/* ------------------------------------------------------------------ */
/* Crypto (BNB / BEP-20)                                               */
/* ------------------------------------------------------------------ */

export type CryptoPackage = GameConfig["payments"]["crypto"]["packages"][number];

export function findCryptoPackage(cfg: GameConfig, id: string): CryptoPackage | null {
  return cfg.payments.crypto.packages.find((p) => p.id === id) ?? null;
}

/** Exact expected asset amount for a package, locked at order creation (buffer included). */
export function expectedAssetAmount(pkg: CryptoPackage, cfg: GameConfig): number {
  const usd = pkg.usd;
  const bnb = usd / cfg.payments.crypto.bnbUsd;
  return Number((bnb * (1 + cfg.payments.crypto.bufferPercent / 100)).toFixed(8));
}

const TX_HASH_RE = /^0x[a-fA-F0-9]{64}$/;

/** Create a pending crypto order. One TX hash can ever be bound to one order (global unique index). */
export async function createCryptoOrder(o: { userId: number; packageId: string; txHash: string; cfg: GameConfig }): Promise<CryptoOrder> {
  const hash = o.txHash.trim();
  if (!TX_HASH_RE.test(hash)) throw new ApiError(400, "BAD_TX_HASH", "That does not look like a valid transaction hash");
  const pkg = findCryptoPackage(o.cfg, o.packageId);
  if (!pkg) throw new ApiError(400, "BAD_PACKAGE", "Unknown package");
  const assetAmount = expectedAssetAmount(pkg, o.cfg);
  const [dupUser] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(cryptoOrders)
    .where(and(eq(cryptoOrders.userId, o.userId), eq(cryptoOrders.status, "pending")));
  if (dupUser.c >= 3) throw new ApiError(429, "TOO_MANY_PENDING", "You already have 3 orders awaiting verification. Ask support or wait for approval.");

  try {
    const [order] = await db
      .insert(cryptoOrders)
      .values({
        userId: o.userId,
        packageId: pkg.id,
        gopAmount: pkg.gop,
        usdAmount: pkg.usd.toFixed(2),
        assetSymbol: o.cfg.payments.crypto.assetSymbol,
        assetAmount: assetAmount.toFixed(8),
        assetUsdRate: o.cfg.payments.crypto.bnbUsd.toFixed(2),
        address: o.cfg.payments.crypto.address,
        txHash: hash,
        status: "pending",
      })
      .returning();
    return order;
  } catch (e) {
    if (isUniqueViolation(e)) throw new ApiError(409, "TX_ALREADY_USED", "This transaction hash was already submitted");
    throw e;
  }
}

function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
}

export async function listUserCryptoOrders(userId: number): Promise<CryptoOrder[]> {
  return db.select().from(cryptoOrders).where(eq(cryptoOrders.userId, userId)).orderBy(desc(cryptoOrders.id)).limit(20);
}

export async function listPendingCryptoOrders(): Promise<(CryptoOrder & { userName: string; telegramId: number })[]> {
  const rows = await db
    .select({ o: cryptoOrders, u: users })
    .from(cryptoOrders)
    .innerJoin(users, eq(users.id, cryptoOrders.userId))
    .where(eq(cryptoOrders.status, "pending"))
    .orderBy(desc(cryptoOrders.id))
    .limit(50);
  return rows.map((r) => ({ ...r.o, userName: displayName(r.u), telegramId: r.u.telegramId }));
}

const BSCSCAN = "https://api.bscscan.com/api";
const BSC_RPC_URLS = ["https://bsc-dataseed.binance.org", "https://bsc-rpc.publicnode.com", "https://bsc.publicnode.com", "https://rpc-bsc.48.club"];

type BscTx = { ok: boolean; from?: string; to?: string; valueBnb?: number; success?: boolean; error?: string };

/** On-chain check via BscScan (works keyless at low rate; set BSCSCAN_API_KEY for higher limits). */
async function fetchTxViaBscScan(txHash: string): Promise<BscTx> {
  const key = process.env.BSCSCAN_API_KEY?.trim();
  const url = (action: string) =>
    `${BSCSCAN}?module=proxy&action=${action}&txhash=${txHash}${key ? `&apikey=${encodeURIComponent(key)}` : ""}`;
  const [txRes, rcRes] = await Promise.all([
    fetch(url("eth_getTransactionByHash"), { signal: AbortSignal.timeout(10_000) }),
    fetch(url("eth_getTransactionReceipt"), { signal: AbortSignal.timeout(10_000) }),
  ]);
  const tx = (await txRes.json()) as { result?: { from?: string; to?: string; value?: string } | null };
  const rc = (await rcRes.json()) as { result?: { status?: string } | null };
  if (!tx.result) return { ok: false, error: "Transaction not found on BNB Smart Chain (yet?) — if you just sent it, wait ~1 minute and try again." };
  const success = rc.result?.status === "0x1";
  const valueBnb = tx.result.value ? Number(BigInt(tx.result.value)) / 1e18 : 0;
  return { ok: true, from: tx.result.from?.toLowerCase(), to: tx.result.to?.toLowerCase(), valueBnb, success };
}

/** Fallback: query public BSC nodes directly (no key, no rate limit shared with BscScan). */
async function fetchTxViaRpc(txHash: string): Promise<BscTx> {
  const body = (method: string) => JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [txHash] });
  let lastError: unknown = null;
  for (const rpcUrl of BSC_RPC_URLS) {
    try {
      const [txRes, rcRes] = await Promise.all([
        fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: body("eth_getTransactionByHash"), signal: AbortSignal.timeout(8_000) }),
        fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: body("eth_getTransactionReceipt"), signal: AbortSignal.timeout(8_000) }),
      ]);
      if (!txRes.ok || !rcRes.ok) throw new Error(`http ${txRes.status}/${rcRes.status}`);
      const tx = (await txRes.json()) as { result?: { from?: string; to?: string; value?: string } | null };
      const rc = (await rcRes.json()) as { result?: { status?: string } | null };
      if (!tx.result) return { ok: false, error: "Transaction not found on BNB Smart Chain (yet?) — if you just sent it, wait ~1 minute and try again." };
      const success = rc.result?.status === "0x1";
      const valueBnb = tx.result.value ? Number(BigInt(tx.result.value)) / 1e18 : 0;
      return { ok: true, from: tx.result.from?.toLowerCase(), to: tx.result.to?.toLowerCase(), valueBnb, success };
    } catch (e) {
      lastError = e;
    }
  }
  return { ok: false, error: lastError instanceof Error ? lastError.message : "all BSC RPC nodes failed" };
}

/** BscScan first, public RPC fallback — one of them must answer for the admin to verify. */
export async function fetchTxDetails(txHash: string): Promise<BscTx> {
  try {
    const viaScan = await fetchTxViaBscScan(txHash);
    // A not-found answer may be a BscScan hiccup — try the RPC path before giving up.
    if (viaScan.ok) return viaScan;
    const viaRpc = await fetchTxViaRpc(txHash);
    return viaRpc.ok ? viaRpc : viaScan;
  } catch (e) {
    const viaRpc = await fetchTxViaRpc(txHash);
    if (viaRpc.ok) return viaRpc;
    return { ok: false, error: e instanceof Error ? e.message : "BscScan request failed" };
  }
}

/** Admin approval: status transition is conditional, ledger key makes the credit idempotent. */
export async function decideCryptoOrder(o: {
  adminTelegramId: number;
  orderId: number;
  decision: "approve" | "reject";
  txFrom?: string | null;
  txValue?: number | null;
  note?: string;
}): Promise<{ order: CryptoOrder; credited: boolean }> {
  const cfg = await getConfig();
  return db.transaction(async (tx) => {
    const [order] = await tx
      .update(cryptoOrders)
      .set({
        status: o.decision === "approve" ? "approved" : "rejected",
        adminTelegramId: o.adminTelegramId,
        decidedAt: new Date(),
        txFrom: o.txFrom ?? undefined,
        txValue: o.txValue !== null && o.txValue !== undefined ? o.txValue.toFixed(8) : undefined,
        note: o.note ?? undefined,
      })
      .where(and(eq(cryptoOrders.id, o.orderId), eq(cryptoOrders.status, "pending")))
      .returning();
    if (!order) throw new ApiError(409, "ORDER_NOT_PENDING", "This order was already processed");
    let credited = false;
    if (o.decision === "approve") {
      const balance = await creditCoins(tx, {
        userId: order.userId,
        amount: order.gopAmount * MILLI,
        type: "purchase_crypto",
        key: `crypto:${order.id}`,
        sourceRef: order.txHash ?? `order:${order.id}`,
        reason: `${order.assetAmount} ${order.assetSymbol} → ${order.gopAmount} GOP (${order.packageId})`,
      });
      credited = balance !== null;
    }
    return { order, credited };
  });
}

/** Notify the admin about a new pending crypto order (called from the API route). */
export async function notifyNewCryptoOrder(order: CryptoOrder, userName: string): Promise<void> {
  const adminId = adminIdForNotify();
  if (!adminId) return;
  const bscscan = order.txHash ? `https://bscscan.com/tx/${order.txHash}` : null;
  await tgApi("sendMessage", {
    chat_id: adminId,
    text:
      `🪙 <b>New crypto order #${order.id}</b>\n\n` +
      `From: <b>${escapeHtml(userName)}</b>\n` +
      `Package: <b>${order.gopAmount.toLocaleString("en-US")} GOP</b> ($${order.usdAmount})\n` +
      `Expected: <b>${order.assetAmount} ${order.assetSymbol}</b>\n` +
      `To: <code>${order.address}</code>\n` +
      `TX: <code>${order.txHash ?? "—"}</code>\n` +
      (bscscan ? `${bscscan}\n` : "") +
      `\nUse /orders in the bot to verify & approve.`,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
}

function adminIdForNotify(): number | null {
  const raw = process.env.TELEGRAM_ADMIN_ID?.trim() || process.env.ADMIN_ID?.trim();
  return raw && /^\d{1,20}$/.test(raw) ? Number(raw) : null;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}

/** Risk helper: unusual burst of crypto order submissions. */
export async function noteCryptoSubmission(userId: number, flagThreshold: number): Promise<void> {
  await recordSecurityEvent({ userId, type: "crypto_order_spam", flagThreshold });
}

export type { Tx };
