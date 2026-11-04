/** Starts background workers (broadcast sender, bot auto-setup, daily backup).
 * All are in-process — no extra Railway service, no cron container, near-zero overhead. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Bot auto-setup: idempotent webhook/commands registration on boot.
  if (process.env.BOT_TOKEN && process.env.WEBAPP_URL?.startsWith("https://") && process.env.DISABLE_BOT_AUTOSETUP !== "true") {
    const g = globalThis as typeof globalThis & { __gopBotSetup?: Promise<unknown> };
    if (!g.__gopBotSetup) {
      g.__gopBotSetup = (async () => {
        const { setupBot } = await import("@/lib/bot");
        try {
          const r = await setupBot();
          console.log(`[bot] webhook=${r.webhook.ok} commands=${r.commands.ok} menu=${r.menu.ok}`);
        } catch (e) {
          console.error("[bot] auto-setup failed (use admin panel → bot setup to retry)", e);
        }
      })();
    }
  }

  // Daily 00:00 UTC full backup to the admin's private chat.
  if (process.env.BOT_TOKEN) {
    const g = globalThis as typeof globalThis & { __gopBackup?: boolean };
    if (!g.__gopBackup) {
      g.__gopBackup = true;
      const { startDailyBackup } = await import("@/lib/bot");
      startDailyBackup();
    }
  }

  // Broadcast sender (row-claiming makes it restart/instance safe).
  if (process.env.BOT_TOKEN && process.env.DISABLE_BROADCAST_WORKER !== "true") {
    const g = globalThis as typeof globalThis & { __gopWorker?: boolean };
    if (g.__gopWorker) return;
    g.__gopWorker = true;
    const { processBroadcastTick } = await import("@/lib/broadcast");
    setInterval(() => {
      processBroadcastTick().catch((e) => console.error("[broadcast] tick failed", e));
    }, 3000);
  }
}
