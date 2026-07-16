-- 105 — bid_multiplier = 0 autorisé dans bidding_zone_configs.
-- Appliquée via MCP Supabase le 2026-07-16 (migration bzc_multiplier_allow_zero_exclusion).
--
-- Le mode diffusion « zones strictes » (out_zone_weights.mode = 'exclusion',
-- livré 2026-07-15) écrit ×0 sur les CP hors zone via apply_zone_weights_to_strategy.
-- La contrainte historique (> 0, posée le 2026-04-28 avant l'existence du mode
-- exclusion) faisait échouer tout re-arm d'une stratégie en zones strictes
-- (500 sur PATCH /api/bidding/strategies/[id]).
-- 0 = exclusion explicite (ne pas enchérir) — une ligne absente serait ambiguë.

ALTER TABLE bidding_zone_configs
  DROP CONSTRAINT bzc_bid_multiplier_positive;

ALTER TABLE bidding_zone_configs
  ADD CONSTRAINT bzc_bid_multiplier_nonnegative CHECK (bid_multiplier >= 0);
