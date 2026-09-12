-- sql/138 — Cascade de zoom des IRIS : paliers departement et commune.
-- Applique le 2026-09-12 (MCP Supabase). Rejouable.
--
-- POURQUOI
-- La couche IRIS avait un plancher a z9. La carte demarre a z5,5 : sous le
-- minzoom d'une source, MapLibre ne demande AUCUNE tuile et n'emet aucune
-- erreur. Activer la couche depuis la vue France ne montrait donc rien.
-- Servir les 49 448 IRIS a z5 n'est pas une option : 1 694 kB de tuile pour des
-- polygones de 0,6 px.
--
-- Meme strategie que les carreaux (get_tile, sql/129) : des PALIERS pre-agreges,
-- choisis pour qu'une maille se lise entre 10 et 40 px.
--   m/px = 78271,517 x cos(lat) / 2^z  ->  53 862 / 2^z a 46,5 deg
--     z4 dept (77 km) = 23 px      z7 commune (4,7 km) = 11 px
--     z5 dept         = 46 px      z8 commune          = 22 px
--     z6 dept         = 91 px      z9 IRIS moyen (3,3 km) = 31 px
--   z6 est le palier bancal : la commune n'y fait que 5,6 px. Le departement
--   l'emporte — une maille trop grande reste lisible, une maille de 5 px est
--   du bruit.
--
-- Les geometries administratives EXISTAIENT deja et sont completes
-- (ref_departements 104, ref_communes 34 921) : aucun ST_Union a faire.
--
-- VALIDATION de la regle d'agregation, avant materialisation (2026-09-12) :
--   population 67 760 552 · proprietaires 58,60 % · logements sociaux 14,97 %
--   revenu median 23 097 EUR · pop_15_29 11 860 704 (17,5 %)
-- Et apres, sur trois departements contrastes :
--   Paris    105 km2 · 2 113 697 hab · 20 066 hab/km2 · 32,8 % proprietaires
--   Cantal  5 777 km2 ·   144 398 hab ·      25 hab/km2 · 72,2 %
--   Guyane 83 677 km2 ·   288 383 hab ·       3,4 hab/km2 · 43,7 %
-- Tous conformes aux valeurs INSEE.
--
-- COUT : departement 4,8 s · commune 5,4 s. Loin du budget I/O Nano.
--
-- superficie_km2 = SOMME des superficies des IRIS du groupe, et non l'aire du
-- polygone administratif : c'est ce qui rend les densites exactement
-- comparables d'un palier a l'autre, par construction. Mesure : 638 019 km2
-- identiques aux trois paliers.
--
-- LIMITE CONNUE : 82 IRIS (80 253 hab, 0,12 %) n'ont pas de commune
-- correspondante dans ref_communes — communes fusionnees ou renommees. Ils sont
-- absents du palier commune, presents au palier departement (jointure complete)
-- et au palier IRIS.

-- classe_iris : LA definition de la classe d'un indicateur, et la seule.
-- Trois consommateurs en dependent et pouvaient diverger : l'agregation (sommer
-- ou moyenner ?), les bornes (diviser par la surface ? quel quantile haut ?) et
-- le front (quelle expression, quelle unite ?). Le front ne la reimplemente
-- pas : il lit la classe servie avec les bornes.
-- DERIVEE du nom, jamais une liste en dur : les colonnes d'`iris` sont
-- dynamiques (CLAUDE.md), une liste serait fausse au prochain import, en silence.
CREATE OR REPLACE FUNCTION public.classe_iris(p_colonne text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_colonne LIKE 'densite\_%' THEN 'densite'
    WHEN p_colonne = 'population'
      OR p_colonne LIKE 'pop\_%'
      OR p_colonne LIKE 'nb\_%'    THEN 'effectif'
    ELSE 'proportion'
  END;
$function$;

COMMENT ON FUNCTION public.classe_iris(text) IS
  'Classe d''un indicateur IRIS (effectif | densite | proportion), derivee du nom. Source unique : agregation, bornes et front en dependent.';

GRANT EXECUTE ON FUNCTION public.classe_iris(text) TO service_role, authenticated;


CREATE OR REPLACE FUNCTION public.construire_iris_agg(p_niveau text)
RETURNS TABLE(niveau text, lignes bigint, duree_ms numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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

  -- ST_CollectionExtract(..., 3) : simplifier peut degenerer un ilot en ligne ou
  -- en point, et rendre alors une GeometryCollection que la colonne MultiPolygon
  -- refuse. ST_MakeValid d'abord : simplifier peut aussi croiser un anneau.
  v_sql := format($sql$
    CREATE TABLE public.%I AS
    WITH a AS (
      SELECT i.%I AS code,
             count(*)::int AS nb_iris,
             sum(ST_Area(i.geom_3857) / 1e6 * power(cos(radians(i.centroid_lat)), 2))::double precision
               AS superficie_km2,
             %s
      FROM public.iris i
      WHERE i.%I IS NOT NULL AND i.centroid_lat IS NOT NULL
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

REVOKE ALL ON FUNCTION public.construire_iris_agg(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.construire_iris_agg(text) TO service_role;

-- A rejouer apres tout import IRIS, dans cet ordre (sql/140 en depend) :
--   SELECT * FROM construire_iris_agg('departement');
--   SELECT * FROM construire_iris_agg('commune');
--   SELECT * FROM construire_iris_bornes();
