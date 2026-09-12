-- sql/140 — Bornes nationales de l'echelle de couleurs des IRIS, en log10 de la
-- valeur NORMALISEE. Applique le 2026-09-12. Depend de sql/138.
--
-- ── Pourquoi des bornes, et pourquoi en log ────────────────────────────────
-- La cascade sert des mailles tres inegales (departement ~6 100 km2, IRIS moyen
-- 13 km2). Un effectif brut n'y est pas comparable : la somme d'un departement
-- vaut ~475 fois celle d'un IRIS. Rapporte a la surface, l'ecart disparait —
-- c'est la lecon de `lib/carreaux/normalisation.ts`.
--
-- Normaliser rend les UNITES comparables, pas les DISTRIBUTIONS : un
-- departement moyenne ses coeurs denses avec ses campagnes, un IRIS parisien
-- est de la densite pure. La meme grandeur s'etend sur plusieurs decades selon
-- le palier. En log10, chaque palier recupere un vrai degrade.
--
-- ── Pourquoi en base et non dans un fichier TypeScript ─────────────────────
-- `lib/carreaux/bornes.ts` est une table statique : les colonnes Filosofi sont
-- figees. Les colonnes d'`iris` sont DYNAMIQUES (CLAUDE.md) — une table
-- statique y serait fausse des le prochain indicateur importe, en silence.
--
-- ── Regle des quantiles (reprise des mesures carreaux, sql/123) ────────────
--   min = p05 du palier le plus GROSSIER (departement) : c'est lui qui descend
--         le plus bas, une maille de 6 100 km2 moyennant de vastes zones vides.
--   max = quantile haut du palier le plus FIN (IRIS), seul a porter la queue
--         urbaine dense :
--           effectif / densite -> p99,9 (queue droite non bornee)
--           proportion         -> p95   (distribution deja bornee ; son p99,9
--                                 etirerait l'echelle sur un aberrant)
--
-- ── Trois classes et non deux ──────────────────────────────────────────────
-- La classe porte DEUX questions distinctes, qu'une premiere version confondait :
--   (a) faut-il diviser par la surface ?   (b) quel quantile haut ?
-- `densite_pop` est deja une densite (ne pas rediviser) MAIS sa queue est
-- longue comme celle d'un effectif. Classee 'proportion', elle recevait le
-- p95 : son plafond tombait a 14 460 hab/km2 contre 60 555 pour la densite de
-- population reconstituee — les 5 % d'IRIS les plus denses, c'est-a-dire le
-- coeur des villes ou travaille un media-planneur, saturaient.
--
-- ── Mesures du 2026-09-12 ──────────────────────────────────────────────────
-- 37 colonnes bornees en 2,7 s. Les 4 restantes (nb_emplois, nb_emplois_commune,
-- part_couples_avec_enfants, part_menages_emmenages_2ans) sont ENTIEREMENT
-- VIDES en base : aucune borne n'a de sens, et le panneau les propose pourtant.
--
--   colonne                 classe     val_min      val_max    decades
--   population              effectif      25,0     60 555,2      3,38
--   pop_15_29               effectif       3,3     15 699,5      3,68
--   nb_menages              effectif      12,2     33 224,9      3,44
--   densite_pop             densite       25,0     14 459,5      2,76  (avant correction de classe)
--   taux_proprio            proportion    49,6         91,3      0,26
--   rev_median              proportion 18 132,3     38 440,0      0,33
--   part_logements_sociaux  proportion     6,1         44,5      0,87
--   taux_chomage            proportion     8,6         22,8      0,43

CREATE TABLE IF NOT EXISTS public.iris_bornes_echelle (
  colonne    text PRIMARY KEY,
  classe     text NOT NULL,
  log_min    double precision NOT NULL,
  log_max    double precision NOT NULL,
  val_min    double precision NOT NULL,
  val_max    double precision NOT NULL,
  mesure_le  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT iris_bornes_croissantes CHECK (log_max > log_min),
  CONSTRAINT iris_bornes_echelle_classe_check CHECK (classe IN ('effectif','densite','proportion'))
);

ALTER TABLE public.iris_bornes_echelle ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.iris_bornes_echelle IS
  'Bornes nationales log10 de l''echelle IRIS, par colonne. Reconstruire avec construire_iris_bornes() apres tout import IRIS.';


CREATE OR REPLACE FUNCTION public.construire_iris_bornes()
RETURNS TABLE(colonnes integer, duree_ms numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_debut timestamptz := clock_timestamp();
  v_sel_i text; v_sel_d text; v_n integer;
BEGIN
  -- Un SEUL passage sur `iris` pour toutes les colonnes : autant de balayages
  -- que de colonnes serait le full scan repete qu'interdit le budget I/O Nano.
  SELECT string_agg(
           format('percentile_cont(%s) WITHIN GROUP (ORDER BY %s) AS %I',
             CASE WHEN classe_iris(c.column_name) = 'proportion' THEN '0.95' ELSE '0.999' END,
             CASE WHEN classe_iris(c.column_name) = 'effectif'
                  THEN format('(i.%I::double precision / nullif(ST_Area(i.geom_3857)/1e6*power(cos(radians(i.centroid_lat)),2),0))', c.column_name)
                  ELSE format('i.%I::double precision', c.column_name) END,
             c.column_name), ', ' ORDER BY c.column_name)
    INTO v_sel_i
  FROM information_schema.columns c
  WHERE c.table_schema='public' AND c.table_name='iris'
    AND c.data_type IN ('integer','bigint','numeric','double precision','real','smallint')
    AND c.column_name NOT IN ('centroid_lat','centroid_lng');

  SELECT string_agg(
           format('percentile_cont(0.05) WITHIN GROUP (ORDER BY %s) AS %I',
             CASE WHEN classe_iris(c.column_name) = 'effectif'
                  THEN format('(d.%I / nullif(d.superficie_km2,0))', c.column_name)
                  ELSE format('d.%I', c.column_name) END,
             c.column_name), ', ' ORDER BY c.column_name)
    INTO v_sel_d
  FROM information_schema.columns c
  WHERE c.table_schema='public' AND c.table_name='iris_agg_departement'
    AND c.data_type IN ('integer','bigint','numeric','double precision','real','smallint')
    AND c.column_name NOT IN ('nb_iris','superficie_km2');

  IF v_sel_i IS NULL OR v_sel_d IS NULL THEN
    RAISE EXCEPTION 'colonnes introuvables — construire_iris_agg(''departement'') a-t-il tourne ?';
  END IF;

  DROP TABLE IF EXISTS t_haut; DROP TABLE IF EXISTS t_bas;
  EXECUTE format('CREATE TEMP TABLE t_haut AS SELECT %s FROM public.iris i WHERE i.centroid_lat IS NOT NULL', v_sel_i);
  EXECUTE format('CREATE TEMP TABLE t_bas  AS SELECT %s FROM public.iris_agg_departement d', v_sel_d);

  DELETE FROM public.iris_bornes_echelle;

  -- Depivotage des deux lignes de quantiles en (colonne, valeur). Une colonne
  -- entierement vide, ou dont le plafond ne depasse pas le plancher, n'entre
  -- pas : mieux vaut pas de bornes qu'une echelle degeneree.
  INSERT INTO public.iris_bornes_echelle (colonne, classe, log_min, log_max, val_min, val_max)
  SELECT h.key, classe_iris(h.key),
         log(greatest(b.value::numeric, 1e-6))::double precision,
         log(greatest(h.value::numeric, 1e-5))::double precision,
         greatest(b.value::double precision, 1e-6),
         greatest(h.value::double precision, 1e-5)
  FROM (SELECT key, value FROM t_haut, jsonb_each_text(to_jsonb(t_haut))) h
  JOIN (SELECT key, value FROM t_bas,  jsonb_each_text(to_jsonb(t_bas)))  b USING (key)
  WHERE h.value IS NOT NULL AND b.value IS NOT NULL
    AND h.value::double precision > 0
    AND log(greatest(h.value::numeric, 1e-5)) > log(greatest(b.value::numeric, 1e-6));

  DROP TABLE IF EXISTS t_haut; DROP TABLE IF EXISTS t_bas;

  SELECT count(*) INTO v_n FROM public.iris_bornes_echelle;
  RETURN QUERY SELECT v_n, round(extract(epoch FROM clock_timestamp() - v_debut)::numeric * 1000, 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.construire_iris_bornes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.construire_iris_bornes() TO service_role;
