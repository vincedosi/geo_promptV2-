# Spec — Suppression du portfolio : campagnes 100 % overlay carte

> Date : 2026-07-09
> Statut : validé (Vincent) — périmètre A + B + C
> Contexte : trois portes d'entrée concurrentes pour les campagnes rendent l'app illisible.
> Décision : la gestion de campagne vit UNIQUEMENT dans l'overlay MAGELIAN de `/map`.

## Objectif

1. **A — Supprimer le portfolio** : pages `/campaigns` et `/campaigns/[id]` retirées, tout accès campagne passe par l'overlay MAGELIAN (onglets Création / Suivi / Aperçu).
2. **B — Nettoyer le panneau Réglages** de la carte : retirer la section « Navigation » (doublon de la sidebar).
3. **C — Bouton Ajuster toujours visible** dans l'Aperçu : actif si stratégie ML active + campagne en cours, sinon désactivé avec une explication.

## A — Suppression du portfolio

### Fichiers supprimés

- `app/campaigns/page.tsx` (liste portfolio)
- `app/campaigns/_components/CampaignPortfolioCard.tsx`
- `app/campaigns/_components/PortfolioToolbar.tsx`
- `app/campaigns/[id]/page.tsx` (page cockpit plein écran)

### Fichiers déplacés (l'overlay en dépend — PAS supprimés)

Déplacés de `app/campaigns/[id]/_components/` vers `components/campaign/wizard/` :

- `FilAriane.tsx`
- `StepMemo.tsx`
- `steps/StepBudget.tsx`, `steps/StepCanaux.tsx`, `steps/StepCible.tsx`, `steps/StepLancement.tsx`, `steps/StepStrategie.tsx`, `steps/types.ts`, `steps/ui.tsx`

Imports mis à jour dans `components/campaign/CampaignCockpit.tsx` (7 imports `@/app/campaigns/[id]/_components/*` → `@/components/campaign/wizard/*`).

### `CampaignImportDialog.tsx` — supprimé

Vérifié : son seul appelant est `app/campaigns/page.tsx`. L'import de campagne reste
accessible via `/admin/campaigns` (page + route admin existantes, inchangées).

### Deep-link overlay (nouveau)

`MagelianOverlayContext` étendu :

```ts
openOverlay(options?: { campaignId?: string; tab?: 'creation' | 'suivi' | 'apercu' })
```

`/map` lit les query params `?campaign=<id>&tab=<tab>` au montage (dans le composant
client qui possède déjà le contexte) et ouvre l'overlay pré-positionné, puis nettoie
l'URL (`router.replace('/map')`). Aucune requête DB supplémentaire : la liste des
campagnes est déjà chargée par l'overlay, le param ne fait que pré-sélectionner.

### Références `/campaigns` rebranchées

| Fichier | Avant | Après |
|---|---|---|
| `app/page.tsx` | `redirect('/campaigns')` | `redirect('/map')` |
| `components/AppSidebar.tsx:46` | section « Campagnes » → lien Portfolio `/campaigns` | l'unique item devient « Gestion campagnes » → `/map?tab=suivi` (ouvre l'overlay via le deep-link) |
| `components/layout/PillarSwitch.tsx` | toggle Campagnes ↔ Carte | composant supprimé + retrait dans `TopRightChrome.tsx` |
| `components/map/overlays/SettingsOverlay.tsx:48` | lien Campagnes | supprimé (voir B) |
| `components/campaign/CampaignCockpit.tsx:176` | `router.push('/campaigns')` après suppression | ferme l'overlay (`closeOverlay()`) — en mode embedded uniquement désormais |
| `components/campaign/CampaignOverview.tsx:72,87,154` | `router.push('/campaigns')` | ferme l'overlay / reste sur `/map` ; le bouton « ← Campagnes DSP » (non-embedded) disparaît avec la page |
| `app/custom-bidding/page.tsx` | `redirect('/campaigns')` | `redirect('/map')` |
| `app/custom-bidding/[strategyId]/page.tsx` | `router.replace('/campaigns/<cid>')` | `router.replace('/map?campaign=<cid>&tab=apercu')` |
| `app/demo/pilote/page.tsx` | `redirect('/campaigns/dede…0001')` | `redirect('/map?campaign=dede…0001&tab=suivi')` |
| `app/admin/sources/page.tsx:2390` | `<Link href="/campaigns/${id}">` | `<Link href="/map?campaign=${id}&tab=apercu">` |
| `app/map/analyse/digital/_components/CustomBiddingBar.tsx:108` | `router.push('/campaigns/<id>')` | `router.push('/map?campaign=<id>&tab=apercu')` |

`CampaignOverview`/`CampaignCockpit` : les branches `!embedded` (header pleine page,
bouton retour) deviennent du code mort une fois la page supprimée — elles sont retirées
et la prop `embedded` supprimée (toujours true).

## B — Panneau Réglages = back office admin (`SettingsOverlay.tsx`)

> Vision (Vincent, 09/07) : le mediaplanner travaille dans les overlays de la carte ;
> l'admin gère le reste depuis l'onglet config/Réglages. Droits par rôle (user / admin /
> super admin) à venir — hors périmètre ici.

Conservé : Fond de carte · Vues sauvegardées · Capturer zone custom · Apparence (thème).

La section « Navigation » est renommée **« Back office »** et recentrée sur l'admin :

- Organisations (workspaces) → `/admin/organizations`
- Utilisateurs → `/admin/users`
- Import POI → `/admin/import`
- Import Shapefile → `/admin/carreaux-import`
- Import OOH → `/admin/ooh-import`
- IRIS crawler → `/dashboard/iris-crawler`
- Radio FM/DAB+ → `/admin/radio`
- Connexions API → `/admin/api`
- Sources → `/admin/sources`
- Imports (historique) → `/admin/imports`
- Health check → `/admin/health`

Retirés de la liste : « Dashboard » et « Campagnes » (le portfolio disparaît ; les
campagnes vivent dans l'overlay MAGELIAN). Le lien « Zones custom » sort de cette
section (métier, pas admin) et reste accessible via la sidebar / rail Zones.

## C — Bouton Ajuster toujours visible (Aperçu)

`components/campaign/CampaignOverview.tsx:182` — remplacement de la condition :

- **Avant** : bouton rendu seulement si `strategyId && strategyStatus === 'active' && status === 'en_cours'`.
- **Après** : bouton rendu dès que `status === 'en_cours'` ; désactivé (`disabled`) si pas
  de stratégie active, avec `title` : « Lance d'abord une stratégie de pilotage (onglet
  Création) pour pouvoir ajuster la campagne. » Le style disabled suit le DESIGN_SYSTEM
  (outline neutre, texte tertiaire).
- Aucune modification de la route `/api/bidding/strategies/[id]/adjust` (elle exige une
  stratégie — le bouton désactivé empêche l'appel).

## Ce qui ne change PAS

- Les composants `CampaignCockpit` / `CampaignOverview` / `CampaignSuivi` / `AdjustPanel` (logique métier intacte, seule la plomberie navigation/embedded change).
- Les routes API (`/api/admin/campaigns/*`, `/api/digital/*`, `/api/bidding/*`).
- `/admin/campaigns` (import + gestion admin).
- La page `/map` elle-même (rail, overlays Terrain/Audience/Analyses/Pilotage/Zones).
- Le fichier `middleware.ts` et les fichiers protégés (CLAUDE.md).

## Impact I/O Supabase

Nul : suppression de pages et de liens, aucun nouveau fetch. Le deep-link réutilise la
liste de campagnes déjà chargée par l'overlay.

## Tests & vérification

- `npx tsc --noEmit` — 0 erreur (aucun import `@/app/campaigns/*` restant).
- `npm test` — les tests existants passent (wizard steps déplacés : mise à jour des chemins d'import dans les tests le cas échéant).
- `grep -rn "/campaigns" app/ components/ lib/` — ne renvoie plus que `/admin/campaigns` et les routes API.
- Vérif navigateur : `/` → `/map` ; overlay MAGELIAN → 3 onglets fonctionnels ; deep-link `/map?campaign=<id>&tab=apercu` ; bouton Ajuster visible désactivé sur campagne sans stratégie, actif sur la démo pilotage ; Réglages sans section Navigation.
