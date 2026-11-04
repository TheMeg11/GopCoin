"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ApiFail, fmt } from "../client";
import { Panel, adm } from "./shared";
import { Confirm, EmptyState, Icon, Pill, Skeleton, ToastProvider, useToast } from "../ui";
import { AuditSection, BroadcastsSection, ConfigSection, ReviewsSection, TasksSection } from "./AdminSections";

const SECTIONS = [
  ["overview", "Overview"],
  ["users", "Users"],
  ["reviews", "Reviews"],
  ["config", "Game config"],
  ["tasks", "Tasks"],
  ["broadcasts", "Broadcasts"],
  ["audit", "Audit log"],
] as const;
type Section = (typeof SECTIONS)[number][0];

export function AdminPanel({ onExit }: { onExit: () => void }) {
  return (
    <ToastProvider>
      <Shell onExit={onExit} />
    </ToastProvider>
  );
}

function Shell({ onExit }: { onExit: () => void }) {
  const [section, setSection] = useState<Section>("overview");
  const [openUser, setOpenUser] = useState<number | null>(null);
  return (
    <div className="min-h-[100dvh] bg-forest-950 text-white">
      <header className="sticky top-0 z-30 border-b border-white/5 bg-forest-950/95 backdrop-blur" style={{ paddingTop: "calc(var(--safe-top) + var(--content-top))" }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <Icon.Shield className="h-6 w-6 text-gold-400" />
            <div>
              <div className="text-base font-black">Gop Coin Admin</div>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-white/40">Server-verified administrator</div>
            </div>
          </div>
          <button onClick={onExit} className="btn-gold flex items-center gap-1 rounded-xl px-3 py-2 text-sm font-extrabold"><Icon.Back className="h-4 w-4" />User Mode</button>
        </div>
        <nav className="no-scrollbar mx-auto flex max-w-6xl gap-1 overflow-x-auto px-3 pb-2">
          {SECTIONS.map(([id, label]) => (
            <button key={id} onClick={() => { setSection(id); setOpenUser(null); }} className={`shrink-0 rounded-xl px-3 py-1.5 text-sm font-bold ${section === id ? "bg-gold-500 text-forest-950" : "text-white/60 hover:bg-white/5"}`}>{label}</button>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-4" style={{ paddingBottom: "calc(var(--safe-bottom) + 24px)" }}>
        {openUser !== null ? (
          <UserDetail id={openUser} onBack={() => setOpenUser(null)} />
        ) : section === "overview" ? (
          <Overview go={setSection} />
        ) : section === "users" ? (
          <Users onOpen={setOpenUser} />
        ) : section === "reviews" ? (
          <ReviewsSection onOpenUser={setOpenUser} />
        ) : section === "config" ? (
          <ConfigSection />
        ) : section === "tasks" ? (
          <TasksSection />
        ) : section === "broadcasts" ? (
          <BroadcastsSection />
        ) : (
          <AuditSection />
        )}
      </main>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "gold" | "red" | "green" }) {
  return (
    <div className="card rounded-2xl p-3.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-white/45">{label}</div>
      <div className={`mt-1 text-2xl font-black tabular-nums ${tone === "gold" ? "text-gold-300" : tone === "red" ? "text-red-300" : tone === "green" ? "text-goblin" : ""}`}>{value}</div>
      {sub && <div className="text-[11px] text-white/40">{sub}</div>}
    </div>
  );
}

function Bars({ data, color }: { data: { day: string; v: number }[]; color: string }) {
  const max = Math.max(1, ...data.map((d) => d.v));
  const total = data.reduce((s, d) => s + d.v, 0);
  if (total === 0) return <div className="flex h-24 items-center justify-center text-xs text-white/35">No data yet</div>;
  return (
    <div className="flex h-24 items-end gap-1">
      {data.map((d) => (
        <div key={d.day} className="group relative flex-1">
          <div className="w-full rounded-t" style={{ height: `${Math.max(2, (d.v / max) * 88)}px`, background: color }} />
          <div className="pointer-events-none absolute -top-6 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-black px-1.5 py-0.5 text-[10px] group-hover:block">{d.day.slice(5)}: {fmt(d.v)}</div>
        </div>
      ))}
    </div>
  );
}

type Stats = {
  users: { total: number; newToday: number; dau: number; flagged: number; restricted: number };
  referrals: { activated: number; pending: number; activatedToday: number };
  coins: { balances: number; mineCoins: number; purchaseCoins: number; referralRewards: number; taskRewards: number; minedToday: number };
  mines: { running: number };
  payments: { pendingCryptoOrders: number; approvedCryptoUsd: number };
  pendingClaims: number;
  series: { day: string; registrations: number; active: number; referrals: number; coins: number }[];
  config: Record<string, number | boolean>;
};
type EnvInfo = { demoMode: boolean; botConfigured: boolean; webAppUrl: string | null; botUsername: string | null; adminIdConfigured: boolean; adminId: string };

function Overview({ go }: { go: (s: Section) => void }) {
  const toast = useToast();
  const [s, setS] = useState<Stats | null>(null);
  const [env, setEnv] = useState<EnvInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [setupBusy, setSetupBusy] = useState(false);
  const load = useCallback(() => {
    adm<Stats>("stats").then(setS).catch((e: Error) => setErr(e.message));
    adm<EnvInfo>("env").then(setEnv).catch(() => {});
  }, []);
  useEffect(load, [load]);
  const setup = async () => {
    setSetupBusy(true);
    try {
      const r = await adm<{ webhook: { ok: boolean; description?: string }; menu: { ok: boolean } }>("bot/setup", {});
      toast(r.webhook.ok ? "Webhook, commands and menu button configured" : `Webhook failed: ${r.webhook.description}`, r.webhook.ok ? "success" : "error");
    } catch (e) {
      toast(e instanceof ApiFail ? e.message : "Setup failed", "error");
    } finally {
      setSetupBusy(false);
    }
  };
  if (err) return <EmptyState icon={<Icon.Refresh />} title="Failed to load" text={err} />;
  if (!s) return <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>;
  const series = (k: "registrations" | "active" | "referrals" | "coins") => s.series.map((d) => ({ day: d.day, v: d[k] }));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total users" value={fmt(s.users.total)} sub={`+${fmt(s.users.newToday)} today`} />
        <Stat label="Daily active" value={fmt(s.users.dau)} sub="Opened app today (UTC)" tone="green" />
        <Stat label="Mines running" value={fmt(s.mines.running)} sub="Checked in within the window" tone="green" />
        <Stat label="Mined today" value={fmt(s.coins.minedToday)} sub="GOP credited today (UTC)" />
        <Stat label="Referrals" value={fmt(s.referrals.activated)} sub={`+${fmt(s.referrals.activatedToday)} today · ${fmt(s.referrals.pending)} pending`} tone="gold" />
        <Stat label="Coins in balances" value={fmt(s.coins.balances)} tone="gold" />
        <Stat label="Mined / purchased" value={`${fmt(s.coins.mineCoins)} / ${fmt(s.coins.purchaseCoins)}`} sub={`Referrals: ${fmt(s.coins.referralRewards)} · Tasks: ${fmt(s.coins.taskRewards)}`} />
        <button onClick={() => go("reviews")} className="text-left"><Stat label="Needs review" value={fmt(s.users.flagged + s.pendingClaims + s.payments.pendingCryptoOrders)} sub={`${s.users.flagged} flagged · ${s.pendingClaims} claims · ${s.payments.pendingCryptoOrders} crypto orders`} tone={s.users.flagged + s.pendingClaims + s.payments.pendingCryptoOrders ? "red" : undefined} /></button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Panel title="Registrations · 14d"><Bars data={series("registrations")} color="#5fd068" /></Panel>
        <Panel title="Active users · 14d"><Bars data={series("active")} color="#3e9b48" /></Panel>
        <Panel title="Referrals activated · 14d"><Bars data={series("referrals")} color="#ffd166" /></Panel>
        <Panel title="Coins issued · 14d"><Bars data={series("coins")} color="#f5b83d" /></Panel>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Panel title="Current reward configuration" right={<button onClick={() => go("config")} className="text-xs font-bold text-gold-300">Edit →</button>}>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            {Object.entries(s.config).map(([k, v]) => (
              <div key={k} className="rounded-xl bg-white/5 px-3 py-2"><dt className="text-[11px] text-white/45">{k}</dt><dd className="font-bold">{typeof v === "boolean" ? (v ? "On" : "Off") : fmt(v)}</dd></div>
            ))}
          </dl>
        </Panel>
        <Panel title="Deployment & bot">
          {env ? (
            <div className="space-y-2 text-sm">
              <Row k="Telegram bot" v={env.botConfigured ? <Pill tone="green">configured</Pill> : <Pill tone="red">BOT_TOKEN missing</Pill>} />
              <Row k="Bot username" v={env.botUsername ?? "—"} />
              <Row k="WEBAPP_URL" v={<span className="break-all">{env.webAppUrl ?? "—"}</span>} />
              <Row k="Admin ID" v={env.adminIdConfigured ? <Pill tone="green">from TELEGRAM_ADMIN_ID</Pill> : <Pill tone="amber">demo admin</Pill>} />
              {env.demoMode && <div className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-300">Demo mode is active because BOT_TOKEN is not set. It turns off automatically once BOT_TOKEN is configured.</div>}
              <button disabled={!env.botConfigured || setupBusy} onClick={setup} className="btn-gold mt-1 w-full rounded-xl py-2.5 text-sm font-extrabold disabled:opacity-40">{setupBusy ? "Configuring…" : "Register webhook, commands & menu button"}</button>
            </div>
          ) : <Skeleton className="h-32" />}
        </Panel>
      </div>
    </div>
  );
}

const Row = ({ k, v }: { k: string; v: ReactNode }) => (
  <div className="flex items-center justify-between gap-3"><span className="text-white/50">{k}</span><span className="text-right font-semibold">{v}</span></div>
);

type UserRow = { id: number; telegramId: string; name: string; username: string | null; joinedAt: string; balance: number; lifetimeEarned: number; level: number; referralCount: number; speedTier: number; capTier: number; minedToday: number; status: string; flagged: boolean; riskScore: number };

const FILTERS = [["all", "All"], ["active", "Active"], ["restricted", "Restricted"], ["flagged", "Flagged"], ["referrals", "Top referrers"], ["balance", "Top balances"], ["miners", "Top miners"], ["recent", "Last 24h"]] as const;

export function StatusPill({ status, flagged }: { status: string; flagged?: boolean }) {
  return (
    <span className="inline-flex gap-1">
      <Pill tone={status === "active" ? "green" : status === "suspended" ? "amber" : "red"}>{status}</Pill>
      {flagged && <Pill tone="red">flagged</Pill>}
    </span>
  );
}

function Users({ onOpen }: { onOpen: (id: number) => void }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ total: number; hasMore: boolean; users: UserRow[] } | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      adm<{ total: number; hasMore: boolean; users: UserRow[] }>(`users?q=${encodeURIComponent(q)}&filter=${filter}&page=${page}`).then(setData).catch(() => setData({ total: 0, hasMore: false, users: [] }));
    }, 250);
    return () => clearTimeout(t);
  }, [q, filter, page]);
  return (
    <div className="space-y-3">
      <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Search name, @username, Telegram ID or referral code" className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm outline-none focus:border-gold-500/50" />
      <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
        {FILTERS.map(([id, label]) => (
          <button key={id} onClick={() => { setFilter(id); setPage(0); }} className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${filter === id ? "bg-goblin text-forest-950" : "bg-white/5 text-white/60"}`}>{label}</button>
        ))}
      </div>
      <div className="card overflow-x-auto rounded-2xl">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-white/40">
            <tr>{["User", "Telegram ID", "Joined", "Balance", "Lifetime", "Lv", "Refs", "Speed/Cap", "Today", "Status", "Risk"].map((h) => <th key={h} className="px-3 py-2.5 font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {!data ? (
              <tr><td colSpan={11} className="p-3"><Skeleton className="h-32" /></td></tr>
            ) : data.users.length === 0 ? (
              <tr><td colSpan={11} className="p-8 text-center text-white/40">No users match.</td></tr>
            ) : (
              data.users.map((u) => (
                <tr key={u.id} onClick={() => onOpen(u.id)} className="cursor-pointer hover:bg-white/5">
                  <td className="px-3 py-2.5"><div className="font-bold">{u.name}</div><div className="text-[11px] text-white/40">{u.username ? `@${u.username}` : "—"}</div></td>
                  <td className="px-3 py-2.5 font-mono text-xs text-white/60">{u.telegramId}</td>
                  <td className="px-3 py-2.5 text-xs text-white/60">{new Date(u.joinedAt).toLocaleDateString()}</td>
                  <td className="px-3 py-2.5 font-bold tabular-nums text-gold-300">{fmt(u.balance)}</td>
                  <td className="px-3 py-2.5 tabular-nums">{fmt(u.lifetimeEarned)}</td>
                  <td className="px-3 py-2.5">{u.level}</td>
                  <td className="px-3 py-2.5">{u.referralCount}</td>
                  <td className="px-3 py-2.5 tabular-nums text-white/70">S{u.speedTier} / C{u.capTier}</td>
                  <td className="px-3 py-2.5 tabular-nums">{fmt(u.minedToday)}</td>
                  <td className="px-3 py-2.5"><StatusPill status={u.status} flagged={u.flagged} /></td>
                  <td className={`px-3 py-2.5 tabular-nums ${u.riskScore > 20 ? "text-red-300" : "text-white/50"}`}>{u.riskScore}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {data && (
        <div className="flex items-center justify-between text-sm text-white/50">
          <span>{fmt(data.total)} users · page {page + 1}</span>
          <div className="flex gap-2">
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="btn-ghost rounded-lg px-3 py-1.5 font-bold disabled:opacity-30">Prev</button>
            <button disabled={!data.hasMore} onClick={() => setPage((p) => p + 1)} className="btn-ghost rounded-lg px-3 py-1.5 font-bold disabled:opacity-30">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

type Detail = {
  user: Record<string, unknown> & { id: number; name: string; telegramId: string; username: string | null; balance: number; lifetimeEarned: number; level: number; xp: number; referralCount: number; referralEarned: number; mineEarned: number; purchaseEarned: number; collectedCount: number; mineSpeedTier: number; mineLimitTier: number; dailyMined: number; effectiveStatus: string; flagged: boolean; riskScore: number; adminNote: string | null; createdAt: string; statusReason: string | null; suspendedUntil: string | null; referralCode: string };
  ledgerConsistent: boolean;
  ledger: { id: number; type: string; amount: number; balanceAfter: number; reason: string | null; createdAt: string; adminTelegramId: number | null }[];
  invited: { id: number; name: string; username: string | null; status: string; createdAt: string }[];
  inviter: { id: number; name: string; status: string } | null;
  orders: { id: number; packageId: string; gopAmount: number; usdAmount: string; assetSymbol: string; assetAmount: string; txHash: string | null; status: string; createdAt: string }[];
  restrictions: { id: number; action: string; reason: string; createdAt: string; until: string | null }[];
  events: { id: number; type: string; severity: number; createdAt: string; details: unknown }[];
};

type ActionKind = "suspend" | "restore" | "ban" | "unban" | "flag" | "unflag" | "adjust";

function UserDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const toast = useToast();
  const [d, setD] = useState<Detail | null>(null);
  const [action, setAction] = useState<ActionKind | null>(null);
  const [reason, setReason] = useState("");
  const [hours, setHours] = useState(24);
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    adm<Detail>(`users/${id}`).then((x) => { setD(x); setNote(x.user.adminNote ?? ""); }).catch((e: Error) => toast(e.message, "error"));
  }, [id, toast]);

  const run = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const x = await adm<Detail>(`users/${id}/action`, body);
      setD(x);
      setAction(null);
      setReason("");
      toast("Action recorded in audit log", "success");
    } catch (e) {
      toast(e instanceof ApiFail ? e.message : "Failed", "error");
    } finally {
      setBusy(false);
    }
  };

  if (!d) return <Skeleton className="h-96" />;
  const u = d.user;
  const highImpact = action === "ban" || action === "suspend" || action === "adjust";
  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1 text-sm font-bold text-white/60"><Icon.Back className="h-4 w-4" />Back to users</button>
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xl font-black">{u.name}</div>
            <div className="text-sm text-white/50">{u.username ? `@${u.username} · ` : ""}TG {u.telegramId} · code {u.referralCode} · joined {new Date(u.createdAt).toLocaleString()}</div>
            <div className="mt-1.5"><StatusPill status={u.effectiveStatus} flagged={u.flagged} /> <Pill>risk {u.riskScore}</Pill> {d.ledgerConsistent ? <Pill tone="green">ledger ✓</Pill> : <Pill tone="red">ledger mismatch</Pill>}</div>
            {u.statusReason && <div className="mt-1 text-xs text-amber-300">Reason: {u.statusReason}{u.suspendedUntil ? ` · until ${new Date(u.suspendedUntil).toLocaleString()}` : ""}</div>}
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            {["Balance", "Lifetime", "Level", "XP", "Referrals", "Check-ins", "Mine tiers", "Mined today", "Purchased"].map((k, i) => (
              <div key={k} className="rounded-xl bg-white/5 px-3 py-1.5"><div className="text-[10px] text-white/45">{k}</div><div className="font-black tabular-nums">{fmt([u.balance, u.lifetimeEarned, u.level, u.xp, u.referralCount, u.collectedCount, `S${u.mineSpeedTier}/C${u.mineLimitTier}`, u.dailyMined, u.purchaseEarned][i] as number)}</div></div>
            ))}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {u.effectiveStatus === "suspended" ? <ActBtn onClick={() => setAction("restore")}>Restore earning</ActBtn> : u.effectiveStatus === "active" && <ActBtn onClick={() => setAction("suspend")} tone="amber">Suspend earning</ActBtn>}
          {u.effectiveStatus === "banned" ? <ActBtn onClick={() => setAction("unban")}>Unban</ActBtn> : <ActBtn onClick={() => setAction("ban")} tone="red">Ban</ActBtn>}
          {u.flagged ? <ActBtn onClick={() => setAction("unflag")}>Clear flag</ActBtn> : <ActBtn onClick={() => setAction("flag")}>Flag for review</ActBtn>}
          <ActBtn onClick={() => setAction("adjust")} tone="gold">Balance correction</ActBtn>
        </div>
      </Panel>

      <div className="grid gap-3 md:grid-cols-2">
        <Panel title="Admin note">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} className="w-full rounded-xl border border-white/10 bg-white/5 p-3 text-sm outline-none" placeholder="Internal note (only visible to admin)" />
          <button disabled={busy} onClick={() => run({ action: "note", note })} className="btn-ghost mt-2 rounded-xl px-4 py-2 text-sm font-bold">Save note</button>
        </Panel>
        <Panel title="Referral relationships">
          <div className="text-sm">Invited by: {d.inviter ? <b>{d.inviter.name} <Pill>{d.inviter.status}</Pill></b> : <span className="text-white/40">nobody</span>}</div>
          <div className="mt-2 max-h-40 space-y-1 overflow-y-auto text-sm">
            {d.invited.length === 0 ? <div className="text-white/40">No invited users.</div> : d.invited.map((i) => (
              <div key={i.id} className="flex justify-between rounded-lg bg-white/5 px-2 py-1"><span>{i.name}{i.username ? ` @${i.username}` : ""}</span><Pill tone={i.status === "activated" ? "green" : "amber"}>{i.status}</Pill></div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title="Coin transactions (latest 50)">
        <div className="max-h-72 overflow-auto">
          <table className="w-full min-w-[560px] text-left text-xs">
            <thead className="text-white/40"><tr><th className="py-1.5">Time</th><th>Type</th><th>Amount</th><th>Balance after</th><th>Reason</th></tr></thead>
            <tbody className="divide-y divide-white/5">
              {d.ledger.map((l) => (
                <tr key={l.id}><td className="py-1.5 text-white/50">{new Date(l.createdAt).toLocaleString()}</td><td>{l.type}</td><td className={`font-bold ${l.amount < 0 ? "text-red-300" : "text-goblin"}`}>{l.amount > 0 ? "+" : ""}{fmt(l.amount)}</td><td className="tabular-nums">{fmt(l.balanceAfter)}</td><td className="text-white/50">{l.reason ?? "—"}{l.adminTelegramId ? ` (admin ${l.adminTelegramId})` : ""}</td></tr>
              ))}
            </tbody>
          </table>
          {d.ledger.length === 0 && <div className="py-4 text-center text-sm text-white/40">No transactions.</div>}
        </div>
      </Panel>

      <div className="grid gap-3 md:grid-cols-3">
        <Panel title="Crypto orders">
          <div className="space-y-1.5 text-xs">{d.orders.length === 0 ? <div className="text-white/40">None.</div> : d.orders.map((o) => (
            <div key={o.id} className="rounded-lg bg-white/5 px-2 py-1"><b>#{o.id}</b> {fmt(o.gopAmount)} GOP · ${o.usdAmount} · {o.assetAmount} {o.assetSymbol}<div className="text-white/50">{o.status} · {new Date(o.createdAt).toLocaleString()}</div></div>
          ))}</div>
        </Panel>
        <Panel title="Restrictions history">
          <div className="space-y-1.5 text-xs">{d.restrictions.length === 0 ? <div className="text-white/40">None.</div> : d.restrictions.map((r) => (
            <div key={r.id} className="rounded-lg bg-white/5 px-2 py-1"><b>{r.action}</b> · {new Date(r.createdAt).toLocaleString()}<div className="text-white/50">{r.reason}</div></div>
          ))}</div>
        </Panel>
        <Panel title="Security events">
          <div className="max-h-56 space-y-1.5 overflow-y-auto text-xs">{d.events.length === 0 ? <div className="text-white/40">None.</div> : d.events.map((e) => (
            <div key={e.id} className="rounded-lg bg-white/5 px-2 py-1"><b>{e.type}</b> (+{e.severity}) · {new Date(e.createdAt).toLocaleString()}</div>
          ))}</div>
        </Panel>
      </div>

      <Confirm
        open={action !== null}
        title={action === "adjust" ? "Balance correction" : `Confirm: ${action}`}
        danger={action === "ban" || (action === "adjust" && amount < 0)}
        busy={busy}
        confirmText={highImpact ? "Yes, apply" : "Confirm"}
        onCancel={() => setAction(null)}
        onConfirm={() => {
          if (!action) return;
          const body: Record<string, unknown> = { action, reason };
          if (highImpact) body.confirm = true;
          if (action === "suspend") body.hours = hours;
          if (action === "adjust") body.amount = amount;
          void run(body);
        }}
      >
        <div className="space-y-3">
          {action === "ban" && <p>Banning blocks all earning for <b>{u.name}</b> across every session and device.</p>}
          {action === "suspend" && (
            <label className="block">Suspend for (hours)
              <input type="number" min={1} value={hours} onChange={(e) => setHours(Number(e.target.value))} className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white" />
            </label>
          )}
          {action === "adjust" && (
            <label className="block">Amount (negative to deduct). Current balance: <b>{fmt(u.balance)}</b>
              <input type="number" value={amount} onChange={(e) => setAmount(Math.trunc(Number(e.target.value)))} className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white" />
              <span className="mt-1 block text-xs text-white/45">Creates an immutable ledger entry with your admin ID. Balances are never overwritten.</span>
            </label>
          )}
          <label className="block">Reason (required, recorded in audit log)
            <input value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white" placeholder="e.g. automated tapping confirmed" />
          </label>
        </div>
      </Confirm>
    </div>
  );
}

function ActBtn({ children, onClick, tone }: { children: ReactNode; onClick: () => void; tone?: "red" | "amber" | "gold" }) {
  const c = tone === "red" ? "bg-red-500/15 text-red-300 ring-red-500/30" : tone === "amber" ? "bg-amber-500/15 text-amber-300 ring-amber-500/30" : tone === "gold" ? "bg-gold-500/15 text-gold-300 ring-gold-500/30" : "bg-white/5 text-white/80 ring-white/10";
  return <button onClick={onClick} className={`rounded-xl px-3 py-2 text-sm font-bold ring-1 ${c}`}>{children}</button>;
}
