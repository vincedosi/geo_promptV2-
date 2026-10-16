-- 260 — Purge des panneaux de Brest : c'était un essai (2026-10-16)
--
-- Spec : docs/superpowers/specs/2026-10-16-ooh-campagnes-design.md § 1 (décision 1) et § 4.1.
-- Les 1 434 panneaux de la source « Brest Métropole 2026 » (`source = 'custom_geo_brest-metropole_fr'`), écrits en
-- 2026-07 par l'import ArcGIS (supprimé dans le même commit), étaient un test. On retire les panneaux, le seul passage
-- de `import_runs_ooh` qui les a écrits, puis la ligne `data_sources`.
--
-- Garde : le bloc REFUSE (P0001) si la source porte autre chose que des panneaux de Brest — un panneau d'une autre
-- `source`, ou un POI de `poi_france` — ou si un panneau de Brest est réservé par une campagne
-- (`campagne_ligne_panneaux`, sql/261 ; testée par `to_regclass`, la table n'existant pas avant 261).
-- Chaque suppression lit son résultat (`GET DIAGNOSTICS`) et le dit (`RAISE NOTICE`).
--
-- Mesuré le 2026-10-16 (base locale) : 1 434 panneaux, une source (640a8b18-f08c-4eb3-bbde-f51b6ddbfe16), un passage
-- `import_runs_ooh` (5a5f67b3-2be6-4cfa-af91-fde3a57f38c4), aucune clé étrangère vers `panneaux_affichage`.
-- Coût : 1 434 suppressions par `source` (index unique (source, source_ref), `source` en tête), une seule fois.
-- Rejouable : sur une base déjà purgée, la source est introuvable, tout compte 0, rien n'est supprimé.
-- Droits : aucun (bloc DO, aucune fonction ni grant).

begin;

do $$
declare
  c_source    constant text := 'custom_geo_brest-metropole_fr';
  v_ds        uuid;
  v_nom       text;
  v_run       uuid;
  n_etrangers integer := 0;
  n_poi       integer := 0;
  n_reserves  integer := 0;
  n_panneaux  integer;
  n_runs      integer;
  n_sources   integer;
begin
  select id, name, nullif(mapping->>'run_id', '')::uuid
    into v_ds, v_nom, v_run
    from public.data_sources
   where type = 'panneaux' and mapping->>'source_key' = c_source
   order by import_date
   limit 1;

  if v_ds is not null then
    select count(*) into n_etrangers
      from public.panneaux_affichage
     where data_source_id = v_ds and source is distinct from c_source;
    select count(*) into n_poi from public.poi_france where data_source_id = v_ds;
    if n_etrangers > 0 or n_poi > 0 then
      raise exception 'purge Brest refusée : la source % porte % panneau(x) d''une autre source et % POI',
        v_ds, n_etrangers, n_poi using errcode = 'P0001';
    end if;
  end if;

  if to_regclass('public.campagne_ligne_panneaux') is not null then
    execute 'select count(*) from public.campagne_ligne_panneaux clp
               join public.panneaux_affichage p on p.id = clp.panneau_id
              where p.source = $1'
       into n_reserves using c_source;
    if n_reserves > 0 then
      raise exception 'purge Brest refusée : % panneau(x) de Brest réservé(s) par une campagne', n_reserves
        using errcode = 'P0001';
    end if;
  end if;

  delete from public.panneaux_affichage where source = c_source;
  get diagnostics n_panneaux = row_count;

  delete from public.import_runs_ooh
   where (v_run is not null and id = v_run)
      or (v_nom is not null and source = v_nom);
  get diagnostics n_runs = row_count;

  delete from public.data_sources where id = v_ds;
  get diagnostics n_sources = row_count;

  raise notice 'purge Brest : % panneau(x), % passage(s) d''import, % source(s) supprimés', n_panneaux, n_runs, n_sources;

  if exists (select 1 from public.panneaux_affichage where source = c_source) then
    raise exception 'purge Brest incomplète : des panneaux de Brest subsistent' using errcode = 'P0001';
  end if;
end
$$;

commit;
