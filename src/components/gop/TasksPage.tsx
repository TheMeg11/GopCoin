"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiFail, api, fmt, haptic, openExternal, type MeState } from "./client";
import { CoinIcon, EmptyState, Icon, Pill, ProgressBar, Skeleton, useToast } from "./ui";

type TaskView = {
  id: number; title: string; description: string; type: string; verification: string; url: string | null; reward: number;
  status: "available" | "pending" | "completed" | "rejected" | "expired"; completedAt: string | null;
  requirement: { kind: string; value: number; current: number } | null; expiresAt: string | null;
};

const verifyLabel: Record<string, string> = { auto: "Auto-verified", telegram_member: "Verified via Telegram", manual: "Reviewed by admin" };

export function TasksPage({ me, onRewarded }: { me: MeState; onRewarded: () => void }) {
  const toast = useToast();
  const [tasks, setTasks] = useState<TaskView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [opened, setOpened] = useState<Set<number>>(new Set());

  const load = useCallback(() => {
    api<{ tasks: TaskView[] }>("/api/tasks").then((r) => setTasks(r.tasks)).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const claim = async (t: TaskView) => {
    setBusy(t.id);
    try {
      const r = await api<{ status: "completed" | "pending"; reward: number }>("/api/tasks", { json: { taskId: t.id } });
      if (r.status === "completed") {
        haptic("success");
        toast(`+${fmt(r.reward)} GOP — task complete!`, "success");
        onRewarded();
      } else toast("Submitted for review. You'll be rewarded once approved.", "info");
      load();
    } catch (e) {
      haptic("error");
      toast(e instanceof ApiFail ? e.message : "Something went wrong", "error");
    } finally {
      setBusy(null);
    }
  };

  const open = (t: TaskView) => {
    if (t.url) openExternal(t.url);
    setOpened((s) => new Set(s).add(t.id));
  };

  const action = (t: TaskView) => {
    if (t.status === "completed") return <Pill tone="green"><Icon.Check className="h-3 w-3" />Done</Pill>;
    if (t.status === "pending") return <Pill tone="amber">In review</Pill>;
    if (t.status === "expired") return <Pill>Expired</Pill>;
    const needsOpen = !!t.url && t.verification !== "auto" && !opened.has(t.id);
    if (needsOpen) return <button onClick={() => open(t)} className="btn-ghost rounded-xl px-3.5 py-2 text-sm font-bold">{t.type === "telegram_channel" ? "Join" : "Open"}</button>;
    const met = !t.requirement || t.requirement.current >= t.requirement.value;
    const label = t.verification === "manual" ? "Submit" : t.verification === "telegram_member" ? "Verify" : "Claim";
    return (
      <button disabled={busy === t.id || !met} onClick={() => claim(t)} className="btn-gold rounded-xl px-3.5 py-2 text-sm font-extrabold disabled:opacity-40">
        {busy === t.id ? "…" : label}
      </button>
    );
  };

  if (!me.features.tasks) return <div className="px-4"><EmptyState icon={<Icon.Tasks />} title="Tasks are paused" text="Check back soon for new ways to earn." /></div>;

  return (
    <div className="page-enter px-4 pb-4">
      <div className="text-center">
        <h1 className="text-2xl font-black">Tasks</h1>
        <p className="mt-1 text-sm text-white/60">Optional bonus rewards. Every reward is verified before it&apos;s paid.</p>
      </div>
      <div className="mt-4">
        {error ? (
          <EmptyState icon={<Icon.Refresh />} title="Couldn't load tasks" text={error} action={<button onClick={() => { setError(null); load(); }} className="btn-ghost rounded-xl px-4 py-2 text-sm font-bold">Retry</button>} />
        ) : !tasks ? (
          <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)}</div>
        ) : tasks.length === 0 ? (
          <EmptyState icon={<Icon.Tasks />} title="No tasks right now" text="New community tasks will appear here. Keep tapping and inviting friends in the meantime!" />
        ) : (
          <div className="space-y-2">
            {tasks.map((t) => (
              <div key={t.id} className={`card rounded-3xl p-4 ${t.status === "completed" ? "opacity-70" : ""}`}>
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/5 text-gold-400">
                    {t.type === "telegram_channel" ? <Icon.Share className="h-5 w-5" /> : t.type === "ingame" ? <Icon.Spark className="h-5 w-5" /> : <Icon.Link className="h-5 w-5" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold leading-tight">{t.title}</div>
                    {t.description && <div className="mt-0.5 text-xs text-white/55">{t.description}</div>}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="flex items-center gap-1 text-sm font-extrabold text-gold-300"><CoinIcon size={14} />+{fmt(t.reward)}</span>
                      <Pill>{verifyLabel[t.verification] ?? t.verification}</Pill>
                      {t.status === "rejected" && <Pill tone="red">Not approved — try again</Pill>}
                    </div>
                    {t.requirement && t.status !== "completed" && (
                      <div className="mt-2 flex items-center gap-2">
                        <ProgressBar value={t.requirement.current / t.requirement.value} tone="green" className="h-1.5 flex-1" />
                        <span className="text-[11px] tabular-nums text-white/45">{fmt(Math.min(t.requirement.current, t.requirement.value))}/{fmt(t.requirement.value)}</span>
                      </div>
                    )}
                    {t.completedAt && <div className="mt-1 text-[11px] text-white/40">Completed {new Date(t.completedAt).toLocaleDateString()}</div>}
                  </div>
                  <div className="shrink-0 self-center">{action(t)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
