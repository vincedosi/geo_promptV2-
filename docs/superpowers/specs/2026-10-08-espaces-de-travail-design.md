# Espaces de travail — une seule page pour administrer les droits

> Spécification validée dans son principe par Vincent le 2026-10-08.
> **Statut : livrée le 2026-10-09** (branche `feat/espaces-de-travail`, non mergée) ; écarts consignés en fin de document, section « Écarts à la livraison ».
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
| `GET /api/admin/espaces/socle` | tous les jeux (sans statut) + le nombre d'espaces clients | la fiche Socle dit « combien d'espaces perdent ce jeu » sans le recalculer dans l'écran |
| `GET /api/admin/espaces/[id]/membres` | les membres de l'espace avec leurs AUTRES espaces | les pastilles de la fiche, sans que l'écran croise appartenances et espaces |
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

## 11. Écarts à la livraison

| # | Écart | Raison |
|---|---|---|
| E2 | **Libellés : « Socle dentsu.explore »** (et non « Socle MAGELIAN » comme au § 4.2) et **« dentsu.explore (interne) »** pour `genesis-global`. Le nom affiché est calculé côté serveur, à un seul endroit (`lib/espaces/nom-espace.ts`). | MAGELIAN ne s'écrit plus dans aucun texte visible (renommage du 2026-10-08). |
| E4 | **Aperçu sans effectif par catégorie** (catégories listées sans nombre de POI ; les effectifs sont ceux des jeux, `data_sources.valid_count`) et **sans zones personnalisées ni jeux de zones** : `custom_geo_zones` et `zone_sets` n'ont pas d'`organization_id` (rattachées à `created_by`), les compter « par espace » serait inventer une règle que les routes n'appliquent pas. Les campagnes (`dsp_campaigns.organization_id`) sont gardées. | § 7 : aucun `COUNT` sur `poi_france` ; et l'aperçu doit appeler la règle des routes, pas en écrire une. |
| — | **sql/237 : un compte neuf naît sans espace.** Le déclencheur `on_auth_user_created` manquait en local et l'ancienne `handle_new_user` posait l'espace interne comme actif sans appartenance, ce que sql/236 refuse. | Création de compte inopérante sinon (500). Pas d'appartenance automatique à l'espace interne. |
| — | **L'espace interne ne se supprime pas, même par appel direct** : `DELETE /api/admin/organizations/[id]` rend 409 (avant : 500 par clé étrangère). Son interrupteur « actif » n'est pas offert non plus. | Il porte les données du socle. |
| — | **Après une écriture échouée, l'onglet Données relit.** | `PATCH admin/sources/[id]` n'est pas atomique : un 500 peut suivre un transfert de propriété réel. |
| — | **`POST …/members` ignore le rôle quand la cible est déjà super_admin.** Son rôle se change par `PATCH /api/admin/users/[id]`. | React envoie toujours un rôle ; sans cela, ajouter un super_admin à un espace le rétrogradait. |

| — | **La page s'appelle « Accès »** (2026-10-10, décision de Vincent) : titre, colonne, barre latérale et panneau Réglages de la carte. Route `admin/acces` ; `admin/espaces/**` redirige. Le mot « espace » reste le nom d'un client ; les noms internes (`espaces/`, `EspacesApi`, `mg-…`) ne changent pas. | C'est LA page unique des droits : comptes, espaces, données visibles. L'admin doit tenir en trois pages (Accès, Données, Système). |
| — | **Vue « Tous les comptes »** (`admin/acces/comptes`, `GET /api/admin/espaces/comptes`) : tous les comptes regroupés comme la page React Users (Super admins, un groupe par espace actif, « Sans espace » en dernier), filtre local, fiche utilisateur ouverte SANS espace courant, « Créer un compte » (rôle Client ou Super admin, espace obligatoire pour un client). Ajout d'un groupe « Aucun espace actif » pour un membre d'au moins un espace sans espace actif (sql/236 l'autorise) : le ranger « Sans espace » serait faux. | Un compte rattaché à aucun espace (super_admin créé sans espace, membre retiré de son dernier espace) était invisible dans Angular : préalable à la suppression de `/admin/users` (T2). |
| — | **Rôles en badge du design system**, sans les couleurs rouge/orange/bleu de React (`ROLE_COLORS`). | Ces couleurs sortent de la charte (DESIGN_SYSTEM § 3 : la couleur vive est réservée au statut et au teal). |
| — | **Les pages React des droits sont SUPPRIMÉES** (2026-10-10, décision de Vincent, contre le § 6 « restent en place, gelées ») : `/admin/users`, `/admin/organizations`, `/admin/organizations/[id]`, le bandeau `components/admin/BandeauEspaces.tsx` et la route `/api/admin/roles` (seul appelant : la page Users). Les routes API `/api/admin/users/**`, `/api/admin/organizations/**`, `/api/admin/sources/**`, `/api/admin/espaces/**` restent : la page Accès les appelle. La barre latérale React, le panneau Réglages de la carte React et le tableau de bord portent une entrée « Accès » vers `${NEXT_PUBLIC_URL_ANGULAR}/admin/acces`, absente sans la variable. Le détail d'une source (`/admin/sources`) ne modifie plus ni le propriétaire ni les partages : une ligne « Propriétaire et partages : page Accès » les remplace. | La page Accès couvre désormais tout ce que ces pages faisaient (vue « Tous les comptes ») ; l'admin doit tenir en trois pages, et deux écrans qui écrivent les mêmes droits finissent par diverger. |
| — | **« Lien de mot de passe » dans la fiche utilisateur** (2026-10-10), pour TOUT compte, avec ou sans espace : `POST /api/admin/users/[id]/lien-mot-de-passe` (par identifiant de compte), lien affiché dans le même `mg-dialogue-lien` que l'onglet Membres. Le `redirectTo` des trois routes de lien est construit à un seul endroit (`lib/espaces/lien-mot-de-passe.ts`), et la liste blanche de l'auth locale autorise enfin `/reset-password`. | Un super_admin créé sans espace n'avait aucun moyen d'obtenir un lien (la route de l'onglet Membres est liée à un espace) ; et en local le lien menait à la racine (GoTrue remplaçait le `redirectTo` hors liste blanche par `site_url`). |
| — | **Le badge de session affiche « dentsu.explore (interne) »** (2026-10-10) : `GET /api/user/organizations` applique `nomAffiche` (E2) dans ses deux branches, super_admin et membre ; React et Angular en profitent sans changement de leur côté. | Le badge montrait « GENESIS (Global) », nom abandonné (DESIGN_SYSTEM § 1). |
| — | **Finitions de relecture** (2026-10-10) : dans « Tous les comptes », le nom est un vrai bouton (Entrée et Espace) et la ligne n'est plus focalisable ; l'email ne passe plus à la ligne ; survol des CTA blancs de création par `--cta-hover` ; focus rendu au bouton « Lien de mot de passe » à la fermeture de son dialogue ; `lienPageAcces` refuse une base qui n'est pas `http(s)://`. | Constats des relectures de T1 et T2. |
