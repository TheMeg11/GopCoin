"use client";

import { useCallback, useEffect, useState } from "react";
import { api, fmt, type MeState } from "./client";
import { Avatar, CoinIcon, EmptyState, Icon, Skeleton } from "./ui";

type Row = { rank: number; id: number; name: string; photoUrl: string | null; level: number; value: number; isMe?: boolean };
type Board = { type: string; offset: number; hasMore: boolean; items: Row[]; me: Row & { rank: number | null } };
const TABS = [
  { id: "coins", label: "Coins" },
  { id: "referrals", label: "Friends" },
  { id: "level", label: "Level" },
] as const;

export function LeaderboardPage({ me }: { me: MeState }) {
  const [type, setType] = useState<(typeof TABS)[number]["id"]>("coins");
  const [board, setBoard] = useState<Board | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((t: string) => {
    setBoard(null);
    setError(null);
    api<Board>(`/api/leaderboard?type=${t}`).then(setBoard).catch((e: Error) => setError(e.message));
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch on tab change
  useEffect(() => load(type), [type, load]);

  const more = async () => {
    if (!board) return;
    setLoadingMore(true);
    try {
      const next = await api<Board>(`/api/leaderboard?type=${type}&offset=${board.offset + board.items.length}`);
      setBoard({ ...next, offset: board.offset, items: [...board.items, ...next.items] });
    } finally {
      setLoadingMore(false);
    }
  };

  const valueLabel = (r: Row) =>
    type === "coins" ? <span className="flex items-center gap-1"><CoinIcon size={14} />{fmt(r.value)}</span> : type === "referrals" ? `${fmt(r.value)} friends` : `Lv ${r.value}`;
  const medal = (rank: number) => (rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : null);

  if (!me.features.leaderboard) return <div className="px-4"><EmptyState icon={<Icon.Trophy />} title="Leaderboard paused" text="Rankings will be back soon." /></div>;

  return (
    <div className="page-enter px-4 pb-4">
      <div className="text-center">
        <h1 className="text-2xl font-black">Leaderboard</h1>
        <p className="mt-1 text-sm text-white/60">All-time rankings from verified server data.</p>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-1 rounded-2xl bg-white/5 p-1" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={type === t.id} onClick={() => setType(t.id)} className={`rounded-xl py-2 text-sm font-bold transition ${type === t.id ? "bg-gold-500 text-forest-950" : "text-white/60"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {board && (
        <div className="mt-3 flex items-center gap-3 rounded-3xl bg-gradient-to-r from-gold-500/25 to-goblin/10 p-3 ring-1 ring-gold-500/30">
          <div className="w-12 text-center text-lg font-black text-gold-300">{board.me.rank ? `#${fmt(board.me.rank)}` : "—"}</div>
          <Avatar name={board.me.name} url={board.me.photoUrl} size={40} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-bold">You</div>
            <div className="text-xs text-white/55">Level {board.me.level}</div>
          </div>
          <div className="text-sm font-extrabold">{valueLabel(board.me)}</div>
        </div>
      )}

      <div className="mt-3">
        {error ? (
          <EmptyState icon={<Icon.Refresh />} title="Couldn't load rankings" text={error} action={<button onClick={() => load(type)} className="btn-ghost rounded-xl px-4 py-2 text-sm font-bold">Retry</button>} />
        ) : !board ? (
          <div className="space-y-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : board.items.length === 0 ? (
          <EmptyState icon={<Icon.Trophy />} title="No players yet" text="Be the first goblin on the board!" />
        ) : (
          <div className="card divide-y divide-white/5 rounded-3xl">
            {board.items.map((r) => (
              <div key={r.id} className={`flex items-center gap-3 px-3 py-2.5 ${r.isMe ? "bg-gold-500/10" : ""}`}>
                <div className="w-9 text-center text-sm font-black tabular-nums text-white/60">{medal(r.rank) ?? r.rank}</div>
                <Avatar name={r.name} url={r.photoUrl} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold">{r.name}{r.isMe && <span className="text-gold-300"> (you)</span>}</div>
                  <div className="text-[11px] text-white/45">Level {r.level}</div>
                </div>
                <div className="text-sm font-extrabold tabular-nums">{valueLabel(r)}</div>
              </div>
            ))}
          </div>
        )}
        {board?.hasMore && (
          <button onClick={more} disabled={loadingMore} className="btn-ghost mt-3 w-full rounded-2xl py-3 text-sm font-bold">{loadingMore ? "Loading…" : "Show more"}</button>
        )}
      </div>
    </div>
  );
}
