-- 122_get_tile_superficie.sql
-- Miroir versionne de la migration `get_tile_superficie` (appliquee via MCP
-- Supabase apply_migration, projet vkkdbygwbrxyogqosten).
--
-- Le client ne peut pas deduire la surface d'un carreau : elle depend du
-- palier servi (200 m / 2 km / 5 km), que seule la cascade de get_tile
-- connait. Sans elle, aucune normalisation en densite n'est possible cote
-- carte (lib/carreaux/normalisation.ts, Tache 1).
--
-- Constante par palier plutot que ST_Area geodesique : mesure en base sur des
-- echantillons de 500 lignes, min = moyenne = max pour chaque table (0.04 km2
-- carreaux_filosofi 200 m, 4 km2 carreaux_2km, 25 km2 carreaux_5km) — la maille
-- INSEE est reguliere par construction. Un ST_Area(geography) paierait un
-- calcul geodesique par carreau et par tuile pour un resultat connu d'avance,
-- ce que le budget I/O de Supabase Nano ne permet pas.
--
-- Modification strictement limitee a l'ajout de la colonne superficie_km2
-- dans les trois branches du SELECT interne. Rien d'autre n'est change.

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

  -- ── z >= 10 : carreaux_filosofi 200m natifs ───────────────────────────────
  IF z >= 10 THEN
    SELECT INTO v_mvt ST_AsMVT(q, 'carreaux', 4096, 'geom')
    FROM (
      SELECT
        ST_AsMVTGeom(cf.geom_3857, v_bounds, 4096, 0, true) AS geom,
        cf.idcar,
        rd.code_dept,
        rd.code_region,
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
        COALESCE((cf.metadata->>'men')::numeric,        0) AS menages_total,
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
        COALESCE((cf.metadata->>'log_inc')::numeric,   0)  AS logements_inconnus,
        0.04::numeric AS superficie_km2   -- maille INSEE 200 m
      FROM carreaux_filosofi cf
      LEFT JOIN LATERAL (
        SELECT rd.code_dept, rd.code_region
        FROM ref_departements rd
        WHERE ST_Intersects(rd.geom, cf.geom_centroid)
        LIMIT 1
      ) rd ON true
      WHERE cf.geom_3857 && v_bounds AND cf.resolution = '200m'
    ) q;

  -- ── z 8-9 : carreaux 2km ──────────────────────────────────────────────────
  ELSIF z >= 8 THEN
    SELECT INTO v_mvt ST_AsMVT(q, 'carreaux', 4096, 'geom')
    FROM (
      SELECT
        ST_AsMVTGeom(ST_Transform(c.geom, 3857), v_bounds, 4096, 0, true) AS geom,
        c.id AS idcar,
        rd.code_dept,
        rd.code_region,
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
        COALESCE(c.log_inc,   0) AS logements_inconnus,
        4::numeric AS superficie_km2      -- maille 2 km
      FROM carreaux_2km c
      LEFT JOIN LATERAL (
        SELECT rd.code_dept, rd.code_region
        FROM ref_departements rd
        WHERE ST_Intersects(rd.geom, ST_Centroid(c.geom))
        LIMIT 1
      ) rd ON true
      WHERE c.geom && v_bounds_4326
    ) q;

  -- ── z 6-7 : carreaux 5km ──────────────────────────────────────────────────
  ELSE
    SELECT INTO v_mvt ST_AsMVT(q, 'carreaux', 4096, 'geom')
    FROM (
      SELECT
        ST_AsMVTGeom(ST_Transform(c.geom, 3857), v_bounds, 4096, 0, true) AS geom,
        c.id AS idcar,
        rd.code_dept,
        rd.code_region,
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
        COALESCE(c.log_inc,   0) AS logements_inconnus,
        25::numeric AS superficie_km2     -- maille 5 km
      FROM carreaux_5km c
      LEFT JOIN LATERAL (
        SELECT rd.code_dept, rd.code_region
        FROM ref_departements rd
        WHERE ST_Intersects(rd.geom, ST_Centroid(c.geom))
        LIMIT 1
      ) rd ON true
      WHERE c.geom && v_bounds_4326
    ) q;
  END IF;

  RETURN v_mvt;
END;
$function$;
