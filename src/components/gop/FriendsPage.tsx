"use client";

import { useCallback, useEffect, useState } from "react";
import { api, copyText, fmt, haptic, shareInvite, type MeState } from "./client";
import { Avatar, CoinIcon, EmptyState, Icon, Pill, ProgressBar, Skeleton, useToast } from "./ui";

type Friend = { id: number; name: string; photoUrl: string | null; level: number; status: string; joinedAt: string; activatedAt: string | null; reward: number; progress: number };
type FriendsData = { total: number; activated: number; pending: number; earned: number; friends: Friend[]; links: { primary: string } };

export function FriendsPage({ me }: { me: MeState }) {
  const toast = useToast();
  const [data, setData] = useState<FriendsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const link = data?.links.primary ?? me.links.primary;

  const load = useCallback(() => {
    api<FriendsData>("/api/friends").then(setData).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const copy = async () => {
    const ok = await copyText(link);
    haptic(ok ? "success" : "error");
    toast(ok ? "Invite link copied!" : "Couldn't copy — long-press the link instead", ok ? "success" : "error");
  };

  const nextMilestone = [1, 3, 5, 10, 25, 50, 100, 250, 500, 1000].find((m) => m > (data?.activated ?? me.user.referralCount)) ?? 1000;
  const activated = data?.activated ?? me.user.referralCount;

  return (
    <div className="page-enter px-4 pb-4">
      <div className="text-center">
        <h1 className="text-2xl font-black">Invite friends</h1>
        <p className="mx-auto mt-1 max-w-xs text-sm text-white/60">You and your friend both get rewarded when they run their first check-in.</p>
      </div>

      {/* Rewards */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="card rounded-3xl p-4">
          <div className="text-xs font-semibold text-white/50">You get</div>
          <div className="mt-1 flex items-center gap-1.5 text-xl font-black text-gold-300"><CoinIcon size={20} />+{fmt(me.rules.inviterReward)}</div>
          <div className="text-[11px] text-white/45">+{fmt(me.rules.xpPerReferral)} XP per friend</div>
        </div>
        <div className="card rounded-3xl p-4">
          <div className="text-xs font-semibold text-white/50">Your friend gets</div>
          <div className="mt-1 flex items-center gap-1.5 text-xl font-black text-goblin"><CoinIcon size={20} />+{fmt(me.rules.inviteeReward)}</div>
          <div className="text-[11px] text-white/45">welcome bonus</div>
        </div>
      </div>
      {me.rules.campaignNote && <div className="mt-3 rounded-2xl bg-gold-500/10 px-4 py-2.5 text-sm text-gold-300 ring-1 ring-gold-500/20">{me.rules.campaignNote}</div>}
      {!me.rules.referralEnabled && <div className="mt-3 rounded-2xl bg-amber-500/10 px-4 py-2.5 text-sm text-amber-300">Referral rewards are paused right now.</div>}

      {/* Link + actions */}
      <div className="card mt-3 rounded-3xl p-4">
        <div className="text-xs font-semibold text-white/50">Your personal invite link</div>
        <button onClick={copy} className="mt-1.5 flex w-full items-center gap-2 rounded-2xl bg-black/30 px-3 py-2.5 text-left ring-1 ring-white/5">
          <Icon.Link className="h-4 w-4 shrink-0 text-white/40" />
          <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-white/80">{link}</span>
          <Icon.Copy className="h-4 w-4 shrink-0 text-gold-400" />
        </button>
        <div className="mt-3 flex gap-2">
          <button onClick={() => { haptic("tap"); shareInvite(link, me.rules.inviteeReward); }} className="btn-gold flex flex-1 items-center justify-center gap-2 rounded-2xl py-3.5 text-base font-extrabold">
            <Icon.Share className="h-5 w-5" /> Invite Friends
          </button>
          <button onClick={copy} className="btn-ghost flex items-center justify-center rounded-2xl px-4" aria-label="Copy link"><Icon.Copy className="h-5 w-5" /></button>
        </div>
      </div>

      {/* Stats */}
      <div className="mt-3 grid grid-cols-4 gap-2">
        {[
          ["Invited", data?.total],
          ["Activated", data?.activated],
          ["Pending", data?.pending],
          ["Earned", data ? data.earned : undefined],
        ].map(([label, v]) => (
          <div key={label as string} className="card rounded-2xl px-2 py-3 text-center">
            {v === undefined ? <Skeleton className="mx-auto h-6 w-10" /> : <div className="text-lg font-black tabular-nums">{label === "Earned" ? fmtShort(v as number) : fmt(v as number)}</div>}
            <div className="text-[10px] font-semibold uppercase tracking-wide text-white/45">{label}</div>
          </div>
        ))}
      </div>

      {/* Milestone */}
      <div className="card mt-3 rounded-3xl p-4">
        <div className="mb-2 flex justify-between text-sm">
          <span className="font-bold">Next milestone</span>
          <span className="text-white/60 tabular-nums">{activated} / {nextMilestone} friends</span>
        </div>
        <ProgressBar value={activated / nextMilestone} />
      </div>

      {/* Friend list */}
      <h3 className="mb-2 mt-5 px-1 text-sm font-extrabold uppercase tracking-wider text-white/50">Your friends</h3>
      {error ? (
        <EmptyState icon={<Icon.Refresh />} title="Couldn't load friends" text={error} action={<button onClick={() => { setError(null); load(); }} className="btn-ghost rounded-xl px-4 py-2 text-sm font-bold">Retry</button>} />
      ) : !data ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : data.friends.length === 0 ? (
        <EmptyState icon={<Icon.Friends />} title="No friends yet" text="Share your link — every activated friend puts +GOP straight into your balance!" action={<button onClick={() => shareInvite(link, me.rules.inviteeReward)} className="btn-gold rounded-xl px-5 py-2.5 text-sm font-extrabold">Invite now</button>} />
      ) : (
        <div className="card divide-y divide-white/5 rounded-3xl">
          {data.friends.map((f) => (
            <div key={f.id} className="flex items-center gap-3 px-4 py-3">
              <Avatar name={f.name} url={f.photoUrl} size={40} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-bold">{f.name}</div>
                {f.status === "pending" ? (
                  <div className="mt-1 flex items-center gap-2">
                    <ProgressBar value={Math.min(f.progress, me.rules.activationCheckins) / me.rules.activationCheckins} tone="green" className="h-1.5 w-20" />
                    <span className="text-[11px] text-white/45">{Math.min(f.progress, me.rules.activationCheckins)}/{me.rules.activationCheckins} check-ins</span>
                  </div>
                ) : (
                  <div className="text-xs text-white/45">Level {f.level}</div>
                )}
              </div>
              {f.status === "activated" ? <Pill tone="gold">+{fmt(f.reward)}</Pill> : f.status === "pending" ? <Pill tone="amber">Pending</Pill> : <Pill tone="red">Not eligible</Pill>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function fmtShort(n: number) {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : fmt(n);
}
