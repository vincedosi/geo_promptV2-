-- ============================================================================
-- sql/170_score_composite_jsonb.sql — 2026-09-15
--
-- QUATRIEME troncature PostgREST de ce projet, et la premiere dans la
-- fonctionnalite que la branche `feat/suivi-v2` vient d'ajouter.
--
-- `calculer_score_composite` (sql/146) est `RETURNS TABLE` et rend UNE LIGNE
-- PAR CODE POSTAL. Le plafond `MAX_CP` de `/api/analyses/score` a ete releve
-- de 3 000 a 7 000 le 2026-09-15 precisement pour admettre le perimetre
-- national. Or PostgREST tronque a 5 000 lignes TOUTE RPC `RETURNS TABLE`,
-- silencieusement, sans erreur ni en-tete exploitable — piege deja mesure
-- deux fois sur ce depot (`correlation_campagne_indicateur`, sql/154 ; puis
-- `codes_postaux_du_perimetre`, sql/168).
--
-- Mesure en base, 2026-09-15 :
--   select count(*) from calculer_score_composite(
--     array['abstention_pres_2022','rev_median'], array[1,1],
--     array['croissant','croissant'],
--     (select array_agg(code_postal) from ref_codes_postaux));
--   -> 6186   (pour 6 187 CP au referentiel)
--
-- sql/168 a corrige la fonction qui RESOUT le perimetre. Celle qui le CALCULE,
-- en aval, etait restee `RETURNS TABLE` : la choropleth laissait 1 186 codes
-- postaux non colories et la ligne ecrite dans `analyses.resultat` figeait
-- `n_scores: 5000` sur un perimetre de 6 187. Aucune erreur, rien a l'ecran.
--
-- Pourquoi la recette ne l'avait pas vu : le parcours navigateur de la tache
-- filtre-france a ete joue avec `rev_median` SEUL (1 952 CP de couverture) —
-- sous le seuil de 5 000, la troncature ne se manifeste jamais.
--
-- ── Forme du correctif : le patron etabli sql/168 + sql/169 ────────────────
-- 1. Une fonction JUMELLE `RETURNS jsonb` porte le CORPS du calcul (PostgREST
--    ne tronque pas un scalaire jsonb).
-- 2. `calculer_score_composite` (RETURNS TABLE) devient une ENVELOPPE MINCE de
--    la jumelle — un seul corps, deux formes de retour, derive impossible par
--    construction. C'est exactement ce que sql/169 a fait pour
--    `codes_postaux_du_perimetre`, et pour la meme raison : deux copies du
--    meme calcul que rien ne compare finissent par diverger.
-- 3. JAMAIS de DROP : `CREATE OR REPLACE`, meme signature et meme type de
--    retour pour l'enveloppe. La base est unique et partagee avec la
--    production ; `/api/custom-geo/source/score` (plafond 1 500 CP, donc
--    jamais tronque) continue d'appeler la forme TABLE sans changement.
--
-- ── Ce qui change dans le calcul : RIEN ────────────────────────────────────
-- Le corps est repris mot pour mot de sql/146 (normalisation min-max sur le
-- PERIMETRE DEMANDE, poids renormalises sur les seuls indicateurs presents de
-- la ligne, `n_indicateurs` rendu). Seul ajout : un `ORDER BY postal_code`
-- avant l'agregation, pour que le tableau JSON soit deterministe — la version
-- TABLE n'avait aucun ORDER BY, donc aucun consommateur ne pouvait dependre
-- de son ordre.
--
-- Jumeau TypeScript inchange : `lib/analyses/score.ts` (memes poids, meme
-- arrondi au dixieme).
--
-- Verifie apres application (2 indicateurs, les 6 187 CP du referentiel) :
--   jsonb_array_length(calculer_score_composite_jsonb(…)) = 6186
--   count(*) from calculer_score_composite(…)            = 6186
--   FULL JOIN des deux sorties sur postal_code           = 0 ecart
--
-- Cout mesure, EXPLAIN (ANALYZE, BUFFERS), meme appel :
--   jumelle jsonb      67,4 ms · shared hit=2899 · 0 lecture disque
--   enveloppe TABLE    72,7 ms · shared hit=2948 · 0 lecture disque
-- L'indirection coute ~5 ms et 49 buffers sur 6 186 lignes — mesuree, non
-- supposee, et jugee negligeable a cette echelle (meme ruling que sql/169).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.calculer_score_composite_jsonb(
  p_indicateurs   text[],    -- indicator_code de indicator_cp_values
  p_poids         numeric[], -- un par indicateur, > 0
  p_sens          text[],    -- 'croissant' | 'decroissant', un par indicateur
  p_codes_postaux text[]     -- perimetre OBLIGATOIRE : la liste de CP du filtre/zone
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  WITH base AS (
    SELECT v.postal_code, v.indicator_code, v.value, i.poids, i.sens
    FROM public.indicator_cp_values v
    JOIN LATERAL (
      SELECT p_poids[g.ord] AS poids, p_sens[g.ord] AS sens
      FROM generate_subscripts(p_indicateurs, 1) AS g(ord)
      WHERE p_indicateurs[g.ord] = v.indicator_code
    ) i ON true
    WHERE v.indicator_code = ANY(p_indicateurs)
      AND v.postal_code    = ANY(p_codes_postaux)
  ), bornes AS (
    SELECT indicator_code, MIN(value) AS mn, MAX(value) AS mx
    FROM base GROUP BY indicator_code
  ), normalise AS (
    SELECT b.postal_code, b.poids,
           -- Etendue nulle : 50, jamais 0 ni NULL. Un indicateur constant sur
           -- le perimetre n'est ni favorable ni defavorable ; le noter 0
           -- ecraserait le score composite de tout le monde.
           CASE WHEN bo.mx = bo.mn THEN 50
                WHEN b.sens = 'decroissant'
                  THEN 100 - 100 * (b.value - bo.mn) / (bo.mx - bo.mn)
                ELSE 100 * (b.value - bo.mn) / (bo.mx - bo.mn) END AS v
    FROM base b JOIN bornes bo USING (indicator_code)
  ), score AS (
    -- Poids ramenes a 1 sur les seuls indicateurs PRESENTS de la ligne : un CP
    -- auquel il manque un indicateur est score sur ce qu'il a, pas penalise
    -- d'un zero jamais mesure (`rev_median` ne couvre que 1 952 des 6 186 CP).
    SELECT postal_code,
           ROUND(SUM(v * poids) / NULLIF(SUM(poids), 0), 1) AS score,
           COUNT(*)::integer                                AS n_indicateurs
    FROM normalise
    GROUP BY postal_code
    HAVING NULLIF(SUM(poids), 0) IS NOT NULL
  )
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'postal_code',   s.postal_code,
             'score',         s.score,
             'n_indicateurs', s.n_indicateurs
           ) ORDER BY s.postal_code
         ), '[]'::jsonb)
  FROM score s;
$fn$;

COMMENT ON FUNCTION public.calculer_score_composite_jsonb(text[], numeric[], text[], text[]) IS
  'Jumelle jsonb de calculer_score_composite (sql/146) — RETURNS jsonb et non TABLE : PostgREST tronque a 5000 lignes meme les RPC RETURNS TABLE (meme piege que sql/154 et sql/168). Porte desormais le CORPS du calcul ; la forme TABLE l enveloppe. sql/170, 2026-09-15.';

REVOKE ALL ON FUNCTION public.calculer_score_composite_jsonb(text[], numeric[], text[], text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calculer_score_composite_jsonb(text[], numeric[], text[], text[])
  TO service_role;


-- ---------------------------------------------------------------------------
-- L'originale devient une ENVELOPPE MINCE (ruling FF-1, sql/169) : meme
-- signature, meme type de retour, jamais de DROP. Les consommateurs de la
-- forme TABLE (`/api/custom-geo/source/score`, plafond 1 500 CP) ne changent
-- pas ; ils restent exposes a la troncature PostgREST au-dela de 5 000
-- lignes, ce que leur propre plafond rend inatteignable.
CREATE OR REPLACE FUNCTION public.calculer_score_composite(
  p_indicateurs   text[],
  p_poids         numeric[],
  p_sens          text[],
  p_codes_postaux text[]
) RETURNS TABLE (postal_code text, score numeric, n_indicateurs integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  RETURN QUERY
  SELECT (e->>'postal_code')::text,
         (e->>'score')::numeric,
         (e->>'n_indicateurs')::integer
  FROM jsonb_array_elements(
         public.calculer_score_composite_jsonb(
           p_indicateurs, p_poids, p_sens, p_codes_postaux)) e;
END $fn$;

COMMENT ON FUNCTION public.calculer_score_composite(text[], numeric[], text[], text[]) IS
  'Score composite 0-100 par code postal sur un perimetre borne (Tache 12, sql/146). Enveloppe MINCE de calculer_score_composite_jsonb depuis sql/170 : un seul corps, deux formes de retour. RETOURNE TABLE (troncature PostgREST a 5000 lignes au-dela) ; utiliser la jumelle _jsonb des que le perimetre peut depasser 5000 CP. Jumeau TypeScript : lib/analyses/score.ts';

REVOKE ALL ON FUNCTION public.calculer_score_composite(text[], numeric[], text[], text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calculer_score_composite(text[], numeric[], text[], text[])
  TO service_role;
