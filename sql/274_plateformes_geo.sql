-- sql/274 — `plateformes_geo` : ce que chaque plateforme d'achat accepte comme maille géographique (lot 5, T2 ;
-- route `GET /api/zones/plateformes`, `lib/zones/plateformes.ts`).
--
-- POURQUOI UNE TABLE. Les règles des plateformes (200 cercles chez Meta, 1 à 80 km, 3 000 lieux chez TikTok, cercle
-- DV360 ≥ 1 km et ≥ 1 000 habitants…) changent sans prévenir et une partie n'est pas encore vérifiée dans de vrais
-- comptes (Q-A, Q-B, Q-C de la spec § 16.7). Écrites en dur, chaque correction serait une livraison ; ici, c'est une
-- `update` (spec § 16.2-3, arbitrage A-7). AUCUNE de ces limites ne doit être recopiée ailleurs que dans ce seed.
--
-- UNE LIGNE PAR (plateforme, maille). La clé primaire est celle que `zone_set_plateformes` (T6) référence par clé
-- étrangère : un jeu de zones ne peut pas choisir une maille que la table ne connaît pas. Une maille que la doc dit
-- IMPOSSIBLE (TikTok : cercle, CP) est une ligne `disponible = false` : l'écran l'affiche grisée avec sa raison
-- (`note`) au lieu de la taire — l'utilisateur sait pourquoi elle manque.
--   • `natif`      : la plateforme achète cette maille telle quelle (sinon : conversion) ;
--   • `a_verifier` : relevé non confirmé dans un compte (doc secondaire, doc derrière connexion, cas France ambigu) —
--                    l'écran porte un badge neutre « À vérifier », sans bloquer ;
--   • `limites`    : clés facultatives `max_unites`, `rayon_min_m`, `rayon_max_m`, `pop_min_unite`, `pop_min_groupe`,
--                    `max_sommets` (entiers ; une clé absente = pas de limite connue) ;
--   • `doc_url`    : la doc officielle LUE au relevé. NULLE quand elle n'est pas publique (TTD : portail partenaire) —
--                    jamais une URL supposée.
--
-- SOURCE DU SEED : relevé du 14/10/2026 (mémoire `reference_dsp_maille_geo`) et spec § 8 ; URLs Meta et TikTok
-- relues le 24/10 (Meta : `custom_locations` ≤ 200, 1 à 80 km, `zips` ≤ 50 000 ; TikTok : 3 000 lieux par groupe).
--
-- REJOUABLE : `if not exists`, `on conflict do nothing`. Rejouer la migration ne REMET PAS le seed sur une ligne
-- corrigée en base : une correction faite par `update` survit (c'est le mode d'édition prévu, A-7). Aucun `drop`.
-- Droits : service_role seul, RLS activée sans policy (patron sql/231, sql/270) — la route lit en service_role.

create table if not exists public.plateformes_geo (
  plateforme  text        not null check (plateforme in ('dv360', 'ttd', 'meta', 'tiktok')),
  maille      text        not null check (maille in ('polygone', 'cp', 'iris', 'commune', 'departement', 'cercle')),
  libelle     text        not null,
  natif       boolean     not null,
  disponible  boolean     not null default true,
  limites     jsonb       not null default '{}'::jsonb check (jsonb_typeof(limites) = 'object'),
  doc_url     text        check (doc_url is null or doc_url like 'https://%'),
  releve_le   date        not null,
  a_verifier  boolean     not null default false,
  note        text,
  ordre       integer     not null,
  primary key (plateforme, maille)
);

comment on table public.plateformes_geo is
  'Capacites geographiques des plateformes d''achat, une ligne par (plateforme, maille). Editee par SQL (update), '
  'jamais en dur dans le code. Seed : releve du 14/10/2026. sql/274 (lot 5, T2).';

alter table public.plateformes_geo enable row level security;
revoke all on table public.plateformes_geo from public, anon, authenticated;
grant select, insert, update, delete on table public.plateformes_geo to service_role;

insert into public.plateformes_geo
  (plateforme, maille, libelle, natif, disponible, limites, doc_url, releve_le, a_verifier, note, ordre)
values
  ('dv360', 'cp', 'Codes postaux', true, true, '{}',
   'https://developers.google.com/display-video/api/guides/concepts/targeting/geography', '2026-10-14', false,
   'Poids par CP possible (script de custom bidding). Poussée par API branchée.', 10),
  ('dv360', 'cercle', 'Cercles (liste de proximité)', true, true, '{"rayon_min_m": 1000, "pop_min_unite": 1000}',
   'https://developers.google.com/display-video/api/guides/concepts/targeting/geography', '2026-10-14', false,
   'Liste de proximité, poussée non branchée.', 20),
  ('ttd', 'polygone', 'Polygones', true, true, '{}', null, '2026-10-14', true,
   'Q-A : natif dans le compte dentsu, ou via un partenaire (Foursquare, surcoût CPM) ? Doc derrière connexion.', 30),
  ('ttd', 'cercle', 'Cercles (points + rayon)', true, true, '{}', null, '2026-10-14', true,
   'Q-A : rayon minimal non relevé. Doc derrière connexion.', 40),
  ('ttd', 'cp', 'Codes postaux', true, true, '{}', null, '2026-10-14', true,
   'Q-A : segments de CP français non confirmés. Doc derrière connexion.', 50),
  ('meta', 'cercle', 'Cercles', true, true, '{"max_unites": 200, "rayon_min_m": 1000, "rayon_max_m": 80000}',
   'https://developers.facebook.com/docs/marketing-api/audiences/reference/basic-targeting', '2026-10-14', false,
   'Rayon d''au moins 15 km en catégorie sensible.', 60),
  ('meta', 'cp', 'Codes postaux', true, true, '{"max_unites": 50000}',
   'https://developers.facebook.com/docs/marketing-api/audiences/reference/basic-targeting', '2026-10-14', true,
   'Q-C : CP français (clé FR:75001) non confirmés. Sans poids : paliers.', 70),
  ('tiktok', 'departement', 'Départements', true, true, '{"max_unites": 3000, "pop_min_groupe": 1000}',
   'https://ads.tiktok.com/help/article/location-targeting', '2026-10-14', false,
   '3 000 lieux par groupe d''annonces, pas d''exclusion. Au moins 1 000 personnes par groupe (UE).', 80),
  ('tiktok', 'commune', 'Communes', true, true, '{"max_unites": 3000, "pop_min_groupe": 1000}',
   'https://ads.tiktok.com/help/article/location-targeting', '2026-10-14', true,
   'Q-B : arrondissements de Paris, Lyon et Marseille acceptés ? 3 000 lieux par groupe d''annonces.', 90),
  ('tiktok', 'cercle', 'Cercles', false, false, '{}',
   'https://ads.tiktok.com/help/article/location-targeting', '2026-10-14', true,
   'Q-B : aucun ciblage par rayon dans la doc officielle (1 km minimum selon des blogs).', 100),
  ('tiktok', 'cp', 'Codes postaux', false, false, '{}',
   'https://ads.tiktok.com/help/article/location-targeting', '2026-10-14', false,
   'Pas de CP en France (US, CA, BR, ID, TH, VN seulement).', 110)
on conflict (plateforme, maille) do nothing;
