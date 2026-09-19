-- sql/178 — Perimetres PPRT pour la carte : bbox, simplification, popup
--
-- Sert la couche « Perimetre PPRT » du panneau Calques, a cote de la zone de
-- danger calculee (sql/175). Les deux coexistent a dessein : le rayon est
-- generalisable aux 99 152 installations classees mais arbitraire, le PPRT ne
-- couvre que 87 departements mais il est opposable.
--
-- ── LA SIMPLIFICATION N'EST PAS CELLE DES AUTRES COUCHES DU PROJET ────────
--
-- `alignement_par_maille_geo` (ruling T13A-1) derive sa tolerance de l'etendue
-- de la bbox. Appliquer la meme regle ici DETRUIT la donnee, et c'est mesure :
-- une tolerance d'etendue France (17,3 deg / 1000) vide **602 des 664 zones**.
-- La raison est une propriete de cette couche et non un reglage : un PPRT fait
-- 0,94 km de large en moyenne et le plus petit **2 metres**, la ou une region
-- en fait des centaines de kilometres. Ce qui est negligeable pour une region
-- est total pour un perimetre d'usine.
--
-- Deux garde-fous, tous deux mesures :
--
--   1. `ST_SimplifyPreserveTopology` et JAMAIS `ST_Simplify`. A 11 m de
--      tolerance, `ST_Simplify` vide **18 zones** (les plus petites) ; la
--      variante PreserveTopology en vide **zero**, n'en rend aucune invalide,
--      et coute 0,314 % de surface. Sur une servitude d'urbanisme opposable,
--      faire disparaitre une zone est le pire defaut possible : personne ne
--      voit l'absence.
--   2. La tolerance est **PLAFONNEE a 0,0001 deg (~11 m)**, quelle que soit la
--      bbox. Elle s'affine au zoom (etendue/5000) mais ne peut jamais grossir
--      au-dela de ce plafond. C'est ce plafond, et non la formule, qui rend le
--      defaut du point 1 inatteignable.
--
-- ── BBOX OBLIGATOIRE, ET C'EST UN CHOIX DE LISIBILITE AUTANT QUE D'I/O ────
--
-- France entiere : 664 zones, 202 186 sommets, **4 948 ko** de GeoJSON. Mais
-- meme gratuit, cela n'aurait aucun sens : a l'echelle de la France une zone
-- de 2 km mesure moins d'un pixel. Une vue z8 (6 deg) rend 126 zones et
-- **119 ko** apres simplification (802 ko brut). La couche a donc un plancher
-- de zoom cote client, et cette fonction exige une bbox.
--
-- Le plafond `p_limite` coupe les PLUS PETITES zones d'abord : un bassin
-- industriel compte plus qu'un eclat de 2 m. `n_total` est compte AVANT la
-- limite, pour que l'interface puisse dire qu'elle tronque.

create or replace function public.pprt_perimetres_carte(
  p_bbox    double precision[],
  p_types   text[] default null,
  p_limite  integer default 700
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_env       geometry;
  v_etendue   double precision;
  v_tolerance double precision;
  v_limite    int := greatest(1, least(coalesce(p_limite, 700), 1000));
  v_total     int;
  v_features  jsonb;
begin
  if p_bbox is null or array_length(p_bbox, 1) <> 4 then
    return jsonb_build_object('error', 'bbox_requise', 'calculable', false);
  end if;
  if p_bbox[1] >= p_bbox[3] or p_bbox[2] >= p_bbox[4] then
    return jsonb_build_object('error', 'bbox_invalide', 'calculable', false);
  end if;

  v_env := ST_MakeEnvelope(p_bbox[1], p_bbox[2], p_bbox[3], p_bbox[4], 4326);
  v_etendue := p_bbox[3] - p_bbox[1];

  -- S'affine au zoom, mais ne depasse JAMAIS ~11 m. Voir l'en-tete : c'est ce
  -- plafond qui empeche de vider 602 zones sur 664.
  v_tolerance := least(v_etendue / 5000.0, 0.0001);

  select count(*)
    into v_total
    from public.pprt_perimetres p
   where p.geom && v_env
     and (p_types is null or p.type_zone = any (p_types));

  select coalesce(jsonb_agg(f.feature order by f.superficie_km2 desc nulls last), '[]'::jsonb)
    into v_features
    from (
      select
        p.superficie_km2,
        jsonb_build_object(
          'type', 'Feature',
          'geometry', ST_AsGeoJSON(ST_SimplifyPreserveTopology(p.geom, v_tolerance))::jsonb,
          'properties', jsonb_build_object(
            'id',               p.id,
            'nom',              p.nom,
            'type_zone',        p.type_zone,
            'superficie_km2',   round(p.superficie_km2::numeric, 3),
            'code_departement', p.code_departement,
            'nom_departement',  p.nom_departement,
            'id_generateur',    p.id_generateur,
            -- Le nom du PDF de l'arrete : c'est la seule trace de l'acte qui
            -- fonde la servitude, et la popup doit pouvoir le citer.
            'fichier_acte',     p.fichier_acte,
            'mode_geometrie',   p.mode_geometrie,
            'date_source',      p.date_source
          )
        ) as feature
        from public.pprt_perimetres p
       where p.geom && v_env
         and (p_types is null or p.type_zone = any (p_types))
       order by p.superficie_km2 desc nulls last
       limit v_limite
    ) f;

  return jsonb_build_object(
    'type', 'FeatureCollection',
    'features', v_features,
    'n_total', v_total,
    'n_rendus', jsonb_array_length(v_features),
    -- Rendue au client pour que la popup puisse dire a quelle finesse la
    -- geometrie affichee a ete reduite.
    'tolerance_deg', v_tolerance
  );
end;
$function$;

comment on function public.pprt_perimetres_carte(double precision[], text[], integer) is
  'Perimetres PPRT d une bbox pour la couche carte. Bbox OBLIGATOIRE (France entiere = 4 948 ko, et une zone de 2 km y fait moins d un pixel). ST_SimplifyPreserveTopology et JAMAIS ST_Simplify, tolerance PLAFONNEE a 0,0001 deg : mesure, ST_Simplify vide 18 zones a 11 m et 602 sur 664 a une tolerance d etendue France — ces perimetres font 0,94 km de large en moyenne, 2 m au minimum. La limite coupe les PLUS PETITES zones d abord ; n_total est compte avant (sql/178).';
