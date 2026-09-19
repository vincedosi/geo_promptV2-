-- ============================================================================
-- sql/153_iris_agg_population_complete.sql — la carte sous-déclarait la
-- population de la France (2026-09-13)
--
-- ── Ce que c'était ────────────────────────────────────────────────────────
--
-- `construire_iris_agg` (sql/138) portait dans son `WHERE` :
--
--     WHERE i.<clé> IS NOT NULL AND i.centroid_lat IS NOT NULL
--
-- Ce second prédicat existait pour protéger le calcul de `superficie_km2`, qui
-- corrige la projection par `cos(radians(centroid_lat))`. Mais placé dans le
-- `WHERE`, il excluait les LIGNES ENTIÈRES, donc leur population.
--
-- Or **85 IRIS n'ont AUCUNE géométrie** (`geom` et `geom_3857` tous deux NULL)
-- tout en portant **91 189 habitants répartis sur 38 départements**. Les deux
-- paliers agrégés sous-déclaraient donc la population de la France de 0,13 %,
-- et la carte avec eux, de z4 à z8.
--
-- ARCHITECTURE.md affirmait même que les IRIS manquants étaient « présents aux
-- deux autres paliers ». C'était faux : le palier département perdait
-- exactement les mêmes 91 189 habitants que le palier commune.
--
-- ── Le correctif ──────────────────────────────────────────────────────────
--
-- Le filtre appartient au calcul de SURFACE, seul à avoir besoin du centroïde,
-- pas à la sélection des lignes : la géométrie du palier vient de
-- `ref_departements` / `ref_communes`, jamais des IRIS. Il devient donc un
-- `FILTER` sur cette seule agrégation.
--
-- ── Mesures après reconstruction des deux paliers ─────────────────────────
--
--   palier département : 67 760 552 hab — EXACT, écart 0
--   palier commune     : 67 680 299 hab — écart -80 253
--
-- L'écart résiduel du palier commune est une AUTRE cause, structurelle et
-- désormais chiffrée : 82 IRIS dont le `code_commune` est absent de
-- `ref_communes` (68 communes), que la jointure du palier perd. Ce n'est pas
-- corrigé ici — cela demanderait de compléter le référentiel des communes.
--
-- Non-régression vérifiée sur les valeurs de validation d'ARCHITECTURE.md :
--   Paris 105,3 km² · 20 066 hab/km²   (documenté : 105 km², 20 066)
--   Cantal 25 hab/km²                   (documenté : 25)
--   Guyane 3 hab/km²                    (documenté : 3,4)
--
-- ── Comment ce défaut a été trouvé ────────────────────────────────────────
--
-- Par l'invariant « chaque palier agrégé doit redonner la population d'iris »
-- de `/admin/qualite-donnees` (sql/152), au tout premier lancement. Il existe
-- précisément pour ça — et il était lui-même né d'une relecture indépendante
-- de cette page.
--
-- ── Ce qui n'est PAS fait, et pourquoi ────────────────────────────────────
--
-- `IRIS_TILE_VERSION` n'est PAS bumpée. Le schéma de tuile ne change pas, seules
-- des valeurs bougent, et de 0,13 % — visuellement imperceptible. Une bump
-- invaliderait TOUTES les tuiles IRIS en cache (jusqu'à une semaine au CDN) et
-- imposerait leur régénération complète sur un Nano. Les tuiles en cache
-- porteront donc l'ancienne population jusqu'à leur expiration naturelle.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.construire_iris_agg(p_niveau text)
 RETURNS TABLE(niveau text, lignes bigint, duree_ms numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cle text; v_ref text; v_nom text; v_tol double precision;
  v_table text; v_cols text; v_densite text := ''; v_sql text;
  v_debut timestamptz := clock_timestamp(); v_lignes bigint;
BEGIN
  IF p_niveau = 'departement' THEN
    v_cle := 'code_dept';    v_ref := 'ref_departements'; v_nom := 'nom_dept';    v_tol := 400;
  ELSIF p_niveau = 'commune' THEN
    v_cle := 'code_commune'; v_ref := 'ref_communes';     v_nom := 'nom_commune'; v_tol := 100;
  ELSE
    RAISE EXCEPTION 'niveau inconnu: % (attendus: departement, commune)', p_niveau;
  END IF;

  v_table := 'iris_agg_' || p_niveau;

  -- effectif   -> SOMME
  -- proportion -> MOYENNE PONDEREE par la population, sur les lignes renseignees
  -- densite    -> ni l'un ni l'autre : recalculee plus bas a partir des sommes
  SELECT string_agg(
           CASE classe_iris(c.column_name)
             WHEN 'effectif' THEN format('sum(i.%I)::double precision AS %I', c.column_name, c.column_name)
             ELSE format(
               '(sum(i.%I::numeric * coalesce(i.population,0)) FILTER (WHERE i.%I IS NOT NULL)'
               || ' / nullif(sum(coalesce(i.population,0)) FILTER (WHERE i.%I IS NOT NULL),0)'
               || ')::double precision AS %I',
               c.column_name, c.column_name, c.column_name, c.column_name)
           END, ', ' ORDER BY c.column_name)
    INTO v_cols
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'iris'
    AND c.data_type IN ('integer','bigint','numeric','double precision','real','smallint')
    AND c.column_name NOT IN ('centroid_lat','centroid_lng')
    AND classe_iris(c.column_name) <> 'densite';

  IF v_cols IS NULL THEN
    RAISE EXCEPTION 'aucune colonne numerique trouvee sur public.iris';
  END IF;

  -- Une densite se RECALCULE a partir des sommes. Moyenner les densites de
  -- mailles de tailles inegales donnerait un resultat faux (moyenne de
  -- quotients != quotient des sommes).
  SELECT coalesce(string_agg(
           format(', (a.population / nullif(a.superficie_km2,0))::double precision AS %I', c.column_name),
           ''), '')
    INTO v_densite
  FROM information_schema.columns c
  WHERE c.table_schema='public' AND c.table_name='iris'
    AND classe_iris(c.column_name) = 'densite';

  EXECUTE format('DROP TABLE IF EXISTS public.%I', v_table);

  -- CORRECTIF 2026-09-13 : le filtre du centroide est passe du WHERE au FILTER
  -- de la seule agregation qui en a besoin. Voir l'en-tete du fichier — il
  -- excluait 85 IRIS sans geometrie portant 91 189 habitants.
  v_sql := format($sql$
    CREATE TABLE public.%I AS
    WITH a AS (
      SELECT i.%I AS code,
             count(*)::int AS nb_iris,
             sum(ST_Area(i.geom_3857) / 1e6 * power(cos(radians(i.centroid_lat)), 2))
               FILTER (WHERE i.centroid_lat IS NOT NULL AND i.geom_3857 IS NOT NULL)
               ::double precision AS superficie_km2,
             %s
      FROM public.iris i
      WHERE i.%I IS NOT NULL
      GROUP BY i.%I
    )
    SELECT a.*,
           r.%I AS nom,
           ST_Multi(ST_CollectionExtract(
             ST_MakeValid(ST_SimplifyPreserveTopology(ST_Transform(r.geom, 3857), %s)), 3
           ))::geometry(MultiPolygon,3857) AS geom_3857%s
    FROM a JOIN public.%I r ON r.%I = a.code
  $sql$, v_table, v_cle, v_cols, v_cle, v_cle, v_nom, v_tol, v_densite, v_ref, v_cle);

  EXECUTE v_sql;

  EXECUTE format('ALTER TABLE public.%I ADD PRIMARY KEY (code)', v_table);
  EXECUTE format('CREATE INDEX %I ON public.%I USING GIST (geom_3857)',
                 'idx_' || v_table || '_geom', v_table);
  EXECUTE format('ANALYZE public.%I', v_table);
  EXECUTE format('SELECT count(*) FROM public.%I', v_table) INTO v_lignes;

  RETURN QUERY SELECT p_niveau, v_lignes,
                      round(extract(epoch FROM clock_timestamp() - v_debut)::numeric * 1000, 0);
END;
$function$;

COMMENT ON FUNCTION public.construire_iris_agg(text) IS
  '(Re)construit un palier agrege de la cascade IRIS (sql/138, corrige sql/153). Le filtre centroid_lat porte desormais sur le seul calcul de SURFACE et non sur la selection des lignes : 85 IRIS sans geometrie mais portant 91189 habitants etaient sinon exclus des DEUX paliers, faisant sous-declarer la population de la France de 0,13 % sur la carte de z4 a z8.';

-- À rejouer après ce correctif (fait le 2026-09-13, 4,7 s et 22,2 s) :
--   SELECT * FROM public.construire_iris_agg('departement');
--   SELECT * FROM public.construire_iris_agg('commune');
-- Les bornes n'ont PAS besoin d'être reconstruites : `construire_iris_bornes`
-- lit `iris` et le palier département pour son p05, et l'ordre de grandeur ne
-- bouge pas de 0,13 %.
