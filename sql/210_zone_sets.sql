-- sql/210 — L'objet « jeu de zones » : ce qu'une campagne reçoit comme plan
--           (2026-09-20)
--
-- ── LE MAILLON QUI MANQUAIT ───────────────────────────────────────────────
--
-- Le module risque savait CALCULER une exposition, mais rien n'était
-- enregistrable : il n'y avait donc rien à donner comme plan à une campagne.
-- D'où la campagne de démonstration livrée le 2026-09-19 avec 2 000 codes
-- postaux et aucun `planned_share` — et un score d'alignement de 100/100 qui
-- ne mesurait rien (sql/209).
--
-- ── POURQUOI PAS `custom_geo_zones` ───────────────────────────────────────
--
-- La table existe, porte 7 zones, et alimente toute la plomberie d'export DSP.
-- Elle ne peut pourtant pas porter un jeu de zones :
--
--   | ce qu'un jeu exige                   | ce que custom_geo_zones a      |
--   |--------------------------------------|--------------------------------|
--   | plusieurs géométries CLASSÉES        | UNE geometry(MultiPolygon)     |
--   | un multiplicateur par classe         | aucun champ                    |
--   | un profil de rayons versionné        | source_metadata jsonb non typé |
--   | une liste de CP avec part couverte   | feature_count_cp — un COMPTE   |
--
-- ⚠ Mais un jeu enregistré pose AUSSI une ligne `custom_geo_zones` miroir
-- (`custom_geo_zone_id`), pour hériter des six routes d'export et de push DSP
-- déjà écrites. **Le miroir est une PROJECTION, jamais la source** : la classe,
-- les poids et le profil vivent ici ; le miroir n'en voit que l'union. Écrire
-- dans le miroir ne doit jamais remonter vers le jeu.
--
-- ── POURQUOI LES GÉOMÉTRIES SONT COPIÉES ET NON RÉFÉRENCÉES ──────────────
--
-- `zones_risque_cache` (sql/205) porte déjà la même forme, keyée par code de
-- profil. On aurait pu y pointer. On copie, parce qu'un plan enregistré ne doit
-- pas changer sous une éviction de cache : `vider_zones_risque()` casserait
-- tous les jeux sauvegardés.
--
-- C'est exactement le raisonnement de `strategie_versions.charge_utile`, que
-- `ARCHITECTURE.md` décrit comme « l'état complet, INDÉPENDANT de l'état
-- courant de bidding_strategies ». On le reprend plutôt que de l'inventer.

create table if not exists public.zone_sets (
  id          uuid primary key default gen_random_uuid(),
  nom         text not null,
  description text,
  org_id      uuid not null,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  -- Version du JEU, incrémentée à chaque duplication-modification. Une
  -- campagne fige la version au rattachement : le plan ne doit pas changer
  -- sous une campagne en vol.
  version     int not null default 1,

  -- ── Le profil et les filtres, figés ─────────────────────────────────────
  profil    jsonb not null,          -- `ProfilRayons` (lib/risques/profil.ts)
  cible     text  not null default 'ind',
  gravites  text[] not null default '{seveso_bas,seveso_haut}',
  natures   text[] not null default '{}',
  modes     text[] not null default '{buffer,pprt}',
  -- Code de département, ou NULL pour la France entière.
  territoire text,

  -- ── Ce qui traduit le jeu en plan ───────────────────────────────────────
  -- 'exclusif' : hors zone, part de plan NULLE.
  -- 'pondere'  : tous les CP, pondérés par la classe. Défaut, parce que c'est
  --              celui qui ne surprend pas — on module avant de restreindre.
  mode_plan text not null default 'pondere',
  -- Part MINIMALE de la population d'un code postal qui doit être en zone pour
  -- que le code postal soit retenu. En POURCENTAGE, pas en fraction : 0,2 et 20
  -- ne veulent pas dire la même chose et l'un des deux vide le plan.
  seuil_couverture_cp numeric not null default 20,
  -- Multiplicateur d'enchère par classe (`{"haut:1": 2.5}`). Absent = 1.
  poids jsonb not null default '{}'::jsonb,

  -- ── La clé de cache ─────────────────────────────────────────────────────
  -- `codeJeu()` (lib/zones/jeu.ts) : RÉVERSIBLE et sans collision possible.
  -- Couvre le profil ET les filtres ET le seuil — mais ni les poids ni le mode
  -- de plan, qui ne changent pas la géométrie.
  profil_hash text not null,

  -- ── La projection, et les chiffres figés ────────────────────────────────
  custom_geo_zone_id uuid,
  population_exposee numeric,
  n_cp_retenus       int,
  -- Population exposée / population des CP retenus, en %. LE chiffre du point
  -- dur : le DSP achète au code postal, un anneau de 1 km est bien plus petit.
  taux_utile         numeric,
  construit_le       timestamptz,

  constraint zone_sets_mode_plan_check
    check (mode_plan in ('pondere', 'exclusif')),
  constraint zone_sets_seuil_check
    check (seuil_couverture_cp >= 0 and seuil_couverture_cp <= 100),
  -- Deux jeux de même nom dans une organisation sont forcément deux VERSIONS.
  constraint zone_sets_nom_version_unique unique (org_id, nom, version)
);

comment on table public.zone_sets is
  'Jeu de zones de risque : un profil de rayons fige en objet reutilisable, avec ses '
  'poids par classe et son mode de plan. C''est ce qu''une campagne recoit comme plan '
  'geographique. NE PAS confondre avec custom_geo_zones, qui ne porte qu''UNE geometrie '
  'sans classe ni poids — un jeu enregistre y pose une ligne MIROIR, projection et '
  'jamais source.';

alter table public.zone_sets enable row level security;
revoke all on table public.zone_sets from public, anon, authenticated;
grant select, insert, update, delete on table public.zone_sets to service_role;

create index if not exists idx_zone_sets_org on public.zone_sets (org_id, created_at desc);
create index if not exists idx_zone_sets_hash on public.zone_sets (profil_hash);

-- ═══════════════════════════════════════════════════════════════════════════
-- LES GÉOMÉTRIES, UNE PAR CLASSE
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.zone_set_geoms (
  zone_set_id uuid not null references public.zone_sets(id) on delete cascade,
  -- 'haut:pprt', 'haut:1', … — MÊME identifiant que `classe_carreau_risque`,
  -- pour que la légende, le tableau, la carte et le plan se rejoignent.
  classe      text not null,
  niveau      text not null,
  -- Numéro de bande, ou NULL pour un périmètre publié par l'État.
  bande       int,
  geom        geometry(MultiPolygon, 4326) not null,
  -- Pré-calculée : c'est en 3857 que `ST_AsMVT` travaille et que vivent les
  -- index GIST. La reprojeter par tuile la paierait des dizaines de fois par
  -- panoramique.
  geom_3857   geometry(MultiPolygon, 3857) not null,
  surface_km2 numeric,
  primary key (zone_set_id, classe)
);

comment on table public.zone_set_geoms is
  'Geometrie figee des classes d''un jeu, exclusives entre elles et dans le MEME ordre '
  'de priorite que classe_carreau_risque. COPIEE depuis zones_risque_cache et non '
  'referencee : un plan enregistre ne doit pas changer sous une eviction de cache.';

alter table public.zone_set_geoms enable row level security;
revoke all on table public.zone_set_geoms from public, anon, authenticated;
grant select, insert, update, delete on table public.zone_set_geoms to service_role;

create index if not exists idx_zone_set_geoms_geom
  on public.zone_set_geoms using gist (geom_3857);

-- ═══════════════════════════════════════════════════════════════════════════
-- LES CODES POSTAUX — LA MAILLE D'ACHAT
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠ C'est ici que se joue le point dur du produit. Le DSP achète au CODE
-- POSTAL, la mesure du risque se fait au carreau de 200 m. Un anneau de 1 km
-- est bien plus petit qu'un code postal : retenir un code postal dont 2 % de
-- la population est en zone, c'est acheter 98 % de hors-cible.

create table if not exists public.zone_set_cp (
  zone_set_id uuid not null references public.zone_sets(id) on delete cascade,
  code_postal text not null,
  -- La classe DOMINANTE : celle qui porte le plus de population dans ce code
  -- postal. Un code postal peut chevaucher plusieurs bandes ; on en retient
  -- une, sans quoi « un code postal, un poids » cesserait de valoir.
  classe        text not null,
  pop_en_zone   numeric not null,
  pop_totale    numeric not null,
  -- pop_en_zone / pop_totale, en %. Stockée et non dérivée à l'affichage : le
  -- seuil s'y compare, et deux arrondis différents feraient basculer des codes
  -- postaux d'un écran à l'autre.
  part_en_zone  numeric not null,
  retenu        boolean not null,
  primary key (zone_set_id, code_postal)
);

comment on table public.zone_set_cp is
  'Codes postaux d''un jeu de zones, avec leur classe dominante et leur part de '
  'population en zone. `retenu` applique seuil_couverture_cp. C''est la table que '
  'genererPlanCp (lib/zones/plan.ts) traduit en bidding_zone_configs.';

alter table public.zone_set_cp enable row level security;
revoke all on table public.zone_set_cp from public, anon, authenticated;
grant select, insert, update, delete on table public.zone_set_cp to service_role;

create index if not exists idx_zone_set_cp_retenu
  on public.zone_set_cp (zone_set_id) where retenu;
