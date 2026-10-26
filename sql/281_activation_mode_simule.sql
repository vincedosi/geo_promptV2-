-- =============================================================================
-- 281 — activation_lots.mode : une poussée réelle ou SIMULÉE (lot 7 « ⑦ Activation », T1, arbitrage A-3)
-- =============================================================================
--
-- Une campagne de DÉMO (`dsp_campaigns.is_demo`) sans connexion DV360 active se pousse en mode `simule` : mêmes
-- contrôles et mêmes comptes que la poussée réelle (mapping CP → geo IDs Google, plafond de 2 000 geo IDs), aucun
-- appel chez Google (`lib/dsp/dv360/pousser-ciblage.ts`). Le lot le dit : l'historique ne doit jamais présenter une
-- poussée simulée comme partie chez DV360.
--
-- Additif et rejouable : `ADD COLUMN IF NOT EXISTS`, défaut `reel` (les lots d'avant le lot 7 sont tous réels).
-- Aucun DROP (base partagée).
ALTER TABLE public.activation_lots
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'reel'
  CONSTRAINT activation_lots_mode_check CHECK (mode IN ('reel', 'simule'));

COMMENT ON COLUMN public.activation_lots.mode IS
  'reel : ciblage envoyé à DV360 ; simule : campagne de démo sans connexion DV360 active, mêmes contrôles et mêmes '
  'comptes, aucun appel chez Google (sql/281, lot 7).';
