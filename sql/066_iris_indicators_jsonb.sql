-- ── Migration 066 : Colonne JSONB indicators sur la table iris ───────────────
-- Architecture hybride : colonnes fixes (core) + JSONB pour indicateurs secondaires

ALTER TABLE public.iris ADD COLUMN IF NOT EXISTS indicators JSONB DEFAULT '{}';

-- Index GIN pour les requêtes sur les clés JSONB
-- ex: WHERE (indicators->>'DEC_D121')::numeric < 10000
CREATE INDEX IF NOT EXISTS idx_iris_indicators_gin
  ON public.iris USING GIN (indicators);

COMMENT ON COLUMN public.iris.indicators IS
  'Indicateurs secondaires issus des datasets INSEE (Filosofi déciles, RP étendu, BPE…). '
  'Clés = codes INSEE originaux (ex: DEC_D121, DEC_GI21). '
  'Merge additif à chaque import : les nouvelles clés s''ajoutent, les existantes sont mises à jour, '
  'les clés absentes du nouvel import sont conservées (opérateur ||).';
