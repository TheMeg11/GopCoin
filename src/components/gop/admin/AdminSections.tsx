"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiFail, fmt } from "../client";
import { Confirm, EmptyState, Icon, Pill, Skeleton, useNow, useToast } from "../ui";
import { Panel, adm } from "./shared";

const input = "w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-gold-500/50";
const errMsg = (e: unknown) => (e instanceof ApiFail ? e.message : "Request failed");

/* ======================= Reviews ======================= */
type Claim = { c: { id: number; taskId: number; userId: number; createdAt: string }; title: string; reward: number; name: string; username: string | null; telegramId: string };
type SecEvent = { e: { id: number; userId: number | null; type: string; severity: number; createdAt: string; details: unknown }; name: string | null; username: string | null };

export function ReviewsSection({ onOpenUser }: { onOpenUser: (id: number) => void }) {
  const toast = useToast();
  const [claims, setClaims] = useState<Claim[] | null>(null);
  const [events, setEvents] = useState<SecEvent[] | null>(null);
  const load = useCallback(() => {
    adm<Claim[]>("claims?status=pending").then(setClaims).catch(() => setClaims([]));
    adm<SecEvent[]>("security").then(setEvents).catch(() => setEvents([]));
  }, []);
  useEffect(load, [load]);
  const review = async (id: number, decision: "approve" | "reject") => {
    try {
      await adm(`claims/${id}`, { decision });
      toast(decision === "approve" ? "Approved & rewarded" : "Rejected", "success");
      load();
    } catch (e) { toast(errMsg(e), "error"); }
  };
  const resolve = async (id: number) => {
    try { await adm(`security/${id}`, {}); load(); } catch (e) { toast(errMsg(e), "error"); }
  };
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Panel title="Task claims awaiting review">
        {!claims ? <Skeleton className="h-32" /> : claims.length === 0 ? <div className="py-6 text-center text-sm text-white/40">Nothing to review 🎉</div> : (
          <div className="space-y-2">
            {claims.map((c) => (
              <div key={c.c.id} className="flex items-center gap-3 rounded-xl bg-white/5 p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-bold">{c.title} <span className="text-gold-300">+{fmt(c.reward)}</span></div>
                  <button onClick={() => onOpenUser(c.c.userId)} className="text-xs text-white/50 underline">{c.name}{c.username ? ` @${c.username}` : ""} · TG {c.telegramId}</button>
                </div>
                <button onClick={() => review(c.c.id, "reject")} className="rounded-lg bg-red-500/15 px-3 py-1.5 text-xs font-bold text-red-300">Reject</button>
                <button onClick={() => review(c.c.id, "approve")} className="btn-gold rounded-lg px-3 py-1.5 text-xs font-extrabold">Approve</button>
              </div>
            ))}
          </div>
        )}
      </Panel>
      <Panel title="Suspicious activity (unresolved)">
        {!events ? <Skeleton className="h-32" /> : events.length === 0 ? <div className="py-6 text-center text-sm text-white/40">No open security events.</div> : (
          <div className="max-h-[480px] space-y-2 overflow-y-auto">
            {events.map(({ e, name, username }) => (
              <div key={e.id} className="flex items-start gap-3 rounded-xl bg-white/5 p-3 text-xs">
                <Pill tone={e.severity >= 5 ? "red" : e.severity >= 2 ? "amber" : "neutral"}>+{e.severity}</Pill>
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-sm">{e.type}</div>
                  <div className="text-white/50">{new Date(e.createdAt).toLocaleString()} · {e.userId ? <button onClick={() => onOpenUser(e.userId!)} className="underline">{name ?? "user"}{username ? ` @${username}` : ""}</button> : "anonymous"}</div>
                  {e.details != null && <code className="mt-1 block truncate text-white/40">{JSON.stringify(e.details)}</code>}
                </div>
                <button onClick={() => resolve(e.id)} className="btn-ghost rounded-lg px-2 py-1 font-bold">Resolve</button>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

/* ======================= Config ======================= */
type Cfg = Record<string, Record<string, unknown>>;
const getPath = (o: Cfg, p: string) => p.split(".").reduce<unknown>((a, k) => (a as Record<string, unknown>)?.[k], o);
function setPath(o: Cfg, p: string, v: unknown): Cfg {
  const [s, k] = p.split(".");
  return { ...o, [s]: { ...o[s], [k]: v } };
}

type DraftState = { draft: Cfg; setDraft: (c: Cfg) => void };
const DraftCtx = createContext<DraftState | null>(null);
const useDraft = () => useContext(DraftCtx)!;

function Num({ p, label, hint }: { p: string; label: string; hint?: string }) {
  const { draft, setDraft } = useDraft();
  return (
    <label className="block text-sm"><span className="text-white/60">{label}</span>
      <input type="number" min={0} className={`${input} mt-1`} value={String(getPath(draft, p) ?? "")} onChange={(e) => setDraft(setPath(draft, p, e.target.value === "" ? 0 : Math.trunc(Number(e.target.value))))} />
      {hint && <span className="text-[11px] text-white/35">{hint}</span>}
    </label>
  );
}
function Float({ p, label, hint, step }: { p: string; label: string; hint?: string; step?: string | number }) {
  const { draft, setDraft } = useDraft();
  return (
    <label className="block text-sm"><span className="text-white/60">{label}</span>
      <input type="number" step={step ?? "0.01"} min={0} className={`${input} mt-1`} value={String(getPath(draft, p) ?? "")} onChange={(e) => setDraft(setPath(draft, p, e.target.value === "" ? 0 : Number(e.target.value)))} />
      {hint && <span className="text-[11px] text-white/35">{hint}</span>}
    </label>
  );
}
function Tog({ p, label }: { p: string; label: string }) {
  const { draft, setDraft } = useDraft();
  return (
    <label className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2 text-sm"><span>{label}</span>
      <input type="checkbox" className="h-5 w-5 accent-[#5fd068]" checked={!!getPath(draft, p)} onChange={(e) => setDraft(setPath(draft, p, e.target.checked))} />
    </label>
  );
}
function Txt({ p, label, area }: { p: string; label: string; area?: boolean }) {
  const { draft, setDraft } = useDraft();
  return (
    <label className="block text-sm"><span className="text-white/60">{label}</span>
      {area ? <textarea rows={2} className={`${input} mt-1`} value={String(getPath(draft, p) ?? "")} onChange={(e) => setDraft(setPath(draft, p, e.target.value))} />
        : <input className={`${input} mt-1`} value={String(getPath(draft, p) ?? "")} onChange={(e) => setDraft(setPath(draft, p, e.target.value))} />}
    </label>
  );
}
const Grid = ({ children }: { children: ReactNode }) => <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;

export function ConfigSection() {
  const toast = useToast();
  const [orig, setOrig] = useState<{ value: Cfg; version: number } | null>(null);
  const [draft, setDraft] = useState<Cfg | null>(null);
  const [json, setJson] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    adm<{ value: Cfg; version: number }>("config").then((r) => {
      setOrig(r);
      setDraft(r.value);
      const payments = r.value.payments as unknown as { stars: { packages: unknown[] }; crypto: { packages: unknown[] } };
      setJson({
        levels: JSON.stringify(r.value.progression.levels, null, 1),
        stages: JSON.stringify(r.value.progression.stages, null, 1),
        speedTiers: JSON.stringify(r.value.mine.speedTiers),
        speedPrices: JSON.stringify(r.value.mine.speedPrices),
        limitTiers: JSON.stringify(r.value.mine.limitTiers),
        limitPrices: JSON.stringify(r.value.mine.limitPrices),
        starsPackages: JSON.stringify(payments.stars.packages),
        cryptoPackages: JSON.stringify(payments.crypto.packages),
      });
    }).catch((e) => toast(errMsg(e), "error"));
  }, [toast]);
  useEffect(load, [load]);

  const built = useMemo(() => {
    if (!draft) return { cfg: null as Cfg | null, error: null as string | null };
    try {
      const parsed = Object.fromEntries(Object.entries(json).map(([k, v]) => [k, JSON.parse(v)]));
      const payments = draft.payments as unknown as Record<string, Record<string, unknown>>;
      const cfg: Cfg = {
        ...draft,
        progression: { levels: parsed.levels, stages: parsed.stages },
        mine: { ...draft.mine, speedTiers: parsed.speedTiers, speedPrices: parsed.speedPrices, limitTiers: parsed.limitTiers, limitPrices: parsed.limitPrices },
        payments: {
          ...payments,
          stars: { ...payments.stars, packages: parsed.starsPackages },
          crypto: { ...payments.crypto, packages: parsed.cryptoPackages },
        },
      };
      return { cfg, error: null };
    } catch {
      return { cfg: null, error: "One of the JSON fields is invalid" };
    }
  }, [draft, json]);

  const changes = useMemo(() => {
    if (!orig || !built.cfg) return [];
    const out: { path: string; from: unknown; to: unknown }[] = [];
    for (const s of Object.keys(built.cfg)) for (const k of Object.keys(built.cfg[s] ?? {})) {
      const a = orig.value[s]?.[k], b = built.cfg[s][k];
      if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ path: `${s}.${k}`, from: Array.isArray(a) ? `${(a as unknown[]).length} items` : a, to: Array.isArray(b) ? `${(b as unknown[]).length} items` : b });
    }
    return out;
  }, [orig, built.cfg]);

  const save = async () => {
    if (!built.cfg || !orig) return;
    setBusy(true);
    try {
      const r = await adm<{ value: Cfg; version: number }>("config", { config: built.cfg, version: orig.version, confirm: true }, "PUT");
      setOrig(r);
      setDraft(r.value);
      setConfirm(false);
      toast("Configuration saved — applies to future actions", "success");
    } catch (e) {
      toast(errMsg(e), "error");
      if (e instanceof ApiFail && e.status === 409) load();
    } finally {
      setBusy(false);
    }
  };

  if (!draft || !orig) return <Skeleton className="h-96" />;
  const jf = (key: string, label: string, rows = 2) => (
    <label className="block text-sm"><span className="text-white/60">{label}</span>
      <textarea rows={rows} className={`${input} mt-1 font-mono text-xs`} value={json[key] ?? ""} onChange={(e) => setJson((j) => ({ ...j, [key]: e.target.value }))} />
    </label>
  );
  return (
    <DraftCtx.Provider value={{ draft, setDraft }}>
    <div className="space-y-3 pb-20">
      <Panel title="Mining">
        <Grid>
          <Tog p="mine.enabled" label="Mining enabled" />
          <Float p="mine.shutdownHours" label="Hours until the mine shuts down" hint="0 = mine runs 24/7 (recommended); otherwise users must check in within this window" />
        </Grid>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {jf("speedTiers", "Speed tiers (GOP/hour, strictly increasing JSON array)")}
          {jf("speedPrices", "Speed upgrade prices (GOP burned, tiers.length − 1; speed needs the matching capacity tier first)")}
          {jf("limitTiers", "Daily cap tiers (GOP/day; tier i ≈ speed tier i × 24 keeps both ladders meaningful)")}
          {jf("limitPrices", "Cap upgrade prices (GOP burned)")}
        </div>
      </Panel>
      <Panel title="Referrals">
        <Grid>
          <Tog p="referral.enabled" label="Referral system enabled" />
          <Num p="referral.inviterReward" label="Inviter reward" />
          <Num p="referral.inviteeReward" label="New user welcome reward" />
          <Num p="referral.activationCheckins" label="Check-ins required for activation" />
          <Num p="referral.maxNewReferralsPerHour" label="Flag inviter above N signups / hour" />
          <Txt p="referral.campaignNote" label="Campaign banner (Friends page)" />
        </Grid>
      </Panel>
      <Panel title="Goblin XP">
        <Grid>
          <Num p="xp.perCheckin" label="XP per collect (max once per 6h bucket)" />
          <Num p="xp.perReferral" label="XP per activated referral" />
          <Num p="xp.perWelcome" label="XP for welcome bonus" />
        </Grid>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {jf("levels", "Level thresholds (JSON: level, xp, title)", 10)}
          {jf("stages", "Evolution stages (JSON: name, minLevel, image, description)", 10)}
        </div>
      </Panel>
      <Panel title="Payments — Telegram Stars">
        <Grid>
          <Tog p="payments.stars.enabled" label="Stars payments enabled" />
          <Float p="payments.stars.gopPerStar" label="GOP per Star" step="0.01" hint="1 = 1 GOP ≈ $0.01" />
          <Tog p="features.shop" label="Shop enabled (goblin menu)" />
        </Grid>
        <div className="mt-3">{jf("starsPackages", "Stars packages (JSON: id, gop, stars)", 5)}</div>
      </Panel>
      <Panel title="Payments — Crypto (BNB Smart Chain)">
        <Grid>
          <Tog p="payments.crypto.enabled" label="Crypto payments enabled" />
          <Txt p="payments.crypto.network" label="Network label" />
          <Txt p="payments.crypto.assetSymbol" label="Asset symbol" />
          <Txt p="payments.crypto.address" label="Receive address (0x…)" />
          <Float p="payments.crypto.usdPerGop" label="GOP price for crypto orders (USD)" step="0.0001" />
          <Float p="payments.crypto.bnbUsd" label="BNB/USD reference rate" step="0.01" hint="Update regularly — used to compute expected amounts" />
          <Float p="payments.crypto.bufferPercent" label="Buffer %" step="0.5" hint="Added on top to absorb price movement" />
        </Grid>
        <div className="mt-3">{jf("cryptoPackages", "Crypto packages (JSON: id, gop, usd)", 5)}</div>
      </Panel>
      <Panel title="Risk, features & community">
        <Grid>
          <Num p="risk.flagThreshold" label="Risk score to flag account" />
          <Tog p="features.tasks" label="Tasks page enabled" />
          <Tog p="features.leaderboard" label="Leaderboard enabled" />
          <Txt p="community.channelUrl" label="Official channel URL" />
          <Txt p="community.chatUrl" label="Community chat URL" />
          <Txt p="community.websiteUrl" label="Website URL" />
        </Grid>
      </Panel>
      <Panel title="Announcements & maintenance">
        <Grid>
          <Txt p="announcement.text" label="Announcement banner (empty = hidden)" area />
          <Tog p="announcement.maintenance" label="Maintenance mode (pauses earning)" />
          <Txt p="announcement.maintenanceMessage" label="Maintenance message" area />
        </Grid>
      </Panel>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-forest-950/95 px-4 py-3 backdrop-blur" style={{ paddingBottom: "calc(var(--safe-bottom) + 12px)" }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <span className="text-sm text-white/50">{built.error ? <span className="text-red-300">{built.error}</span> : `${changes.length} unsaved change${changes.length === 1 ? "" : "s"} · v${orig.version}`}</span>
          <div className="flex gap-2">
            <button onClick={load} className="btn-ghost rounded-xl px-4 py-2 text-sm font-bold">Reset</button>
            <button disabled={!changes.length || !!built.error} onClick={() => setConfirm(true)} className="btn-gold rounded-xl px-5 py-2 text-sm font-extrabold disabled:opacity-40">Review & save</button>
          </div>
        </div>
      </div>

      <Confirm open={confirm} title="Apply configuration changes?" busy={busy} onCancel={() => setConfirm(false)} onConfirm={save} confirmText="Save changes">
        <p className="mb-2">These changes take effect for <b>future</b> actions on all instances within seconds. Past transactions are never modified.</p>
        <div className="max-h-60 space-y-1 overflow-y-auto">
          {changes.map((c) => (
            <div key={c.path} className="rounded-lg bg-white/5 px-2 py-1 font-mono text-xs"><b className="text-white">{c.path}</b>: <span className="text-red-300">{JSON.stringify(c.from)}</span> → <span className="text-goblin">{JSON.stringify(c.to)}</span></div>
          ))}
        </div>
        {changes.some((c) => c.path.startsWith("referral.") && /Reward/.test(c.path)) && <p className="mt-2 text-xs text-amber-300">Referral reward change: already-activated referrals keep their original reward; pending referrals will receive the new amount when they activate.</p>}
      </Confirm>
    </div>
    </DraftCtx.Provider>
  );
}

/* ======================= Tasks ======================= */
type TaskRow = { id: number; title: string; description: string; type: string; verification: string; url: string | null; chatId: string | null; requirementKind: string | null; requirementValue: number | null; reward: number; active: boolean; expiresAt: string | null; sortOrder: number };
const emptyTask = { title: "", description: "", type: "link", verification: "manual", url: "", chatId: "", requirementKind: "", requirementValue: 0, reward: 100, active: true, expiresAt: "", sortOrder: 0 };
type TaskForm = typeof emptyTask;

export function TasksSection() {
  const toast = useToast();
  const [rows, setRows] = useState<TaskRow[] | null>(null);
  const [editing, setEditing] = useState<{ id: number | null; f: TaskForm } | null>(null);
  const now = useNow(30_000);
  const load = useCallback(() => { adm<TaskRow[]>("tasks").then(setRows).catch(() => setRows([])); }, []);
  useEffect(load, [load]);

  const toBody = (f: TaskForm) => ({
    title: f.title, description: f.description, type: f.type, verification: f.verification,
    url: f.url || null, chatId: f.chatId || null,
    requirementKind: f.verification === "auto" ? f.requirementKind || null : null,
    requirementValue: f.verification === "auto" && f.requirementValue ? f.requirementValue : null,
    reward: f.reward, active: f.active, expiresAt: f.expiresAt ? new Date(f.expiresAt).toISOString() : null, sortOrder: f.sortOrder,
  });
  const save = async () => {
    if (!editing) return;
    try {
      await adm(editing.id ? `tasks/${editing.id}` : "tasks", toBody(editing.f), editing.id ? "PUT" : "POST");
      toast("Task saved", "success");
      setEditing(null);
      load();
    } catch (e) { toast(errMsg(e), "error"); }
  };
  const fromRow = (t: TaskRow): TaskForm => ({
    title: t.title, description: t.description, type: t.type, verification: t.verification, url: t.url ?? "", chatId: t.chatId ?? "",
    requirementKind: t.requirementKind ?? "", requirementValue: t.requirementValue ?? 0, reward: t.reward, active: t.active,
    expiresAt: t.expiresAt ? new Date(t.expiresAt).toISOString().slice(0, 16) : "", sortOrder: t.sortOrder,
  });
  const quick = async (t: TaskRow, patch: Partial<TaskForm>) => {
    try { await adm(`tasks/${t.id}`, toBody({ ...fromRow(t), ...patch }), "PUT"); load(); } catch (e) { toast(errMsg(e), "error"); }
  };
  const set = (k: keyof TaskForm, v: unknown) => editing && setEditing({ ...editing, f: { ...editing.f, [k]: v } });

  return (
    <div className="space-y-3">
      <div className="flex justify-end"><button onClick={() => setEditing({ id: null, f: { ...emptyTask } })} className="btn-gold rounded-xl px-4 py-2 text-sm font-extrabold">+ New task</button></div>
      {editing && (
        <Panel title={editing.id ? `Edit task #${editing.id}` : "New task"}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm"><span className="text-white/60">Title</span><input className={`${input} mt-1`} value={editing.f.title} onChange={(e) => set("title", e.target.value)} /></label>
            <label className="text-sm"><span className="text-white/60">Reward (GOP)</span><input type="number" min={0} className={`${input} mt-1`} value={editing.f.reward} onChange={(e) => set("reward", Math.trunc(Number(e.target.value)))} /></label>
            <label className="text-sm sm:col-span-2"><span className="text-white/60">Description</span><input className={`${input} mt-1`} value={editing.f.description} onChange={(e) => set("description", e.target.value)} /></label>
            <label className="text-sm"><span className="text-white/60">Type</span>
              <select className={`${input} mt-1`} value={editing.f.type} onChange={(e) => set("type", e.target.value)}><option value="link">Visit link</option><option value="telegram_channel">Telegram channel/group</option><option value="ingame">In-game action</option></select></label>
            <label className="text-sm"><span className="text-white/60">Verification</span>
              <select className={`${input} mt-1`} value={editing.f.verification} onChange={(e) => set("verification", e.target.value)}>
                <option value="manual">Manual admin review</option><option value="telegram_member">Telegram membership (bot must be admin of chat)</option><option value="auto">Automatic (in-game requirement)</option></select></label>
            <label className="text-sm"><span className="text-white/60">URL</span><input className={`${input} mt-1`} value={editing.f.url} onChange={(e) => set("url", e.target.value)} placeholder="https://t.me/yourchannel" /></label>
            {editing.f.verification === "telegram_member" && <label className="text-sm"><span className="text-white/60">Chat ID</span><input className={`${input} mt-1`} value={editing.f.chatId} onChange={(e) => set("chatId", e.target.value)} placeholder="@yourchannel or -100…" /></label>}
            {editing.f.verification === "auto" && (
              <>
                <label className="text-sm"><span className="text-white/60">Requirement</span>
                  <select className={`${input} mt-1`} value={editing.f.requirementKind} onChange={(e) => set("requirementKind", e.target.value)}><option value="">Choose…</option><option value="level">Reach level</option><option value="referrals">Activated referrals</option><option value="checkins">Total check-ins</option><option value="collected">GOP mined (lifetime)</option></select></label>
                <label className="text-sm"><span className="text-white/60">Required value</span><input type="number" min={1} className={`${input} mt-1`} value={editing.f.requirementValue} onChange={(e) => set("requirementValue", Math.trunc(Number(e.target.value)))} /></label>
              </>
            )}
            <label className="text-sm"><span className="text-white/60">Expires at (optional)</span><input type="datetime-local" className={`${input} mt-1`} value={editing.f.expiresAt} onChange={(e) => set("expiresAt", e.target.value)} /></label>
            <label className="text-sm"><span className="text-white/60">Sort order</span><input type="number" className={`${input} mt-1`} value={editing.f.sortOrder} onChange={(e) => set("sortOrder", Math.trunc(Number(e.target.value)))} /></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5 accent-[#5fd068]" checked={editing.f.active} onChange={(e) => set("active", e.target.checked)} />Published (active)</label>
          </div>
          <div className="mt-4 flex gap-2"><button onClick={save} className="btn-gold rounded-xl px-5 py-2 text-sm font-extrabold">Save task</button><button onClick={() => setEditing(null)} className="btn-ghost rounded-xl px-4 py-2 text-sm font-bold">Cancel</button></div>
        </Panel>
      )}
      {!rows ? <Skeleton className="h-40" /> : rows.length === 0 ? <EmptyState icon={<Icon.Tasks />} title="No tasks yet" text="Create optional engagement tasks. Use manual review where automatic verification isn't possible." /> : (
        <div className="card overflow-x-auto rounded-2xl">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-[11px] uppercase text-white/40"><tr>{["#", "Title", "Verification", "Reward", "Status", ""].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-white/5">
              {rows.map((t) => {
                const expired = !!t.expiresAt && new Date(t.expiresAt).getTime() < now;
                return (
                  <tr key={t.id}>
                    <td className="px-3 py-2 text-white/40">{t.id}</td>
                    <td className="px-3 py-2"><div className="font-bold">{t.title}</div><div className="text-xs text-white/40">{t.type}</div></td>
                    <td className="px-3 py-2 text-xs">{t.verification}{t.requirementKind ? ` (${t.requirementKind} ≥ ${t.requirementValue})` : ""}</td>
                    <td className="px-3 py-2 font-bold text-gold-300">{fmt(t.reward)}</td>
                    <td className="px-3 py-2">{expired ? <Pill>expired</Pill> : t.active ? <Pill tone="green">live</Pill> : <Pill tone="amber">disabled</Pill>}</td>
                    <td className="space-x-1 whitespace-nowrap px-3 py-2 text-right">
                      <button onClick={() => setEditing({ id: t.id, f: fromRow(t) })} className="btn-ghost rounded-lg px-2 py-1 text-xs font-bold">Edit</button>
                      <button onClick={() => quick(t, { active: !t.active })} className="btn-ghost rounded-lg px-2 py-1 text-xs font-bold">{t.active ? "Disable" : "Publish"}</button>
                      {!expired && <button onClick={() => quick(t, { expiresAt: new Date(Date.now() + 60_000).toISOString().slice(0, 16) })} className="rounded-lg bg-red-500/15 px-2 py-1 text-xs font-bold text-red-300">Expire</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ======================= Broadcasts ======================= */
type Bc = { id: number; title: string; message: string; buttonText: string | null; segment: string; status: string; scheduledAt: string | null; total: number; sent: number; failed: number; createdAt: string; completedAt: string | null };

export function BroadcastsSection() {
  const toast = useToast();
  const [rows, setRows] = useState<Bc[] | null>(null);
  const [form, setForm] = useState({ title: "", message: "", buttonText: "Play Gop Coin", segment: "all", scheduledAt: "" });
  const [queueId, setQueueId] = useState<number | null>(null);
  const load = useCallback(() => { adm<Bc[]>("broadcasts").then(setRows).catch(() => setRows([])); }, []);
  useEffect(load, [load]);
  const active = rows?.find((r) => r.status === "queued");
  useEffect(() => {
    if (!active) return;
    const t = setInterval(async () => {
      try { await adm(`broadcasts/${active.id}/process`, {}); } catch {}
      load();
    }, 3000);
    return () => clearInterval(t);
  }, [active, load]);

  const create = async () => {
    try {
      await adm("broadcasts", { ...form, buttonText: form.buttonText || null, scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null });
      toast("Draft created — review and queue it below", "success");
      setForm({ ...form, title: "", message: "" });
      load();
    } catch (e) { toast(errMsg(e), "error"); }
  };
  const act = async (id: number, a: "queue" | "cancel") => {
    try { await adm(`broadcasts/${id}/${a}`, {}); toast(a === "queue" ? "Broadcast queued" : "Cancelled", "success"); setQueueId(null); load(); } catch (e) { toast(errMsg(e), "error"); }
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="New announcement">
          <div className="space-y-3">
            <label className="block text-sm"><span className="text-white/60">Internal title</span><input className={`${input} mt-1`} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
            <label className="block text-sm"><span className="text-white/60">Message (plain text, max 3500)</span><textarea rows={5} maxLength={3500} className={`${input} mt-1`} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm"><span className="text-white/60">Button text (opens app)</span><input className={`${input} mt-1`} value={form.buttonText} onChange={(e) => setForm({ ...form, buttonText: e.target.value })} /></label>
              <label className="block text-sm"><span className="text-white/60">Audience</span>
                <select className={`${input} mt-1`} value={form.segment} onChange={(e) => setForm({ ...form, segment: e.target.value })}><option value="all">All reachable users</option><option value="active7d">Active in last 7 days</option><option value="level5">Level 5+</option></select></label>
            </div>
            <label className="block text-sm"><span className="text-white/60">Schedule (optional)</span><input type="datetime-local" className={`${input} mt-1`} value={form.scheduledAt} onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })} /></label>
            <button disabled={!form.title || !form.message} onClick={create} className="btn-gold rounded-xl px-5 py-2 text-sm font-extrabold disabled:opacity-40">Create draft</button>
          </div>
        </Panel>
        <Panel title="Preview">
          <div className="rounded-2xl bg-[#0e1621] p-4">
            <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-[#182533] px-3 py-2 text-sm whitespace-pre-wrap">{form.message || <span className="text-white/30">Your message preview…</span>}</div>
            {form.buttonText && <div className="mt-1 max-w-[85%] rounded-xl bg-[#2b5278]/60 py-2 text-center text-sm font-semibold">{form.buttonText}</div>}
          </div>
          <p className="mt-2 text-xs text-white/40">Only users who started the bot or allowed messages are included. Blocked bots are skipped and recorded. Sending is throttled to stay under Telegram limits; each recipient is claimed once so restarts never cause duplicates.</p>
        </Panel>
      </div>
      <Panel title="Campaigns">
        {!rows ? <Skeleton className="h-24" /> : rows.length === 0 ? <div className="py-6 text-center text-sm text-white/40">No broadcasts yet.</div> : (
          <div className="space-y-2">
            {rows.map((b) => (
              <div key={b.id} className="rounded-xl bg-white/5 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><b>{b.title}</b> <Pill tone={b.status === "completed" ? "green" : b.status === "queued" ? "gold" : b.status === "cancelled" ? "red" : "neutral"}>{b.status}</Pill> <span className="text-xs text-white/40">{b.segment}{b.scheduledAt ? ` · scheduled ${new Date(b.scheduledAt).toLocaleString()}` : ""}</span></div>
                  <div className="flex gap-1">
                    {b.status === "draft" && <button onClick={() => setQueueId(b.id)} className="btn-gold rounded-lg px-3 py-1 text-xs font-extrabold">Queue send</button>}
                    {(b.status === "draft" || b.status === "queued") && <button onClick={() => act(b.id, "cancel")} className="rounded-lg bg-red-500/15 px-3 py-1 text-xs font-bold text-red-300">Cancel</button>}
                  </div>
                </div>
                {b.total > 0 && (
                  <div className="mt-2">
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-goblin" style={{ width: `${((b.sent + b.failed) / b.total) * 100}%` }} /></div>
                    <div className="mt-1 text-xs text-white/50">{fmt(b.sent)} sent · {fmt(b.failed)} failed · {fmt(b.total)} total</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>
      <Confirm open={queueId !== null} title="Send this broadcast?" onCancel={() => setQueueId(null)} onConfirm={() => queueId && act(queueId, "queue")} confirmText="Queue for sending">
        Recipients are snapshotted now. Once queued, messages start sending (or at the scheduled time). This cannot be unsent.
      </Confirm>
    </div>
  );
}

/* ======================= Audit ======================= */
type Audit = { id: number; adminTelegramId: string; action: string; targetUserId: number | null; details: unknown; createdAt: string };

export function AuditSection() {
  const [rows, setRows] = useState<Audit[] | null>(null);
  useEffect(() => { adm<Audit[]>("audit").then(setRows).catch(() => setRows([])); }, []);
  if (!rows) return <Skeleton className="h-64" />;
  if (rows.length === 0) return <EmptyState icon={<Icon.Shield />} title="No admin actions yet" text="Every administrative action is recorded here (append-only)." />;
  return (
    <div className="card overflow-x-auto rounded-2xl">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="text-[11px] uppercase text-white/40"><tr>{["Time", "Admin", "Action", "Target", "Details"].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-white/5">
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap px-3 py-2 text-xs text-white/50">{new Date(r.createdAt).toLocaleString()}</td>
              <td className="px-3 py-2 font-mono text-xs">{r.adminTelegramId}</td>
              <td className="px-3 py-2 font-bold">{r.action}</td>
              <td className="px-3 py-2 text-xs">{r.targetUserId ?? "—"}</td>
              <td className="max-w-md px-3 py-2"><code className="block truncate text-xs text-white/50" title={JSON.stringify(r.details)}>{JSON.stringify(r.details)}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
