# GOP Coin — Economy Design & Valuation Model (v3)

This document is the **single source of truth** for every number in the game. All values live in
`src/lib/config.ts` (`DEFAULT_CONFIG`) and can be tuned live by the admin without a redeploy.
**v3 (2026-11)**: audited + re-simulated — see §2.1 (what was wrong) and §7 (simulations).

---

## 1. Valuation anchor (math)

| Anchor | Value | Rationale |
|---|---|---|
| 1 Telegram Star | ≈ $0.013 | Telegram/Fragment public rate (~$1.29 per 100 ⭐) |
| **1 GOP** | **≈ 1 Star ≈ $0.01** | Premium, scarce game currency. Rounded 1:1 GOP:⭐ for a memorable shop |

Consequences of the 1 GOP ≈ $0.01 anchor:

- Invite reward **50 GOP ≈ $0.50** of in-game value per activated friend (admin-mandated figure).
- Base mining **0.5 GOP/h** → **12 GOP/day** → ≈ **$0.12/day** per player at start.
- Nothing in the game can print free GOP faster than the caps below → supply stays scarce, value holds.
- GOP is an **in-game score**. It is never presented as a withdrawable or tradeable asset while the
  tokenization plan (future) is not live.

## 2. Emission control (supply side)

Mining accrual is computed **server-side from timestamps** (no background jobs, no client-trusted clocks):

```
gained = min( speed × hoursOn , dailyCap − minedToday )
hoursOn = time between lastSettle and min(now, lastCheckIn + shutdownHours)
```

- **v3: the mine runs 24/7.** `shutdownHours = 0` — there is no mandatory 6-hour check-in any more.
  Production continues while the app is closed; the only limiter is the daily cap.
  (The admin can still set `shutdownHours > 0` to bring back a check-in window — the whole
  accrual path supports both modes, see `accrualPreview` in `src/lib/mine.ts`.)
- **Daily cap:** the cap ladder is now **binding**: cap tier *i* equals speed tier *i* × 24h.
  Accrual hard-stops when the cap is hit; the quota resets at 00:00 UTC.
- **Maximum possible emission per user:** `min(speedTier × 24h, capTier)`:

| Tier | GOP/h | Cap (GOP/day) | Max GOP/day |
|---|---|---|---|
| 0 (start) | 0.5 | 12 | 12 |
| 1 | 1 | 24 | 24 |
| 2 | 2 | 48 | 48 |
| 3 | 4 | 96 | 96 |
| 4 | 8 | 192 | 192 |
| 5 | 16 | 384 | 384 |
| 6 (max) | 32 | 768 | 768 |

Absolute ceiling: **768 GOP/day/user ≈ $7.68/day** at the anchor — scarce by design.

### 2.1 What was wrong in v2 (audit findings)

1. **The cap ladder was decorative.** Old caps (500 → 32,000 GOP/day) exceeded every speed tier's
   maximum output (12 → 768 GOP/day), so 5 of the 6 capacity upgrades (burning up to 9,000 GOP)
   gave **zero benefit**.
2. **The documented payback was wrong.** ECONOMY.md v2 divided the upgrade price by the *new*
   speed's output instead of the *extra* output (delta). Real paybacks were 12.5–26 days per speed
   tier and 22.5–49.5 days per (speed+capacity) pair — far outside the claimed 6–13 day band.
3. **Bulk crypto packs undercut the anchor.** 10,000 GOP for $95 ($0.0095/GOP) and 30,000 GOP for
   $270 ($0.009/GOP) sold the coin **below** its $0.01 anchor.
4. **XP farming.** Every check-in granted +15 XP unconditionally, so spamming the check-in button
   (rate-limited to 12/min) yielded ~720 XP/h — the "reach level 10" task (250 GOP) was farmable
   in ~25 minutes.

## 3. Coin sinks (demand side)

Upgrades **burn** GOP (immutable negative ledger rows). There is no user-to-user transfer, so the
only ways GOP leaves circulation are upgrades.

**Ordering rule (server-enforced):** the next speed tier's full output must fit under the user's
daily cap — *capacity first, then speed*. This kills trap purchases and makes every upgrade count.

Prices are set so the **payback of a (capacity + speed) pair** — burned GOP divided by the *extra*
GOP/day it unlocks — stays in the classic idle-game band of **8–13 days**:

| Step (i → i+1) | Capacity price | Speed price | Pair total | Extra GOP/day | Payback |
|---|---|---|---|---|---|
| 0 → 1 | 40 | 60 | 100 | +12 | 8.3 d |
| 1 → 2 | 90 | 130 | 220 | +24 | 9.2 d |
| 2 → 3 | 200 | 280 | 480 | +48 | 10.0 d |
| 3 → 4 | 450 | 600 | 1,050 | +96 | 10.9 d |
| 4 → 5 | 1,000 | 1,300 | 2,300 | +192 | 12.0 d |
| 5 → 6 | 2,200 | 2,800 | 5,000 | +384 | 13.0 d |

Total burn to max both ladders: **9,150 GOP**. These are defaults — the admin can retune every
number live from the admin panel (Config → Mining).

## 4. Purchase prices (inflow — revenue)

Both channels are deliberately priced **at or above** the $0.01 anchor so buying never undercuts
the economy and cheap-Stars abuse is impossible (few Stars ⇒ few coins):

**Telegram Stars (fully automatic, server-verified via `successful_payment`):** 1 GOP = 1 ⭐

| Pack | GOP | Stars | Effective $/GOP (⭐≈$0.013) |
|---|---|---|---|
| Starter | 50 | 50 | $0.0130 |
| Small | 150 | 145 | $0.0126 |
| Medium | 500 | 470 | $0.0122 |
| Large | 1,500 | 1,350 | $0.0117 |
| Whale | 5,000 | 4,300 | $0.0112 |

**BNB (BEP-20, manual admin approval with on-chain check):** **$0.011 per GOP** — every package
holds that price point after the v3 re-pricing (bulk packs no longer dip below the anchor):

| Pack | GOP | USD | $/GOP |
|---|---|---|---|
| Crypto S | 1,000 | $11 | $0.0110 |
| Crypto M | 3,000 | $33 | $0.0110 |
| Crypto L | 10,000 | $110 | $0.0110 |
| Crypto XL | 30,000 | $330 | $0.0110 |

A **3% buffer** is added to the expected BNB amount to absorb volatility between order creation
and payment; the exact expected amount is locked into the order row. The BNB/USD reference is an
admin-tunable config value (`payments.crypto.bnbUsd`).

## 5. Rewards & pacing (all synced to the anchor)

| Source | GOP | Notes |
|---|---|---|
| Invite a friend (activated = their first collect) | **50** | inviter; +200 XP |
| Welcome bonus for the invited friend | **25** | invitee |
| Task: join @GOPCOININFO | 25 | verified via `getChatMember` |
| Task: first collect | 25 | auto-verified |
| Task: first friend | 50 | auto-verified |
| Task: reach level 5 | 100 | auto-verified |
| Task: reach level 10 | 250 | auto-verified |
| XP per collect | +15 XP | **max once per 6h bucket** (anti-farm, ≤ 60 XP/day) |

One-time task income is capped at **475 GOP** per account; referral income scales with *real*
activated friends only (burst detection flags >30 invitees/hour; mass-registration farming yields
nothing because activation requires the invitee's first collect).

## 6. Anti-cheat summary (why the economy can't be gamed)

1. **No client-trusted earning.** Accrual is a pure function of server-side timestamps
   (`last_settled_at`, `mine_last_active_at`) — device clocks are irrelevant.
2. **Row-lock + idempotent ledger.** Every balance change is one locked transaction and one unique
   `idempotency_key` (`coin_transactions.idempotency_key` UNIQUE). Replays and double-spends are
   database-impossible. `CHECK (balance >= 0)` is the last line of defence.
3. **XP anti-farm.** Check-in XP is granted only when coins were actually collected, and at most
   once per 6h bucket (`checkinXpBucket`); collect spam yields neither coins nor XP.
4. **Stars:** credit happens **only** on Telegram's `successful_payment` webhook (secret-token
   authenticated), keyed by `telegram_payment_charge_id` → a charge can never pay twice.
5. **Crypto:** one order per TX hash (UNIQUE), expected amount locked at creation, approval only by
   the admin with an on-chain check; credit keyed `crypto:<orderId>` — a TX can never pay twice.
6. **Upgrade ordering:** price and availability are resolved server-side (`upgradeView`); the
   client only says *which* upgrade. Idempotency key `upgrade:<kind>:<userId>:<fromTier>` blocks
   double-purchase on retries; `CAPACITY_FIRST` blocks trap purchases.
7. **Referrals:** attribution only at first registration from signed initData / bot webhook,
   self-referral blocked, burst detection (>30 invites/h → flagged), activation requires the
   invitee's first collect.
8. **Admin surface:** every admin API call re-checks `TELEGRAM_ADMIN_ID` server-side; every admin
   action is audit-logged; `/BACKUP` and `/RESTORE` work only in the admin's private chat.
9. **Rate limits** on every earning/purchase endpoint + risk-score flagging (never auto-ban;
   shared-IP/device users are not blocked by IP signals — IPs are stored only as salted,
   daily-rotating hashes used for rate-limiting, and flags always go to human review).

## 7. Simulation results (30 / 90 / 180 days)

Pure-math simulations (`scripts/economy_sim.mjs`), 24/7 mining under the v3 caps, upgrade plan =
buy capacity → speed whenever affordable:

| Archetype | Horizon | End tiers (speed/cap) | Mined | Bought | Burned | Balance |
|---|---|---|---|---|---|---|
| Casual, no invites | 30 d | 4 / 5 | 3,480 | 0 | 2,850 | 1,130 |
| Casual, no invites | 90 d | 6 / 6 (maxed) | 43,992 | 0 | 9,150 | 35,342 |
| Casual, no invites | 180 d | 6 / 6 (maxed) | 113,112 | 0 | 9,150 | 104,462 |
| Regular, 3 invites | 90 d | 6 / 6 (maxed) | 43,992 | 0 | 9,150 | 35,492 |
| Whale (5,000 + 10,000 GOP bought) | 90 d | 6 / 6 (maxed) | 63,768 | 15,000 | 9,150 | 70,118 |
| Grinder, 10 invites | 180 d | 6 / 6 (maxed) | 118,584 | 0 | 9,150 | 110,634 |

Take-aways:

- Supply per user is **hard-bounded at 768 GOP/day** — the absolute 180-day ceiling is 138,240 GOP
  (≈ $1,382 at anchor) even for a perfectly dedicated account.
- Free players reach the endgame in **~60–90 days**; the burn of 9,150 GOP is the dominant sink.
- Purchases accelerate progression but cannot exceed the same caps — buying never beats the
  economy, it only skips waiting time.
- Long-run inflation comes only from new users and referral/task rewards; admin knobs (prices,
  caps, rewards) can be tuned live without a redeploy.

## 8. Migration (v2 → v3)

`drizzle/0002_economy_v3.sql` (runs once on deploy, guarded & idempotent):

1. `UPDATE users SET mine_limit_tier = GREATEST(mine_limit_tier, mine_speed_tier)` — every existing
   user gets capacity parity with their speed tier, so **nobody's production drops** when the cap
   semantics change (old caps never bound below speed tier 6).
2. The stored game config's mine section is refreshed to the v3 defaults **only** when it still
   carries the old-generation signature (`limitTiers[0] = 500`); crypto packages are re-priced at
   the same time. Everything else in the config is left untouched.
