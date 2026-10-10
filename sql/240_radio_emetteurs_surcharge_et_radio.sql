-- 240 — Émetteurs radio : une seule fonction, et des émetteurs qui portent leur radio (2026-10-10)
--
-- ── 1. LA SURCHARGE MORTE ──────────────────────────────────────────────────
--
-- sql/078 a créé `get_radio_emetteurs_geojson(text, text, uuid, integer)`.
-- sql/080 l'a « remplacée » par une version à 6 arguments — mais un
-- `CREATE OR REPLACE` d'une AUTRE signature crée une SECONDE fonction. Les deux
-- coexistaient, et dès que l'appelant ne passait ni `p_radio_ids` ni
-- `p_exclude_categories` (le cas par défaut de la carte : supabase-js omet les
-- clés `undefined`), PostgREST répondait PGRST203 « Could not choose the best
-- candidate function » → `/api/radio/emetteurs` en 500, aucun émetteur sur la
-- carte, React comme Angular. Mesuré le 2026-10-10 (lot 4 Angular, T9).
--
-- Seule appelante : `app/api/radio/emetteurs/route.ts`, qui passe toujours les
-- six noms de paramètres. La version à 4 arguments est donc morte : on la
-- retire. La version à 6 garde ses défauts (tous NULL sauf `p_limit`), et
-- couvre à elle seule tous les appels de l'ancienne.
--
-- ── 2. LA RADIO DE CHAQUE ÉMETTEUR ─────────────────────────────────────────
--
-- Les deux cartes lisent sur chaque émetteur `radio_nom`, `radio_id`,
-- `portee`, `categorie_arcom`, `genre`, `groupe_media` et `exploitant`
-- (popup, couleur par portée, mise en évidence de la radio choisie). La RPC
-- n'en rendait AUCUN : héritage du modèle 1-1 (`emetteurs_radio.radio_id`,
-- NULL sur les 12 704 lignes) abandonné par sql/078 pour la table N:N
-- `emetteur_radio_stations` (569 698 liaisons, 11 836 émetteurs liés).
--
-- Un émetteur porte de 13 à plusieurs dizaines de radios. On en rend UNE,
-- représentative, choisie de façon déterministe :
--   - parmi les radios RETENUES par les filtres de l'appel : la radio choisie
--     (`p_radio_id`), l'une des radios demandées (`p_radio_ids`), et jamais une
--     radio de catégorie exclue (`p_exclude_categories`) ;
--   - la première par nom.
-- Sans filtre, c'est donc `radio_principale` (MIN(nom)), qui reste rendue telle
-- quelle. Avec une radio choisie, chaque émetteur rendu porte CETTE radio : la
-- mise en évidence `['==', ['get','radio_id'], id]` mord enfin.
--
-- `puissance_w` reste rendue mais vaut NULL sur les 12 704 émetteurs : la
-- donnée manque à l'import ANFR, rien n'est inventé ici.
--
-- Retour `jsonb` (un FeatureCollection), donc hors de la troncature PostgREST
-- des fonctions `RETURNS TABLE` ; borné par `p_limit` (route : 20 000 au plus).
--
-- Rejouable. Verrouillé par tests/integration/radio-emetteurs.test.ts.

begin;

drop function if exists public.get_radio_emetteurs_geojson(text, text, uuid, integer);

create or replace function public.get_radio_emetteurs_geojson(
  p_bbox text default null,
  p_systeme text default null,
  p_radio_id uuid default null,
  p_limit integer default 10000,
  p_radio_ids uuid[] default null,
  p_exclude_categories text[] default null
)
returns jsonb
language plpgsql
stable
set search_path to 'public', 'pg_catalog'
as $function$
declare
  result jsonb;
begin
  select jsonb_build_object(
    'type', 'FeatureCollection',
    'features', coalesce(jsonb_agg(f.feature), '[]'::jsonb)
  )
  into result
  from (
    select jsonb_build_object(
      'type', 'Feature',
      'geometry', st_asgeojson(e.geom)::jsonb,
      'properties', jsonb_build_object(
        'id', e.id,
        'sta_nm_anfr', e.sta_nm_anfr,
        'nb_radios', coalesce(rc.nb_radios, 0),
        'radio_principale', rc.radio_principale,
        'radio_id', rr.id,
        'radio_nom', rr.nom,
        'portee', rr.portee,
        'categorie_arcom', rr.categorie_arcom,
        'genre', rr.genre,
        'groupe_media', rr.groupe_media,
        'systeme', e.systeme,
        'frequence_mhz', case when e.frequence_mhz in (87.5, 108) then null else e.frequence_mhz end,
        'puissance_w', e.puissance_w,
        'exploitant', e.exploitant,
        'commune', e.commune,
        'departement', e.departement,
        'rayon_couverture_m', e.rayon_couverture_m
      )
    ) as feature
    from emetteurs_radio e
    left join lateral (
      select count(*) as nb_radios,
             min(r.nom) as radio_principale,
             -- La radio représentative : la première par nom parmi celles que
             -- les filtres de l'appel retiennent (en-tête, § 2).
             (array_agg(r.id order by r.nom) filter (
               where (p_radio_id is null or r.id = p_radio_id)
                 and (p_radio_ids is null or r.id = any(p_radio_ids))
                 and (p_exclude_categories is null
                      or (r.categorie_arcom is not null
                          and r.categorie_arcom <> all(p_exclude_categories)))
             ))[1] as radio_representative
      from emetteur_radio_stations ers
      join radios r on r.id = ers.radio_id
      where ers.emetteur_id = e.id
    ) rc on true
    left join radios rr on rr.id = rc.radio_representative
    where e.geom is not null
    and (p_systeme is null or e.systeme = p_systeme)
    -- Radio choisie
    and (p_radio_id is null or e.id in (
      select ers.emetteur_id from emetteur_radio_stations ers where ers.radio_id = p_radio_id
    ))
    -- Plusieurs radios : l'émetteur en porte au moins une
    and (p_radio_ids is null or e.id in (
      select ers.emetteur_id from emetteur_radio_stations ers where ers.radio_id = any(p_radio_ids)
    ))
    -- Exclusion de catégories : l'émetteur porte au moins une radio hors exclusion
    and (p_exclude_categories is null or e.id in (
      select ers.emetteur_id from emetteur_radio_stations ers
      join radios r on r.id = ers.radio_id
      where ers.emetteur_id = e.id and r.categorie_arcom is not null
      and r.categorie_arcom <> all(p_exclude_categories)
    ))
    and (p_bbox is null or st_intersects(
      e.geom,
      st_makeenvelope(
        split_part(p_bbox, ',', 1)::float,
        split_part(p_bbox, ',', 2)::float,
        split_part(p_bbox, ',', 3)::float,
        split_part(p_bbox, ',', 4)::float,
        4326
      )
    ))
    limit p_limit
  ) f;

  return result;
end;
$function$;

notify pgrst, 'reload schema';

commit;
