"use client";

import { useState } from "react";
import { api, copyText, fmt, fmtGop, haptic, openBotDeepLink, type MeState, type MineState, type StageDef, type UpgradeView } from "./client";
import { CoinIcon, Icon, ProgressBar, useToast } from "./ui";

export function stageFor(level: number, stages: StageDef[]) {
  let s = stages[0];
  for (const st of stages) if (level >= st.minLevel) s = st;
  return s;
}

export function GoblinArt({ src, size, locked, className = "" }: { src: string; size: number; locked?: boolean; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      draggable={false}
      loading="lazy"
      className={`goblin-art select-none ${locked ? "brightness-0 opacity-40" : ""} ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

export function GoblinPage({ me, mine, xp, level, onPurchased, onRefresh }: {
  me: MeState; mine: MineState; xp: number; level: number; onPurchased: () => void; onRefresh: () => void;
}) {
  const [showLevels, setShowLevels] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const stage = stageFor(level, me.stages);
  const nextStage = me.stages.find((s) => s.minLevel > level) ?? null;
  const cur = me.levels.find((l) => l.level === level) ?? me.levels[0];
  const next = me.levels.find((l) => l.level === level + 1) ?? null;
  const progress = next ? (xp - cur.xp) / (next.xp - cur.xp) : 1;
  const stageRange = (s: StageDef, i: number) => {
    const nx = me.stages[i + 1];
    return nx ? `Lv ${s.minLevel}–${nx.minLevel - 1}` : `Lv ${s.minLevel}+`;
  };

  const buy = async (kind: "speed" | "limit") => {
    setBusy(kind);
    try {
      const r = await api<{ tier: number; price: number; state: MineState }>("/api/mine/upgrade", { json: { kind } });
      haptic("success");
      toast(`Upgrade complete — burned ${fmt(r.price)} GOP ⛏`, "success");
      onPurchased();
      void r;
    } catch (e) {
      haptic("error");
      toast(e instanceof Error ? e.message : "Purchase failed", "error");
    } finally {
      setBusy(null);
    }
  };

  // Server-authoritative upgrade availability (includes the capacity-first ordering rule).
  // Defensive fallback for tabs that still hold a pre-v3 /api/me snapshot: treat upgrades as
  // purchasable (the server still enforces the ordering rule on the actual purchase).
  const balance = me.user.balance;
  const speedUp = me.upgrades?.speed ?? { kind: "speed" as const, tier: mine.speedTier, maxTier: 6, currentValue: mine.speedGop, nextValue: null, price: null, purchasable: true, lockedReason: null };
  const limitUp = me.upgrades?.limit ?? { kind: "limit" as const, tier: mine.limitTier, maxTier: 6, currentValue: mine.dailyLimit, nextValue: null, price: null, purchasable: true, lockedReason: null };

  return (
    <div className="page-enter px-4 pb-4">
      {/* Hero */}
      <div className="card relative overflow-hidden rounded-[28px] p-5 text-center">
        <div className="rays absolute left-1/2 top-[38%] h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 opacity-60" />
        <div className="relative mx-auto flex justify-center">
          <GoblinArt src={stage.image} size={240} />
        </div>
        <div className="relative mt-1">
          <div className="text-xs font-bold uppercase tracking-[0.2em] text-goblin">{stage.name}</div>
          <div className="mt-1 text-2xl font-black">{cur.title}</div>
          <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-gold-500/15 px-3 py-1 text-sm font-extrabold text-gold-300">Level {level}</div>
          <p className="mx-auto mt-2 max-w-xs text-sm text-white/55">{stage.description}</p>
        </div>
        <div className="relative mt-4 text-left">
          <div className="mb-1.5 flex justify-between text-xs font-semibold">
            <span className="text-white/60">{fmt(xp)} XP total</span>
            <span className="text-white/60">{next ? `${fmt(Math.max(0, next.xp - xp))} XP to Lv ${level + 1}` : "Max level reached"}</span>
          </div>
          <ProgressBar value={progress} tone="green" className="h-3" />
          {next && <div className="mt-1.5 text-[11px] text-white/40">Next title: <b className="text-white/70">{next.title}</b></div>}
        </div>
      </div>

      {/* Goblin shop: upgrades */}
      {me.features.shop && (
        <>
          <h3 className="mb-2 mt-5 px-1 text-sm font-extrabold uppercase tracking-wider text-white/50">Goblin shop — upgrade your mine</h3>
          <div className="space-y-2">
            <UpgradeCard
              icon={<Icon.Spark className="h-5 w-5" />}
              title="Mining speed"
              current={`Mine speed: ${mine.speedGop} GOP/h`}
              view={speedUp}
              balance={balance}
              busy={busy === "speed"}
              onBuy={() => buy("speed")}
            />
            <UpgradeCard
              icon={<Icon.Shield className="h-5 w-5" />}
              title="Daily capacity"
              current={`Daily cap: ${fmt(mine.dailyLimit)} GOP`}
              view={limitUp}
              balance={balance}
              busy={busy === "limit"}
              onBuy={() => buy("limit")}
            />
            <p className="px-1 text-[11px] text-white/35">Upgrades burn your GOP — that&apos;s how the coin keeps its value. Raise capacity first: it unlocks the next speed tier.</p>
          </div>
        </>
      )}

      {/* Buy GOP */}
      {me.features.shop && <BuyGopSection me={me} onRefresh={onRefresh} />}

      {/* Next evolution */}
      {nextStage && (
        <div className="card mt-3 flex items-center gap-4 rounded-3xl p-4">
          <div className="relative">
            <GoblinArt src={nextStage.image} size={84} locked />
            <Icon.Lock className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 text-white/70" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold uppercase tracking-wider text-white/45">Next evolution</div>
            <div className="text-lg font-extrabold">{nextStage.name}</div>
            <div className="text-sm text-white/55">Unlocks at level {nextStage.minLevel} · {fmt(Math.max(0, (me.levels.find((l) => l.level === nextStage.minLevel)?.xp ?? 0) - xp))} XP to go</div>
          </div>
        </div>
      )}

      {/* Evolution path */}
      <h3 className="mb-2 mt-5 px-1 text-sm font-extrabold uppercase tracking-wider text-white/50">Evolution path</h3>
      <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
        {me.stages.map((s, i) => {
          const unlocked = level >= s.minLevel;
          const current = s.name === stage.name;
          return (
            <div key={s.name} className={`card w-[118px] shrink-0 rounded-2xl p-2 text-center ${current ? "ring-2 ring-gold-400/70" : ""}`}>
              <div className="relative flex justify-center">
                <GoblinArt src={s.image} size={96} locked={!unlocked} />
                {!unlocked && <Icon.Lock className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 text-white/60" />}
              </div>
              <div className={`mt-1 text-xs font-extrabold ${unlocked ? "text-white" : "text-white/45"}`}>{s.name}</div>
              <div className="text-[10px] text-white/40">{stageRange(s, i)}</div>
            </div>
          );
        })}
      </div>

      {/* How to earn XP */}
      <div className="card mt-4 rounded-3xl p-4">
        <div className="text-sm font-extrabold">How to earn XP</div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-2xl bg-white/5 p-3"><div className="text-lg font-black text-goblin">+{me.rules.xpPerCheckin}</div><div className="text-white/55">per check-in</div></div>
          <div className="rounded-2xl bg-white/5 p-3"><div className="text-lg font-black text-goblin">+{fmt(me.rules.xpPerReferral)}</div><div className="text-white/55">per activated friend</div></div>
        </div>
        <p className="mt-2 text-[11px] text-white/40">Levels never cost coins. Your goblin grows only through play.</p>
      </div>

      {/* All levels */}
      <button onClick={() => setShowLevels((v) => !v)} className="btn-ghost mt-3 flex w-full items-center justify-between rounded-2xl px-4 py-3 text-sm font-bold">
        All level titles <Icon.Arrow className={`h-4 w-4 transition-transform ${showLevels ? "rotate-90" : ""}`} />
      </button>
      {showLevels && (
        <div className="card mt-2 divide-y divide-white/5 rounded-2xl">
          {me.levels.map((l) => (
            <div key={l.level} className={`flex items-center justify-between px-4 py-2 text-sm ${l.level === level ? "bg-gold-500/10" : ""}`}>
              <span className={l.level <= level ? "text-white" : "text-white/40"}>
                <b className="mr-2 inline-block w-8 tabular-nums">{l.level}</b>{l.title}
              </span>
              <span className="tabular-nums text-white/40">{fmt(l.xp)} XP</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UpgradeCard({ icon, title, current, view, balance, busy, onBuy }: {
  icon: React.ReactNode; title: string; current: string;
  view: UpgradeView; balance: number; busy: boolean; onBuy: () => void;
}) {
  const affordable = view.price !== null ? balance >= view.price : false;
  const locked = !view.purchasable && view.price !== null;
  return (
    <div className="card flex items-center gap-3 rounded-3xl p-4">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gold-500/15 text-gold-300">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-extrabold">{title}</div>
        <div className="text-xs text-white/55">{current}</div>
        {view.nextValue !== null && view.price !== null ? (
          <div className="mt-0.5 text-xs font-bold text-goblin">
            Next: {view.kind === "speed" ? `${view.nextValue} GOP/h` : `${fmt(view.nextValue)} GOP/day`} · <span className="text-gold-300">{fmt(view.price)} GOP</span>
          </div>
        ) : null}
        {locked && view.lockedReason && <div className="mt-0.5 text-[11px] font-semibold text-amber-300">🔒 {view.lockedReason}</div>}
      </div>
      {view.price !== null && view.nextValue !== null ? (
        <button onClick={onBuy} disabled={busy || !affordable || locked} className="btn-gold shrink-0 rounded-2xl px-3.5 py-2.5 text-sm font-extrabold disabled:opacity-40">
          {busy ? "…" : affordable && !locked ? "Upgrade" : locked ? "Locked" : "Need GOP"}
        </button>
      ) : (
        <span className="shrink-0 rounded-2xl bg-goblin/15 px-3 py-1.5 text-xs font-extrabold text-goblin">MAX</span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Buy GOP (Stars + crypto)                                            */
/* ------------------------------------------------------------------ */

export function BuyGopSection({ me, onRefresh }: { me: MeState; onRefresh: () => void }) {
  const toast = useToast();
  const [tab, setTab] = useState<"stars" | "crypto">("stars");
  const [pkgId, setPkgId] = useState<string>(me.payments.crypto.packages[0]?.id ?? "");
  const [txHash, setTxHash] = useState("");
  const [busy, setBusy] = useState(false);
  const c = me.payments.crypto;
  const pkg = c.packages.find((p) => p.id === pkgId) ?? c.packages[0] ?? null;
  const expected = pkg ? Number(((pkg.usd / c.bnbUsd) * (1 + c.bufferPercent / 100)).toFixed(6)) : 0;

  const submit = async () => {
    if (!pkg) return;
    if (!/^0x[a-fA-F0-9]{64}$/.test(txHash.trim())) {
      toast("Enter a valid transaction hash (0x…)", "error");
      return;
    }
    setBusy(true);
    try {
      await api("/api/shop/crypto", { json: { packageId: pkg.id, txHash: txHash.trim() } });
      haptic("success");
      toast("Submitted! The admin verifies your payment on-chain — coins arrive after approval.", "success");
      setTxHash("");
      onRefresh();
    } catch (e) {
      haptic("error");
      toast(e instanceof Error ? e.message : "Submission failed", "error");
    } finally {
      setBusy(false);
    }
  };

  if (!me.payments.stars.enabled && !me.payments.crypto.enabled) return null;

  return (
    <div className="card mt-3 rounded-3xl p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-extrabold">💰 Buy GOP</div>
        <div className="flex gap-1 rounded-xl bg-white/5 p-1 text-xs font-bold">
          {me.payments.stars.enabled && (
            <button onClick={() => setTab("stars")} className={`rounded-lg px-2.5 py-1 ${tab === "stars" ? "bg-gold-500 text-forest-950" : "text-white/60"}`}>⭐ Stars</button>
          )}
          {me.payments.crypto.enabled && (
            <button onClick={() => setTab("crypto")} className={`rounded-lg px-2.5 py-1 ${tab === "crypto" ? "bg-gold-500 text-forest-950" : "text-white/60"}`}>₿ {c.assetSymbol}</button>
          )}
        </div>
      </div>

      {tab === "stars" && me.payments.stars.enabled && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-white/55">Pay with Telegram Stars — coins land in your balance instantly. 1 GOP ≈ 1 ⭐.</p>
          {me.payments.stars.packages.map((p) => (
            <button key={p.id} onClick={() => openBotDeepLink(`buy_${p.id}`)} className="flex w-full items-center justify-between rounded-2xl bg-white/5 px-3.5 py-3 text-left ring-1 ring-white/5 transition hover:bg-white/10">
              <span className="flex items-center gap-2 text-sm font-extrabold"><CoinIcon size={18} /> {fmt(p.gop)} GOP</span>
              <span className="text-sm font-black text-gold-300">⭐ {fmt(p.stars)}</span>
            </button>
          ))}
          <p className="text-[11px] text-white/35">Tapping a pack opens the bot chat and sends your invoice there.</p>
        </div>
      )}

      {tab === "crypto" && me.payments.crypto.enabled && (
        <div className="mt-3 space-y-2.5">
          <p className="text-xs text-white/55">
            Send <b className="text-white">{c.assetSymbol}</b> on <b className="text-white">{c.network}</b> to the official address, then submit your transaction hash. The admin verifies on-chain and your GOP arrives after approval.
          </p>
          <button onClick={async () => { const ok = await copyText(c.address); toast(ok ? "Address copied" : "Copy failed", ok ? "success" : "error"); }} className="w-full rounded-2xl bg-black/30 px-3 py-2.5 text-left ring-1 ring-white/5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-white/40">Receive address (tap to copy)</div>
            <div className="break-all font-mono text-xs text-white/85">{c.address}</div>
          </button>
          <div>
            <div className="mb-1 text-[11px] font-semibold text-white/45">Package</div>
            <div className="flex flex-wrap gap-1.5">
              {c.packages.map((p) => {
                const amt = Number(((p.usd / c.bnbUsd) * (1 + c.bufferPercent / 100)).toFixed(6));
                return (
                  <button key={p.id} onClick={() => setPkgId(p.id)} className={`rounded-xl px-3 py-2 text-xs font-bold ring-1 ${pkgId === p.id ? "bg-gold-500 text-forest-950 ring-gold-400" : "bg-white/5 text-white/70 ring-white/10"}`}>
                    {fmt(p.gop)} GOP · ${fmt(p.usd)}<span className="block text-[10px] font-semibold opacity-80">≈ {amt} {c.assetSymbol}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div className="mb-1 text-[11px] font-semibold text-white/45">Transaction hash (TXID)</div>
            <input
              value={txHash}
              onChange={(e) => setTxHash(e.target.value.trim())}
              placeholder="0x…"
              spellCheck={false}
              className="w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-3 font-mono text-xs text-white outline-none focus:border-gold-500/50"
            />
            {pkg && <div className="mt-1 text-[11px] text-white/45">Send at least <b className="text-gold-300">{expected} {c.assetSymbol}</b> (incl. {c.bufferPercent}% buffer) for {fmt(pkg.gop)} GOP.</div>}
          </div>
          <button onClick={submit} disabled={busy || !pkg} className="btn-gold w-full rounded-2xl py-3 text-sm font-extrabold disabled:opacity-40">
            {busy ? "Submitting…" : "Submit for verification"}
          </button>
        </div>
      )}
    </div>
  );
}

export function LevelUpModal({ me, from, to, onClose }: { me: MeState; from: number; to: number; onClose: () => void }) {
  const oldStage = stageFor(from, me.stages);
  const stage = stageFor(to, me.stages);
  const evolved = oldStage.name !== stage.name;
  const title = me.levels.find((l) => l.level === to)?.title ?? "";
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-6" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="fade-in absolute inset-0 bg-black/80 backdrop-blur-sm" />
      <div className="relative w-full max-w-sm text-center">
        <div className="rays absolute left-1/2 top-[40%] h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2" />
        <div className="evolve-in relative flex justify-center"><GoblinArt src={stage.image} size={260} /></div>
        <div className="relative">
          <div className="text-sm font-extrabold uppercase tracking-[0.3em] text-goblin">{evolved ? "Evolution!" : "Level up!"}</div>
          <div className="gold-text mt-1 text-5xl font-black">Level {to}</div>
          <div className="mt-1 text-lg font-bold">{title}</div>
          {evolved && <div className="mt-2 text-sm text-white/70">Your goblin evolved into a <b className="text-gold-300">{stage.name}</b></div>}
          <button onClick={onClose} className="btn-gold mt-6 w-full rounded-2xl py-3.5 text-base font-extrabold">Awesome!</button>
        </div>
      </div>
    </div>
  );
}
