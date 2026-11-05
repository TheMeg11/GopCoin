-- GOP Coin economy v3 (one-time, idempotent):
--   * Mine runs 24/7 — the mandatory 6h check-in shutdown is removed (shutdownHours = 0).
--   * Daily-cap ladder becomes the binding constraint (cap tier i = speed tier i × 24h)
--     and capacity upgrades must precede the matching speed upgrade.
--   * Crypto packages are re-priced to hold the $0.011/GOP price point (the old bulk
--     packs sold at $0.009–0.0095/GOP, below the coin's $0.01 anchor).
--
-- Existing players are protected:
--   1) Every user gets cap parity (mine_limit_tier = GREATEST(cap, speed)) so their
--      effective daily production can never drop when the cap ladder semantics change.
--      Old caps (500 * 2^i) never bound below speed tier 6, so this preserves income.
--   2) The stored game config's mine section is refreshed to the v3 defaults ONLY when
--      it still carries the old-generation signature (limitTiers[0] = 500). Everything
--      else in the config (payments, tasks, texts…) is left untouched.

UPDATE users SET mine_limit_tier = GREATEST(mine_limit_tier, mine_speed_tier);

UPDATE game_config
SET value = jsonb_set(
      jsonb_set(
        value,
        '{mine}',
        jsonb_build_object(
          'enabled', COALESCE(value #> '{mine,enabled}', 'true'::jsonb),
          'shutdownHours', 0,
          'speedTiers', '[0.5,1,2,4,8,16,32]'::jsonb,
          'speedPrices', '[60,130,280,600,1300,2800]'::jsonb,
          'limitTiers', '[12,24,48,96,192,384,768]'::jsonb,
          'limitPrices', '[40,90,200,450,1000,2200]'::jsonb
        ),
        true
      ),
      '{payments,crypto,packages}',
      '[{"id":"c1000","gop":1000,"usd":11},{"id":"c3000","gop":3000,"usd":33},{"id":"c10000","gop":10000,"usd":110},{"id":"c30000","gop":30000,"usd":330}]'::jsonb,
      true
    ),
    version = version + 1,
    updated_at = now()
WHERE key = 'main'
  AND (value #>> '{mine,limitTiers,0}' = '500' OR value #> '{mine,limitTiers}' IS NULL);
