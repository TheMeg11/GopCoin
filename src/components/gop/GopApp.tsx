"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiFail, api, getStoredToken, haptic, loadPrefs, setPrefsCache, setToken, tgInitData, tgRaw, type MeState } from "./client";
import { useMineEngine } from "./useMineEngine";
import { HomePage } from "./HomePage";
import { GoblinPage, LevelUpModal } from "./GoblinPage";
import { FriendsPage } from "./FriendsPage";
import { TasksPage } from "./TasksPage";
import { LeaderboardPage } from "./LeaderboardPage";
import { ProfileSheet } from "./ProfileSheet";
import { Avatar, CoinIcon, Icon, Skeleton, ToastProvider, useToast } from "./ui";

const AdminPanel = dynamic(() => import("./admin/AdminPanel").then((m) => m.AdminPanel), {
  ssr: false,
  loading: () => <div className="p-6"><Skeleton className="h-40" /></div>,
});

type Tab = "goblin" | "tasks" | "home" | "friends" | "leaderboard";
const TABS: Tab[] = ["goblin", "tasks", "home", "friends", "leaderboard"];
function initialTab(): Tab {
  if (typeof window === "undefined") return "home";
  const t = new URLSearchParams(window.location.search).get("tab") as Tab | null;
  return t && TABS.includes(t) ? t : "home";
}

type Phase = { kind: "loading" } | { kind: "ready" } | { kind: "demo" } | { kind: "outside" } | { kind: "error"; message: string };

/** Resolves with the Telegram initData once the bridge has loaded, or "" if it
 *  never appears within timeoutMs (caller then treats the launch as outside). */
async function waitForTelegram(timeoutMs: number, isCancelled: () => boolean): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const d = tgInitData();
    if (d) return d;
    if (isCancelled() || Date.now() >= deadline) return "";
    await new Promise((r) => setTimeout(r, 100));
  }
}

export function GopApp() {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  );
}

function AppInner() {
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [me, setMe] = useState<MeState | null>(null);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [profileOpen, setProfileOpen] = useState(false);
  const [adminMode, setAdminMode] = useState(false);
  const [levelUp, setLevelUp] = useState<{ from: number; to: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const m = await api<MeState>("/api/me");
      setMe(m);
      return m;
    } catch (e) {
      if (e instanceof ApiFail && e.status === 401) setPhase({ kind: "error", message: "Your session expired. Please reopen Gop Coin from Telegram." });
      return null;
    }
  }, []);

  const loginDemo = useCallback(async (as: "player" | "admin") => {
    setPhase({ kind: "loading" });
    try {
      let demoId: number | undefined;
      try { demoId = Number(localStorage.getItem("gop:demoId")) || undefined; } catch {}
      const sp = new URLSearchParams(window.location.search);
      const startParam = sp.get("startapp") ?? (sp.get("ref") ? `ref_${sp.get("ref")}` : undefined);
      const r = await api<{ token: string; demoId: number }>("/api/auth/demo", { json: { as, demoId: as === "player" ? demoId : undefined, startParam } });
      if (as === "player") try { localStorage.setItem("gop:demoId", String(r.demoId)); } catch {}
      setToken(r.token);
      if (await refresh()) setPhase({ kind: "ready" });
    } catch (e) {
      setPhase({ kind: "error", message: e instanceof Error ? e.message : "Login failed" });
    }
  }, [refresh]);

  // Boot: Telegram init + authentication
  useEffect(() => {
    setPrefsCache(loadPrefs());
    let cancelled = false;
    (async () => {
      // The Telegram bridge script (telegram-web-app.js) is injected
      // asynchronously by the Next.js runtime, so window.Telegram may not exist
      // yet when this effect first runs — especially on slow connections.
      // Poll for initData (WebApp.initData, or the #tgWebAppData fragment) for a
      // grace period before concluding the app was opened outside Telegram;
      // otherwise a genuine Telegram launch can be misclassified as "outside".
      const initData = await waitForTelegram(10_000, () => cancelled);
      const w = tgRaw();
      try {
        w?.ready();
        w?.expand();
        w?.setHeaderColor?.("#070b09");
        w?.setBackgroundColor?.("#070b09");
        w?.setBottomBarColor?.("#070b09");
        if (w?.isVersionAtLeast?.("7.7")) w.disableVerticalSwipes?.();
      } catch {}
      if (cancelled) return;
      try {
        if (initData) {
          const r = await api<{ token: string; created: boolean }>("/api/auth/telegram", { json: { initData } });
          setToken(r.token);
          const m = await refresh();
          if (m) {
            setPhase({ kind: "ready" });
            if (r.created && m.user.invitedBy) toast(`Welcome! Check in once to unlock your +${m.rules.inviteeReward} GOP bonus 🎁`, "success");
          }
          return;
        }
        const stored = getStoredToken();
        if (stored) {
          setToken(stored);
          if (await refresh()) return setPhase({ kind: "ready" });
          setToken(null);
        }
        const d = await api<{ demo: boolean }>("/api/auth/demo");
        setPhase({ kind: d.demo ? "demo" : "outside" });
      } catch (e) {
        if (!cancelled) setPhase({ kind: "error", message: e instanceof Error ? e.message : "Could not connect" });
      }
    })();
    return () => { cancelled = true; };
  }, [refresh, toast]);

  // Periodic authoritative refresh
  useEffect(() => {
    if (phase.kind !== "ready") return;
    const i = setInterval(refresh, 60_000);
    const v = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", v);
    return () => { clearInterval(i); document.removeEventListener("visibilitychange", v); };
  }, [phase.kind, refresh]);

  const engine = useMineEngine(me, {
    onLevelUp: (from, to) => { haptic("success"); setLevelUp({ from, to }); void refresh(); },
    onReferralActivated: (reward) => { haptic("success"); toast(`🎁 Welcome bonus unlocked: +${reward} GOP!`, "success"); void refresh(); },
    onError: (e) => {
      toast(e.message, "error");
      if (e.status === 403 || e.status === 503) void refresh();
    },
  });

  const go = (t: Tab) => {
    if (t !== tab) haptic("tap");
    setTab(t);
    scrollRef.current?.scrollTo({ top: 0 });
  };

  if (phase.kind !== "ready" || !me || !engine.view) {
    return <BootScreen phase={phase} onDemo={loginDemo} />;
  }

  if (adminMode && me.isAdmin) {
    return <AdminPanel onExit={() => { setAdminMode(false); void refresh(); }} />;
  }

  const view = engine.view;
  return (
    <div className="mx-auto flex h-[100dvh] max-w-lg flex-col">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between px-4 pb-2" style={{ paddingTop: "calc(var(--safe-top) + var(--content-top) + 10px)" }}>
        <div className="flex items-center gap-2">
          <CoinIcon size={30} />
          <div className="leading-none">
            <div className="text-[17px] font-black tracking-wide"><span className="text-goblin">GOP</span> <span className="gold-text">COIN</span></div>
            <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">Mine · Check in · Evolve</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {me.isAdmin && (
            <button onClick={() => setAdminMode(true)} className="flex h-9 items-center gap-1 rounded-full bg-gold-500/15 px-3 text-xs font-extrabold text-gold-300 ring-1 ring-gold-500/30" aria-label="Open admin panel">
              <Icon.Shield className="h-4 w-4" /> Admin
            </button>
          )}
          <button onClick={() => setProfileOpen(true)} className="flex items-center gap-2 rounded-full bg-white/5 py-1 pl-1 pr-2.5 ring-1 ring-white/10" aria-label="Open profile">
            <Avatar name={me.user.name} url={me.user.photoUrl} size={28} />
            <span className="max-w-[90px] truncate text-xs font-bold">{me.user.name}</span>
          </button>
        </div>
      </header>

      {me.announcement.text && (
        <div className="mx-4 mb-2 shrink-0 rounded-2xl bg-goblin/10 px-3 py-2 text-xs font-semibold text-goblin ring-1 ring-goblin/20">📣 {me.announcement.text}</div>
      )}

      {/* Content */}
      <main ref={scrollRef} className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain pb-28" key={tab}>
        {tab === "home" && <HomePage me={me} view={view} checkin={engine.checkin} busy={engine.busy} goFriends={() => go("friends")} goGoblin={() => go("goblin")} />}
        {tab === "goblin" && <GoblinPage me={me} mine={me.mine} xp={view.xp} level={view.level} onPurchased={refresh} onRefresh={refresh} />}
        {tab === "tasks" && <TasksPage me={me} onRewarded={refresh} />}
        {tab === "friends" && <FriendsPage me={me} />}
        {tab === "leaderboard" && <LeaderboardPage me={me} />}
      </main>

      <BottomNav tab={tab} go={go} />

      <ProfileSheet open={profileOpen} onClose={() => setProfileOpen(false)} me={me} mine={me.mine} onOpenAdmin={() => { setProfileOpen(false); setAdminMode(true); }} />
      {levelUp && <LevelUpModal me={me} from={levelUp.from} to={levelUp.to} onClose={() => setLevelUp(null)} />}
    </div>
  );
}

function NavItem({ tab, go, id, label, icon }: { tab: Tab; go: (t: Tab) => void; id: Tab; label: string; icon: React.ReactNode }) {
  return (
    <button onClick={() => go(id)} aria-current={tab === id ? "page" : undefined} className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-bold transition-colors ${tab === id ? "text-gold-300" : "text-white/45"}`}>
      <span className={`flex h-7 w-10 items-center justify-center rounded-full transition ${tab === id ? "bg-gold-500/15" : ""}`}>{icon}</span>
      {label}
    </button>
  );
}

function BottomNav({ tab, go }: { tab: Tab; go: (t: Tab) => void }) {
    return (
    <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-lg px-3" style={{ paddingBottom: "calc(var(--safe-bottom) + 8px)" }} aria-label="Main navigation">
      <div className="relative flex items-end rounded-[26px] border border-white/8 bg-forest-850/90 px-1 shadow-[0_-10px_40px_-10px_rgba(0,0,0,0.8)] backdrop-blur-xl">
        <NavItem tab={tab} go={go} id="goblin" label="Goblin" icon={<Icon.Goblin className="h-5 w-5" />} />
        <NavItem tab={tab} go={go} id="tasks" label="Tasks" icon={<Icon.Tasks className="h-5 w-5" />} />
        <div className="flex flex-1 justify-center">
          <button onClick={() => go("home")} aria-current={tab === "home" ? "page" : undefined} aria-label="Home" className="-mt-7 mb-1.5 flex flex-col items-center gap-0.5">
            <span className={`flex h-[62px] w-[62px] items-center justify-center rounded-full p-1 transition ${tab === "home" ? "bg-gradient-to-b from-gold-300 to-gold-600 shadow-[0_8px_24px_-4px_rgba(245,184,61,0.7)]" : "bg-forest-700 ring-1 ring-white/10"}`}>
              <CoinIcon size={52} className={tab === "home" ? "" : "opacity-80 grayscale-[0.3]"} />
            </span>
            <span className={`text-[10px] font-extrabold ${tab === "home" ? "text-gold-300" : "text-white/45"}`}>Mine</span>
          </button>
        </div>
        <NavItem tab={tab} go={go} id="friends" label="Friends" icon={<Icon.Friends className="h-5 w-5" />} />
        <NavItem tab={tab} go={go} id="leaderboard" label="Leaders" icon={<Icon.Trophy className="h-5 w-5" />} />
      </div>
    </nav>
  );
}

function BootScreen({ phase, onDemo }: { phase: Phase; onDemo: (as: "player" | "admin") => void }) {
  const bot = process.env.NEXT_PUBLIC_BOT_USERNAME;
  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col items-center justify-center px-6 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/art/coin.webp" alt="Gop Coin" width={150} height={150} className={phase.kind === "loading" ? "animate-pulse" : ""} />
      <h1 className="mt-5 text-3xl font-black"><span className="text-goblin">GOP</span> <span className="gold-text">COIN</span></h1>
      <p className="mt-2 max-w-xs text-sm text-white/50">Mine coins automatically — check in every 6 hours to keep your goblin mine running.</p>
      {phase.kind === "loading" && (
        <div className="mt-6 w-full space-y-2">
          <Skeleton className="mx-auto h-4 w-40" />
          <Skeleton className="mx-auto h-4 w-28" />
        </div>
      )}
      {phase.kind === "outside" && (
        <>
          <p className="mt-3 text-sm text-white/60">Gop Coin is a Telegram Mini App. Open it from Telegram to start mining.</p>
          {bot && <a href={`https://t.me/${bot}`} className="btn-gold mt-6 w-full rounded-2xl py-3.5 font-extrabold">Open in Telegram</a>}
          <button onClick={() => window.location.reload()} className="btn-ghost mt-2 rounded-2xl px-6 py-2.5 text-sm font-bold">Reload</button>
        </>
      )}
      {phase.kind === "demo" && (
        <>
          <p className="mt-3 text-sm text-white/60">Preview mode — no <code className="text-gold-300">BOT_TOKEN</code> is configured, so Telegram login is replaced with a demo account. This mode is disabled automatically in production.</p>
          <button onClick={() => onDemo("player")} className="btn-gold mt-6 w-full rounded-2xl py-3.5 text-base font-extrabold">Play demo</button>
          <button onClick={() => onDemo("admin")} className="btn-ghost mt-2 w-full rounded-2xl py-3 text-sm font-bold">Enter as demo admin</button>
        </>
      )}
      {phase.kind === "error" && (
        <>
          <p className="mt-3 text-sm text-red-300">{phase.message}</p>
          <button onClick={() => window.location.reload()} className="btn-ghost mt-5 rounded-2xl px-6 py-3 text-sm font-bold">Try again</button>
        </>
      )}
    </div>
  );
}
