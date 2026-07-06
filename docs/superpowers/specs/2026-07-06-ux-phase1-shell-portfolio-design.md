# New Magelian UX — Phase 1 : shell 2-piliers + home portfolio — Design

> Sous-projet 1/4 du rethink UX (voir vision globale ci-dessous). Repositionnement : d'un outil
> map-first vers un produit de **pilotage de campagne**. Date : 2026-07-06.
> Branche : `feat/ux-phase1-shell-portfolio`.

## Vision globale (contexte, validée avec Vincent 2026-07-06)

Deux publics, deux piliers dans un shell unique :
- **Carte** (tout le monde) — géo-intelligence + fabrique de zones. Reste first-class (= l'actuel `/map`).
- **Campagnes** (trader) — le cockpit de la boucle de pilotage (plan → délivrance → pacing → optimisation → bilan).

Le copilote **geo.prompt** est le fil conducteur (déjà persistant dans le layout). Décomposition en 4 phases,
chacune son cycle spec→plan→build :
1. **Shell 2-piliers + home portfolio** ← CE SPEC.
2. Workspace cockpit campagne (consolide `/demo/pilote`, `/custom-bidding`, `/admin/campaigns`, `/map/analyse/digital`).
3. geo.prompt copilote persistant cross-piliers (enrichir l'existant).
4. Nettoyage Carte (Layer Manager simplifié).

Le **point 2 (campagne nationale avec renfort / locale)** se logera dans la phase Plan du cockpit (Phase 2).

---

## Goal (Phase 1)

Poser la **nouvelle architecture d'information** : un shell avec navigation à 2 piliers (Carte | Campagnes),
et une **home portfolio de campagnes** — cartes avec statut de cycle de vie + signal d'attention en direct —
qui devient le point d'entrée du produit. Réutilise 100 % des données/logiques existantes ; aucun nouveau
backend. Ne touche PAS à la carte elle-même ni au détail campagne (phases suivantes).

## Périmètre Phase 1 (précis)

**DANS :**
1. **Switch de piliers** `Carte | Campagnes` dans le chrome haut-droit (`TopRightChrome`) — présent sur TOUTES les pages (y compris `/map` plein écran), pour toujours pouvoir changer de pilier.
2. **Nav sidebar refondue** (`AppSidebar`) : structure 2-piliers au lieu de « Analyse/Administration/API/Système ».
3. **Home portfolio** `/campaigns` : liste des campagnes en cartes avec statut + attention, filtres/tri, CTA « Créer une campagne ».
4. **REMPLACEMENT de l'ancienne UI campagne** (décision Vincent : « enlève l'old, remplace par ça, gaffe à la dette ») — voir section Migration : extraire l'import, relocaliser le détail sous `/campaigns/[id]`, supprimer l'ancienne page liste `app/admin/campaigns/page.tsx`, repointer tous les liens. **Aucune feature perdue, aucun code orphelin, namespace UI unifié `/campaigns/*`.**
5. **Redirection racine** : `/` → `/campaigns` (nouvelle home par défaut).

**HORS (phases suivantes) :**
- **Refonte** du contenu du détail campagne en cockpit à phases (Phase 2). En Phase 1 le détail est **relocalisé tel quel** sous `/campaigns/[id]` (déplacement, pas réécriture) ; Phase 2 le reconstruira en place.
- Refonte de la carte / IconBar (Phase 4).
- Landing par rôle (nécessite une notion de persona « trader » absente en base — voir Décisions).
- Backend : les routes `/api/admin/campaigns/*` restent inchangées (seul le namespace UI bouge).

## Décisions de cadrage

| Sujet | Choix Phase 1 |
|-------|---------------|
| Landing par rôle | **Différé** : `/` → `/campaigns` pour tous (le switch de piliers couvre le besoin 2-publics). La notion « trader » n'existe pas comme rôle DB (`profiles.role` = super_admin/admin/client) ; le landing conditionnel viendra quand un persona sera défini. |
| Ancienne UI campagne | **Remplacée** (pas conservée en parallèle). Détail relocalisé `/admin/campaigns/[id]` → `/campaigns/[id]` ; import extrait ; ancienne liste supprimée. Les cartes du portfolio pointent vers `/campaigns/[id]`. |
| Statut affiché sur les cartes | **Cycle de vie** (à venir/en cours/en pause/terminée/archivée) via `effectiveCampaignStatus` + un **badge « attention »** si `campaignNeedsAttention` (en cours + données périmées). PAS la convergence pacing par campagne (= N appels RPC, contrainte Nano) → réservée au cockpit. |
| Carte | Inchangée (`/map`), juste atteignable via le switch. |

## Migration & dette technique (décision « remplacer, ne pas dupliquer »)

L'ancienne page `app/admin/campaigns/page.tsx` bundle 5 fonctions. Chacune a un foyer précis en Phase 1 — **rien n'est perdu, rien n'est laissé orphelin** :

| Fonction de l'ancienne page | Destination Phase 1 |
|-----------------------------|---------------------|
| Liste des campagnes | → **remplacée** par la home portfolio `/campaigns`. |
| Modal d'import (preview + SSE) | → **extraite** en composant réutilisable `app/campaigns/_components/CampaignImportDialog.tsx` (logique verbatim : `/preview`, `/import`, lecture du flux SSE), montée dans `/campaigns` via le CTA « Créer une campagne ». |
| Ops bulk admin (`populate-postal`, `match-iris` global) | → menu overflow « ⋯ » du header portfolio (visible admin), mêmes appels API. |
| Liaison orgs ↔ campagne | → déplacée dans le détail relocalisé `/campaigns/[id]` (c'est du per-campagne, sa vraie place). |
| Suppression campagne | → action sur la carte portfolio + dans le détail (appels `DELETE /api/admin/campaigns/[id]` inchangés). |

**Relocalisation du détail** : `app/admin/campaigns/[id]/page.tsx` → `app/campaigns/[id]/page.tsx` (déplacement du fichier ; corriger ses back-links internes `router.push('/admin/campaigns')` → `/campaigns`). Contenu inchangé (Phase 2 le reconstruira en cockpit).

**Liens à repointer** (`/admin/campaigns[/id]` → `/campaigns[/id]`, sinon liens cassés = dette) :
- `app/admin/sources/page.tsx` (Link détail campagne l.2390)
- `components/map/overlays/SettingsOverlay.tsx` (nav l.48)
- `components/AppSidebar.tsx` (traité par la nav refondue)
- `lib/dsp-mapping/loader.ts` (commentaire l.91 → mentionner `/campaigns`)

**Suppression** : `app/admin/campaigns/page.tsx` retirée (git en garde l'historique). Les routes API `/api/admin/campaigns/*` **restent** (backend, appelées par le détail relocalisé, KpiSelector, useSelectedMetric, sources — inchangées).

**Vérif anti-dette** : après migration, `grep -rn "/admin/campaigns" app/ components/ lib/` ne doit renvoyer que des chemins `/api/admin/campaigns/*` (backend) — zéro lien UI mort ; `npx tsc` 0 ; `next build` OK.

## Global Constraints

- **Design System MAGELIAN** (dark minimal) : couleurs via `var(--token)` uniquement, accent `var(--brand-teal)`, statut via `STATUS_META[status].colorVar` de `@/lib/campaigns/status`, fonts Inter (UI) / JetBrains Mono (données), sentence case, flat. Respecter `DESIGN_SYSTEM.md`.
- **Supabase Nano** : la home consomme `GET /api/admin/campaigns` (déjà borné, 1 requête + RPC agrégées existantes). AUCUN appel pacing par campagne. Aucun nouvel accès DB.
- **TypeScript strict**, imports absolus `@/`.
- Ne pas modifier les fichiers protégés (`middleware.ts` etc.). `/campaigns` doit être protégé (ajout au matcher/prefixes middleware — modif explicite autorisée car nouvelle route).
- Réutiliser : `lib/campaigns/status.ts` (`effectiveCampaignStatus`, `campaignNeedsAttention`, `STATUS_META`), `components/campaigns/CampaignStatusBadge`, `GET /api/admin/campaigns`, `TopRightChrome`, `AppSidebar`, `ThemeProvider`, `geo-toast`.
- **Supersède** `geomatik-product-vision` au niveau IA (map-first Layer Manager → devient l'organisation INTERNE du pilier Carte en Phase 4, plus le cadre global).

## Architecture

```
components/layout/PillarSwitch.tsx   (nouveau) — segmented « Carte | Campagnes », déduit le pilier actif de usePathname, navigue vers /map ou /campaigns
components/layout/TopRightChrome.tsx (modifié) — monte <PillarSwitch/> à gauche du bloc org/thème/user
components/AppSidebar.tsx            (modifié) — navItems refondus : pilier « Campagnes » (Portfolio) + « Carte » (Explorer, Zones custom) + Admin/Système conservés. Masquée sur /map (inchangé).
app/campaigns/page.tsx               (nouveau) — home portfolio (client), fetch /api/admin/campaigns via adminFetch ; monte CampaignImportDialog + menu overflow admin
app/campaigns/_components/CampaignPortfolioCard.tsx (nouveau) — carte campagne (→ /campaigns/[id])
app/campaigns/_components/PortfolioToolbar.tsx      (nouveau) — recherche + filtres statut + tri + « ⋯ » (ops bulk admin) + CTA Créer
app/campaigns/_components/CampaignImportDialog.tsx  (nouveau) — modal d'import EXTRAITE de l'ancienne page (preview + SSE, logique verbatim)
app/campaigns/[id]/page.tsx          (déplacé depuis app/admin/campaigns/[id]/page.tsx) — détail relocalisé, back-links → /campaigns (contenu inchangé, cockpit = Phase 2) + accueille la liaison orgs
app/admin/campaigns/page.tsx         (SUPPRIMÉ) — ancienne liste+import, remplacée
app/admin/campaigns/[id]/page.tsx    (SUPPRIMÉ après déplacement)
app/admin/sources/page.tsx           (modifié) — Link détail → /campaigns/[id]
components/map/overlays/SettingsOverlay.tsx (modifié) — nav → /campaigns
lib/dsp-mapping/loader.ts            (modifié) — commentaire → /campaigns
app/page.tsx                         (modifié) — redirect() vers /campaigns
middleware.ts                        (modifié) — /campaigns aux pages protégées + matcher (l'ancien /admin/campaigns reste couvert par le préfixe /admin)
```

### PillarSwitch
`'use client'`. Deux segments `Carte` (→ `/map`) et `Campagnes` (→ `/campaigns`). Actif = `pathname.startsWith('/map')` → Carte, sinon (`/campaigns`, `/admin/campaigns`, `/dashboard`…) → Campagnes. Style segmented control DESIGN_SYSTEM (fond `var(--elevated)`, segment actif `var(--brand-teal)` texte `var(--background)` ou souligné teal). Navigation via `next/link` / `router.push`.

### AppSidebar (nav refondue)
Nouvelle `navItems` :
- **Campagnes** : `Portfolio` (`/campaigns`), `Import DSP` (`/admin/campaigns` — jusqu'à la Phase 2 qui déplacera l'import dans le cockpit).
- **Carte** : `Explorer` (`/map`), `Zones custom` (`/map/custom-geo`).
- **Administration** : imports (Shapefile/POI/OOH/IRIS), Radio, Connexions API — inchangé.
- **Système** : Sources, Users, Organisations, Imports, Health — inchangé.
Les libellés « geo.prompt »/« Digital »/« Analyse » disparaissent (framing obsolète). Comportement masquage sur `/map` inchangé.

### Home portfolio `/campaigns`
`'use client'`. Au montage : `adminFetch('/api/admin/campaigns')` → `Campaign[]` (forme de la route : `{ id, name, dsp_source, date_start, date_end, status_override, is_demo, organization_name, organizations_linked, total_rows, france_rows, matched_iris, last_data_date, created_at }`).
- Calcule pour chaque campagne : `status = effectiveCampaignStatus({date_start, date_end, status_override}, today)` et `attention = campaignNeedsAttention({status, last_data_date}, today)` (`today` = date locale ISO `YYYY-MM-DD`).
- **Toolbar** : recherche par nom, filtres par statut (chips), tri (récent / nom / statut). État local.
- **Grille de cartes** `CampaignPortfolioCard`. État vide : « Aucune campagne — importez un export DSP » + CTA vers `/admin/campaigns`.
- Header page : titre « Campagnes », CTA « Créer une campagne » (→ `/admin/campaigns`, ouvre l'import).

### CampaignPortfolioCard
Props `{ campaign }`. Affiche : nom, `organization_name`, badge `dsp_source`, `<CampaignStatusBadge status={status} />`, **dot d'attention** `var(--warning)` si `attention` (tooltip « données en retard »), badge « démo » si `is_demo`, période `date_start → date_end`, 1-2 KPI (`total_rows` lignes, `matched_iris`/`france_rows` %). Carte cliquable → `/admin/campaigns/${id}`. Style card DESIGN_SYSTEM (`var(--card)`, border `var(--border-subtle)`, hover border teal).

## Data flow

```
/ → redirect → /campaigns
/campaigns monte → adminFetch(/api/admin/campaigns) → Campaign[]
  → map: status + attention (fonctions pures status.ts)
  → toolbar filtre/trie en mémoire → grille CampaignPortfolioCard
PillarSwitch (chrome, toutes pages) → /map ↔ /campaigns
```

## Error handling
- Fetch échoue → état d'erreur dans la page (« Impossible de charger les campagnes ») + retry.
- Liste vide → état vide + CTA import.
- `date_start`/`date_end` null → `effectiveCampaignStatus` gère (retourne `en_cours` par défaut, déjà testé).

## Tests
- `lib/campaigns/status.ts` est déjà couvert (tests existants) — pas de nouvelle logique pure à tester.
- **Vérif navigateur** (Playwright authentifié) : `/` redirige vers `/campaigns` ; la home liste les campagnes avec badges de statut ; le PillarSwitch bascule vers `/map` et revient ; filtres/tri fonctionnent ; une carte ouvre `/admin/campaigns/[id]`. tsc 0, build OK.
- Pas de test unitaire UI (composants présentational) — couverts par la vérif navigateur.

## Découpage (pour writing-plans)
1. **Relocaliser le détail** : déplacer `app/admin/campaigns/[id]/page.tsx` → `app/campaigns/[id]/page.tsx`, corriger ses back-links (`/admin/campaigns` → `/campaigns`), y intégrer la liaison orgs. tsc.
2. **Extraire l'import** : `CampaignImportDialog` depuis l'ancienne page (preview + SSE verbatim). tsc.
3. **Home portfolio** : `/campaigns/page.tsx` + `CampaignPortfolioCard` + `PortfolioToolbar` (fetch `/api/admin/campaigns`, statut via status.ts, filtres/tri, monte `CampaignImportDialog`, menu ⋯ ops bulk admin).
4. **Supprimer l'ancien** : retirer `app/admin/campaigns/page.tsx` + `app/admin/campaigns/[id]/page.tsx` ; repointer les liens (`sources`, `SettingsOverlay`, `loader.ts` commentaire). Vérif anti-dette (grep). tsc.
5. **Shell** : `PillarSwitch` + montage `TopRightChrome` ; `AppSidebar` nav 2-piliers ; `/` redirect ; `/campaigns` au middleware.
6. **Vérif** : navigateur (redirect, portfolio, switch, import, détail, filtres) + tsc + `next build` + grep anti-dette.

## Hors scope (rappel)
Refonte du détail en cockpit à phases (Phase 2 — le détail est seulement relocalisé ici), refonte carte (Phase 4), landing par rôle, nouveau backend, convergence pacing par carte de portfolio.
