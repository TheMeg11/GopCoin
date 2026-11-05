"use client";

/* ---------- Types mirrored from the API ---------- */
export type LevelDef = { level: number; xp: number; title: string };
export type StageDef = { name: string; minLevel: number; image: string; description: string };

export type MineState = {
  on: boolean;
  shutDown: boolean;
  speedGop: number;
  dailyLimit: number;
  minedToday: number;
  remainingToday: number;
  quotaFull: boolean;
  pendingMilli: number;
  pendingGop: number;
  shutdownInMs: number | null;
  shutdownAt: string | null;
  resetAt: string;
  checkins: number;
  speedTier: number;
  limitTier: number;
  maxSpeedTier: number;
  maxLimitTier: number;
};

export type StarsPackage = { id: string; gop: number; stars: number };
export type CryptoPackage = { id: string; gop: number; usd: number };
export type PaymentsState = {
  stars: { enabled: boolean; gopPerStar: number; packages: StarsPackage[] };
  crypto: { enabled: boolean; network: string; assetSymbol: string; address: string; usdPerGop: number; bnbUsd: number; bufferPercent: number; packages: CryptoPackage[] };
};

export type UpgradeView = {
  kind: "speed" | "limit";
  tier: number;
  maxTier: number;
  currentValue: number;
  nextValue: number | null;
  price: number | null;
  purchasable: boolean;
  lockedReason: string | null;
};

export type MeState = {
  user: {
    id: number; name: string; photoUrl: string | null; level: number; username: string | null;
    balance: number; balanceMilli: number; lifetimeEarned: number; mineEarned: number; referralEarned: number; purchaseEarned: number;
    checkins: number; xp: number;
    referralCount: number; pendingReferrals: number; referralCode: string; status: "active" | "suspended" | "banned";
    suspendedUntil: string | null; joinedAt: string; invitedBy: { status: string } | null;
  };
  progression: {
    level: number; title: string; currentLevelXp: number; nextLevelXp: number | null; xpToNext: number; progress: number; maxed: boolean;
    stage: StageDef; nextStage: StageDef | null;
  };
  mine: MineState;
  mineTierData: { speedTiers: number[]; speedPrices: number[]; limitTiers: number[]; limitPrices: number[] };
  upgrades: { speed: UpgradeView; limit: UpgradeView };
  rules: {
    mineEnabled: boolean; shutdownHours: number; referralEnabled: boolean; inviterReward: number;
    inviteeReward: number; activationCheckins: number; xpPerCheckin: number; xpPerReferral: number; campaignNote: string; shopEnabled: boolean;
  };
  payments: PaymentsState;
  levels: LevelDef[];
  stages: StageDef[];
  features: { tasks: boolean; leaderboard: boolean; shop: boolean };
  community: { channelUrl: string; chatUrl: string; websiteUrl: string };
  announcement: { text: string; maintenance: boolean; maintenanceMessage: string };
  isAdmin: boolean;
  serverTime: string;
  links: { primary: string; botLink: string; appLink: string | null };
};

export type CheckinResponse = {
  creditedGop: number; balanceGop: number; restarted: boolean; wasOff: boolean; xpGained: number;
  level: number; previousLevel: number; referralActivated: { inviteeReward: number } | null; state: MineState;
};

/* ---------- Telegram WebApp bridge ---------- */
type TgWebApp = {
  initData: string;
  initDataUnsafe?: { start_param?: string };
  ready: () => void;
  expand: () => void;
  setHeaderColor?: (c: string) => void;
  setBackgroundColor?: (c: string) => void;
  setBottomBarColor?: (c: string) => void;
  disableVerticalSwipes?: () => void;
  openTelegramLink: (url: string) => void;
  openLink: (url: string) => void;
  HapticFeedback?: { impactOccurred: (s: "light" | "medium" | "heavy" | "rigid" | "soft") => void; notificationOccurred: (s: "success" | "error" | "warning") => void };
  isVersionAtLeast?: (v: string) => boolean;
  platform?: string;
};

export function tg(): TgWebApp | null {
  if (typeof window === "undefined") return null;
  const w = (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp;
  return w && w.initData ? w : null;
}

export function tgRaw(): TgWebApp | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp ?? null;
}

/**
 * Best-effort Telegram initData.
 * Normal path: WebApp.initData. Fallback: the #tgWebAppData=... fragment that
 * Telegram appends whenever it launches a Mini App — this covers launches where
 * the bridge object exists but initData was not (yet) populated.
 * The fragment value is the initData string percent-encoded once, so we decode
 * exactly once to get the byte-identical string the server knows how to verify.
 */
export function tgInitData(): string {
  const w = tgRaw();
  if (w?.initData) return w.initData;
  if (typeof window === "undefined") return "";
  try {
    const m = window.location.hash.match(/tgWebAppData=([^&]+)/);
    if (m) return decodeURIComponent(m[1]);
  } catch {}
  return "";
}

/* ---------- Preferences (sound/haptics) ---------- */
const PREF_KEY = "gop:prefs";
export type Prefs = { sound: boolean; haptics: boolean };
export function loadPrefs(): Prefs {
  try {
    return { sound: false, haptics: true, ...JSON.parse(localStorage.getItem(PREF_KEY) ?? "{}") };
  } catch {
    return { sound: false, haptics: true };
  }
}
export function savePrefs(p: Prefs) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch {}
}

let prefsCache: Prefs | null = null;
export function setPrefsCache(p: Prefs) { prefsCache = p; }

export function haptic(kind: "tap" | "success" | "error" | "warning") {
  if (!(prefsCache ?? loadPrefs()).haptics) return;
  const h = tgRaw()?.HapticFeedback;
  try {
    if (h) kind === "tap" ? h.impactOccurred("light") : h.notificationOccurred(kind);
    else if (kind === "tap" && "vibrate" in navigator) navigator.vibrate?.(8);
  } catch {}
}

let audioCtx: AudioContext | null = null;
export function playTick(pitch = 1) {
  if (!(prefsCache ?? loadPrefs()).sound) return;
  try {
    audioCtx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = "triangle";
    o.frequency.value = 880 * pitch;
    g.gain.setValueAtTime(0.06, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.09);
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + 0.1);
  } catch {}
}

/* ---------- API client ---------- */
let token: string | null = null;
export function setToken(t: string | null) {
  token = t;
  try { t ? sessionStorage.setItem("gop:token", t) : sessionStorage.removeItem("gop:token"); } catch {}
}
export function getStoredToken() {
  try { return sessionStorage.getItem("gop:token"); } catch { return null; }
}

export class ApiFail extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown; keepalive?: boolean }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? (init?.json !== undefined ? "POST" : "GET"),
    headers: { ...(init?.json !== undefined ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: init?.json !== undefined ? JSON.stringify(init.json) : undefined,
    keepalive: init?.keepalive,
    cache: "no-store",
  });
  let data: unknown = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; message?: string };
    throw new ApiFail(res.status, d.error ?? "ERROR", d.message ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export const fmt = (n: number) => n.toLocaleString("en-US");
export const fmtCompact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K` : fmt(n));

/** Decimal GOP display (up to 2 places, trims trailing zeros). */
export function fmtGop(n: number): string {
  const v = Math.round(n * 100) / 100;
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function countdown(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function shareInvite(link: string, reward: number) {
  const text = `⛏ Dig with me in GOP COIN — the goblin mining game!\n\n🪙 Your mine produces coins 24/7 — collect any time\n⬆️ Upgrade your pickaxe speed & daily capacity\n👥 +${reward} GOP welcome bonus with my link\n\n👉 ${link}`;
  const url = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
  const w = tgRaw();
  if (w?.openTelegramLink && tg()) w.openTelegramLink(url);
  else window.open(url, "_blank", "noopener");
}

export function openExternal(url: string) {
  const w = tg();
  if (!w) return void window.open(url, "_blank", "noopener");
  if (/^https:\/\/t\.me\//.test(url)) w.openTelegramLink(url);
  else w.openLink(url);
}

/** Open the bot chat pre-loaded with a /start payload (e.g. a Stars purchase deep link). */
export function openBotDeepLink(payload: string) {
  const bot = process.env.NEXT_PUBLIC_BOT_USERNAME ?? "";
  const url = `https://t.me/${bot}?start=${payload}`;
  const w = tgRaw();
  if (w?.openTelegramLink && tg()) w.openTelegramLink(url);
  else window.open(url, "_blank", "noopener");
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
