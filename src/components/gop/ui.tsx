"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

/* ---------- Icons (inline SVG, no icon font downloads) ---------- */
type IP = { className?: string };
const S = ({ className, children }: IP & { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className ?? "h-6 w-6"} aria-hidden>
    {children}
  </svg>
);
export const Icon = {
  Goblin: (p: IP) => (
    <S {...p}><path d="M3 9l4 2M21 9l-4 2" /><path d="M7 11a5 5 0 0 1 10 0v2a5 5 0 0 1-10 0z" /><path d="M10 13h.01M14 13h.01" /><path d="M10 16c1.2.8 2.8.8 4 0" /></S>
  ),
  Tasks: (p: IP) => (<S {...p}><rect x="4" y="3" width="16" height="18" rx="3" /><path d="M8 9l2 2 4-4M8 15h8" /></S>),
  Friends: (p: IP) => (<S {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6" /></S>),
  Trophy: (p: IP) => (<S {...p}><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z" /><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4" /></S>),
  Copy: (p: IP) => (<S {...p}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></S>),
  Share: (p: IP) => (<S {...p}><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4z" /></S>),
  Shield: (p: IP) => (<S {...p}><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M9 12l2 2 4-4" /></S>),
  Close: (p: IP) => (<S {...p}><path d="M6 6l12 12M18 6L6 18" /></S>),
  Check: (p: IP) => (<S {...p}><path d="M5 12l5 5 9-10" /></S>),
  Clock: (p: IP) => (<S {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></S>),
  Lock: (p: IP) => (<S {...p}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></S>),
  Spark: (p: IP) => (<S {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6" /></S>),
  Arrow: (p: IP) => (<S {...p}><path d="M9 6l6 6-6 6" /></S>),
  Back: (p: IP) => (<S {...p}><path d="M15 6l-6 6 6 6" /></S>),
  Link: (p: IP) => (<S {...p}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></S>),
  Refresh: (p: IP) => (<S {...p}><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" /></S>),
};

export function CoinIcon({ size = 20, className = "" }: { size?: number; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/art/coin.webp" alt="" width={size} height={size} className={`inline-block shrink-0 ${className}`} draggable={false} />;
}

export function Avatar({ name, url, size = 36 }: { name: string; url?: string | null; size?: number }) {
  const [err, setErr] = useState(false);
  const initials = name.replace(/^@/, "").split(/\s+/).map((s) => s[0]).join("").slice(0, 2).toUpperCase() || "G";
  if (url && !err)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" width={size} height={size} onError={() => setErr(true)} className="shrink-0 rounded-full object-cover ring-1 ring-white/10" style={{ width: size, height: size }} />;
  return (
    <div className="flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-goblin-dim to-forest-600 font-bold text-white ring-1 ring-white/10" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {initials}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-xl ${className}`} />;
}

export function ProgressBar({ value, className = "", tone = "gold" }: { value: number; className?: string; tone?: "gold" | "green" }) {
  return (
    <div className={`h-2 overflow-hidden rounded-full bg-white/8 ${className}`} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div
        className={`h-full rounded-full transition-[width] duration-500 ${tone === "gold" ? "bg-gradient-to-r from-gold-600 via-gold-400 to-gold-300" : "bg-gradient-to-r from-goblin-dim to-goblin"}`}
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
      />
    </div>
  );
}

export function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center rounded-3xl px-6 py-10 text-center">
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/5 text-gold-400">{icon}</div>
      <div className="text-base font-bold">{title}</div>
      <p className="mt-1 max-w-xs text-sm text-white/55">{text}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "gold" | "green" | "red" | "amber" }) {
  const tones = {
    neutral: "bg-white/8 text-white/70",
    gold: "bg-gold-500/15 text-gold-300",
    green: "bg-goblin/15 text-goblin",
    red: "bg-red-500/15 text-red-300",
    amber: "bg-amber-500/15 text-amber-300",
  };
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${tones[tone]}`}>{children}</span>;
}

/* ---------- Toasts ---------- */
type Toast = { id: number; text: string; tone: "success" | "error" | "info" };
const ToastCtx = createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 z-[80] flex flex-col items-center gap-2 px-4" style={{ top: "calc(var(--safe-top) + var(--content-top) + 10px)" }} aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast-enter pointer-events-auto flex max-w-sm items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold shadow-2xl backdrop-blur-md ${
              t.tone === "success" ? "bg-goblin/90 text-forest-950" : t.tone === "error" ? "bg-red-500/90 text-white" : "bg-forest-700/95 text-white ring-1 ring-white/10"
            }`}
          >
            {t.tone === "success" && <Icon.Check className="h-4 w-4" />}
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- Bottom sheet & confirm dialog ---------- */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center" role="dialog" aria-modal="true">
      <div className="fade-in absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="sheet-enter relative max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-t-[28px] border-t border-white/10 bg-forest-850 px-5 pt-3" style={{ paddingBottom: "calc(var(--safe-bottom) + 20px)" }}>
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/15" />
        {title && (
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-extrabold">{title}</h2>
            <button onClick={onClose} className="btn-ghost rounded-full p-1.5" aria-label="Close"><Icon.Close className="h-5 w-5" /></button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export function Confirm({
  open, title, children, confirmText = "Confirm", danger, onConfirm, onCancel, busy,
}: { open: boolean; title: string; children: ReactNode; confirmText?: string; danger?: boolean; onConfirm: () => void; onCancel: () => void; busy?: boolean }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" role="alertdialog" aria-modal="true">
      <div className="fade-in absolute inset-0 bg-black/70" onClick={onCancel} />
      <div className="toast-enter relative w-full max-w-md rounded-3xl border border-white/10 bg-forest-850 p-5 shadow-2xl">
        <h3 className="text-lg font-extrabold">{title}</h3>
        <div className="mt-2 text-sm text-white/70">{children}</div>
        <div className="mt-5 flex gap-2">
          <button onClick={onCancel} className="btn-ghost flex-1 rounded-2xl py-3 font-bold">Cancel</button>
          <button disabled={busy} onClick={onConfirm} className={`flex-1 rounded-2xl py-3 font-extrabold disabled:opacity-50 ${danger ? "bg-red-500 text-white" : "btn-gold"}`}>
            {busy ? "Working…" : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
