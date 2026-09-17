-- sql/175 — Sites a risque industriel pour la carte, avec leur zone de danger
--
-- Sert la couche dediee du panneau Calques : les points ICPE de la bbox
-- visible, leurs attributs complets pour la popup, et — au choix de
-- l'utilisateur — la ZONE DE DANGER autour de chaque site.
--
-- POURQUOI LA ZONE EST CALCULEE ICI ET PAS DESSINEE PAR LE NAVIGATEUR
--   1. `ST_Buffer` sur `geography` rend un rayon en METRES qui suit la sphere.
--      Un buffer sur la geometrie 4326 serait en DEGRES : « 500 m » vaudrait
--      500 m en latitude et environ 350 m en longitude a Marseille — une
--      ellipse presentee comme un cercle. C'est la meme raison qui a dicte
--      `zone_rayon` (sql/155).
--   2. C'est EXACTEMENT la geometrie qu'il faudra croiser avec les carreaux
--      pour compter la population exposee (chantier C). La calculer une fois,
--      en base, cote PostGIS, evite d'avoir deux definitions du meme cercle —
--      une pour l'affichage, une pour le calcul — qui finiraient par differer.
--
-- LE RAYON EST UN CHOIX, PAS UNE VERITE
--   Ce n'est PAS le perimetre reglementaire d'un PPRT (415 procedures en
--   France, polygones du WFS Georisques, figes a fevrier 2023). C'est un rayon
--   indicatif que l'utilisateur regle. L'interface doit le dire : confondre les
--   deux ferait passer un cercle de notre invention pour une servitude
--   d'urbanisme opposable.
--
-- BORNES, parce que la table porte 99 152 sites
--   `p_limite` plafonne le nombre de sites rendus (defaut 2 000). La bbox est
--   OBLIGATOIRE des que la limite peut mordre : sans elle on paierait un
--   balayage national pour afficher un departement. `quad_segs=8` donne 32
--   sommets par cercle — au-dela, la charge utile double sans qu'on voie la
--   difference a l'ecran.

create or replace function public.risques_industriels_carte(
  p_bbox            double precision[] default null,  -- [ouest, sud, est, nord]
  p_gravites        text[]             default null,  -- sous_categorie ; null = toutes
  p_natures         text[]             default null,  -- metadata.libelle_nature ; null = toutes
  p_inclure_inactifs boolean           default false,
  p_rayon_m         integer            default null,  -- null = pas de zone de danger
  p_limite          integer            default 2000
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_result jsonb;
  v_rayon  int := greatest(0, least(coalesce(p_rayon_m, 0), 20000)); -- 20 km max
begin
  -- UNE SEULE instruction : les CTE d'une requete ne survivent pas a la
  -- suivante, et compter dans une requete separee obligerait a recopier le
  -- filtre — deux copies qui finiraient par differer.
  with filtres as (
    select p.*
      from public.poi_france p
     where p.source = 'georisques_icpe'
       and (p_gravites is null or p.sous_categorie = any(p_gravites))
       and (p_natures  is null or (p.metadata->>'libelle_nature') = any(p_natures))
       and (p_inclure_inactifs
            or coalesce(p.metadata->>'etat_activite', '') is distinct from 'En fin d''exploitation')
       and (p_bbox is null
            or (p.lng between p_bbox[1] and p_bbox[3]
            and p.lat between p_bbox[2] and p_bbox[4]))
  ),
  -- Les sites les plus graves d'abord : si la limite mord, elle coupe les
  -- declaratifs, jamais un Seveso seuil haut.
  bornes as (
    select * from filtres
     order by case sous_categorie
                when 'seveso_haut'    then 1
                when 'seveso_bas'     then 2
                when 'ied'            then 3
                when 'autorisation'   then 4
                when 'enregistrement' then 5
                else 6 end,
              id
     limit greatest(1, least(coalesce(p_limite, 2000), 5000))
  ),
  features as (
    select jsonb_agg(jsonb_build_object(
      'type', 'Feature',
      'geometry', jsonb_build_object('type','Point','coordinates', jsonb_build_array(b.lng, b.lat)),
      'properties', jsonb_build_object(
        'id',                  b.id,
        'nom',                 b.nom,
        'adresse',             b.adresse,
        'ville',               b.ville,
        'code_postal',         b.code_postal,
        'departement',         b.departement,
        'lat',                 b.lat,
        'lng',                 b.lng,
        'gravite',             b.sous_categorie,
        'libelle_nature',      b.metadata->>'libelle_nature',
        'natures_risque',      coalesce(b.metadata->'natures_risque', '[]'::jsonb),
        'statut_seveso',       b.metadata->>'statut_seveso',
        'regime',              b.metadata->>'regime',
        'ied',                 coalesce((b.metadata->>'ied')::boolean, false),
        'priorite_nationale',  coalesce((b.metadata->>'priorite_nationale')::boolean, false),
        'etat_activite',       b.metadata->>'etat_activite',
        'dreal',               b.metadata->>'dreal',
        'siret',               b.metadata->>'siret',
        'code_naf',            b.metadata->>'code_naf',
        'code_aiot',           b.metadata->>'code_aiot',
        'date_maj_source',     b.metadata->>'date_maj_source',
        'derniere_inspection', b.metadata->>'derniere_inspection',
        'nb_inspections',      coalesce((b.metadata->>'nb_inspections')::int, 0),
        'rubriques',           coalesce(b.metadata->'rubriques', '[]'::jsonb),
        -- La zone de danger voyage avec son site, et ne vaut que si un rayon
        -- a ete demande.
        'zone',  case when v_rayon > 0 then
                   ST_AsGeoJSON(
                     ST_Buffer(ST_SetSRID(ST_MakePoint(b.lng, b.lat), 4326)::geography,
                               v_rayon, 'quad_segs=8')::geometry
                   )::jsonb
                 else null end,
        'rayon_m', case when v_rayon > 0 then v_rayon else null end
      )
    )) as fc
    from bornes b
  )
  select jsonb_build_object(
    'type', 'FeatureCollection',
    'features', coalesce((select fc from features), '[]'::jsonb),
    -- `n_total` compte AVANT la limite : une liste tronquee doit le dire.
    'n_total', (select count(*) from filtres),
    'n_rendus', coalesce(jsonb_array_length((select fc from features)), 0),
    'rayon_m', case when v_rayon > 0 then v_rayon else null end
  )
  into v_result;

  return v_result;
end;
$function$;

comment on function public.risques_industriels_carte(double precision[], text[], text[], boolean, integer, integer) is
  'Sites ICPE de la bbox pour la couche carte dediee, avec attributs complets (popup) et zone de danger optionnelle. ST_Buffer sur GEOGRAPHY : rayon en metres, jamais en degres (meme raison que zone_rayon, sql/155). Le rayon est indicatif et REGLE par l utilisateur — ce n est pas un perimetre PPRT opposable. n_total est compte AVANT p_limite, qui coupe les sites les moins graves en premier (sql/175, 2026-09-17).';
