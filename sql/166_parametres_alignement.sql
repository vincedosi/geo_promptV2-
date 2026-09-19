-- sql/166_parametres_alignement.sql
-- Paramètres du score d'alignement géographique.
-- JAMAIS en dur dans le code : le score doit rester recalculable à l'identique
-- depuis les données brutes, donc ses paramètres doivent être lisibles en base.

alter table dsp_campaigns
  add column if not exists tolerance_pct numeric not null default 10
    check (tolerance_pct >= 0 and tolerance_pct <= 100),
  add column if not exists overpressure_weight numeric not null default 1.0
    check (overpressure_weight >= 0 and overpressure_weight <= 5);

comment on column dsp_campaigns.tolerance_pct is
  'Marge de conformite du score d alignement, en %. Un CP dans [plan*(1-t), plan*(1+t)] est conforme.';
comment on column dsp_campaigns.overpressure_weight is
  'Poids de la sur-pression dans la penalite. 1.0 = penalisee autant que la sous-pression.';

-- L'etalon ("Moyenne du secteur") est calcule sur les parametres PAR DEFAUT,
-- jamais sur ceux d une campagne : un etalon qui bouge avec le reglage de
-- chacun ne mesure plus rien.
create table if not exists etalon_alignement (
  id              boolean primary key default true check (id),
  score_median    numeric not null,
  n_campagnes     integer not null,
  tolerance_pct   numeric not null,
  calcule_le      timestamptz not null default now()
);

alter table etalon_alignement enable row level security;
-- RLS deny-all : lu et ecrit uniquement par les routes en service_role.

insert into etalon_alignement (id, score_median, n_campagnes, tolerance_pct)
values (true, 64, 0, 10)
on conflict (id) do nothing;
