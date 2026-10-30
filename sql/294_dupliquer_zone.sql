-- 294 — Dupliquer une zone à forme figée, côté base (2026-10-29, ③ finitions, T2 ; V-4, Q-3)
--
-- Plan : docs/superpowers/plans/2026-10-29-carte-en-parcours-zones.md, arbitrage A-5. Appelée par
-- `POST /api/zones/[id]/dupliquer` pour une zone dont la recette n'est PAS recalculable (dessin, import, isochrone,
-- capture, combinaison) ou absente (zone d'avant le lot 3). Une recette recalculable ne passe pas ici : la route
-- l'exécute À NEUF et l'écrit par creer_zone_recette (sql/253).
--
-- Pourquoi une RPC : la géométrie est copiée DANS la base (`insert … select`), elle ne transite jamais par Node ni par
-- le navigateur (jusqu'à 378 Ko de géométrie pour la plus grosse zone locale, 23 073 sommets).
--
-- Relecture 1 (I-1) : les clés de MIGRATION (`origine`, `geography_zone_id`, `migre_le`, sql/293) ne sont pas
-- recopiées — une copie de zone CIRFA n'est pas « migrée de geography_zones », et elle ne doit ni compter parmi les 93
-- ni porter la clé d'idempotence de sql/293. Sa provenance est `duplique_de`.
-- Ce qui est copié : nom (celui de l'appelant), description, source_type, source_metadata + `duplique_de`,
-- geometry (bbox et updated_at par le déclencheur custom_geo_zones_before_write), recette TELLE QUELLE, et les
-- sous-zones (une bataille capturée a une sous-zone par POI et par palier). PAS les codes CP / IRIS ni les compteurs
-- (la route les résout comme à la création), ni les statistiques d'audience (recalculées à la demande).
-- La zone source n'est NI lue sous verrou NI modifiée (A-2) : une zone citée par un plan reste intouchée.
-- Une zone d'un autre espace, ou absente : `{ refus: 'zone_introuvable' }` (on ne dit pas qu'elle existe ailleurs).
--
-- Mesuré le 2026-10-29 (local, EXPLAIN (ANALYZE, BUFFERS) dans une transaction annulée) sur la plus grosse zone
-- (23 073 sommets, 378 756 octets de géométrie) : 85 ms, 1 245 accès — une ligne lue par la clé primaire, une ligne
-- écrite.
-- Rend jsonb. Droits : service_role. Rejouable (create or replace), aucun DROP.

begin;

create or replace function public.dupliquer_zone(p_zone_id uuid, p_org_id uuid, p_nom text, p_cree_par uuid)
returns jsonb
language plpgsql
security invoker
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_id uuid;
  v_km2 numeric;
begin
  if p_nom is null or length(trim(p_nom)) = 0 or length(p_nom) > 200 then
    raise exception 'nom de zone hors bornes (1 a 200 caracteres)' using errcode = '22023';
  end if;

  insert into public.custom_geo_zones (name, description, org_id, created_by, source_type, source_metadata, geometry, recette)
  select trim(p_nom), z.description, z.org_id, p_cree_par, z.source_type,
         (z.source_metadata - 'origine' - 'geography_zone_id' - 'migre_le') || jsonb_build_object('duplique_de', z.id),
         z.geometry, z.recette
    from public.custom_geo_zones z
   where z.id = p_zone_id and z.org_id = p_org_id
  returning id, round((ST_Area(geometry::geography) / 1e6)::numeric, 2) into v_id, v_km2;

  if v_id is null then
    return jsonb_build_object('refus', 'zone_introuvable');
  end if;

  insert into public.custom_geo_zone_subzones (zone_id, name, source_ref, geometry, ordering, default_multiplier)
  select v_id, s.name, s.source_ref, s.geometry, s.ordering, s.default_multiplier
    from public.custom_geo_zone_subzones s
   where s.zone_id = p_zone_id;

  return jsonb_build_object('id', v_id, 'surface_km2', v_km2);
end
$fn$;

revoke all on function public.dupliquer_zone(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.dupliquer_zone(uuid, uuid, text, uuid) to service_role;

comment on function public.dupliquer_zone(uuid, uuid, text, uuid) is
  'Copie une zone de l''espace (forme, recette, sous-zones) sous un nouveau nom, source_metadata.duplique_de ; '
  'la source n''est pas modifiee. { id, surface_km2 } | { refus: zone_introuvable } (sql/294).';

commit;
