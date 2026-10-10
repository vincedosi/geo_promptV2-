-- 242 — Émetteurs radio : une radio n'est affichée que si elle est UNIQUE (2026-10-10)
--
-- sql/240 donnait à chaque émetteur une radio « représentative » : la première
-- PAR NOM parmi ses radios. Or un émetteur lié en porte de 13 à 73 (aucun
-- n'en porte une seule, mesuré le 2026-10-10). Résultat : « Air Zen, locale »
-- affiché sur 3 046 émetteurs, « Africa Radio » sur 1 520 ; Mont July, qui
-- porte 73 radios dont des nationales, se lisait « Air Zen, locale » et se
-- peignait en couleur « locale ». Une information FAUSSE, là où « Radio non
-- associée » était honnête (relecture de T-serveur, décision du chef de projet).
--
-- Règle, jamais un choix arbitraire :
--   - SANS filtre de radio : `radio_id`, `radio_nom`, `portee`,
--     `categorie_arcom`, `genre`, `groupe_media` ne sont remplis que si
--     l'émetteur est lié à exactement UNE radio ; sinon NULL ;
--   - AVEC un filtre de radio (`p_radio_id`, ou `p_radio_ids`) : la radio du
--     filtre que l'émetteur porte — remplie seulement si elle est unique (avec
--     `p_radio_id`, elle l'est toujours ; avec plusieurs radios filtrées, un
--     émetteur qui en porte deux reste NULL) ;
--   - l'exclusion de catégories ne choisit rien : elle ne fait que filtrer les
--     émetteurs, comme avant.
-- `nb_radios` (nombre de radios liées, déjà rendu depuis sql/078) dit combien
-- l'émetteur en porte. `radio_principale`, qui valait MIN(nom) depuis sql/078
-- — le même choix arbitraire, lu par aucun client — suit la même règle.
--
-- Effet de bord : la jointure latérale ne sonde plus `radios` pour chaque
-- liaison (569 698 sondes de `radios_pkey`, ≈ 1,7 M buffers par appel global).
--
-- Même signature que sql/240 (CREATE OR REPLACE). Rejouable.
-- Verrouillé par tests/integration/radio-emetteurs.test.ts.

begin;

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
        'radio_principale', rr.nom,
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
             -- Radios RETENUES : celles du filtre de radio s'il y en a un,
             -- toutes sinon. Une seule → c'est elle ; plusieurs → aucune.
             count(*) filter (where (p_radio_id is null or ers.radio_id = p_radio_id)
                                and (p_radio_ids is null or ers.radio_id = any(p_radio_ids))) as nb_retenues,
             (array_agg(ers.radio_id) filter (where (p_radio_id is null or ers.radio_id = p_radio_id)
                                                and (p_radio_ids is null or ers.radio_id = any(p_radio_ids))))[1] as radio_retenue
      from emetteur_radio_stations ers
      where ers.emetteur_id = e.id
    ) rc on true
    left join radios rr on rr.id = case when rc.nb_retenues = 1 then rc.radio_retenue end
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
