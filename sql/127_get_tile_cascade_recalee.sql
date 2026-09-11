-- 127 — get_tile : la cascade de zoom recalee sur la taille apparente des mailles
--
-- CONSTAT (mesure du 2026-09-11, apres le retrait de la jointure de sql/126)
--
-- Le pic de lenteur s'etait deplace sur z10 : jusqu'a 15,5 s pour stabiliser la
-- vue, avec 38 460 carreaux rendus sur Toulouse. La raison n'est pas le cout
-- unitaire d'une tuile mais leur CONTENU : a z10 une maille de 200 m mesure
-- 1,9 pixel a l'ecran. On calculait, transferait et peignait 38 000 carres que
-- l'oeil ne peut pas distinguer les uns des autres.
--
-- Le critere retenu : une maille de choroplethe est lisible entre 10 et 40 px.
-- Taille apparente en pixels (latitude 46, centre de la France) :
--
--   z     m/px     20 km    5 km    2 km   200 m
--   z6    1699      11.8     2.9     1.2     0.1
--   z7     850      23.5     5.9     2.4     0.2
--   z8     425      47.1    11.8     4.7     0.5
--   z9     212      94.2    23.5     9.4     0.9
--   z10    106     188.3    47.1    18.8     1.9
--   z11     53     376.7    94.2    37.7     3.8
--   z12     27     753.3   188.3    75.3     7.5
--   z13     13    1506.7   376.7   150.7    15.1
--   z14      7    3013.3   753.3   301.3    30.1
--
-- Chaque palier etait servi environ deux crans trop tot. La cascade devient :
--
--   z <= 7   20 km   (3 a 24 px)    etait z <= 6
--   z 8-9     5 km   (12 a 24 px)   etait z 7 seulement
--   z 10-11   2 km   (19 a 38 px)   etait z 8-9
--   z >= 12  200 m   (7,5 a 30 px)  etait z >= 10
--
-- En dessous de z6 le 20 km descend a 3-6 px : c'est la maille la plus grossiere
-- dont on dispose, et elle ne coute rien (1 515 lignes pour la France entiere).
--
-- EFFET VISUEL ASSUME : la carte parait plus grossiere entre z8 et z11. Elle
-- etait auparavant plus fine en apparence seulement — une bouillie de carres
-- sous-pixel qui se lisait comme un degrade continu, au prix de 6 a 15 s
-- d'attente. La normalisation en densite (sql/122 + lib/carreaux) garantit que
-- la VALEUR reste comparable d'un palier a l'autre : changer de palier ne change
-- plus le sens de la couleur, seulement sa finesse.
--
-- Le trou z11 -> z12 (2 km a 200 m, facteur 10 en taille lineaire) serait comble
-- par un palier 1 km. La table `carreaux_1km` EXISTE mais est VIDE (0 ligne,
-- verifie le 2026-09-11). La remplir est un chantier a part : elle se derive de
-- carreaux_filosofi, 2,3 M de lignes, et une agregation de cette taille a deja
-- fait expirer la creation de carreaux_20km (d'ou sa derivation depuis le 5 km).
--
-- CARREAUX_TILE_VERSION passe de 16 a 17 : le decoupage sert d'autres mailles
-- aux memes coordonnees de tuile, donc toute tuile en cache est perimee.

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

  -- z >= 12 : carreaux_filosofi 200m natifs (maille 7,5 a 30 px)
  IF z >= 12 THEN
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

  -- z 10-11 : carreaux 2km (maille 19 a 38 px)
  ELSIF z >= 10 THEN
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

  -- z 8-9 : carreaux 5km (maille 12 a 24 px)
  ELSIF z >= 8 THEN
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

  -- z <= 7 : carreaux 20km (vue materialisee, sql/124) — maille 3 a 24 px
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
