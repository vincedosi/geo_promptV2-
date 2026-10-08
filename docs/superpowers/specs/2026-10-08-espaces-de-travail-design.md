# Espaces de travail — une seule page pour administrer les droits

> Spécification validée dans son principe par Vincent le 2026-10-08.
> ⚠ Le produit s'appelle désormais **dentsu.explore** (décision du 2026-10-08) :
> « MAGELIAN » dans ce document désigne l'ancien nom.
> Prérequis : le cloisonnement par organisation (`feat/droits-donnees`,
> sql/234-235, `lib/auth/perimetre-donnees.ts`) — cette page ADMINISTRE la
> règle que ce chantier a posée, elle n'en invente pas une autre.

## 1. Objectif

Aujourd'hui, les droits se règlent sur trois pages qui ne se parlent pas :
`/admin/users` (comptes), `/admin/organizations/[id]` (membres, partages vus
du client) et `/admin/sources` (propriétaire et partages vus de la source). Et
le niveau **socle / privé** ajouté le 2026-10-08 n'a aucun écran.

Une page **Espaces de travail** remplace les trois pour tout ce qui touche aux
droits : qui est dans quel espace, quelles données chaque espace voit, et la
vérification de ce qu'il voit réellement.

## 2. Décisions validées (2026-10-08)

| # | Décision |
|---|---|
| D1 | **Seul le super_admin administre** : il crée les comptes, les espaces, et fait les imports. Pas d'admin côté client. |
| D2 | **Un utilisateur peut appartenir à plusieurs espaces** (un planner dentsu sur BMW et sur la Marine) ; il ne voit que l'espace **actif**, choisi dans le sélecteur. |
| D3 | **Même modules pour tous** : la différence entre clients est la donnée, pas la fonctionnalité. Pas de droits par module. |
| D4 | **Trois niveaux de visibilité** d'un jeu de données : socle, privé, partagé (sql/234). |
| D5 | **Construite en Angular**, dans l'administration du lot 6 — pas en React, qui serait réécrit. |
| D6 | « Brest Métropole 2026 » reste au socle pour le moment. |

## 3. Le modèle que la page administre

### 3.1 Appartenance et espace actif — une règle, deux colonnes

| Colonne | Rôle | Vérité |
|---|---|---|
| `organization_members (user_id, organization_id)` | À quels espaces l'utilisateur APPARTIENT | **source de vérité de l'appartenance** |
| `profiles.organization_id` | Dans quel espace il TRAVAILLE en ce moment | l'espace actif, lu par `getOrgSourceIds` et `get_user_org()` |

**Invariant :** pour un non-super_admin, l'espace actif est toujours un espace
dont il est membre, ou `null` (il ne voit alors que le socle).

Constat du 2026-10-08 qui rend l'invariant nécessaire : les deux comptes
clients (`souraj91@…`, `souraj91+1@…`) ont un espace actif mais **ne figurent
dans aucun** `organization_members`. S'ils basculaient ailleurs, ils ne
pourraient plus revenir : `/api/user/switch-org` exige l'appartenance.

Migration `sql/236_appartenance_espaces.sql` :
- rattrapage : toute paire `(profiles.id, profiles.organization_id)` absente
  d'`organization_members` y est ajoutée ;
- déclencheur sur `profiles` : refuse un `organization_id` dont un
  non-super_admin n'est pas membre ;
- déclencheur sur `organization_members` : retirer un utilisateur de son espace
  actif remet son espace actif sur un autre de ses espaces, ou `null`.

Garder la règle EN BASE et pas seulement dans les routes : c'est la leçon de
sql/234, où la base était la seule barrière face à un appel PostgREST direct.

### 3.2 Rôles

Deux rôles employés : `super_admin` (Vincent) et `client` (tous les autres,
planners dentsu compris). Un planner dentsu en `super_admin` verrait TOUT,
quel que soit son espace actif : la page l'affiche en clair (§ 4.3).

Le rôle `admin` existe en base mais n'ouvre rien (`requireAdmin` = super_admin
strict). La page ne le propose pas (D1).

### 3.3 Le socle et « GENESIS (Global) »

« GENESIS (Global) » est l'organisation qui possède les données MAGELIAN
(lycées, carroyage). Depuis sql/234, ce n'est plus la propriété qui rend une
donnée visible de tous, c'est `visibilite = 'socle'`. La page montre donc :
- une entrée virtuelle **« Socle MAGELIAN »** en tête : les jeux visibles de
  tous, quel que soit leur propriétaire ;
- « GENESIS (Global) » comme un espace parmi les autres, renommé à l'affichage
  **« dentsu.explore (interne) »** (§ 9, Q1).

## 4. L'écran

Route Angular : `admin/espaces` (lot 6, garde super_admin existante). Entrée de
navigation **« Espaces de travail »** sous Système, à la place de « Users » et
« Organisations ».

```
┌ Espaces de travail ─────┬─ MARINE ──────────────────────────────────────────┐
│ ● Socle MAGELIAN        │  Membres (3)  Données (3)  Aperçu  Réglages       │
│   visible de tous · 3   │                                                   │
│ ─────────────────────── │                                                   │
│   BMW GROUP     2 · 1   │                  (contenu de l'onglet)            │
│ ▸ MARINE        3 · 1   │                                                   │
│   DRHAT         2 · 0   │                                                   │
│   MAGELIAN (interne)    │                                                   │
│ + Nouvel espace         │                                                   │
└─────────────────────────┴───────────────────────────────────────────────────┘
```

### 4.1 Colonne des espaces

- Chaque ligne : nom, nombre de membres · nombre de jeux privés possédés.
- Lien direct par URL : `admin/espaces/:id` (et `admin/espaces/socle`), pour
  qu'un rechargement ou un lien partagé rouvre la même fiche.
- **+ Nouvel espace** : dialogue nom + description (`POST /api/admin/organizations`).
- Accessible au clavier : liste de liens, flèches haut/bas, Entrée.

### 4.2 Fiche « Socle MAGELIAN »

La liste des jeux `visibilite = 'socle'`, chacun avec son propriétaire et un
bouton **« Retirer du socle »** (→ privé à son propriétaire, avec confirmation
qui dit combien de clients le perdent). En bas : les jeux privés, avec
**« Mettre au socle »** (confirmation : « visible de tous les clients »).

Les référentiels système sans source (arrêts de transport, installations
classées) sont listés en lecture seule, avec la mention « référentiel système,
toujours visible ».

### 4.3 Onglet Membres

| Colonne | Contenu |
|---|---|
| Utilisateur | nom, email |
| Rôle | `client` ou `super_admin` — un super_admin porte le bandeau « voit tous les espaces » |
| Autres espaces | pastilles des autres espaces dont il est membre |
| Espace actif | celui où il travaille en ce moment |
| Actions | Retirer de l'espace · Réinitialiser le mot de passe |

Actions :
- **Ajouter un membre** : chercher un compte existant (email) ou **créer un
  compte** (email, nom). La création rend le lien d'initialisation (pas de
  système d'email) : affiché une fois, copiable, jamais journalisé ni conservé
  après fermeture — même règle que le lot 6, T6.
- **Fiche utilisateur** (clic sur la ligne) : tous les espaces en cases à
  cocher, espace actif, suppression du compte. C'est là qu'on règle un planner
  multi-espaces, en un seul endroit.
- Retirer un membre de son espace actif : la confirmation le dit (« il
  basculera sur BMW GROUP » ou « il ne verra plus que le socle »).

### 4.4 Onglet Données

Tous les jeux de données, un statut par jeu POUR CET ESPACE :

| Statut | Signification | Action |
|---|---|---|
| **Propriétaire** | jeu privé de cet espace | Transférer à un autre espace · Mettre au socle |
| **Partagé** | jeu privé d'un autre espace, ouvert à celui-ci | Retirer le partage |
| **Socle** | visible de tous | aucune ici (cadenas) — se règle dans « Socle MAGELIAN » |
| **Non visible** | jeu privé d'un autre espace | Partager avec cet espace |

Chaque ligne : nom, type (POI / panneaux / carreaux), catégorie, nombre de
lignes (`data_sources.valid_count` — jamais un `COUNT` sur `poi_france`, § 7).
Tri : propriétaire, partagé, socle, non visible.

Le partage et le retrait passent par les routes existantes
(`…/sources/assign`) ; le transfert et le socle par
`PATCH /api/admin/sources/[id]` (`organization_id`, `visibilite`), qui recopie
déjà l'organisation sur les POI et panneaux.

### 4.5 Onglet Aperçu — « ce que voit cet espace »

Calculé par **la même règle que les routes** (`getOrgSourceIds` sur une
session simulée de cet espace), pas par une logique d'affichage parallèle :
- catégories de POI visibles (`getCategoriesVisibles`) avec leur nombre ;
- jeux de données visibles, par niveau ;
- zones personnalisées, jeux de zones et campagnes de l'espace (comptes).

C'est la vérification qui manque aujourd'hui : on voit d'un coup d'œil que la
Marine ne voit pas « bmw », sans créer de compte de test. Si l'aperçu et la
règle divergeaient, l'aperçu mentirait : il APPELLE la règle, il ne la recopie
pas.

### 4.6 Onglet Réglages

Les champs de configuration d'une organisation, qui n'auraient sinon plus
d'écran : nom, description, actif / inactif, quota de POI, quota de requêtes
IA, connexion Site Centric (URL, clé). Mêmes routes que React
(`PATCH /api/admin/organizations/[id]`).

Le quota IA disparaîtra avec la suppression de l'IA (chantier en attente) : le
garder tant que la colonne est lue.

## 5. API

### 5.1 Réutilisées telles quelles

`GET/POST /api/admin/organizations`, `GET/PATCH /api/admin/organizations/[id]`,
`POST/PATCH/DELETE /api/admin/organizations/[id]/members`,
`POST …/members/reset-password`, `POST/DELETE …/sources/assign`,
`GET/POST /api/admin/users`, `PATCH/DELETE /api/admin/users/[id]`,
`PATCH /api/admin/sources/[id]`.

À vérifier à l'implémentation (et corriger si besoin) : que `…/members` écrit
bien `organization_members`, et que chaque écriture lit son erreur — le lot 6
a relevé six `await adminFetch` React sans lecture de réponse.

### 5.2 Nouvelles

| Route | Rend | Pourquoi |
|---|---|---|
| `GET /api/admin/espaces` | les espaces + compteurs (membres, jeux possédés) + l'entrée socle | une lecture pour la colonne, au lieu de N |
| `GET /api/admin/espaces/[id]/donnees` | chaque jeu avec son statut pour cet espace | le statut se calcule côté serveur, avec la règle, pas dans l'écran |
| `GET /api/admin/espaces/[id]/apercu` | l'aperçu du § 4.5 | appelle `getOrgSourceIds` / `getCategoriesVisibles` |
| `PUT /api/admin/users/[id]/espaces` | remplace la liste des espaces d'un utilisateur | la fiche utilisateur coche plusieurs cases en une fois |

Toutes : `requireAdmin`, `force-dynamic`, validation Zod, `lireCorps`, réponses
bornées (quelques dizaines de lignes — aucune troncature PostgREST possible,
le noter dans chaque route).

## 6. Ce qui change ailleurs

- **Lot 6** : les tâches T6 (Users), T7 (Organisations) et T8 (Organisation —
  détail) sont REMPLACÉES par cette page. Le partage disparaît du détail d'une
  source (T18) au profit d'un lien « Gérer les droits → Espaces de travail ».
- **React** : les pages `/admin/users`, `/admin/organizations` et leur détail
  restent en place, gelées (règle du lot 6 : on ne retire rien côté React). Un
  bandeau y renvoie vers la page Angular.
- **Navigation Angular** : « Espaces de travail » remplace « Users » et
  « Organisations ».

## 7. Contraintes

- **I/O** : aucun `COUNT` sur `poi_france` (390 000 lignes) — les effectifs
  viennent de `data_sources.valid_count`. L'aperçu lit au plus une catégorie
  par requête (leapfrog existant). Au plus 3 appels simultanés à l'ouverture
  d'une fiche.
- **Angular** : primitives du socle lot 6 (`mg-confirmation`, `mg-notifications`,
  `<dialog>` natif), jetons de couleur uniquement, deux thèmes, contrat AIDA,
  skill `porting-react-to-angular` pour ce qui est repris de React.
- **Design** : dark minimal, sentence case, bandeaux de section avec point teal.

## 8. Preuves attendues

- Specs Angular par composant (montage, lectures, écritures au corps exact,
  erreurs notifiées).
- Tests d'intégration des quatre routes nouvelles contre la base locale, dont
  l'aperçu : **il doit rendre exactement ce que les routes rendent** pour un
  vrai compte de l'espace (même jeu de comptes que
  `tests/integration/cloisonnement-rls.test.ts`).
- Test de l'invariant d'appartenance (sql/236) : un `UPDATE profiles` vers un
  espace non membre est refusé.
- Navigateur, deux thèmes : un espace jetable `[ESSAI] …` créé, un membre
  ajouté, un jeu partagé puis retiré, un jeu mis au socle puis retiré, l'aperçu
  qui change en conséquence — puis tout supprimé, SQL de contrôle.

## 9. Questions ouvertes

| # | Question | Proposition |
|---|---|---|
| Q1 | Renommer « GENESIS (Global) » à l'affichage ? | **Tranché 2026-10-08 : oui**, « dentsu.explore (interne) » à l'affichage seulement, sans toucher la base |
| Q2 | Les trois comptes super_admin sont-ils tous voulus ? | **Tranché 2026-10-08 :** `vincent.sidoli@gmail.com` était un compte de test — supprimé (base locale, il ne possédait aucune donnée). Restent deux super_admin. |

## 10. Hors champ

- Mode « voir comme » en navigation réelle (se connecter dans la peau d'un
  client) : l'onglet Aperçu en tient lieu.
- Droits par module (D3).
- Identifiant de POI incluant l'organisation : jugé sans gravité (imports
  faits par MAGELIAN seule).
- Interface « Vos données / Données MAGELIAN » côté carte : chantier distinct.
