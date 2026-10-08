-- 235 — Chaque source rendue à son propriétaire (2026-10-08)
--
-- Avant cette migration, les cinq sources appartenaient TOUTES à
-- « GENESIS (Global) », y compris « CONCESSIONS BMW » et « CIRFA ». Effet
-- paradoxal mesuré le 2026-10-08 : un client MARINE ne voyait AUCUN CIRFA sur
-- la carte (aucune source à son nom), mais lisait toutes les concessions BMW
-- par la battle d'isochrones et la liste des natures, qui ne filtraient rien.
--
-- Affectation (décision produit du 2026-10-08) :
--   CONCESSIONS BMW               → BMW GROUP, privée
--   CIRFA                         → MARINE, privée
--   LYCEEE, Filosofi 2021,
--   Brest Métropole 2026          → socle (visible de tous)
--
-- Les POI et panneaux suivent leur source (`organization_id` recopié) : la
-- colonne n'est plus lue par la règle, mais une valeur fausse y mentirait au
-- prochain lecteur.
--
-- Rejouable : affecter deux fois donne le même état. Le bloc échoue — et
-- n'écrit rien — si une source attendue manque, plutôt que de laisser un
-- client sans ses données sans le dire.

begin;

do $$
declare
  v_bmw    uuid := (select id from organizations where slug = 'bmw-group');
  v_marine uuid := (select id from organizations where slug = 'marine');
  v_n      int;
begin
  if v_bmw is null or v_marine is null then
    raise exception 'organisation bmw-group ou marine absente';
  end if;

  update data_sources set organization_id = v_bmw, visibilite = 'privee'
   where name = 'CONCESSIONS BMW';
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'CONCESSIONS BMW : % source(s), 1 attendue', v_n; end if;

  update data_sources set organization_id = v_marine, visibilite = 'privee'
   where name = 'CIRFA';
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'CIRFA : % source(s), 1 attendue', v_n; end if;

  update data_sources set visibilite = 'socle'
   where name in ('LYCEEE', 'Filosofi 2021 — Carreaux 200m', 'Brest Métropole 2026');
  get diagnostics v_n = row_count;
  if v_n <> 3 then raise exception 'socle : % source(s), 3 attendues', v_n; end if;

  update poi_france p set organization_id = ds.organization_id
    from data_sources ds
   where ds.id = p.data_source_id and p.organization_id is distinct from ds.organization_id;

  update panneaux_affichage p set organization_id = ds.organization_id
    from data_sources ds
   where ds.id = p.data_source_id and p.organization_id is distinct from ds.organization_id;
end $$;

commit;
