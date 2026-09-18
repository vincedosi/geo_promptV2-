-- sql/183 — Les PROCÉDURES PPRT (GASPAR), et la clé qui les relie aux périmètres
--
-- ── TROIS NOMBRES, AUCUN INTERCHANGEABLE ─────────────────────────────────
--
--   664 assiettes    les polygones — une ligne de `pprt_perimetres` chacune
--   609 générateurs  l'établissement à l'origine du risque (`id_generateur`)
--   415 procédures   le PLAN lui-même (`gaspar/pprt`) — cette table
--
-- Un plan couvre plusieurs générateurs, un générateur porte plusieurs
-- assiettes. Compter des assiettes en croyant compter des PPRT annonce 664
-- plans là où il y en a 415.
--
-- ── LA CLÉ DE JOINTURE EXISTE, CONTRAIREMENT À CE QUI ÉTAIT ÉCRIT ────────
--
-- `ARCHITECTURE.md` a affirmé pendant un mois que « ce flux ne porte aucune clé
-- de jointure vers GASPAR ». C'est faux : la couche **`wfs_sup:generateur_sup_s`**
-- porte un champ **`id_gaspar`**, et l'assiette porte `idgen`. La chaîne est
-- donc `assiette.idgen → generateur.idgen → id_gaspar → GASPAR`.
--
-- Mesuré le 2026-09-18 sur le flux complet : **664 assiettes sur 664** se
-- rattachent à un générateur (609 distincts, 711 entités), **0 sans
-- `id_gaspar`**, atteignant **404 procédures distinctes** sur les 415 — chiffre
-- cohérent avec les 403 procédures que GASPAR déclare porteuses d'une SUP.
--
-- ── CE QUE GASPAR NE DONNE PAS, ET QU'ON NE CRÉE DONC PAS ────────────────
--
-- Le modèle demandé prévoyait `etat` (approuvé / prescrit / abrogé),
-- `date_approbation` et `date_abrogation`. **`/api/v1/gaspar/pprt` n'expose
-- aucun des trois** — vérifié champ par champ sur une procédure réelle. Les
-- créer reviendrait à poser trois colonnes que rien ne remplira jamais, et
-- qu'un lecteur prendrait pour une donnée manquante plutôt que pour une donnée
-- absente à la source.
--
-- Ce que GASPAR donne réellement : le nom du plan, son bassin de risques, son
-- département pilote, une date de modification, l'état de révision, et —
-- utile — **la liste des types de zones réglementaires qui existent**.
--
-- ── `zonage_existe` VAUT PLUS QU'IL N'EN A L'AIR ─────────────────────────
--
-- **365 procédures sur 415 (88 %) déclarent un zonage réglementaire**, dont la
-- GÉOMÉTRIE n'est publiée nulle part en vecteur national (voir l'en-tête de
-- sql/180). Cette colonne permet donc de dire à l'écran, sans mentir : « ce
-- plan comporte 3 zones (R, r, B) — leur tracé n'est pas publié ». C'est très
-- différent d'un silence, qui se lirait comme « ce plan n'a pas de zonage ».
--
-- Les codes relevés sur les 415 procédures confirment la non-normalisation
-- déjà documentée : R (139), r (92), G (73), b (60), B (51), mais aussi B1,
-- R1, b1… Chaque DDT nomme ses zones à sa façon.

create table if not exists public.pprt_documents (
  -- Identifiant GASPAR, ex. '01DDT20110004'. C'est la clé du PLAN.
  id_gaspar               text primary key,
  nom                     text not null,
  bassin_risques          text,
  modele                  text,
  code_departement_pilote text,
  nom_departement_pilote  text,
  -- `etatRevision` : le plan est-il en cours de révision.
  en_revision             boolean not null default false,
  -- `supExists` : une servitude est-elle déclarée pour ce plan.
  sup_existe              boolean not null default false,
  -- `zoneRegExists` : un zonage réglementaire EXISTE-T-IL, indépendamment de
  -- la publication de sa géométrie. Voir l'en-tête.
  zonage_existe           boolean not null default false,
  -- `listTypeReg` brut : [{code, libelle, nom, codeZone}]. Conservé tel quel,
  -- les codeZone n'étant pas normalisés entre départements.
  types_zones             jsonb  not null default '[]'::jsonb,
  date_modification       date,
  source                  text   not null default 'gaspar',
  importe_le              timestamptz not null default now()
);

create index if not exists idx_pprt_documents_dept
  on public.pprt_documents(code_departement_pilote);

alter table public.pprt_documents enable row level security;

comment on table public.pprt_documents is
  'Procedures PPRT de GASPAR (415). A distinguer des 664 assiettes de pprt_perimetres et des 609 generateurs : un plan couvre plusieurs generateurs. etat / date_approbation / date_abrogation ABSENTS a dessein — /api/v1/gaspar/pprt ne les expose pas (sql/183). RLS deny-all.';

-- ─────────────────────────────────────────────────────────────────────────
-- La clé sur les périmètres
-- ─────────────────────────────────────────────────────────────────────────
alter table public.pprt_perimetres
  add column if not exists id_gaspar text;

create index if not exists idx_pprt_perimetres_gaspar
  on public.pprt_perimetres(id_gaspar);

comment on column public.pprt_perimetres.id_gaspar is
  'Procedure PPRT dont releve cette assiette, via generateur_sup_s.id_gaspar (sql/183). PAS de cle etrangere vers pprt_documents : les deux flux sont importes separement et rien ne garantit que le document soit deja la quand l assiette arrive. Une contrainte ferait echouer l import des perimetres sur un ordre d execution, pour un lien qui se verifie par une requete.';
