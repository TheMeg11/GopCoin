"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiFail, api, type CheckinResponse, type MeState, type MineState } from "./client";

type Snapshot = { balanceMilli: number; mine: MineState; xp: number; level: number; syncedAt: number };

/**
 * Mine engine.
 * - The server is the only authority: coins are settled by /api/mine/checkin.
 * - Between server syncs the UI interpolates the pending amount and the shutdown
 *   countdown locally so the mine looks alive; values snap back to authoritative
 *   state on every sync.
 */
export function useMineEngine(me: MeState | null, handlers: {
  onLevelUp: (from: number, to: number) => void;
  onReferralActivated: (reward: number) => void;
  onError: (e: ApiFail) => void;
  onSuccess?: (creditedGop: number, wasOff: boolean) => void;
}) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const snapRef = useRef<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const h = useRef(handlers);
  useEffect(() => { h.current = handlers; });

  const adopt = useCallback((mine: MineState, balanceMilli: number, xp: number, level: number) => {
    const s: Snapshot = { mine, balanceMilli, xp, level, syncedAt: Date.now() };
    snapRef.current = s;
    setSnap(s);
  }, []);

  // Sync from authoritative /me state.
  useEffect(() => {
    if (!me) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- adopting a server snapshot (same pattern as the original tap engine)
    adopt(me.mine, me.user.balanceMilli, me.user.xp, me.user.level);
  }, [me, adopt]);

  const checkin = useCallback(async (): Promise<boolean> => {
    if (!me || busy) return false;
    if (!me.rules.mineEnabled || me.user.status !== "active") return false;
    setBusy(true);
    try {
      const r = await api<CheckinResponse>("/api/mine/checkin", { json: {} });
      adopt(r.state, Math.round(r.balanceGop * 1000), (snapRef.current?.xp ?? 0) + r.xpGained, r.level);
      if (r.referralActivated) h.current.onReferralActivated(r.referralActivated.inviteeReward);
      if (r.level > r.previousLevel) h.current.onLevelUp(r.previousLevel, r.level);
      h.current.onSuccess?.(r.creditedGop, r.wasOff);
      return true;
    } catch (e) {
      const err = e instanceof ApiFail ? e : new ApiFail(0, "NETWORK", "Connection problem — try again");
      h.current.onError(err);
      return false;
    } finally {
      setBusy(false);
    }
  }, [me, busy, adopt]);

  // Local interpolation of the pending amount & countdown (display only).
  const now = useTick(snap ? 1000 : 0);
  let view: (Snapshot & { pendingGopLive: number; shutdownInMsLive: number | null }) | null = null;
  if (snap) {
    const elapsed = now - snap.syncedAt;
    const speedMilliPerMs = (snap.mine.speedGop * 1000) / 3_600_000;
    const growing = snap.mine.on && !snap.mine.quotaFull;
    const room = Math.max(0, (snap.mine.dailyLimit - snap.mine.minedToday) * 1000 - snap.mine.pendingMilli);
    const pendingMilliLive = growing ? Math.min(snap.mine.pendingMilli + Math.floor(elapsed * speedMilliPerMs), snap.mine.pendingMilli + Math.max(0, room)) : snap.mine.pendingMilli;
    const shutdownInMsLive = snap.mine.on && snap.mine.shutdownInMs !== null ? Math.max(0, snap.mine.shutdownInMs - elapsed) : null;
    view = { ...snap, pendingGopLive: pendingMilliLive / 1000, shutdownInMsLive };
  }

  return { view, checkin, busy, syncing: busy };
}

function useTick(intervalMs: number): number {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    if (!intervalMs) return;
    const i = setInterval(() => setT(Date.now()), intervalMs);
    return () => clearInterval(i);
  }, [intervalMs]);
  return t;
}
