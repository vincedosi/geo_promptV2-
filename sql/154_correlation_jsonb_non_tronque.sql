-- ============================================================================
-- sql/154_correlation_jsonb_non_tronque.sql — la troncature que sql/147
-- invoquait tout en la subissant (2026-09-13)
--
-- `correlation_campagne_indicateur` était déclarée `RETURNS TABLE`. Son en-tête
-- justifiait pourtant l'agrégation SQL par le plafond de 5 000 lignes de
-- PostgREST — sans voir que ce plafond s'applique AUSSI aux RPC qui rendent une
-- table, puisqu'elles passent par le même pipeline qu'un SELECT.
--
-- Mesuré en relecture sur ce projet : `codes_postaux_dans_bbox(-6,41,10,52)`
-- compte 6 051 lignes en SQL et en rend exactement 5 000 par PostgREST, sans
-- erreur ni en-tête exploitable côté supabase-js.
--
-- Conséquence pour une campagne nationale dépassant 5 000 codes postaux (le
-- référentiel en compte 6 187, et `abstention_pres_2022` en couvre 6 186) : la
-- fonction triant par code postal, le coefficient aurait été calculé sur la
-- moitié nord-est de la France, avec `n = 5000`, un statut « terminé », et une
-- couverture partielle qui se lit comme un manque d'indicateur plutôt que comme
-- une troncature. Le chiffre affiché aurait été faux, et rien ne l'aurait dit.
--
-- Non déclenché aujourd'hui (la seule campagne en base couvre 2 041 CP) — c'est
-- exactement le genre de défaut qui apparaît le jour d'une vraie campagne
-- nationale.
--
-- Le `jsonb` n'est pas tronqué : c'est UNE valeur, pas un ensemble de lignes.
-- Prescription déjà écrite dans ARCHITECTURE.md (« Truncate a 5000 rows par
-- defaut → utiliser RPC JSON ou .limit(100000) »).
-- ============================================================================

DROP FUNCTION IF EXISTS public.correlation_campagne_indicateur(uuid, text);

CREATE OR REPLACE FUNCTION public.correlation_campagne_indicateur(
  p_campaign_id uuid,
  p_indicator_code text
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  WITH imps AS (
    SELECT r.postal_code, SUM(r.impressions)::bigint AS impressions
    FROM public.campaign_cp_rollup r
    WHERE r.campaign_id = p_campaign_id
    GROUP BY r.postal_code
  ), paires AS (
    SELECT i.postal_code, i.impressions, v.value
    FROM imps i
    JOIN public.indicator_cp_values v
      ON v.postal_code = i.postal_code AND v.indicator_code = p_indicator_code
    ORDER BY i.postal_code
  )
  SELECT jsonb_build_object(
    'n', (SELECT count(*) FROM paires),
    'paires', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'code', postal_code, 'x', impressions, 'y', valeur))
              FROM (SELECT postal_code, impressions, value AS valeur FROM paires) p), '[]'::jsonb)
  );
$fn$;

COMMENT ON FUNCTION public.correlation_campagne_indicateur(uuid, text) IS
  'Impressions par code postal (SOMMEES sur les acteurs) appariees a un indicateur INSEE — Tache 13, sql/147, corrigee sql/154. RETURNS jsonb et non TABLE : PostgREST tronque a 5000 lignes AUSSI les RPC RETURNS TABLE (mesure : codes_postaux_dans_bbox rend 5000 lignes pour 6051 reelles, sans erreur ni en-tete exploitable). Une campagne nationale depassant 5000 CP aurait vu son coefficient calcule sur la moitie nord-est de la France, avec un n faux et rien pour le dire.';

REVOKE ALL ON FUNCTION public.correlation_campagne_indicateur(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.correlation_campagne_indicateur(uuid, text) TO service_role;
