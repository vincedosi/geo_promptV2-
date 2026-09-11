-- 126 — get_tile : retrait du LEFT JOIN LATERAL sur ref_departements
--
-- CONSTAT (mesure du 2026-09-11, EXPLAIN ANALYZE BUFFERS)
--
-- Trois des quatre paliers enrichissaient chaque carreau de `code_dept` et
-- `code_region` par une jointure laterale :
--
--   LEFT JOIN LATERAL (
--     SELECT rd.code_dept, rd.code_region FROM ref_departements rd
--     WHERE ST_Intersects(rd.geom, ST_Centroid(c.geom)) LIMIT 1
--   ) rd ON true
--
-- Une tuile z8 (2 954 carreaux de 2 km) coutait 11 438 ms, dont 10 250 ms dans
-- cette seule jointure : 2 954 boucles a 3,47 ms. L'index trouve le departement
-- candidat, puis le recheck decompresse le multipolygone complet depuis le TOAST
-- pour le test exact. 27 082 buffers pour la jointure contre 2 132 pour les
-- donnees elles-memes. La meme tuile sans la jointure : 100 ms.
--
-- La jointure empechait en outre le parallelisme : sans elle le planificateur
-- passe en Parallel Bitmap Heap Scan.
--
-- Au palier 200 m la jointure ne coutait presque rien (15 %, mesure a cache
-- chaud : 133 ms contre 113 ms) pour une raison qui n'est pas rassurante :
-- `carreaux_filosofi.geom_centroid` est NULL sur la table entiere, donc
-- ST_Intersects court-circuite et la colonne sortait toujours NULL. Elle etait
-- donc soit couteuse, soit inutile, jamais utile.
--
-- PERSONNE NE LIT CES DEUX COLONNES. Verifie sur tout le code client : ni
-- `useMapLayers.ts` (le chemin vivant), ni `CarreauxSection.tsx`, ni aucun
-- `setFilter` MapLibre sur `carreaux-mvt-fill`/`-line`. Les occurrences de
-- `code_dept`/`code_region` ailleurs dans le projet concernent les IRIS, la
-- sante environnementale et le referentiel geo — pas les carreaux.
--
-- Si un filtre territorial sur les carreaux devient un besoin produit, la
-- reponse n'est PAS de retablir cette jointure : c'est une colonne materialisee
-- une fois sur `carreaux_2km`/`carreaux_5km`/`carreaux_20km`, calculee a
-- l'agregation. Le cout par tuile retomberait a zero.
--
-- Le schema de tuile change (deux proprietes en moins) : CARREAUX_TILE_VERSION
-- passe de 15 a 16 dans lib/version.ts, sans quoi les tuiles en cache (1 h de
-- max-age) resteraient servies avec l'ancien schema.
--
-- Ce qui reste APRES ce correctif, et qui est un autre sujet : au palier 200 m
-- le cout est du I/O a froid, pas du calcul. Une tuile z10 lit 2 663 blocs
-- (environ 21 Mo) sur une table de 4,5 Go, parce que chaque ligne fait ~990
-- octets — le jsonb `metadata` est lu en entier pour en extraire 29 numeriques.
-- Sur Nano (5 Mo/s) cela plafonne a ~3,4 s par tuile froide. La reponse serait
-- une table 200 m a colonnes typees, comme carreaux_2km/5km. Non traite ici.

CREATE OR REPLACE FUNCTION public.get_tile(z integer, x integer, y integer)
 RETURNS bytea
 LANGUAGE plpgsql
 STABLE PARALLEL SAFE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_bounds      BOX2D;
  v_bounds_4326 geometry;
  v_mvt         BYTEA;
BEGIN
  v_bounds      := ST_TileEnvelope(z, x, y);
  v_bounds_4326 := ST_Transform(ST_TileEnvelope(z, x, y), 4326);

  -- z >= 10 : carreaux_filosofi 200m natifs
  IF z >= 10 THEN
    SELECT INTO v_mvt ST_AsMVT(q, 'carreaux', 4096, 'geom')
    FROM (
      SELECT
        ST_AsMVTGeom(cf.geom_3857, v_bounds, 4096, 0, true) AS geom,
        cf.idcar,
        0.04::numeric AS superficie_km2,
        COALESCE((cf.metadata->>'ind')::numeric,       0)  AS population_totale,
        COALESCE((cf.metadata->>'ind_0_3')::numeric,   0)  AS ind_0_3,
        COALESCE((cf.metadata->>'ind_4_5')::numeric,   0)  AS ind_4_5,
        COALESCE((cf.metadata->>'ind_6_10')::numeric,  0)  AS ind_6_10,
        COALESCE((cf.metadata->>'ind_11_17')::numeric, 0)  AS ind_11_17,
        COALESCE((cf.metadata->>'ind_18_24')::numeric, 0)  AS ind_18_24,
        COALESCE((cf.metadata->>'ind_25_39')::numeric, 0)  AS ind_25_39,
        COALESCE((cf.metadata->>'ind_40_54')::numeric, 0)  AS ind_40_54,
        COALESCE((cf.metadata->>'ind_55_64')::numeric, 0)  AS ind_55_64,
        COALESCE((cf.metadata->>'ind_65_79')::numeric, 0)  AS ind_65_79,
        COALESCE((cf.metadata->>'ind_80p')::numeric,   0)  AS ind_80p,
        COALESCE((cf.metadata->>'ind_inc')::numeric,   0)  AS population_inconnue,
        COALESCE((cf.metadata->>'ind_snv')::numeric,   0)  AS revenu_median,
        COALESCE((cf.metadata->>'men')::numeric,       0)  AS menages_total,
        COALESCE((cf.metadata->>'men_pauv')::numeric,  0)  AS menages_pauvres,
        COALESCE((cf.metadata->>'men_1ind')::numeric,  0)  AS menages_1_personne,
        COALESCE((cf.metadata->>'men_5ind')::numeric,  0)  AS menages_5_plus,
        COALESCE((cf.metadata->>'men_prop')::numeric,  0)  AS menages_proprietaires,
        COALESCE((cf.metadata->>'men_fmp')::numeric,   0)  AS familles_monoparentales,
        COALESCE((cf.metadata->>'men_mais')::numeric,  0)  AS menages_maison,
        COALESCE((cf.metadata->>'men_coll')::numeric,  0)  AS menages_collectif,
        COALESCE((cf.metadata->>'men_surf')::numeric,  0)  AS surface_moyenne,
        COALESCE((cf.metadata->>'log_av45')::numeric,  0)  AS logements_avant_1945,
        COALESCE((cf.metadata->>'log_45_70')::numeric, 0)  AS logements_1945_1970,
        COALESCE((cf.metadata->>'log_70_90')::numeric, 0)  AS logements_1970_1990,
        COALESCE((cf.metadata->>'log_ap90')::numeric,  0)  AS logements_apres_1990,
        COALESCE((cf.metadata->>'log_soc')::numeric,   0)  AS logements_sociaux,
        COALESCE((cf.metadata->>'log_inc')::numeric,   0)  AS logements_inconnus
      FROM carreaux_filosofi cf
      WHERE cf.geom_3857 && v_bounds AND cf.resolution = '200m'
    ) q;

  -- z 8-9 : carreaux 2km
  ELSIF z >= 8 THEN
    SELECT INTO v_mvt ST_AsMVT(q, 'carreaux', 4096, 'geom')
    FROM (
      SELECT
        ST_AsMVTGeom(ST_Transform(c.geom, 3857), v_bounds, 4096, 0, true) AS geom,
        c.id AS idcar,
        4::numeric AS superficie_km2,
        COALESCE(c.ind,       0) AS population_totale,
        COALESCE(c.ind_0_3,   0) AS ind_0_3,
        COALESCE(c.ind_4_5,   0) AS ind_4_5,
        COALESCE(c.ind_6_10,  0) AS ind_6_10,
        COALESCE(c.ind_11_17, 0) AS ind_11_17,
        COALESCE(c.ind_18_24, 0) AS ind_18_24,
        COALESCE(c.ind_25_39, 0) AS ind_25_39,
        COALESCE(c.ind_40_54, 0) AS ind_40_54,
        COALESCE(c.ind_55_64, 0) AS ind_55_64,
        COALESCE(c.ind_65_79, 0) AS ind_65_79,
        COALESCE(c.ind_80p,   0) AS ind_80p,
        COALESCE(c.ind_inc,   0) AS population_inconnue,
        COALESCE(c.ind_snv,   0) AS revenu_median,
        COALESCE(c.men,       0) AS menages_total,
        COALESCE(c.men_pauv,  0) AS menages_pauvres,
        COALESCE(c.men_1ind,  0) AS menages_1_personne,
        COALESCE(c.men_5ind,  0) AS menages_5_plus,
        COALESCE(c.men_prop,  0) AS menages_proprietaires,
        COALESCE(c.men_fmp,   0) AS familles_monoparentales,
        COALESCE(c.men_mais,  0) AS menages_maison,
        COALESCE(c.men_coll,  0) AS menages_collectif,
        COALESCE(c.men_surf,  0) AS surface_moyenne,
        COALESCE(c.log_av45,  0) AS logements_avant_1945,
        COALESCE(c.log_45_70, 0) AS logements_1945_1970,
        COALESCE(c.log_70_90, 0) AS logements_1970_1990,
        COALESCE(c.log_ap90,  0) AS logements_apres_1990,
        COALESCE(c.log_soc,   0) AS logements_sociaux,
        COALESCE(c.log_inc,   0) AS logements_inconnus
      FROM carreaux_2km c
      WHERE c.geom && v_bounds_4326
    ) q;

  -- z 7 : carreaux 5km
  ELSIF z >= 7 THEN
    SELECT INTO v_mvt ST_AsMVT(q, 'carreaux', 4096, 'geom')
    FROM (
      SELECT
        ST_AsMVTGeom(ST_Transform(c.geom, 3857), v_bounds, 4096, 0, true) AS geom,
        c.id AS idcar,
        25::numeric AS superficie_km2,
        COALESCE(c.ind,       0) AS population_totale,
        COALESCE(c.ind_0_3,   0) AS ind_0_3,
        COALESCE(c.ind_4_5,   0) AS ind_4_5,
        COALESCE(c.ind_6_10,  0) AS ind_6_10,
        COALESCE(c.ind_11_17, 0) AS ind_11_17,
        COALESCE(c.ind_18_24, 0) AS ind_18_24,
        COALESCE(c.ind_25_39, 0) AS ind_25_39,
        COALESCE(c.ind_40_54, 0) AS ind_40_54,
        COALESCE(c.ind_55_64, 0) AS ind_55_64,
        COALESCE(c.ind_65_79, 0) AS ind_65_79,
        COALESCE(c.ind_80p,   0) AS ind_80p,
        COALESCE(c.ind_inc,   0) AS population_inconnue,
        COALESCE(c.ind_snv,   0) AS revenu_median,
        COALESCE(c.men,       0) AS menages_total,
        COALESCE(c.men_pauv,  0) AS menages_pauvres,
        COALESCE(c.men_1ind,  0) AS menages_1_personne,
        COALESCE(c.men_5ind,  0) AS menages_5_plus,
        COALESCE(c.men_prop,  0) AS menages_proprietaires,
        COALESCE(c.men_fmp,   0) AS familles_monoparentales,
        COALESCE(c.men_mais,  0) AS menages_maison,
        COALESCE(c.men_coll,  0) AS menages_collectif,
        COALESCE(c.men_surf,  0) AS surface_moyenne,
        COALESCE(c.log_av45,  0) AS logements_avant_1945,
        COALESCE(c.log_45_70, 0) AS logements_1945_1970,
        COALESCE(c.log_70_90, 0) AS logements_1970_1990,
        COALESCE(c.log_ap90,  0) AS logements_apres_1990,
        COALESCE(c.log_soc,   0) AS logements_sociaux,
        COALESCE(c.log_inc,   0) AS logements_inconnus
      FROM carreaux_5km c
      WHERE c.geom && v_bounds_4326
    ) q;

  -- z <= 6 : carreaux 20km (vue materialisee, sql/124)
  -- Ce palier n'a jamais porte la jointure : c'est pourquoi z4-z6 etaient deja
  -- les seuls zooms rapides a froid (environ 500 ms contre plus de 15 s a z8).
  ELSE
    SELECT INTO v_mvt ST_AsMVT(q, 'carreaux', 4096, 'geom')
    FROM (
      SELECT
        ST_AsMVTGeom(ST_Transform(c.geom, 3857), v_bounds, 4096, 0, true) AS geom,
        c.grid_id AS idcar,
        400::numeric AS superficie_km2,
        c.population_totale, c.ind_0_3, c.ind_4_5, c.ind_6_10, c.ind_11_17,
        c.ind_18_24, c.ind_25_39, c.ind_40_54, c.ind_55_64, c.ind_65_79,
        c.ind_80p, c.population_inconnue, c.revenu_median, c.menages_total,
        c.menages_pauvres, c.menages_1_personne, c.menages_5_plus,
        c.menages_proprietaires, c.familles_monoparentales, c.menages_maison,
        c.menages_collectif, c.surface_moyenne, c.logements_avant_1945,
        c.logements_1945_1970, c.logements_1970_1990, c.logements_apres_1990,
        c.logements_sociaux, c.logements_inconnus
      FROM carreaux_20km c
      WHERE c.geom && v_bounds_4326
    ) q;
  END IF;

  RETURN v_mvt;
END;
$function$;
