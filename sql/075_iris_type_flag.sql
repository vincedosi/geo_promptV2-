-- Migration 075 — Flag is_true_iris (vrais IRIS vs IRIS communaux)
-- Diagnostic :
--   type_iris = 'Z' ↔ RIGHT(code_iris, 4) = '0000' : corrélation 1:1 parfaite (0 exception)
--   IRIS communaux (Z) : 33 044 — pop moy 827 hab, ZÉRO donnée Filosofi
--   Vrais IRIS (H/A/D) : 16 404 — pop moy 2 490 hab, données comparables entre elles
--
-- Les IRIS communaux sont des communes non découpées (< ~5 000 hab).
-- Les mélanger avec les vrais IRIS fausse corrélations et analyses.
-- On les garde mais on les flag pour pouvoir les filtrer.

ALTER TABLE public.iris ADD COLUMN IF NOT EXISTS is_true_iris BOOLEAN DEFAULT false;

-- Un vrai IRIS a type_iris IN ('H','A','D') — jamais 'Z'
-- type_iris = 'Z' = commune non découpée (IRIS communal)
UPDATE public.iris
SET is_true_iris = (type_iris != 'Z');

-- Index partiel pour filtrer rapidement sur les 16 404 vrais IRIS
CREATE INDEX IF NOT EXISTS idx_iris_is_true
  ON public.iris (is_true_iris)
  WHERE is_true_iris = true;

COMMENT ON COLUMN public.iris.is_true_iris IS
  'true = vrai IRIS (quartier H/A/D, commune découpée >= ~5000 hab), false = IRIS communal (commune entière non découpée, type Z). Ne pas mélanger les deux dans les corrélations.';

NOTIFY pgrst, 'reload schema';
