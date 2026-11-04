"use client";

import { useState } from "react";
import { fmt, fmtGop, openExternal, savePrefs, setPrefsCache, loadPrefs, type MeState, type MineState, type Prefs } from "./client";
import { Avatar, Icon, Pill, Sheet } from "./ui";

export function ProfileSheet({ open, onClose, me, mine, onOpenAdmin }: {
  open: boolean; onClose: () => void; me: MeState; mine: MineState; onOpenAdmin: () => void;
}) {
  const [prefs, setPrefs] = useState<Prefs>(() => (typeof window === "undefined" ? { sound: false, haptics: true } : loadPrefs()));
  const toggle = (k: keyof Prefs) => {
    const p = { ...prefs, [k]: !prefs[k] };
    setPrefs(p);
    savePrefs(p);
    setPrefsCache(p);
  };
  const u = me.user;
  const stats: [string, string][] = [
    ["Balance", `${fmtGop(u.balance)} GOP`],
    ["Lifetime earned", `${fmtGop(u.lifetimeEarned)} GOP`],
    ["Mined lifetime", `${fmtGop(u.mineEarned)} GOP`],
    ["Purchased", `${fmtGop(u.purchaseEarned)} GOP`],
    ["Level", `${u.level}`],
    ["Total XP", fmt(u.xp)],
    ["Mine speed", `${mine.speedGop} GOP/h`],
    ["Daily capacity", `${fmt(mine.dailyLimit)} GOP`],
    ["Check-ins", fmt(u.checkins)],
    ["Friends activated", fmt(u.referralCount)],
    ["Referral earnings", `${fmtGop(u.referralEarned)} GOP`],
    ["Invited by", u.invitedBy ? u.invitedBy.status : "—"],
  ];
  const links = [
    ["Official channel", me.community.channelUrl],
    ["Community chat", me.community.chatUrl],
    ["Website", me.community.websiteUrl],
  ].filter(([, url]) => url);

  return (
    <Sheet open={open} onClose={onClose} title="Profile">
      <div className="flex items-center gap-3">
        <Avatar name={u.name} url={u.photoUrl} size={56} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-extrabold">{u.name}</div>
          <div className="text-sm text-white/50">{u.username ? `@${u.username} · ` : ""}joined {new Date(u.joinedAt).toLocaleDateString()}</div>
        </div>
        <Pill tone={u.status === "active" ? "green" : u.status === "suspended" ? "amber" : "red"}>{u.status}</Pill>
      </div>
      {u.status === "suspended" && u.suspendedUntil && <div className="mt-3 rounded-2xl bg-amber-500/10 px-3 py-2 text-sm text-amber-300">Earning suspended until {new Date(u.suspendedUntil).toLocaleString()}.</div>}

      <div className="mt-4 grid grid-cols-2 gap-2">
        {stats.map(([k, v]) => (
          <div key={k} className="rounded-2xl bg-white/5 px-3 py-2.5">
            <div className="text-[11px] font-semibold text-white/45">{k}</div>
            <div className="text-base font-extrabold tabular-nums">{v}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 divide-y divide-white/5 rounded-2xl bg-white/5">
        {(["haptics", "sound"] as const).map((k) => (
          <label key={k} className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-semibold">
            {k === "haptics" ? "Haptic feedback" : "Sound effects"}
            <button role="switch" aria-checked={prefs[k]} onClick={() => toggle(k)} className={`relative h-6 w-11 rounded-full transition ${prefs[k] ? "bg-goblin" : "bg-white/15"}`}>
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${prefs[k] ? "left-[22px]" : "left-0.5"}`} />
            </button>
          </label>
        ))}
      </div>

      {links.length > 0 && (
        <div className="mt-4 space-y-2">
          {links.map(([label, url]) => (
            <button key={label} onClick={() => openExternal(url)} className="btn-ghost flex w-full items-center justify-between rounded-2xl px-4 py-3 text-sm font-bold">
              {label} <Icon.Arrow className="h-4 w-4" />
            </button>
          ))}
        </div>
      )}

      {me.isAdmin && (
        <button onClick={onOpenAdmin} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-gold-500/15 py-3 text-sm font-extrabold text-gold-300 ring-1 ring-gold-500/30">
          <Icon.Shield className="h-5 w-5" /> Open Admin Panel
        </button>
      )}
    </Sheet>
  );
}
