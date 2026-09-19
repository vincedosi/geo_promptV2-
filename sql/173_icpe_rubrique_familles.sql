-- sql/173 — Registre des familles de rubriques ICPE + categorie POI « risque industriel »
--
-- Spec : docs/superpowers/specs/2026-09-17-georisques-icpe-design.md
--
-- POURQUOI CETTE TABLE, ET PAS UNE LISTE EN DUR
--   Le numero de rubrique ICPE porte la nature du risque (41xx toxicite aigue,
--   47xx GPL et produits petroliers, 27xx dechets...). Le libelle affiche doit
--   pouvoir changer sans deploiement : c'est le motif des autres registres du
--   projet (cible_indicator_registry, dsp_metrics_registry, dsp_channel_registry).
--   Un miroir TypeScript existe — lib/import/georisques/familles.ts — parce que
--   le classement tourne sur 138 423 sites et ne peut pas faire un aller-retour
--   en base par rubrique.
--
-- CE QUE rang_gravite FAIT, ET NE FAIT PAS
--   Il departage la nature DOMINANTE d'un site qui porte plusieurs rubriques, et
--   rien d'autre. Ce n'est pas une echelle de danger publiable : la gravite
--   reglementaire est le statut Seveso, qui vit dans poi_france.sous_categorie.
--   Espacement de 5 pour inserer une famille sans renumeroter.
--   UNIQUE dessus : deux familles de meme rang rendraient la dominante non
--   deterministe, donc la couleur d'un point pourrait changer d'un import a
--   l'autre sans que rien ne le signale.

create table if not exists public.icpe_rubrique_familles (
  prefixe      text primary key,
  libelle      text not null,
  rang_gravite int  not null unique
);

comment on table public.icpe_rubrique_familles is
  'Familles de rubriques ICPE : traduit le prefixe (2 chiffres) du numero de rubrique en nature de risque. rang_gravite ne sert qu a departager la nature dominante d un site portant plusieurs rubriques. Miroir TS : lib/import/georisques/familles.ts (sql/173, 2026-09-17)';

comment on column public.icpe_rubrique_familles.rang_gravite is
  'Departage la nature dominante. PAS une echelle de danger : la gravite reglementaire est le statut Seveso (poi_france.sous_categorie)';

-- RLS deny-all, comme les autres registres : lue par le service_role seulement.
alter table public.icpe_rubrique_familles enable row level security;

insert into public.icpe_rubrique_familles (prefixe, libelle, rang_gravite) values
  ('41', 'Toxicité aiguë',                         100),
  ('42', 'Explosibles',                             95),
  ('47', 'GPL et produits pétroliers',              90),
  ('43', 'Gaz et liquides inflammables',            85),
  ('14', 'Inflammables (ancienne nomenclature)',    80),
  ('27', 'Déchets',                                 75),
  ('45', 'Dangereux pour le milieu aquatique',      70),
  ('34', 'Chimie (IED)',                            65),
  ('35', 'Déchets (IED)',                           60),
  ('15', 'Entrepôts et stockages',                  55),
  ('29', 'Combustion et refroidissement',           50),
  ('26', 'Plastiques et caoutchouc',                45),
  ('25', 'Matériaux et minéraux',                   40),
  ('22', 'Agroalimentaire et divers',               35),
  ('11', 'Fluides frigorigènes',                    30)
on conflict (prefixe) do update
  set libelle = excluded.libelle, rang_gravite = excluded.rang_gravite;

-- La categorie POI. C'est CETTE ligne qui fait apparaitre « Zones risque indus »
-- dans le selecteur de types du panneau Calques, via /api/map/categories qui
-- joint poi_categories pour le label_fr.
--
-- couleur_carte porte un jeton du design system et non un hex : la gravite se
-- lit sur la rampe sequentielle --seq-1..--seq-5, et --seq-3 est la teinte
-- mediane, utilisee comme couleur par defaut de la categorie.
insert into public.poi_categories
  (categorie, sous_categorie, label_fr, icone, couleur_carte, source_defaut, actif, description)
values
  ('risque_industriel', null, 'Zones risque indus', 'factory', 'var(--seq-3)', 'georisques_icpe', true,
   'Installations classees pour la protection de l environnement (ICPE), source API Georisques. Gravite (Seveso/IED/regime) dans sous_categorie, nature du risque dans metadata.libelle_nature, liste complete dans metadata.natures_risque.')
on conflict do nothing;
