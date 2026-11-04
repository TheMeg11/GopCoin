import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getConfig } from "@/lib/config";
import { botUsername, referralLinks, webAppUrl, webhookSecret } from "@/lib/env";
import { parseReferralParam, tgApi, type TelegramUser } from "@/lib/telegram";
import { buildMineState, checkIn, MILLI } from "@/lib/mine";
import { findStarsPackage, decideCryptoOrder, fetchTxDetails, listPendingCryptoOrders, escapeHtml } from "@/lib/shop";
import { downloadTelegramFile, restoreBackup, sendBackupDocument, validateBackupJson } from "@/lib/backup";
import { isAdminTelegramId } from "@/lib/env";
import { upsertTelegramUser } from "@/lib/users";

type Chat = { id: number; type: string };
type InlineKeyboard = { inline_keyboard: { text: string; url?: string; web_app?: { url: string }; callback_data?: string; switch_inline_query?: string }[][] };

export type SuccessfulPayment = { telegram_payment_charge_id: string; invoice_payload: string; total_amount: number; currency: string };
export type TgUpdate = {
  update_id: number;
  message?: {
    message_id: number; chat: Chat; from?: TelegramUser; text?: string;
    document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
    successful_payment?: SuccessfulPayment;
  };
  callback_query?: { id: string; from: TelegramUser; data?: string; message?: { chat: Chat; message_id: number } };
  pre_checkout_query?: { id: string; from: TelegramUser; currency: string; total_amount: number; invoice_payload: string };
  my_chat_member?: { chat: Chat; from: TelegramUser; new_chat_member: { status: string } };
};

/** /RESTORE is armed per admin chat for 10 minutes; the next document is then applied. */
const restoreArmed = new Map<number, number>();
const RESTORE_ARM_MS = 10 * 60_000;

export function fmtGop(n: number): string {
  const v = Math.round(n * 1000) / 1000;
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

const CHANNEL_URL = "https://t.me/GOPCOININFO";

function shareText(link: string, inviteeReward: number): string {
  return `⛏ Dig with me in GOP COIN — the goblin mining game!\n\n🪙 Your mine produces coins 24/7 — you only check in every 6 hours to keep it running\n⬆️ Upgrade your pickaxe speed & daily capacity\n👥 +${inviteeReward} GOP welcome bonus when you join with my link\n\n👉 ${link}`;
}

function shareUrl(link: string, inviteeReward: number): string {
  return `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(shareText(link, inviteeReward))}`;
}

function mainKeyboard(link: string | null, inviteeReward: number): InlineKeyboard {
  const url = webAppUrl();
  const rows: InlineKeyboard["inline_keyboard"] = [];
  if (url) rows.push([{ text: "⛏ Open Mine", web_app: { url } }]);
  rows.push([{ text: "💰 Buy GOP", callback_data: "shop" }, { text: "👥 Invite +GOP", url: link ? shareUrl(link, inviteeReward) : CHANNEL_URL }]);
  rows.push([{ text: "📢 Official channel", url: CHANNEL_URL }]);
  return { inline_keyboard: rows };
}

async function reply(chatId: number, text: string, markup?: InlineKeyboard) {
  await tgApi("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...(markup ? { reply_markup: markup } : {}), link_preview_options: { is_disabled: true } });
}

async function replyPhoto(chatId: number, photoUrl: string | null, caption: string, markup?: InlineKeyboard) {
  if (photoUrl) {
    const r = await tgApi("sendPhoto", { chat_id: chatId, photo: photoUrl, caption, parse_mode: "HTML", ...(markup ? { reply_markup: markup } : {}), link_preview_options: { is_disabled: true } });
    if (r.ok) return;
  }
  await reply(chatId, caption, markup);
}

function appLogo(): string | null {
  const url = webAppUrl();
  return url ? `${url}/art/icon.png` : null;
}

/* ------------------------------------------------------------------ */
/* Update router                                                       */
/* ------------------------------------------------------------------ */

export async function handleUpdate(update: TgUpdate): Promise<void> {
  if (update.my_chat_member) {
    const m = update.my_chat_member;
    if (m.chat.type === "private") {
      const blocked = m.new_chat_member.status === "kicked";
      await db.update(users).set(blocked ? { botBlocked: true } : { botBlocked: false, canMessage: true }).where(eq(users.telegramId, m.from.id));
    }
    return;
  }

  if (update.pre_checkout_query) return handlePreCheckout(update.pre_checkout_query);

  if (update.callback_query) return handleCallback(update.callback_query);

  const msg = update.message;
  if (!msg || !msg.from || msg.chat.type !== "private" || msg.from.is_bot) return;

  if (msg.successful_payment) return handleSuccessfulPayment(msg.from, msg.chat.id, msg.successful_payment);

  if (msg.document) return handleDocument(msg.from.id, msg.chat.id, msg.document);

  if (!msg.text) return;
  const [rawCmd, ...rest] = msg.text.trim().split(/\s+/);
  const cmd = rawCmd.toLowerCase().replace(/@.*$/, "");
  const payload = rest.join(" ");
  const cfg = await getConfig();

  if (cmd === "/start") {
    // The webhook is authenticated by Telegram's secret token, so `from` and payload are trusted.
    const buyPkg = /^buy_([a-z0-9_]{1,24})$/i.exec(payload.trim());
    const { user, created } = await upsertTelegramUser({ tg: msg.from, referralCode: parseReferralParam(payload), source: "bot", canMessage: true });
    const link = referralLinks(user.referralCode).primary;
    const invited = created && user.referredById;
    const mine = buildMineState(user, cfg);
    await replyPhoto(
      msg.chat.id,
      appLogo(),
      `<b>Welcome to GOP COIN, ${escapeHtml(msg.from.first_name)}!</b> 🪙⛏\n\n` +
        `Your goblin mine <b>already started digging</b>: it produces <b>${mine.speedGop} GOP/hour</b> around the clock — you only have to check in once every <b>${cfg.mine.shutdownHours} hours</b> to keep it running. Miss the window and the mine shuts down until you restart it.\n\n` +
        `🪙 Daily mining capacity: <b>${fmtGop(mine.dailyLimit)} GOP</b>\n` +
        `⬆️ Upgrade speed & capacity in the Goblin menu\n` +
        `👥 Invite friends: <b>+${cfg.referral.inviterReward} GOP</b> each\n` +
        `💰 Need coins fast? Buy GOP with Telegram Stars or BNB\n` +
        (invited ? `\n🎁 You were invited by a friend! Check in once to unlock your <b>+${cfg.referral.inviteeReward} GOP</b> welcome bonus.\n` : "") +
        `\n📢 News & updates: ${CHANNEL_URL}`,
      mainKeyboard(link, cfg.referral.inviteeReward),
    );
    if (buyPkg) {
      const pkg = findStarsPackage(cfg, buyPkg[1].toLowerCase());
      if (pkg) await sendStarsInvoice(msg.chat.id, pkg.id, pkg.gop, pkg.stars);
    }
    return;
  }

  const [user] = await db.select().from(users).where(eq(users.telegramId, msg.from.id)).limit(1);
  if (!user && cmd !== "/help") {
    await reply(msg.chat.id, "Send /start to create your GOP Coin account first.");
    return;
  }

  switch (cmd) {
    case "/mine":
    case "/collect":
      return void (await sendMineStatus(msg.chat.id, user, cfg));
    case "/play":
      await reply(msg.chat.id, "⛏ Your mine awaits!", mainKeyboard(referralLinks(user.referralCode).primary, cfg.referral.inviteeReward));
      break;
    case "/balance": {
      const mine = buildMineState(user, cfg);
      await reply(
        msg.chat.id,
        `💰 <b>Balance:</b> ${fmtGop(user.balance / MILLI)} GOP\n⛏ <b>Mine speed:</b> ${mine.speedGop} GOP/h\n📅 <b>Mined today:</b> ${fmtGop(mine.minedToday)} / ${fmtGop(mine.dailyLimit)} GOP\n👥 <b>Friends activated:</b> ${user.referralCount}\n⭐ <b>Level:</b> ${user.level}`,
        mainKeyboard(null, cfg.referral.inviteeReward),
      );
      break;
    }
    case "/buy":
      return void (await sendShop(msg.chat.id, cfg));
    case "/referral":
    case "/invite": {
      const link = referralLinks(user.referralCode).primary;
      const appRow: InlineKeyboard["inline_keyboard"] = webAppUrl() ? [[{ text: "⛏ Open my mine", web_app: { url: webAppUrl() } }]] : [];
      await replyPhoto(
        msg.chat.id,
        appLogo(),
        `👥 <b>Invite friends, both win!</b>\n\nYou get <b>+${cfg.referral.inviterReward} GOP</b> and your friend gets <b>+${cfg.referral.inviteeReward} GOP</b> once they run their first check-in.\n\nActivated friends: <b>${user.referralCount}</b>\nEarned from referrals: <b>${fmtGop(user.referralEarned / MILLI)} GOP</b>\n\n👇 Share this — the more goblins in your crew, the richer the mine:\n<code>${link}</code>`,
        { inline_keyboard: [[{ text: "📤 Share invite", url: shareUrl(link, cfg.referral.inviteeReward) }], ...appRow] },
      );
      break;
    }
    case "/channel":
      await reply(msg.chat.id, `📢 <b>Official GOP Coin channel</b>\n\nNews, events and important announcements:\n${CHANNEL_URL}`, { inline_keyboard: [[{ text: "📢 Open channel", url: CHANNEL_URL }]] });
      break;
    case "/backup":
      return void (await adminBackup(msg.from.id, msg.chat.id));
    case "/restore":
      return void (await adminRestoreArm(msg.from.id, msg.chat.id));
    case "/orders":
      return void (await adminListOrders(msg.from.id, msg.chat.id));
    case "/help":
      await reply(
        msg.chat.id,
        `<b>How GOP Coin works</b> ⛏\n\n` +
          `• Your mine produces <b>${cfg.mine.speedTiers[0]} GOP</b> every hour, automatically\n` +
          `• Check in at least every <b>${cfg.mine.shutdownHours}h</b> or the mine shuts down\n` +
          `• Daily mining capacity: <b>${fmtGop(cfg.mine.limitTiers[0])}+ GOP</b> (upgradable)\n` +
          `• Upgrade speed & capacity in the Goblin menu — upgrades burn coins and make the mine stronger\n` +
          `• Invite friends: +${cfg.referral.inviterReward} GOP each · buy GOP with Stars or BNB\n` +
          `• XP from every check-in levels your goblin from Baby to King\n\n` +
          `Commands: /mine /balance /buy /invite /channel`,
        mainKeyboard(referralLinks(user?.referralCode ?? "").primary, cfg.referral.inviteeReward),
      );
      break;
    default:
      if (cmd.startsWith("/")) await reply(msg.chat.id, "Unknown command — try /help 👈", mainKeyboard(null, cfg.referral.inviteeReward));
  }
}

/* ------------------------------------------------------------------ */
/* Mine status & check-in                                              */
/* ------------------------------------------------------------------ */

async function sendMineStatus(chatId: number, user: typeof users.$inferSelect, cfg: Awaited<ReturnType<typeof getConfig>>) {
  const mine = buildMineState(user, cfg);
  const status = mine.on
    ? `⛏ <b>Your mine is running</b> — ${mine.speedGop} GOP/h\n⏱ Shuts down in <b>${formatDuration(mine.shutdownInMs ?? 0)}</b> unless you check in`
    : `💤 <b>Your mine is OFF</b> — you missed the ${cfg.mine.shutdownHours}h check-in window.\nCheck in now to restart production!`;
  await reply(
    chatId,
    `${status}\n\n💰 Balance: <b>${fmtGop(user.balance / MILLI)} GOP</b>\n🪙 Ready to collect: <b>${fmtGop(mine.pendingGop)} GOP</b>\n📅 Today: ${fmtGop(mine.minedToday)} / ${fmtGop(mine.dailyLimit)} GOP\n\nCheck in every ${cfg.mine.shutdownHours}h to keep the mine alive!`,
    { inline_keyboard: [[{ text: "⛏ CHECK IN & COLLECT", callback_data: "checkin" }], [{ text: "🎮 Open Mine", web_app: { url: webAppUrl() } }].filter((b) => "web_app" in b)] },
  );
}

function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/* ------------------------------------------------------------------ */
/* Shop: Stars invoices & crypto                                       */
/* ------------------------------------------------------------------ */

async function sendShop(chatId: number, cfg: Awaited<ReturnType<typeof getConfig>>) {
  if (!cfg.features.shop) return void (await reply(chatId, "The shop is closed right now."));
  const rows: InlineKeyboard["inline_keyboard"] = [];
  if (cfg.payments.stars.enabled) {
    for (const p of cfg.payments.stars.packages) rows.push([{ text: `🪙 ${fmtGop(p.gop)} GOP — ⭐${p.stars}`, callback_data: `buys:${p.id}` }]);
  }
  if (cfg.payments.crypto.enabled) rows.push([{ text: `₿ Pay with ${cfg.payments.crypto.assetSymbol} (BEP-20)`, callback_data: "crypto" }]);
  rows.push([{ text: "🎮 Open Mine", web_app: { url: webAppUrl() } }].filter((b) => "web_app" in b));
  await reply(
    chatId,
    `💰 <b>Buy GOP Coins</b>\n\n1 GOP ≈ 1 ⭐. Coins land in your balance instantly.\nFor larger amounts, pay with ${cfg.payments.crypto.assetSymbol} on ${cfg.payments.crypto.network}.`,
    { inline_keyboard: rows },
  );
}

async function sendStarsInvoice(chatId: number, pkgId: string, gop: number, stars: number) {
  await tgApi("sendInvoice", {
    chat_id: chatId,
    title: `${gop.toLocaleString("en-US")} GOP Coins`,
    description: `GOP Coin in-game currency — delivered instantly to your balance.`,
    payload: `stars:${pkgId}`,
    currency: "XTR",
    prices: [{ label: `${gop.toLocaleString("en-US")} GOP`, amount: stars }],
  });
}

async function handlePreCheckout(q: NonNullable<TgUpdate["pre_checkout_query"]>) {
  const cfg = await getConfig();
  const [kind, pkgId] = q.invoice_payload.split(":");
  const ok = kind === "stars" && !!findStarsPackage(cfg, pkgId ?? "") && q.currency === "XTR";
  await tgApi("answerPreCheckoutQuery", { pre_checkout_query_id: q.id, ok, error_message: ok ? undefined : "This offer is no longer available. Open /buy again." });
}

async function handleSuccessfulPayment(from: TelegramUser, chatId: number, p: SuccessfulPayment) {
  const cfg = await getConfig();
  const { user } = await upsertTelegramUser({ tg: from, referralCode: null, source: "bot", canMessage: true });
  const { creditStarsPayment } = await import("@/lib/shop");
  const [kind, pkgId] = p.invoice_payload.split(":");
  if (kind !== "stars") return;
  const r = await creditStarsPayment({ userId: user.id, packageId: pkgId ?? "", chargeId: p.telegram_payment_charge_id, stars: p.total_amount, cfg });
  if (r.credited) {
    await reply(chatId, `✅ Payment received — <b>+${fmtGop(r.gop)} GOP</b> added to your balance. Happy mining! ⛏`);
    await notifyAdmin(`💸 <b>Stars purchase</b>: ${escapeHtml(user.firstName || String(from.id))} (ID <code>${from.id}</code>) bought <b>${fmtGop(r.gop)} GOP</b> for <b>⭐${p.total_amount}</b>.`);
  } else {
    await reply(chatId, "Payment received but the package could not be matched. The admin has been notified.");
    await notifyAdmin(`⚠️ Stars payment unmatched: charge <code>${p.telegram_payment_charge_id}</code>, payload <code>${p.invoice_payload}</code>, ${p.total_amount} XTR, user ${from.id}.`);
  }
}

/* ------------------------------------------------------------------ */
/* Admin: backup / restore / orders                                    */
/* ------------------------------------------------------------------ */

async function adminBackup(tgId: number, chatId: number) {
  if (!requireBotAdmin(tgId)) return void (await reply(chatId, "This command is only for the bot administrator."));
  const r = await sendBackupDocument(chatId, { label: "🗄 Manual full backup (/backup)" });
  if (!r.ok) await reply(chatId, `Backup failed: ${r.description ?? "unknown error"}`);
}

async function adminRestoreArm(tgId: number, chatId: number) {
  if (!requireBotAdmin(tgId)) return void (await reply(chatId, "This command is only for the bot administrator."));
  restoreArmed.set(tgId, Date.now());
  await reply(
    chatId,
    `♻️ <b>Restore mode armed</b>\n\nSend me a GOP Coin backup file (<code>.json</code>) within 10 minutes.\nI will verify it, save a safety backup of the current data, then replace the live database with your file.\n\n⚠️ This overwrites ALL current data. Send /restore_cancel to abort.`,
    { inline_keyboard: [[{ text: "✖ Cancel restore", callback_data: "restore_cancel" }]] },
  );
}

async function handleDocument(tgId: number, chatId: number, doc: NonNullable<TgUpdate["message"]>["document"]) {
  if (!doc) return;
  const armed = restoreArmed.get(tgId);
  const armedFresh = armed && Date.now() - armed < RESTORE_ARM_MS;
  if (!requireBotAdmin(tgId)) return; // documents from non-admins are ignored entirely
  if (!armedFresh) {
    restoreArmed.delete(tgId);
    await reply(chatId, "To restore data, first send /RESTORE, then the backup file. Nothing was changed.");
    return;
  }
  restoreArmed.delete(tgId);
  if ((doc.file_size ?? 0) > 96 * 1024 * 1024) return void (await reply(chatId, "File too large."));
  await reply(chatId, "⏳ Downloading and verifying backup…");
  try {
    const text = await downloadTelegramFile(doc.file_id);
    const backup = validateBackupJson(text);
    // Safety net: snapshot the CURRENT database before overwriting it.
    const safety = await sendBackupDocument(chatId, { label: "🛟 Safety backup (state before restore)" });
    if (!safety.ok) {
      await reply(chatId, "⚠️ Could not create the safety backup — aborting the restore to protect your data. Nothing was changed.");
      return;
    }
    await reply(chatId, `✅ Backup verified (created ${backup.createdAt}). Safety backup sent above.\n⏳ Restoring…`);
    const counts = await restoreBackup(backup);
    const summary = Object.entries(counts).filter(([, n]) => n > 0).map(([t, n]) => `${t}: ${n}`).join(", ") || "empty database";
    await reply(chatId, `✅ <b>Restore complete</b>\n\n${summary}\n\nAll sessions remain valid. The bot is now running on the restored data.`);
  } catch (e) {
    await reply(chatId, `❌ Restore failed: ${e instanceof Error ? e.message : "unknown error"}\n\nThe current database was NOT modified.`);
  }
}

async function adminListOrders(tgId: number, chatId: number) {
  if (!requireBotAdmin(tgId)) return void (await reply(chatId, "This command is only for the bot administrator."));
  const orders = await listPendingCryptoOrders();
  if (orders.length === 0) return void (await reply(chatId, "No pending crypto orders."));
  for (const o of orders.slice(0, 10)) {
    await reply(chatId, cryptoOrderText(o), cryptoOrderKeyboard(o.id, o.txHash));
  }
}

function cryptoOrderText(o: { id: number; userName: string; telegramId: number; gopAmount: number; usdAmount: string; assetAmount: string; assetSymbol: string; txHash: string | null; address: string; status: string }): string {
  return (
    `🪙 <b>Crypto order #${o.id}</b> — ${o.status.toUpperCase()}\n\n` +
    `From: <b>${escapeHtml(o.userName)}</b> (ID <code>${o.telegramId}</code>)\n` +
    `Buys: <b>${o.gopAmount.toLocaleString("en-US")} GOP</b> ($${o.usdAmount})\n` +
    `Expected: <b>${o.assetAmount} ${o.assetSymbol}</b>\n` +
    `Address: <code>${o.address}</code>\n` +
    (o.txHash ? `TX: <code>${o.txHash}</code>\n` : "")
  );
}

function cryptoOrderKeyboard(orderId: number, txHash: string | null): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: "🔍 Verify on-chain", callback_data: `cord:${orderId}:verify` },
        { text: "✅ Approve", callback_data: `cord:${orderId}:approve` },
        { text: "❌ Reject", callback_data: `cord:${orderId}:reject` },
      ],
      ...(txHash ? [[{ text: "🌐 Open on BscScan", url: `https://bscscan.com/tx/${txHash}` }]] : []),
    ],
  };
}

function requireBotAdmin(tgId: number): boolean {
  return isAdminTelegramId(tgId);
}

export async function notifyAdmin(text: string): Promise<void> {
  if (!process.env.BOT_TOKEN) return;
  const adminRaw = process.env.TELEGRAM_ADMIN_ID?.trim() || process.env.ADMIN_ID?.trim();
  if (!adminRaw || !/^\d{1,20}$/.test(adminRaw)) return;
  await tgApi("sendMessage", { chat_id: Number(adminRaw), text, parse_mode: "HTML", link_preview_options: { is_disabled: true } });
}

/* ------------------------------------------------------------------ */
/* Inline callbacks                                                    */
/* ------------------------------------------------------------------ */

async function handleCallback(q: NonNullable<TgUpdate["callback_query"]>) {
  const cfg = await getConfig();
  const chatId = q.message?.chat.id ?? q.from.id;
  const data = q.data ?? "";
  const answer = (text?: string) => tgApi("answerCallbackQuery", { callback_query_id: q.id, ...(text ? { text, show_alert: false } : {}) });

  if (data === "restore_cancel" && requireBotAdmin(q.from.id)) {
    restoreArmed.delete(q.from.id);
    await answer("Restore cancelled");
    await reply(chatId, "Restore cancelled. Nothing was changed.");
    return;
  }

  if (data.startsWith("cord:")) {
    if (!requireBotAdmin(q.from.id)) return void (await answer("Admin only"));
    const [, idStr, action] = data.split(":");
    const orderId = Number(idStr);
    if (!Number.isInteger(orderId)) return void (await answer());
    const { listPendingCryptoOrders: pending } = await import("@/lib/shop");
    const orders = await pending();
    const order = orders.find((o) => o.id === orderId);
    if (!order) return void (await answer("Order not found or already processed"));
    if (action === "verify") {
      if (!order.txHash) return void (await answer("No TX hash on this order"));
      const tx = await fetchTxDetails(order.txHash);
      if (!tx.ok) {
        await answer();
        await reply(chatId, `⚠️ Order #${orderId}: ${tx.error}\nVerify manually on BscScan, then approve or reject.`);
        return;
      }
      const expected = Number(order.assetAmount);
      const addressOk = tx.to === order.address.toLowerCase();
      const amountOk = (tx.valueBnb ?? 0) >= expected - 1e-9;
      const successOk = tx.success !== false;
      await answer(addressOk && amountOk && successOk ? "On-chain check passed ✅" : "Check failed — see details");
      await reply(
        chatId,
        `🔍 <b>On-chain check — order #${orderId}</b>\n\n` +
          `Status: ${successOk ? "✅ success" : "❌ failed/reverted tx"}\n` +
          `To: ${addressOk ? "✅" : "❌"} <code>${tx.to ?? "—"}</code>\n` +
          `Amount: ${amountOk ? "✅" : "❌"} ${tx.valueBnb ?? 0} ${order.assetSymbol} (expected ≥ ${expected})\n\n` +
          (addressOk && amountOk && successOk ? "All good — approve to credit the coins." : "Do NOT approve unless you verified this payment manually."),
      );
      return;
    }
    if (action === "approve" || action === "reject") {
      const { decideCryptoOrder } = await import("@/lib/shop");
      try {
        const r = await decideCryptoOrder({ adminTelegramId: q.from.id, orderId, decision: action });
        await answer(action === "approve" ? `Approved — ${r.order.gopAmount} GOP credited` : "Rejected");
        await reply(chatId, action === "approve" ? `✅ Order #${orderId} approved — <b>${r.order.gopAmount.toLocaleString("en-US")} GOP</b> credited to the buyer.` : `❌ Order #${orderId} rejected.`);
        if (action === "approve") {
          await tgApi("sendMessage", { chat_id: order.telegramId, text: `✅ Your crypto payment for <b>${r.order.gopAmount.toLocaleString("en-US")} GOP</b> was confirmed. Coins are in your balance! ⛏`, parse_mode: "HTML" });
        } else if (order.telegramId) {
          await tgApi("sendMessage", { chat_id: order.telegramId, text: `❌ Your crypto order #${orderId} could not be verified and was rejected. If you believe this is a mistake, contact support.`, parse_mode: "HTML" });
        }
      } catch (e) {
        await answer(e instanceof Error ? e.message : "Failed");
      }
      return;
    }
    return void (await answer());
  }

  const [user] = await db.select().from(users).where(eq(users.telegramId, q.from.id)).limit(1);
  if (!user) return void (await answer());

  if (data === "checkin") {
    try {
      const r = await checkIn({ userId: user.id, cfg });
      await answer(r.creditedGop > 0 ? `+${fmtGop(r.creditedGop)} GOP collected!` : r.wasOff ? "Mine restarted!" : "Checked in ✅");
      const [fresh] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
      if (fresh) await sendMineStatus(chatId, fresh, cfg);
    } catch (e) {
      await answer(e instanceof Error ? e.message.slice(0, 190) : "Check-in failed");
    }
    return;
  }

  if (data === "shop") {
    await answer();
    await sendShop(chatId, cfg);
    return;
  }

  if (data === "crypto") {
    await answer();
    await sendCryptoInstructions(chatId, user, cfg);
    return;
  }

  if (data.startsWith("buys:")) {
    const pkgId = data.slice(5);
    const pkg = findStarsPackage(cfg, pkgId);
    if (!pkg) return void (await answer("Offer unavailable"));
    await answer();
    await sendStarsInvoice(chatId, pkg.id, pkg.gop, pkg.stars);
    return;
  }

  await answer();
}

async function sendCryptoInstructions(chatId: number, user: typeof users.$inferSelect, cfg: Awaited<ReturnType<typeof getConfig>>) {
  const c = cfg.payments.crypto;
  if (!c.enabled) return void (await reply(chatId, "Crypto payments are disabled right now."));
  const link = referralLinks(user.referralCode).primary;
  const packages = c.packages.map((p) => {
    const amt = Number(((p.usd / c.bnbUsd) * (1 + c.bufferPercent / 100)).toFixed(6));
    return `🪙 <b>${p.gop.toLocaleString("en-US")} GOP</b> — $${p.usd} ≈ <b>${amt} ${c.assetSymbol}</b> (id: <code>${p.id}</code>)`;
  });
  await replyPhoto(
    chatId,
    appLogo(),
    `₿ <b>Pay with ${c.assetSymbol} — ${c.network}</b>\n\n` +
      `<b>How it works:</b>\n1️⃣ Send <b>at least</b> the expected amount to the address below\n2️⃣ Copy your transaction hash (TXID)\n3️⃣ Open the Mini App → Goblin menu → <b>Buy GOP</b> → submit the TXID\n4️⃣ Admin verifies on-chain and your coins arrive\n\n` +
      `<b>Receive address:</b>\n<code>${c.address}</code>\n\n` +
      `<b>Packages:</b>\n${packages.join("\n")}\n\n` +
      `ℹ️ The exact expected amount (incl. a ${c.bufferPercent}% network buffer) is shown when you submit your TXID in the app.`,
    mainKeyboard(link, cfg.referral.inviteeReward),
  );
}

/* ------------------------------------------------------------------ */
/* Setup & daily backup scheduler                                      */
/* ------------------------------------------------------------------ */

/** Registers the secured webhook, command list and the Mini App menu button. */
export async function setupBot() {
  const url = webAppUrl();
  if (!process.env.BOT_TOKEN) throw new Error("BOT_TOKEN is not configured");
  if (!url.startsWith("https://")) throw new Error("WEBAPP_URL must be an https URL");
  const webhook = await tgApi("setWebhook", {
    url: `${url}/api/bot/webhook`,
    secret_token: webhookSecret(),
    allowed_updates: ["message", "my_chat_member", "callback_query", "pre_checkout_query"],
    max_connections: 40,
  });
  const commands = await tgApi("setMyCommands", {
    commands: [
      { command: "start", description: "Start GOP Coin" },
      { command: "mine", description: "Mine status & check-in" },
      { command: "balance", description: "Show your balance" },
      { command: "buy", description: "Buy GOP (Stars / BNB)" },
      { command: "invite", description: "Invite friends +50 GOP" },
      { command: "help", description: "How GOP Coin works" },
    ],
  });
  // Admin-only commands appear only in the admin's private chat.
  const adminRaw = process.env.TELEGRAM_ADMIN_ID?.trim() || process.env.ADMIN_ID?.trim();
  const adminCommands = adminRaw
    ? await tgApi("setMyCommands", {
        commands: [
          { command: "backup", description: "Full database backup (admin)" },
          { command: "restore", description: "Restore from backup file (admin)" },
          { command: "orders", description: "Pending crypto orders (admin)" },
        ],
        scope: { type: "chat", chat_id: Number(adminRaw) },
      })
    : null;
  const menu = await tgApi("setChatMenuButton", { menu_button: { type: "web_app", text: "Mine", web_app: { url } } });
  return { bot: botUsername(), webhook, commands, menu, adminCommands };
}

let backupTimerStarted = false;

/** Daily full backup to the admin's private chat at 00:00 UTC. */
export function startDailyBackup() {
  if (backupTimerStarted || process.env.DISABLE_AUTO_BACKUP === "true") return;
  if (!process.env.BOT_TOKEN) return;
  const adminRaw = process.env.TELEGRAM_ADMIN_ID?.trim() || process.env.ADMIN_ID?.trim();
  if (!adminRaw || !/^\d{1,20}$/.test(adminRaw)) {
    console.warn("[backup] auto-backup disabled: TELEGRAM_ADMIN_ID/ADMIN_ID not set");
    return;
  }
  backupTimerStarted = true;
  const schedule = () => {
    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 5));
    return next.getTime() - now.getTime();
  };
  let timer: NodeJS.Timeout;
  const run = async () => {
    try {
      const r = await sendBackupDocument(Number(adminRaw), { label: "⏰ Daily automatic backup (00:00 UTC)" });
      if (!r.ok) console.error("[backup] daily backup delivery failed", r.description);
      else console.log(`[backup] daily backup sent (${(r.bytes / 1024).toFixed(1)} KB)`);
    } catch (e) {
      console.error("[backup] daily backup failed", e);
    } finally {
      timer = setTimeout(run, schedule());
      timer.unref?.();
    }
  };
  timer = setTimeout(run, schedule());
  timer.unref?.();
  console.log("[backup] daily auto-backup scheduled at 00:00 UTC");
}
