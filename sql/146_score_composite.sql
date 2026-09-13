-- ============================================================================
-- sql/146_score_composite.sql — Tâche 12 (2026-09-13)
--
-- Score composite par code postal : plusieurs indicateurs de
-- `indicator_cp_values`, normalisés 0-100 puis pondérés en un seul nombre.
--
-- La normalisation se fait EN SQL sur le PÉRIMÈTRE DEMANDÉ, jamais sur la
-- France entière : `p_codes_postaux` est obligatoire et vide ⇒ résultat vide.
-- C'est le garde-fou d'I/O Nano (CLAUDE.md, incidents du 28/03 et du 08/04),
-- et c'est aussi la définition du score : « où acheter DANS ce périmètre »,
-- une question relative à ce qu'on regarde. Des bornes nationales répondraient
-- à une autre question (c'est le rôle d'`iris_bornes_echelle` pour les couleurs).
--
-- Spécification exécutable côté TypeScript : `lib/analyses/score.ts`, testé
-- sans base. MÊME règle de poids et MÊME arrondi au dixième des deux côtés —
-- toute évolution de l'un se répercute dans l'autre dans le même commit.
--
-- Filtre sur les DEUX colonnes de la clé primaire (indicator_code, postal_code)
-- et non sur le seul code postal comme le plan l'écrivait : la PK est
-- (indicator_code, postal_code), et restreindre les deux rend l'index
-- utilisable au lieu de faire remonter tous les indicateurs de chaque CP pour
-- les jeter ensuite dans le LATERAL.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.calculer_score_composite(
  p_indicateurs   text[],    -- indicator_code de indicator_cp_values
  p_poids         numeric[], -- un par indicateur, > 0
  p_sens          text[],    -- 'croissant' | 'decroissant', un par indicateur
  p_codes_postaux text[]     -- périmètre OBLIGATOIRE : la liste de CP du filtre/zone
) RETURNS TABLE (postal_code text, score numeric, n_indicateurs integer)
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
           -- Étendue nulle : 50, jamais 0 ni NULL. Un indicateur constant sur
           -- le périmètre n'est ni favorable ni défavorable ; le noter 0
           -- écraserait le score composite de tout le monde.
           CASE WHEN bo.mx = bo.mn THEN 50
                WHEN b.sens = 'decroissant'
                  THEN 100 - 100 * (b.value - bo.mn) / (bo.mx - bo.mn)
                ELSE 100 * (b.value - bo.mn) / (bo.mx - bo.mn) END AS v
    FROM base b JOIN bornes bo USING (indicator_code)
  )
  -- Poids ramenés à 1 sur les seuls indicateurs PRÉSENTS de la ligne (SUM(poids)
  -- porte sur les lignes existantes) : un CP auquel il manque un indicateur est
  -- scoré sur ce qu'il a, pas pénalisé d'un zéro jamais mesuré. Ce n'est pas un
  -- cas limite : `rev_median` ne couvre que 1 952 des 6 186 CP (mesuré le
  -- 2026-09-13). `n_indicateurs` dit sur combien d'indicateurs le score porte —
  -- sans lui, un score calculé sur un seul indicateur serait indiscernable d'un
  -- score complet.
  SELECT postal_code,
         ROUND(SUM(v * poids) / NULLIF(SUM(poids), 0), 1),
         COUNT(*)::integer
  FROM normalise
  GROUP BY postal_code
  HAVING NULLIF(SUM(poids), 0) IS NOT NULL;
$fn$;

COMMENT ON FUNCTION public.calculer_score_composite(text[], numeric[], text[], text[]) IS
  'Score composite 0-100 par code postal sur un périmètre borné (Tâche 12, sql/146). Normalisation min-max sur le périmètre demandé, poids renormalisés sur les indicateurs présents. Jumeau TypeScript : lib/analyses/score.ts';

REVOKE ALL ON FUNCTION public.calculer_score_composite(text[], numeric[], text[], text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calculer_score_composite(text[], numeric[], text[], text[])
  TO service_role;


-- ============================================================================
-- Périmètre → codes postaux
--
-- Un `FiltreActif` de la carte (lib/carte/filtre.ts) porte un code de région,
-- département, commune ou CP, ou un uuid de zone — jamais une liste de codes
-- postaux, et une bbox résolue SEULEMENT pour une zone enregistrée. Sans cette
-- fonction, `bboxDuFiltre` repliait sur `BBOX_METRO`, soit les 6 187 CP de
-- France : le score composite aurait refusé tout périmètre régional ou
-- départemental comme « trop large ».
--
-- Deux choix payés par la mesure, le 2026-09-13 :
--
--  1. BRANCHES SÉPARÉES, pas un `CASE` dans le `WHERE`. La première version
--     tenait en une seule requête avec `CASE p_type WHEN ... THEN r.code_dept =
--     p_code ...` : élégante, et **835 ms** pour un département — le CASE rend
--     `idx_ref_cp_dept` inutilisable, le planificateur ne pouvant pas savoir
--     quelle branche s'appliquera. En plpgsql avec une requête par branche :
--     **6,5 ms**, 128 fois moins.
--
--  2. LE PALIER COMMUNE PASSE PAR `communes_arrondissements`. `postal_code_commune`
--     ne connaît QUE les arrondissements de Paris, Lyon et Marseille : un filtre
--     sur 13055 (Marseille) rendait ZÉRO code postal, en silence. Même piège que
--     celui documenté pour `classer_territoires` (sql/150). Mesuré après
--     correction : Marseille 16 CP, Paris 21, Lyon 9, Nantes 4.
--
-- Un `p_type` inconnu ou un uuid de zone mal formé rendent zéro ligne, jamais
-- une erreur : c'est une frontière, elle reçoit ce que le client envoie.
-- ============================================================================

DROP FUNCTION IF EXISTS public.codes_postaux_du_perimetre(text, text);

CREATE OR REPLACE FUNCTION public.codes_postaux_du_perimetre(
  p_type text,   -- 'region' | 'departement' | 'commune' | 'cp' | 'zone'
  p_code text    -- code INSEE, code postal, ou uuid de custom_geo_zones
) RETURNS TABLE (code_postal text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_communes text[];
BEGIN
  IF p_type = 'cp' THEN
    RETURN QUERY SELECT r.code_postal FROM public.ref_codes_postaux r WHERE r.code_postal = p_code;

  ELSIF p_type = 'departement' THEN
    RETURN QUERY SELECT r.code_postal FROM public.ref_codes_postaux r
      WHERE r.code_dept = p_code ORDER BY 1;

  ELSIF p_type = 'region' THEN
    RETURN QUERY SELECT r.code_postal FROM public.ref_codes_postaux r
      JOIN public.ref_departements d ON d.code_dept = r.code_dept
      WHERE d.code_region = p_code ORDER BY 1;

  ELSIF p_type = 'commune' THEN
    -- La commune demandée PLUS ses arrondissements, s'il y en a (voir ci-dessus).
    SELECT array_agg(c) INTO v_communes FROM (
      SELECT p_code AS c
      UNION
      SELECT a.code_arrondissement FROM public.communes_arrondissements a
       WHERE a.code_commune_mere = p_code
    ) s;
    RETURN QUERY SELECT DISTINCT pcc.code_postal FROM public.postal_code_commune pcc
      WHERE pcc.code_commune = ANY(v_communes) ORDER BY 1;

  ELSIF p_type = 'zone' AND p_code ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    -- Centroïde du CP dans la zone — index GIST `idx_ref_codes_postaux_centroid`,
    -- même règle que `codes_postaux_dans_bbox` (sql/144).
    RETURN QUERY SELECT r.code_postal FROM public.ref_codes_postaux r
      JOIN public.custom_geo_zones z ON z.id = p_code::uuid
      WHERE z.geometry IS NOT NULL AND r.centroid IS NOT NULL
        AND ST_Intersects(z.geometry, r.centroid)
      ORDER BY 1;
  END IF;

  RETURN;
END $fn$;

COMMENT ON FUNCTION public.codes_postaux_du_perimetre(text, text) IS
  'Codes postaux d un perimetre de carte (FiltreActif) — Tache 12, sql/146. Branches SEPAREES et non un CASE dans le WHERE : le CASE rendait idx_ref_cp_dept inutilisable (835 ms pour un departement, mesure du 2026-09-13). Le palier commune passe par communes_arrondissements : postal_code_commune ne connait QUE les arrondissements de Paris/Lyon/Marseille, donc un filtre sur 13055 rendait zero code postal.';

REVOKE ALL ON FUNCTION public.codes_postaux_du_perimetre(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.codes_postaux_du_perimetre(text, text) TO service_role;
