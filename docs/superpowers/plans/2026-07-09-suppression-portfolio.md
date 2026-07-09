# Suppression portfolio — campagnes 100 % overlay carte — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Supprimer les pages `/campaigns` et `/campaigns/[id]` ; toute la gestion de campagne passe par l'overlay MAGELIAN de `/map`, avec deep-link `?campaign=<id>&tab=<tab>` ; le panneau Réglages devient le back office admin ; le bouton Ajuster est toujours visible (désactivé avec explication si pas de stratégie active).

**Architecture:** Les composants métier (`CampaignCockpit`/`CampaignOverview`/`CampaignSuivi`) ne changent pas de logique — seule la plomberie navigation change. Les composants du wizard migrent de `app/campaigns/[id]/_components/` vers `components/campaign/wizard/`. Un deep-link léger (query params lus côté client, zéro fetch supplémentaire) remplace les URLs `/campaigns/[id]`.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Vitest. Aucune dépendance nouvelle.

## Global Constraints

- Spec : `docs/superpowers/specs/2026-07-09-suppression-portfolio-design.md`
- CLAUDE.md : ne PAS toucher `middleware.ts`, `app/api/isochrone-battle/route.ts`, fonctions PostGIS battle.
- Aucune route API modifiée. Aucun nouveau fetch (contrainte Supabase Nano).
- Design system : pas de hex en dur — tokens `var(--…)` uniquement ; sentence case.
- Commits atomiques `type: description`.
- `app/custom-bidding/[strategyId]/_components/` reste EN PLACE (utilisé par `PilotageOverlay` et `CampaignSuivi`) — seule la page `page.tsx` change de cible de redirect.
- Après chaque tâche : `npx tsc --noEmit` doit rendre 0 erreur.

---

### Task 1: Deep-link overlay MAGELIAN (`?campaign=&tab=`)

**Files:**
- Create: `components/magelian/deep-link.ts`
- Create: `components/magelian/MagelianDeepLink.tsx`
- Modify: `components/magelian/MagelianOverlayContext.tsx`
- Modify: `components/magelian/MagelianOverlay.tsx` (lignes 22, 42, 69–94)
- Modify: `app/layout.tsx` (monter `<MagelianDeepLink />` à côté de `<MagelianOverlay />`)
- Test: `tests/unit/magelian-deep-link.test.ts`

**Interfaces:**
- Consumes: `useMagelianOverlay()` existant.
- Produces: `openOverlay(options?: { campaignId?: string; tab?: MagelianTab })` et `parseMagelianParams(params: URLSearchParams): MagelianDeepLinkRequest | null` — utilisés par les Tasks 5/6 pour les liens `/map?campaign=<id>&tab=<tab>`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/magelian-deep-link.test.ts
import { describe, it, expect } from 'vitest';
import { parseMagelianParams } from '@/components/magelian/deep-link';

describe('parseMagelianParams', () => {
  it('retourne null sans param pertinent', () => {
    expect(parseMagelianParams(new URLSearchParams(''))).toBeNull();
    expect(parseMagelianParams(new URLSearchParams('foo=bar'))).toBeNull();
  });

  it('parse campaign seul', () => {
    expect(parseMagelianParams(new URLSearchParams('campaign=abc-123')))
      .toEqual({ campaignId: 'abc-123', tab: undefined });
  });

  it('parse tab valide', () => {
    expect(parseMagelianParams(new URLSearchParams('tab=apercu')))
      .toEqual({ campaignId: undefined, tab: 'apercu' });
  });

  it('ignore un tab invalide (mais garde campaign)', () => {
    expect(parseMagelianParams(new URLSearchParams('campaign=x&tab=zzz')))
      .toEqual({ campaignId: 'x', tab: undefined });
    expect(parseMagelianParams(new URLSearchParams('tab=zzz'))).toBeNull();
  });

  it('parse les deux', () => {
    expect(parseMagelianParams(new URLSearchParams('campaign=x&tab=suivi')))
      .toEqual({ campaignId: 'x', tab: 'suivi' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/magelian-deep-link.test.ts`
Expected: FAIL — `Cannot find module '@/components/magelian/deep-link'`

- [ ] **Step 3: Create `components/magelian/deep-link.ts`**

```ts
/** Deep-link de l'overlay MAGELIAN : /map?campaign=<id>&tab=<creation|suivi|apercu>. */

export type MagelianTab = 'creation' | 'suivi' | 'apercu';

export interface MagelianDeepLinkRequest {
  campaignId?: string;
  tab?: MagelianTab;
}

const TABS: readonly MagelianTab[] = ['creation', 'suivi', 'apercu'];

export function parseMagelianParams(params: URLSearchParams): MagelianDeepLinkRequest | null {
  const campaignId = params.get('campaign') ?? undefined;
  const rawTab = params.get('tab');
  const tab = TABS.includes(rawTab as MagelianTab) ? (rawTab as MagelianTab) : undefined;
  if (!campaignId && !tab) return null;
  return { campaignId, tab };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/magelian-deep-link.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Étendre le contexte** — remplacer le contenu de `components/magelian/MagelianOverlayContext.tsx` :

```tsx
'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { MagelianDeepLinkRequest } from './deep-link';

interface MagelianOverlayState {
  open: boolean;
  /** Demande d'ouverture ciblée (deep-link) — consommée puis effacée par l'overlay. */
  request: MagelianDeepLinkRequest | null;
  openOverlay: (options?: MagelianDeepLinkRequest) => void;
  closeOverlay: () => void;
  clearRequest: () => void;
}

const MagelianOverlayContext = createContext<MagelianOverlayState | null>(null);

export function MagelianOverlayProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState<MagelianDeepLinkRequest | null>(null);

  const openOverlay = useCallback((options?: MagelianDeepLinkRequest) => {
    setRequest(options ?? null);
    setOpen(true);
  }, []);
  const closeOverlay = useCallback(() => {
    setOpen(false);
    setRequest(null);
  }, []);
  const clearRequest = useCallback(() => setRequest(null), []);

  const value = useMemo(
    () => ({ open, request, openOverlay, closeOverlay, clearRequest }),
    [open, request, openOverlay, closeOverlay, clearRequest]
  );

  return (
    <MagelianOverlayContext.Provider value={value}>
      {children}
    </MagelianOverlayContext.Provider>
  );
}

export function useMagelianOverlay() {
  const ctx = useContext(MagelianOverlayContext);
  if (!ctx) {
    throw new Error('useMagelianOverlay must be used within a MagelianOverlayProvider');
  }
  return ctx;
}
```

- [ ] **Step 6: Consommer la requête dans `MagelianOverlay.tsx`**

a) Ligne 22 : supprimer `type MagelianTab = 'creation' | 'suivi' | 'apercu';` et importer à la place :

```ts
import type { MagelianTab } from './deep-link';
```

b) Ligne 30 : `const { open, closeOverlay } = useMagelianOverlay();` devient :

```ts
const { open, request, closeOverlay, clearRequest } = useMagelianOverlay();
```

c) Effet « reset l'onglet » (lignes 69–74) devient :

```ts
// Reset l'onglet actif à chaque nouvelle ouverture (deep-link prioritaire) + horodate.
useEffect(() => {
  if (open) {
    setTab(request?.tab ?? 'suivi');
    openedAtRef.current = Date.now();
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [open]);
```

d) Après l'effet de chargement des campagnes (ligne 94), ajouter un effet de pré-sélection :

```ts
// Deep-link : pré-sélectionne la campagne demandée dès que la liste est disponible.
useEffect(() => {
  if (!open || !request?.campaignId || campaigns === null) return;
  const found = campaigns.find((c) => c.id === request.campaignId);
  if (found) setSelectedId(found.id);
  clearRequest();
}, [open, request, campaigns, clearRequest]);
```

e) Dans l'effet de chargement initial (ligne 88-89), préférer la campagne du deep-link :

```ts
const wanted = list.find((c) => c.id === requestRef.current?.campaignId);
const preferred = wanted ?? list.find((c) => c.id === DEMO_CAMPAIGN_ID);
setSelectedId(preferred?.id ?? list[0]?.id ?? null);
```

avec, près des autres refs (ligne ~50) :

```ts
// Le fetch ne tourne qu'une fois : capture la requête courante sans re-déclencher l'effet.
const requestRef = useRef(request);
useEffect(() => { requestRef.current = request; }, [request]);
```

- [ ] **Step 7: Créer `components/magelian/MagelianDeepLink.tsx`**

```tsx
'use client';

/**
 * Lit /map?campaign=<id>&tab=<tab>, ouvre l'overlay MAGELIAN pré-positionné,
 * puis nettoie l'URL. Aucun fetch : la liste des campagnes est chargée par l'overlay.
 */
import { Suspense, useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { parseMagelianParams } from './deep-link';
import { useMagelianOverlay } from './MagelianOverlayContext';

function MagelianDeepLinkInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { openOverlay } = useMagelianOverlay();
  const handledRef = useRef(false);

  useEffect(() => {
    if (pathname !== '/map') {
      handledRef.current = false;
      return;
    }
    if (handledRef.current) return;
    const req = parseMagelianParams(new URLSearchParams(searchParams.toString()));
    if (!req) return;
    handledRef.current = true;
    openOverlay(req);
    router.replace('/map', { scroll: false });
  }, [pathname, searchParams, openOverlay, router]);

  return null;
}

export function MagelianDeepLink() {
  return (
    <Suspense fallback={null}>
      <MagelianDeepLinkInner />
    </Suspense>
  );
}
```

- [ ] **Step 8: Monter dans `app/layout.tsx`** — repérer `<MagelianOverlay />` et ajouter juste à côté :

```tsx
import { MagelianDeepLink } from '@/components/magelian/MagelianDeepLink';
// …dans le JSX, au même niveau que <MagelianOverlay /> :
<MagelianDeepLink />
```

- [ ] **Step 9: Vérifier**

Run: `npx tsc --noEmit && npx vitest run tests/unit/magelian-deep-link.test.ts`
Expected: 0 erreur TS, tests PASS.

- [ ] **Step 10: Commit**

```bash
git add components/magelian tests/unit/magelian-deep-link.test.ts app/layout.tsx
git commit -m "feat: deep-link overlay MAGELIAN (/map?campaign=&tab=)"
```

---

### Task 2: Migration du wizard vers `components/campaign/wizard/`

**Files:**
- Move: `app/campaigns/[id]/_components/FilAriane.tsx` → `components/campaign/wizard/FilAriane.tsx`
- Move: `app/campaigns/[id]/_components/StepMemo.tsx` → `components/campaign/wizard/StepMemo.tsx`
- Move: `app/campaigns/[id]/_components/steps/` (7 fichiers) → `components/campaign/wizard/steps/`
- Modify: `components/campaign/CampaignCockpit.tsx:7-13` (imports)
- Modify: tout autre fichier important `@/app/campaigns/[id]/_components/…` (à découvrir au grep, hors `app/campaigns` lui-même)

**Interfaces:**
- Produces: mêmes exports, nouveaux chemins `@/components/campaign/wizard/FilAriane`, `@/components/campaign/wizard/steps/StepCible` etc. La Task 7 (suppression pages) dépend de cette migration.

- [ ] **Step 1: Recenser les imports à réécrire**

Run: `grep -rln "app/campaigns/\[id\]/_components" --include="*.ts" --include="*.tsx" app/ components/ lib/ tests/`
Expected: liste contenant `components/campaign/CampaignCockpit.tsx` (+ éventuels autres — tous seront réécrits au Step 3).

- [ ] **Step 2: Déplacer les fichiers (git mv, historise le déplacement)**

```bash
mkdir -p components/campaign/wizard
git mv "app/campaigns/[id]/_components/FilAriane.tsx" components/campaign/wizard/FilAriane.tsx
git mv "app/campaigns/[id]/_components/StepMemo.tsx" components/campaign/wizard/StepMemo.tsx
git mv "app/campaigns/[id]/_components/steps" components/campaign/wizard/steps
```

- [ ] **Step 3: Réécrire les imports** — dans chaque fichier listé au Step 1, remplacer le préfixe `@/app/campaigns/[id]/_components/` par `@/components/campaign/wizard/`. Dans `CampaignCockpit.tsx` (lignes 7–13) :

```ts
import { FilAriane, type FilArianeStep } from '@/components/campaign/wizard/FilAriane';
import { StepCible } from '@/components/campaign/wizard/steps/StepCible';
import { StepCanaux } from '@/components/campaign/wizard/steps/StepCanaux';
import { StepBudget } from '@/components/campaign/wizard/steps/StepBudget';
import { StepStrategie } from '@/components/campaign/wizard/steps/StepStrategie';
import { StepLancement } from '@/components/campaign/wizard/steps/StepLancement';
import { DEFAULT_PROG_DRAFT, inferIntensity, type ProgDraft } from '@/components/campaign/wizard/steps/types';
```

Les imports **relatifs internes** entre fichiers du wizard (steps ↔ types/ui, FilAriane) ne changent pas (déplacés en bloc). Si un fichier du wizard importe encore `../../_components/…` ou remonte vers `app/campaigns`, le réécrire vers le chemin absolu `@/components/campaign/wizard/…`.

- [ ] **Step 4: Vérifier**

Run: `npx tsc --noEmit && grep -rn "app/campaigns/\[id\]/_components" --include="*.ts" --include="*.tsx" app/ components/ lib/ tests/ | wc -l`
Expected: 0 erreur TS, grep = 0.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: wizard campagne déplacé vers components/campaign/wizard (l'overlay en dépend)"
```

---

### Task 3: `CampaignOverview` — Ajuster toujours visible + fin du mode pleine page

**Files:**
- Modify: `components/campaign/CampaignOverview.tsx` (lignes 60–95, 147–201, signature du composant)

**Interfaces:**
- Consumes: rien de nouveau.
- Produces: `CampaignOverview({ campaignId, onDeleted }: { campaignId: string; onDeleted?: () => void })` — la prop `embedded` disparaît (le composant est toujours embarqué dans l'overlay). Task 4 consomme cette signature.

- [ ] **Step 1: Bouton Ajuster toujours visible (ligne 182)** — remplacer :

```tsx
{strategyId && strategyStatus === 'active' && status === 'en_cours' && (
  <ActionButton label="Ajuster" variant="teal" onClick={() => setAdjustOpen(true)} disabled={overridePending} />
)}
```

par :

```tsx
{status === 'en_cours' && (
  <span title={!hasActiveStrategy ? "Lance d'abord une stratégie de pilotage (onglet Création campagne) pour pouvoir ajuster." : undefined}>
    <ActionButton
      label="Ajuster"
      variant="teal"
      onClick={() => setAdjustOpen(true)}
      disabled={overridePending || !hasActiveStrategy}
    />
  </span>
)}
```

avec, juste au-dessus du `return` (près de `const status = …`) :

```ts
const hasActiveStrategy = Boolean(strategyId) && strategyStatus === 'active';
```

Nota : si `ActionButton` (défini dans `components/campaign/_shared.tsx`) ne rend pas l'attribut `title` sur son `<button>`, le `<span title=…>` wrapper suffit (le tooltip natif s'affiche même sur bouton disabled). Ne pas modifier `ActionButton`.

- [ ] **Step 2: Supprimer la prop `embedded` et les navigations `/campaigns`**

a) Signature : retirer `embedded` des props et du type ; supprimer le commentaire d'en-tête mentionnant la page `/campaigns/[id]`.
b) Ligne ~72 (`fetchDetail`, campagne introuvable) : supprimer `router.push('/campaigns');` — garder uniquement le toast d'erreur.
c) Ligne ~87 (`handleDelete`) : remplacer `if (onDeleted) onDeleted(); else router.push('/campaigns');` par `onDeleted?.();`.
d) Lignes 148, 152–162 : remplacer les ternaires `embedded ? … : …` par la branche embedded (fond transparent, padding 0) et supprimer le bloc bouton « ← Campagnes DSP » (`!embedded && …`).
e) Si `router` n'est plus utilisé après a–d, supprimer l'import `useRouter` et la variable.

- [ ] **Step 3: Vérifier**

Run: `npx tsc --noEmit && grep -n "router.push('/campaigns')" components/campaign/CampaignOverview.tsx | wc -l`
Expected: 0 erreur TS, grep = 0. (L'appelant `MagelianOverlay` ligne 368 passe `embedded` — l'erreur TS éventuelle se corrige en Task 4 ; si tsc casse ici, retirer aussi `embedded` de l'appel dans `MagelianOverlay.tsx:368` et `CampaignCockpit.tsx:176` dans CE commit.)

- [ ] **Step 4: Commit**

```bash
git add components/campaign/CampaignOverview.tsx components/campaign/CampaignCockpit.tsx components/magelian/MagelianOverlay.tsx
git commit -m "feat: bouton Ajuster toujours visible (désactivé sans stratégie) + Overview embedded-only"
```

---

### Task 4: `CampaignCockpit` embedded-only + suppression après delete dans l'overlay

**Files:**
- Modify: `components/campaign/CampaignCockpit.tsx` (signature, lignes 140–176)
- Modify: `components/magelian/MagelianOverlay.tsx` (lignes 346–374)

**Interfaces:**
- Consumes: `CampaignOverview({ campaignId, onDeleted })` (Task 3).
- Produces: `CampaignCockpit({ campaignId, initialView, wizardOnly, onDeleted }: { campaignId: string; initialView?: CockpitView; wizardOnly?: boolean; onDeleted?: () => void })`.

- [ ] **Step 1: Cockpit** — retirer la prop `embedded` (les styles lignes 141 et 152 gardent la branche embedded : `background: 'transparent'`, `minHeight: 0`, `padding: 0` pour la ligne 152 ; la ligne 141 garde `padding: 24` du loader). Ajouter la prop `onDeleted?: () => void`. Ligne 176 :

```tsx
{view === 'overview' && (
  <CampaignOverview campaignId={id} onDeleted={onDeleted} />
)}
```

Supprimer l'import `useRouter` si plus utilisé.

- [ ] **Step 2: Overlay** — dans `MagelianOverlay.tsx`, ajouter un handler près de `toggleDemo` :

```ts
// Après suppression d'une campagne : retire de la liste et sélectionne la suivante.
const handleCampaignDeleted = useCallback(() => {
  setCampaigns((prev) => {
    const next = (prev ?? []).filter((c) => c.id !== selectedId);
    setSelectedId(next[0]?.id ?? null);
    return next;
  });
}, [selectedId]);
```

puis mettre à jour les rendus (lignes 348 et 368) :

```tsx
<CampaignCockpit key={selectedId} campaignId={selectedId} initialView="prog" wizardOnly onDeleted={handleCampaignDeleted} />
…
<CampaignOverview key={selectedId} campaignId={selectedId} onDeleted={handleCampaignDeleted} />
```

- [ ] **Step 3: Vérifier**

Run: `npx tsc --noEmit && grep -rn "embedded" components/campaign/CampaignCockpit.tsx components/campaign/CampaignOverview.tsx components/magelian/MagelianOverlay.tsx | wc -l`
Expected: 0 erreur TS, grep = 0.

- [ ] **Step 4: Commit**

```bash
git add components/campaign components/magelian
git commit -m "refactor: cockpit/overview embedded-only + gestion suppression campagne dans l'overlay"
```

---

### Task 5: Rebranchement de tous les liens et redirects `/campaigns`

**Files:**
- Modify: `app/page.tsx`
- Delete: `components/layout/PillarSwitch.tsx`
- Modify: `components/layout/TopRightChrome.tsx`
- Modify: `components/AppSidebar.tsx:43-48`
- Modify: `app/custom-bidding/page.tsx`
- Modify: `app/custom-bidding/[strategyId]/page.tsx:23-26`
- Modify: `app/demo/pilote/page.tsx`
- Modify: `app/admin/sources/page.tsx:2390`
- Modify: `app/map/analyse/digital/_components/CustomBiddingBar.tsx:108`

**Interfaces:**
- Consumes: deep-link `/map?campaign=<id>&tab=<tab>` (Task 1).

- [ ] **Step 1: `app/page.tsx`**

```tsx
import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/map');
}
```

- [ ] **Step 2: Supprimer `PillarSwitch`**

```bash
git rm components/layout/PillarSwitch.tsx
```

`components/layout/TopRightChrome.tsx` devient :

```tsx
'use client';

import { usePathname } from 'next/navigation';
import { SessionBadge } from '@/components/SessionBadge';
import { ThemeToggle } from '@/components/ThemeToggle';

export function TopRightChrome() {
  const pathname = usePathname();
  const onMap = pathname?.startsWith('/map');
  if (onMap) return null; // sur /map, le chrome vit dans le banner de la carte
  return (
    <div
      style={{
        position: 'fixed', top: 0, right: 0, zIndex: 200,
        display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px',
      }}
    >
      <ThemeToggle />
      <SessionBadge />
    </div>
  );
}
```

- [ ] **Step 3: `AppSidebar.tsx`** — remplacer l'item Portfolio (ligne 46) :

```ts
{
  section: 'Campagnes',
  items: [
    { href: '/map?tab=suivi', label: 'Gestion campagnes', icon: Target },
  ],
},
```

- [ ] **Step 4: `app/custom-bidding/page.tsx`** — `redirect('/campaigns')` → `redirect('/map')` (mettre à jour le commentaire d'en-tête : « la gestion vit dans l'overlay MAGELIAN de /map »).

- [ ] **Step 5: `app/custom-bidding/[strategyId]/page.tsx`** — lignes 23–26 :

```ts
const cid = j?.campaign?.id ?? j?.strategy?.campaign_id ?? null;
router.replace(cid ? `/map?campaign=${cid}&tab=apercu` : '/map');
```

et le `.catch` : `router.replace('/map')`. Mettre à jour le commentaire d'en-tête (les `_components` de ce dossier restent utilisés par `PilotageOverlay` et `CampaignSuivi` — NE PAS les déplacer).

- [ ] **Step 6: `app/demo/pilote/page.tsx`**

```tsx
/**
 * /demo/pilote — ouvre l'overlay MAGELIAN sur la campagne de démo (onglet Suivi).
 */
import { redirect } from 'next/navigation';

export default function Page() {
  redirect('/map?campaign=dede0000-0000-4000-8000-000000000001&tab=suivi');
}
```

- [ ] **Step 7: `app/admin/sources/page.tsx:2390`** — `href={`/campaigns/${c.id}`}` → `href={`/map?campaign=${c.id}&tab=apercu`}`.

- [ ] **Step 8: `CustomBiddingBar.tsx:108`** — `router.push(`/campaigns/${campaignId}`)` → `router.push(`/map?campaign=${campaignId}&tab=apercu`)`.

- [ ] **Step 9: Vérifier**

Run: `npx tsc --noEmit && grep -rn "'/campaigns\|\"/campaigns\|\`/campaigns" --include="*.ts" --include="*.tsx" app/ components/ lib/ | grep -v "app/campaigns/" | grep -v "admin/campaigns"`
Expected: 0 erreur TS ; grep ne renvoie plus AUCUNE ligne (hors routes API `/api/admin/campaigns` qui matchent `admin/campaigns`).

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor: tous les accès campagne passent par /map (deep-link overlay), racine → /map"
```

---

### Task 6: Panneau Réglages = back office admin

**Files:**
- Modify: `components/map/overlays/SettingsOverlay.tsx:43-53, 189-230`

**Interfaces:** aucun changement d'API — contenu de `NAV_LINKS` et titre de section seulement.

- [ ] **Step 1: Remplacer `NAV_LINKS` (lignes 43–53)**

```ts
/**
 * Back office (admin) — vision 09/07 : le mediaplanner travaille dans les overlays
 * de la carte ; l'admin gère workspaces, données et connexions depuis cet onglet.
 * Droits par rôle (user / admin / super admin) à venir.
 */
const BACK_OFFICE_LINKS: NavLink[] = [
  { href: '/admin/organizations', label: 'Organisations (workspaces)', icon: Users },
  { href: '/admin/users', label: 'Utilisateurs', icon: Users },
  { href: '/admin/import', label: 'Import POI', icon: FileUp },
  { href: '/admin/carreaux-import', label: 'Import Shapefile', icon: FileUp },
  { href: '/admin/ooh-import', label: 'Import OOH', icon: FileUp },
  { href: '/dashboard/iris-crawler', label: 'IRIS crawler', icon: Database },
  { href: '/admin/radio', label: 'Radio FM/DAB+', icon: RadioIcon },
  { href: '/admin/api', label: 'Connexions API', icon: Plug },
  { href: '/admin/sources', label: 'Sources', icon: Database },
  { href: '/admin/imports', label: 'Historique imports', icon: FileUp },
  { href: '/admin/health', label: 'Health check', icon: Activity },
];
```

Icônes : `Users`, `FileUp`, `Database`, `RadioIcon`, `Plug`, `Activity` sont déjà importées ; retirer de l'import lucide les icônes devenues inutilisées (`LayoutDashboard`, `LayersIcon`, `Target`) — garder `SaveIcon` (bouton capture).

- [ ] **Step 2: Renommer la section (ligne ~191)** — `<h4 …>Navigation</h4>` → `<h4 …>Back office</h4>` et remplacer `NAV_LINKS.map` par `BACK_OFFICE_LINKS.map`.

- [ ] **Step 3: Vérifier**

Run: `npx tsc --noEmit && npm run lint -- --quiet 2>&1 | tail -5`
Expected: 0 erreur TS, pas de nouvelle erreur lint (imports inutilisés retirés).

- [ ] **Step 4: Commit**

```bash
git add components/map/overlays/SettingsOverlay.tsx
git commit -m "feat: panneau Réglages = back office admin (workspaces, imports, IRIS, connexions API)"
```

---

### Task 7: Suppression des pages portfolio

**Files:**
- Delete: `app/campaigns/page.tsx`, `app/campaigns/_components/` (3 fichiers), `app/campaigns/[id]/page.tsx` (le dossier `app/campaigns` disparaît entièrement — `_components` du wizard déjà migré en Task 2)

- [ ] **Step 1: Vérifier qu'aucun import ne pointe encore vers le dossier**

Run: `grep -rn "app/campaigns" --include="*.ts" --include="*.tsx" components/ lib/ tests/ app/ | grep -v "^app/campaigns" | grep -v "admin/campaigns"`
Expected: aucune ligne. Si une ligne apparaît, la corriger AVANT de supprimer (retour Task 2/5).

- [ ] **Step 2: Supprimer**

```bash
git rm -r app/campaigns
```

- [ ] **Step 3: Vérifier**

Run: `npx tsc --noEmit && npm test`
Expected: 0 erreur TS, tous les tests passent.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat!: suppression du portfolio /campaigns — gestion campagne 100% overlay carte"
```

---

### Task 8: Vérification de bout en bout

**Files:** aucun (vérification).

- [ ] **Step 1: Build complet**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: 0 erreur, tests verts, build OK (aucune référence à `/campaigns` dans les pages générées).

- [ ] **Step 2: Grep final**

Run: `grep -rn "'/campaigns\|\"/campaigns\|\`/campaigns\|PillarSwitch\|CampaignImportDialog\|CampaignPortfolioCard\|PortfolioToolbar" --include="*.ts" --include="*.tsx" app/ components/ lib/ tests/`
Expected: aucune ligne (hors `admin/campaigns`).

- [ ] **Step 3: Vérification navigateur (Playwright MCP, serveur `npm run dev`)**

1. `http://localhost:3000/` → atterrit sur `/map`.
2. `/map?campaign=dede0000-0000-4000-8000-000000000001&tab=suivi` → overlay MAGELIAN ouvert, onglet Suivi, campagne démo pilotage sélectionnée, URL nettoyée en `/map`.
3. Overlay → onglet Aperçu : bouton « Ajuster » présent ; actif sur la campagne démo pilotage (stratégie active), désactivé avec tooltip sur une campagne sans stratégie.
4. Rail → Réglages : sections Fond de carte / Vues sauvegardées / Apparence / **Back office** (11 liens admin, pas de lien Campagnes ni Dashboard).
5. Suppression d'une campagne de test depuis l'Aperçu → l'overlay reste ouvert, la campagne disparaît du sélecteur.
6. Sidebar (page admin, ex. `/admin/sources`) → « Gestion campagnes » ouvre `/map` avec l'overlay sur Suivi.

- [ ] **Step 4: Commit final éventuel** (corrections mineures issues de la vérif) puis résumé structuré à l'utilisateur (fichiers modifiés / supprimés / ce qui n'a pas changé).

---

## Self-review (fait à l'écriture)

- **Couverture spec** : A (Tasks 2, 5, 7), B (Task 6), C (Task 3), deep-link (Task 1), vérifs (Task 8). ✔
- **Types cohérents** : `MagelianTab` défini une fois dans `deep-link.ts`, consommé par contexte + overlay ; signatures `onDeleted?: () => void` alignées Tasks 3/4. ✔
- **Pas de placeholder** : chaque étape contient le code ou la commande exacte. ✔
