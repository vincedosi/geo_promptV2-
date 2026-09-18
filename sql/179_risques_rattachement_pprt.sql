-- sql/179 — Rattachement d'un site ICPE a son perimetre PPRT
--
-- POURQUOI CETTE MIGRATION EXISTE
--   Depuis sql/175 et sql/177, deux couches se superposent a l'ecran sans se
--   parler : les 99 152 sites ICPE d'un cote, les 664 perimetres PPRT de
--   l'autre. Cliquer un site ne disait pas s'il etait couvert par une
--   servitude ; et la ZONE affichee autour de lui etait un cercle que nous
--   calculons, indiscernable a l'oeil d'un perimetre reglementaire.
--
--   C'est la question que doit trancher l'interface EN UN COUP D'OEIL : cette
--   zone est-elle CALCULEE par nous, ou est-ce une vraie zone publiee par
--   l'Etat ? La reponse se decide ici, en base, et voyage avec chaque site.
--
-- ── L'INDEX EST LA MOITIE DE CETTE MIGRATION, PAS UN DETAIL ───────────────
--
--   `ST_DWithin(z.geom::geography, ...)` ne peut PAS utiliser `idx_pprt_geom`,
--   qui porte sur `geom` en geometry : le cast vers geography change le type
--   indexe et le planificateur retombe sur un Seq Scan des 664 polygones —
--   POUR CHAQUE SITE.
--
--   Mesure sur la bbox de l'Etang de Berre (1 014 sites), avant/apres l'index
--   d'expression ci-dessous :
--
--     sans index geography : 118 340 ms, `shared hit=1 614 807`
--     avec index geography :     164 ms, `shared hit=3 332`
--
--   Soit 720x le temps et 485x les lectures. Sans cet index, ouvrir la couche
--   sur les Bouches-du-Rhone rejouait l'incident du 28/03 a lui tout seul.
--   NE PAS supprimer cet index en croyant que `idx_pprt_geom` fait le travail.
--
-- ── POURQUOI 500 m DE TOLERANCE, ET PAS UN TEST D'INCLUSION STRICT ────────
--
--   Mesure sur la base complete (2026-09-18), 1 327 sites Seveso :
--
--                            inclusion stricte   a moins de 500 m
--     Seveso seuil haut (717)      496 (69 %)        567 (79 %)
--     Seveso seuil bas  (610)       76 (12 %)        120 (20 %)
--
--   Les 71 sites seuil haut gagnes entre les deux ne sont pas des PPRT
--   manquants : ce sont les coordonnees AIOT de Georisques, qui pointent
--   parfois l'entree du site ou le centroide communal plutot que
--   l'installation. Un test d'inclusion strict les declarerait « sans
--   perimetre » alors que leur PPRT est la, a 200 m.
--
--   Le rattachement retient le perimetre le PLUS PROCHE, et rend la distance
--   mesuree : une popup peut dire « perimetre PPRT a 180 m » plutot que de
--   laisser croire a une inclusion qui n'existe pas.
--
-- ── LES QUATRE STATUTS, ET POURQUOI « AUCUN PPRT » N'EST PAS UNE ERREUR ───
--
--   `statut_zone` est calcule ICI et non deduit cote client, pour que les
--   deux couches et la legende lisent la meme regle :
--
--     'pprt'          le site a un perimetre PPRT (a moins de 500 m)
--     'sans_pprt'     seuil haut SANS perimetre — un vrai manque (117 sites) :
--                     PPRT prescrit mais non approuve, ou servitude non
--                     deposee au Geoportail de l'Urbanisme
--     'non_soumis'    seuil bas — le PPRT ne s'applique QU'AU seuil haut.
--                     435 des 610 sites seuil bas sont a plus de 2 km de tout
--                     PPRT, et c'est le droit, pas un trou de donnees
--     'non_concerne'  les 97 825 autres ICPE
--
--   Distinguer 'sans_pprt' de 'non_soumis' est tout l'interet : le premier est
--   une donnee qui manque, le second une zone qui n'existe pas. Les confondre
--   sous un « aucune zone » unique ferait passer une regle de droit pour une
--   lacune de notre import.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. L'index. Voir l'en-tete : il conditionne l'utilisabilite de la fonction.
-- ─────────────────────────────────────────────────────────────────────────
create index if not exists idx_pprt_geog
  on public.pprt_perimetres using gist ((geom::geography));

comment on index public.idx_pprt_geog is
  'Index GIST sur geom::geography. OBLIGATOIRE pour risques_industriels_carte : sans lui, ST_DWithin(geography) retombe en Seq Scan des 664 polygones par site — 118 340 ms et 1,6 M buffers mesures sur l Etang de Berre, contre 164 ms et 3 332 buffers avec (sql/179).';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. La fonction, avec le rattachement.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.risques_industriels_carte(
  p_bbox            double precision[] default null,  -- [ouest, sud, est, nord]
  p_gravites        text[]             default null,  -- sous_categorie ; null = toutes
  p_natures         text[]             default null,  -- metadata.libelle_nature ; null = toutes
  p_inclure_inactifs boolean           default false,
  p_rayon_m         integer            default null,  -- null = pas de zone calculee
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
  -- Tolerance du rattachement, en metres. Voir l'en-tete de sql/179 : elle
  -- rattrape le geocodage AIOT, elle n'elargit pas le perimetre reglementaire.
  c_tolerance_m constant int := 500;
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
  -- Le rattachement. LEFT JOIN LATERAL et non un JOIN : un site sans PPRT
  -- doit sortir de cette CTE, avec ses colonnes PPRT a NULL — c'est lui qui
  -- porte les statuts 'sans_pprt' et 'non_soumis', les deux cas que
  -- l'interface doit precisement savoir nommer.
  rattaches as (
    select b.*,
           r.pprt_id,
           r.pprt_nom,
           r.pprt_km2,
           r.pprt_generateur,
           r.pprt_type_zone,
           r.pprt_distance_m
      from bornes b
      left join lateral (
        select z.id                                       as pprt_id,
               z.nom                                      as pprt_nom,
               z.superficie_km2                           as pprt_km2,
               z.id_generateur                            as pprt_generateur,
               z.type_zone                                as pprt_type_zone,
               round(ST_Distance(
                 z.geom::geography,
                 ST_SetSRID(ST_MakePoint(b.lng, b.lat), 4326)::geography
               ))::int                                    as pprt_distance_m
          from public.pprt_perimetres z
         where ST_DWithin(
                 z.geom::geography,
                 ST_SetSRID(ST_MakePoint(b.lng, b.lat), 4326)::geography,
                 c_tolerance_m
               )
         order by ST_Distance(
                    z.geom::geography,
                    ST_SetSRID(ST_MakePoint(b.lng, b.lat), 4326)::geography
                  )
         limit 1
      ) r on true
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

        -- ── Rattachement PPRT ────────────────────────────────────────────
        -- `statut_zone` est la reponse a « cette zone est-elle calculee ou
        -- reelle ? ». Calcule ici, jamais redevine cote client : la couche,
        -- la popup et la legende doivent lire la MEME regle.
        'statut_zone', case
                         when b.pprt_id is not null           then 'pprt'
                         when b.sous_categorie = 'seveso_haut' then 'sans_pprt'
                         when b.sous_categorie = 'seveso_bas'  then 'non_soumis'
                         else 'non_concerne'
                       end,
        'pprt_id',          b.pprt_id,
        'pprt_nom',         b.pprt_nom,
        'pprt_km2',         b.pprt_km2,
        'pprt_generateur',  b.pprt_generateur,
        'pprt_type_zone',   b.pprt_type_zone,
        'pprt_distance_m',  b.pprt_distance_m,

        -- La zone CALCULEE voyage avec son site, et ne vaut que si un rayon
        -- a ete demande. Elle n'a aucune valeur reglementaire — c'est
        -- `statut_zone` qui dit si le site a, par ailleurs, un vrai perimetre.
        'zone',  case when v_rayon > 0 then
                   ST_AsGeoJSON(
                     ST_Buffer(ST_SetSRID(ST_MakePoint(b.lng, b.lat), 4326)::geography,
                               v_rayon, 'quad_segs=8')::geometry
                   )::jsonb
                 else null end,
        'rayon_m', case when v_rayon > 0 then v_rayon else null end
      )
    )) as fc
    from rattaches b
  )
  select jsonb_build_object(
    'type', 'FeatureCollection',
    'features', coalesce((select fc from features), '[]'::jsonb),
    -- `n_total` compte AVANT la limite : une liste tronquee doit le dire.
    'n_total', (select count(*) from filtres),
    'n_rendus', coalesce(jsonb_array_length((select fc from features)), 0),
    -- Combien des sites RENDUS ont un vrai perimetre. Compte ici plutot que
    -- reduit cote client : c'est ce que la legende affiche, et le deriver
    -- deux fois finirait par donner deux chiffres.
    'n_avec_pprt', (select count(*) from rattaches where pprt_id is not null),
    'rayon_m', case when v_rayon > 0 then v_rayon else null end,
    'tolerance_rattachement_m', c_tolerance_m
  )
  into v_result;

  return v_result;
end;
$function$;

comment on function public.risques_industriels_carte(double precision[], text[], text[], boolean, integer, integer) is
  'Sites ICPE de la bbox pour la couche carte dediee, avec attributs complets (popup), rattachement au perimetre PPRT le plus proche a 500 m (sql/179) et zone CALCULEE optionnelle. statut_zone vaut pprt / sans_pprt / non_soumis / non_concerne — il distingue une donnee qui manque (seuil haut sans PPRT) d une zone qui n existe pas en droit (seuil bas, non soumis). ST_Buffer sur GEOGRAPHY : rayon en metres, jamais en degres (meme raison que zone_rayon, sql/155). Le rayon est indicatif et REGLE par l utilisateur — ce n est pas un perimetre opposable. n_total est compte AVANT p_limite, qui coupe les sites les moins graves en premier (sql/175, 2026-09-17 ; rattachement sql/179, 2026-09-18).';
