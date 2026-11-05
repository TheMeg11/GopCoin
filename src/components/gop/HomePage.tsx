"use client";

import { useState } from "react";
import { countdown, fmt, fmtGop, haptic, type MeState } from "./client";
import { CoinIcon, Icon, ProgressBar, useNow } from "./ui";

type View = {
  mine: MeState["mine"];
  balanceMilli: number;
  pendingGopLive: number;
  shutdownInMsLive: number | null;
  level: number;
  xp: number;
};

export function HomePage({ me, view, checkin, busy, goFriends, goGoblin }: {
  me: MeState; view: View; checkin: () => Promise<boolean>; busy: boolean; goFriends: () => void; goGoblin: () => void;
}) {
  const [collectFx, setCollectFx] = useState(false);
  const now = useNow();
  const mine = view.mine;
  const status = me.user.status;
  const paused = !me.rules.mineEnabled;
  const canCheckin = !paused && status === "active" && !busy;

  const lvl = me.levels.find((l) => l.level === view.level);
  const next = me.levels.find((l) => l.level === view.level + 1);
  const lvlProgress = next && lvl ? (view.xp - lvl.xp) / (next.xp - lvl.xp) : 1;

  const doCheckin = async () => {
    if (!canCheckin) { haptic("warning"); return; }
    haptic("tap");
    const ok = await checkin();
    if (ok) {
      haptic("success");
      setCollectFx(true);
      setTimeout(() => setCollectFx(false), 900);
    }
  };

  const on = mine.on && !paused;
  const balanceShown = view.balanceMilli / 1000;
  const quotaResetIn = countdown(new Date(mine.resetAt).getTime() - now);
  const fresh = me.user.checkins === 0;

  return (
    <div className="page-enter flex flex-col items-center px-4 pb-4">
      {/* First-run onboarding hint */}
      {fresh && status === "active" && !paused && (
        <div className="mt-2 w-full rounded-2xl bg-goblin/10 px-4 py-3 text-center text-xs font-semibold text-goblin ring-1 ring-goblin/25">
          👋 Welcome! Your goblin mine is already digging — tap the button below to collect your first coins.
        </div>
      )}

      {/* Balance */}
      <div className="mt-2 flex flex-col items-center">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-white/45">Your balance</div>
        <div className="mt-1 flex items-center gap-2.5">
          <CoinIcon size={38} />
          <span className="gold-text text-[44px] font-black leading-none tabular-nums" aria-live="polite">{fmtGop(balanceShown)}</span>
        </div>
        <div className="mt-1 text-sm font-bold text-goblin" aria-live="polite">
          {on && !mine.quotaFull ? `⛏ +${fmtGop(view.pendingGopLive)} GOP ready to collect` : on ? "Daily quota full — resets at 00:00 UTC" : mine.shutDown ? "Mine is off" : ""}
        </div>
        <button onClick={goGoblin} className="btn-ghost mt-3 flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-xs font-bold">
          <span className="rounded-full bg-gold-500/20 px-2 py-0.5 text-gold-300">Lv {view.level}</span>
          <span className="text-white/80">{lvl?.title ?? me.progression.title}</span>
          <span className="h-1.5 w-12 overflow-hidden rounded-full bg-white/10"><span className="block h-full bg-goblin" style={{ width: `${Math.min(1, lvlProgress) * 100}%` }} /></span>
        </button>
      </div>

      {/* Mine logo — intentionally left completely clean. No timer, no text overlay:
          status and countdowns live on the dedicated elements below. */}
      <div className="coin-wrap relative my-5 flex aspect-square w-[min(74vw,330px)] items-center justify-center">
        <div className={`coin-glow absolute inset-[-8%] rounded-full ${on ? "" : "opacity-20"}`} />
        <div
          aria-label={on ? "Mine is running" : "Mine is shut down"}
          className={`coin relative flex h-full w-full items-center justify-center rounded-full ${on ? "" : "grayscale-[0.7] brightness-[0.5]"}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/art/coin.webp"
            alt=""
            draggable={false}
            className={`pointer-events-none h-full w-full select-none drop-shadow-[0_18px_40px_rgba(245,184,61,0.35)] ${on ? "coin-idle" : ""}`}
          />
        </div>
        {collectFx && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="float-plus gold-text text-5xl font-black">+{fmtGop(mine.pendingGop)}</span>
          </div>
        )}
      </div>

      {/* Mine status line (never on top of the logo) */}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-center">
        {on && me.rules.shutdownHours > 0 && view.shutdownInMsLive !== null && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-forest-800 px-3 py-1.5 text-xs font-bold ring-1 ring-white/10">
            <Icon.Clock className="h-3.5 w-3.5 text-gold-300" />
            <span className="text-white/60">shuts down in</span>
            <span className="gold-text tabular-nums">{countdown(view.shutdownInMsLive)}</span>
          </span>
        )}
        {on ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-goblin/10 px-3 py-1.5 text-xs font-bold text-goblin ring-1 ring-goblin/25">
            ⛏ {mine.speedGop} GOP/h · mine running {me.rules.shutdownHours === 0 ? "24/7" : ""}
          </span>
        ) : status === "banned" ? (
          <span className="rounded-full bg-red-500/15 px-3 py-1.5 text-xs font-bold text-red-300 ring-1 ring-red-400/30">This account is banned.</span>
        ) : status === "suspended" ? (
          <span className="rounded-full bg-amber-500/15 px-3 py-1.5 text-xs font-bold text-amber-300 ring-1 ring-amber-400/30">Earning is temporarily suspended.</span>
        ) : paused ? (
          <span className="max-w-[280px] rounded-full bg-amber-500/15 px-3 py-1.5 text-xs font-bold text-amber-300 ring-1 ring-amber-400/30">{me.announcement.maintenance ? me.announcement.maintenanceMessage : "Mining is paused right now."}</span>
        ) : (
          <span className="rounded-full bg-amber-500/15 px-3 py-1.5 text-xs font-bold text-amber-300 ring-1 ring-amber-400/30">💤 Mine shut down — collect below to restart it</span>
        )}
      </div>

      {/* Collect button — the countdown lives here as its own chip, never over the logo */}
      <div className="mt-4 w-full">
        <button
          onClick={doCheckin}
          disabled={!canCheckin}
          className="btn-gold flex w-full items-center justify-between gap-3 rounded-3xl py-4 pl-5 pr-3 text-lg font-black shadow-[0_10px_30px_-8px_rgba(245,184,61,0.7)] disabled:opacity-40"
        >
          <span className="truncate">{busy ? "Collecting…" : "⛏ COLLECT"}</span>
          <span className="flex shrink-0 flex-col items-end leading-tight">
            {on && !mine.quotaFull && (
              <span className="text-base font-black text-forest-950">+{fmtGop(view.pendingGopLive)} GOP</span>
            )}
            <span className="inline-flex items-center gap-1 rounded-full bg-forest-950/20 px-2 py-0.5 text-[10px] font-bold text-forest-950/90 tabular-nums">
              <Icon.Clock className="h-3 w-3" /> resets in {quotaResetIn}
            </span>
          </span>
        </button>
      </div>
      <div className="mt-1.5 text-center text-[11px] text-white/40">
        {me.rules.shutdownHours === 0
          ? "Your mine digs 24/7 — collect any time. The daily quota resets at 00:00 UTC."
          : `Check in at least every ${me.rules.shutdownHours}h or the mine shuts down`}
      </div>

      {/* Daily capacity */}
      <div className="card mt-3 w-full rounded-3xl p-4">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-xs font-semibold text-white/50">Mined today</div>
            <div className="text-lg font-extrabold tabular-nums">
              <span className="text-white">{fmtGop(mine.minedToday)}</span>
              <span className="text-white/40"> / {fmt(mine.dailyLimit)} GOP</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-right text-xs text-white/55">
            <Icon.Clock className="h-4 w-4" />
            <div>
              <div>Quota resets in</div>
              <div className="font-bold tabular-nums text-white/85">{quotaResetIn}</div>
            </div>
          </div>
        </div>
        <ProgressBar value={mine.dailyLimit > 0 ? mine.minedToday / mine.dailyLimit : 0} className="mt-3" />
        <div className="mt-2 flex items-center justify-between text-[11px] text-white/40">
          <span>Mine speed: <b className="text-goblin">{mine.speedGop} GOP/h</b> · quota resets at 00:00 UTC</span>
          <button onClick={goGoblin} className="font-bold text-gold-300">Upgrade →</button>
        </div>
      </div>

      {/* Invite card */}
      {me.rules.referralEnabled && (
        <button onClick={goFriends} className="relative mt-3 w-full overflow-hidden rounded-3xl p-4 text-left ring-1 ring-gold-500/30" style={{ background: "linear-gradient(120deg, rgba(245,184,61,0.22), rgba(95,208,104,0.12) 60%, rgba(17,25,21,0.9))" }}>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gold-500/20 text-gold-300"><Icon.Friends /></div>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-extrabold">Invite friends, earn big</div>
              <div className="mt-0.5 flex items-center gap-1 text-sm text-white/75">
                <CoinIcon size={14} /> <b className="text-gold-300">+{fmt(me.rules.inviterReward)}</b> per friend · {me.user.referralCount} activated
              </div>
            </div>
            <div className="btn-gold flex shrink-0 items-center rounded-2xl px-3 py-2 text-sm font-extrabold">Invite</div>
          </div>
        </button>
      )}
    </div>
  );
}
