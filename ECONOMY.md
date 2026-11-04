# GOP Coin — Economy Design & Valuation Model

This document is the **single source of truth** for every number in the game. All values live in
`src/lib/config.ts` (`DEFAULT_CONFIG`) and can be tuned live by the admin without a redeploy.

---

## 1. Valuation anchor (math)

| Anchor | Value | Rationale |
|---|---|---|
| 1 Telegram Star | ≈ $0.013 | Telegram/Fragment public rate (~$1.29 per 100 ⭐) |
| **1 GOP** | **≈ 1 Star ≈ $0.01** | Premium, scarce game currency. Rounded 1:1 GOP:⭐ for a memorable shop |

Consequences of the 1 GOP ≈ $0.01 anchor:

- Invite reward **50 GOP ≈ $0.50** of in-game value per activated friend (admin-mandated figure — consistent with the anchor).
- Base mining **0.5 GOP/h** → **12 GOP/day** at perfect discipline → ≈ **$0.12/day** per player at start.
- Nothing in the game can print free GOP faster than the caps below → supply stays scarce, value holds.

## 2. Emission control (supply side)

Mining accrual is computed **server-side from timestamps** (no background jobs):

```
gained = min( speed × hoursOn , dailyCap − minedToday , quotaRoom )
hoursOn = time between lastSettle and min(now, lastCheckIn + 6h)
```

- **Check-in discipline:** the mine shuts down automatically after **6 h** without a check-in;
  production stops at the shutdown moment (missing hours are never credited retroactively).
- **Daily cap:** base **500 GOP/day**. Accrual hard-stops when the cap is hit (excess production is
  lost — scarcity by design). Cap applies to *mining only*; purchased coins are not capped.
- **Maximum possible emission per user:** `min(speedTier × 24h, limitTier)`:

| Speed tier | GOP/h | Max GOP/day (24 h on) | Daily cap at that level |
|---|---|---|---|
| 0 (start) | 0.5 | 12 | 500 |
| 1 | 1 | 24 | 1,000 |
| 2 | 2 | 48 | 2,000 |
| 3 | 4 | 96 | 4,000 |
| 4 | 8 | 192 | 8,000 |
| 5 | 16 | 384 | 16,000 |
| 6 | 32 | 768 | 32,000 |

## 3. Coin sinks (demand side)

Upgrades **burn** GOP (immutable negative ledger rows). There is no user-to-user transfer, so the
only ways GOP leaves circulation are upgrades. Burn prices are set so the **payback period** of an
upgrade stays in the classic idle-game band of **6–13 days**:

| Upgrade | Effect | Price (burned) | Payback |
|---|---|---|---|
| Speed → 1/h | +12 GOP/day | 150 | ~6.3 d |
| Speed → 2/h | +24 GOP/day | 350 | ~7.3 d |
| Speed → 4/h | +48 GOP/day | 800 | ~8.3 d |
| Speed → 8/h | +96 GOP/day | 1,800 | ~9.4 d |
| Speed → 16/h | +192 GOP/day | 4,200 | ~10.9 d |
| Speed → 32/h | +384 GOP/day | 10,000 | ~13.0 d |
| Cap → 1,000 | headroom | 120 | utility |
| Cap → 2,000 | headroom | 300 | utility |
| Cap → 4,000 | headroom | 700 | utility |
| Cap → 8,000 | headroom | 1,600 | utility |
| Cap → 16,000 | headroom | 3,800 | utility |
| Cap → 32,000 | headroom | 9,000 | utility |

Sink/flow target: a mid-game player reinvests ~60–80 % of production into upgrades. Escalating
prices keep late-game whales from dumping unlimited supply.

## 4. Purchase prices (inflow — revenue)

Both channels are deliberately priced **at or above** the $0.01 anchor so buying never undercuts
the economy and cheap-Stars abuse is impossible (few Stars ⇒ few coins):

**Telegram Stars (fully automatic, server-verified via `successful_payment`):** 1 GOP = 1 ⭐

| Pack | GOP | Stars | Effective discount |
|---|---|---|---|
| Starter | 50 | 50 | 0 % |
| Small | 150 | 145 | ~3 % |
| Medium | 500 | 470 | ~6 % |
| Large | 1,500 | 1,350 | ~10 % |
| Whale | 5,000 | 4,300 | ~14 % |

**BNB (BEP-20, manual admin approval with on-chain check):** **$0.011 per GOP** (10 % premium over
the anchor to absorb fees/volatility) + a **3 % buffer** added to the expected BNB amount.
The BNB/USD reference price is an admin-tunable config value (`payments.crypto.bnbUsd`).
Every order locks in its exact expected amount at creation time.

| Pack | GOP | USD |
|---|---|---|
| Crypto S | 1,000 | $11 |
| Crypto M | 3,000 | $30 |
| Crypto L | 10,000 | $95 |
| Crypto XL | 30,000 | $270 |

## 5. Rewards & pacing (all synced to the anchor)

| Source | GOP | Notes |
|---|---|---|
| Invite a friend (activated = their first check-in) | **50** | inviter; +200 XP |
| Welcome bonus for the invited friend | **25** | invitee |
| Task: join @GOPCOININFO | 25 | verified via `getChatMember` |
| Task: first check-in | 25 | auto-verified |
| Task: first friend | 50 | auto-verified |
| Task: reach level 5 | 100 | auto-verified |
| Task: reach level 10 | 250 | auto-verified |
| XP per check-in | +15 XP | levels never cost coins |

A new player on base speed reaches their first speed upgrade (150 GOP) in **~1.5–2 weeks** of
disciplined mining, or in a couple of days with 2–3 friends — or instantly for 150 ⭐ (~$2).

## 6. Anti-cheat summary (why the economy can't be gamed)

1. **No client-trusted earning.** The tap system is gone; accrual is a pure function of
   server-side timestamps (`last_settled_at`, `mine_last_active_at`) — device clocks are irrelevant.
2. **Row-lock + idempotent ledger.** Every balance change is one locked transaction and one unique
   `idempotency_key` (`coin_transactions.idempotency_key` UNIQUE). Replays and double-spends are
   database-impossible. `CHECK (balance >= 0)` is the last line of defence.
3. **Stars:** credit happens **only** on Telegram's `successful_payment` webhook (secret-token
   authenticated), keyed by `telegram_payment_charge_id` → a charge can never pay twice.
4. **Crypto:** one order per TX hash (UNIQUE), expected amount locked at creation, approval only by
   the admin with an on-chain check; credit keyed `crypto:<orderId>` — a TX can never pay twice.
5. **Upgrades:** price is looked up server-side from the tier table; the client only says *which*
   upgrade. Idempotency key `upgrade:<kind>:<userId>:<fromTier>` blocks double-purchase on retries.
6. **Referrals:** attribution only at first registration from signed initData / bot webhook,
   self-referral blocked, burst detection (>30 invites/h → flagged), activation requires the
   invitee's first check-in (mass-registration farming yields nothing).
7. **Admin surface:** every admin API call re-checks `TELEGRAM_ADMIN_ID` server-side; every admin
   action is audit-logged; `/BACKUP` and `/RESTORE` work only in the admin's private chat.
8. **Rate limits** on every earning/purchase endpoint + risk-score flagging (never auto-ban).
