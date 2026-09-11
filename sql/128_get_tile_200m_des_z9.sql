-- 128 — get_tile : le palier 200 m demarre a z9 (demande de Vincent, 11/09/2026)
--
-- Vincent a teste le recalage de sql/127 et tranche : « il faut passer aux
-- carreaux les plus fins au zoom 9 ». La finesse prime sur le temps d'affichage.
-- C'est une decision produit, elle annule le recalage de sql/127 pour les
-- paliers fins. Le retrait de la jointure ref_departements (sql/126), lui,
-- reste acquis — il etait gratuit.
--
-- Cascade :
--   z <= 6   20 km
--   z 7       5 km
--   z 8       2 km
--   z >= 9   200 m
--
-- CE QUE CELA COUTE, mesure et assume
--
-- Une tuile z9 couvre 4 fois la surface d'une tuile z10. La tuile z10 de Paris
-- portait 11 480 carreaux de 200 m et lisait 2 663 blocs (~21 Mo) a froid. A z9
-- l'ordre de grandeur est donc ~45 000 carreaux et ~85 Mo par tuile.
--
-- Le facteur limitant n'est pas le calcul mais le volume lu :
-- `carreaux_filosofi` pese 4,6 Go et son jsonb `metadata` fait 806 octets par
-- ligne, lus INTEGRALEMENT pour en extraire 29 nombres. Sur Supabase Nano
-- (5 Mo/s) aucune reecriture de requete ne passe sous ce plancher.
--
-- Le seul correctif reel est une table 200 m a colonnes typees, sur le modele
-- de carreaux_2km : ~330 octets par ligne au lieu de ~1 090, soit 3,3x moins
-- d'I/O. Tant qu'elle n'existe pas, z9 et z10 resteront lents a froid.
--
-- A titre de reference, la taille apparente d'une maille de 200 m :
--   z9 = 0,9 px   z10 = 1,9 px   z11 = 3,8 px   z12 = 7,5 px   z13 = 15 px
-- En dessous de ~10 px les carreaux ne se distinguent plus les uns des autres
-- et se lisent comme un degrade continu. C'est l'effet recherche ici.
--
-- CARREAUX_TILE_VERSION passe de 17 a 18.

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

  -- z >= 9 : carreaux_filosofi 200m natifs (choix produit de Vincent)
  IF z >= 9 THEN
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

  -- z 8 : carreaux 2km (maille 4,7 px)
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

  -- z 7 : carreaux 5km (maille 5,9 px)
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

  -- z <= 6 : carreaux 20km (vue materialisee, sql/124) — maille 3 a 12 px
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
