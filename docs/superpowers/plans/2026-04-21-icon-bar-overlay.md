# IconBar + Overlay flottant — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer le `FilterPanel` 240px de `/map` par une barre d'icônes verticale 48px + un overlay flottant 280px, rendant la carte plein écran par défaut.

**Architecture:** IconBar fixed left (z=30, 7 icônes). OverlayPanel fixed (z=40, 280px) qui flotte par-dessus la carte, switch interne sur la catégorie active. AppSidebar globale masquée uniquement sur `/map`. État géré dans `app/map/page.tsx` (`activeOverlay`, `iconBarHidden`, `activeStudy`). Migration en 8 phases : FilterPanel reste vivant jusqu'en Phase 6 pour permettre la comparaison visuelle.

**Tech Stack:** React 19, Next.js 14 App Router, TypeScript strict, Tailwind, Zustand (existant), MapLibre GL JS, lucide-react.

**Spec:** `docs/superpowers/specs/2026-04-21-icon-bar-overlay-design.md`

**Verification model:** Pas de tests unitaires (UI MapLibre + 80 props orchestrés — coverage non-rentable). Verification = `npx tsc --noEmit` + `npm run build` + check visuel `npm run dev`. Chaque tâche se termine par un commit après vérification.

---

## Phase 1 — Pré-flight

### Task 1.1 : Checkpoint commit + branche

**Files:** —

- [ ] **Step 1 : Vérifier l'état git**

```bash
git status --short
```

Expected : `?? docs/PROMPT2.md` et autres fichiers untracked OK, pas de modif staged sur le code app.

- [ ] **Step 2 : Checkpoint commit du spec déjà fait + état actuel**

Le spec `docs/superpowers/specs/2026-04-21-icon-bar-overlay-design.md` est déjà commité (`565c69c`). Skip ce step.

- [ ] **Step 3 : Créer la branche feat/icon-bar-overlay**

```bash
git checkout -b feat/icon-bar-overlay
```

Expected : `Switched to a new branch 'feat/icon-bar-overlay'`

- [ ] **Step 4 : Verify**

```bash
git branch --show-current
```

Expected : `feat/icon-bar-overlay`

---

## Phase 2 — IconBar (composant + intégration sans contenu overlay)

### Task 2.1 : Créer `components/map/IconBar.tsx`

**Files:**
- Create: `components/map/IconBar.tsx`

- [ ] **Step 1 : Créer le fichier avec la structure complète**

```typescript
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Bot, MapPin, Layers, BarChart3, Megaphone, Settings, Home } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type OverlayId = 'ai' | 'perimeter' | 'terrain' | 'analyses' | 'campaigns' | 'settings';

interface IconBarItem {
  id: OverlayId | 'home';
  label: string;
  icon: LucideIcon;
  colorVar: string;
  rgb: string;
  position?: 'top' | 'bottom';
  separator?: boolean;
}

const ICON_BAR_ITEMS: IconBarItem[] = [
  { id: 'home', label: 'Home', icon: Home, colorVar: 'var(--text-tertiary)', rgb: '102,102,102' },
  { id: 'ai', label: 'geo.prompt', icon: Bot, colorVar: 'var(--brand-teal)', rgb: '78,205,196', separator: true },
  { id: 'perimeter', label: 'Périmètre', icon: MapPin, colorVar: 'var(--cat-context, #8a8a8a)', rgb: '138,138,138' },
  { id: 'terrain', label: 'Terrain', icon: Layers, colorVar: 'var(--cat-terrain, #4ecdc4)', rgb: '78,205,196' },
  { id: 'analyses', label: 'Analyses', icon: BarChart3, colorVar: 'var(--cat-analysis, #e8845c)', rgb: '232,132,92' },
  { id: 'campaigns', label: 'Campagnes', icon: Megaphone, colorVar: 'var(--cat-media, #f7b731)', rgb: '247,183,49' },
  { id: 'settings', label: 'Réglages', icon: Settings, colorVar: 'var(--text-tertiary)', rgb: '102,102,102', position: 'bottom' },
];

interface IconBarProps {
  activeItem: OverlayId | null;
  onItemClick: (id: OverlayId) => void;
  hidden?: boolean;
  studyAvailable?: boolean;
  showLabels?: boolean;
}

export function IconBar({
  activeItem,
  onItemClick,
  hidden = false,
  studyAvailable = false,
  showLabels = true,
}: IconBarProps) {
  const router = useRouter();

  // Shortcut "/" ouvre AI overlay (si focus pas dans input)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== '/') return;
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable)) {
        return;
      }
      e.preventDefault();
      onItemClick('ai');
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onItemClick]);

  const topItems = ICON_BAR_ITEMS.filter(i => i.position !== 'bottom');
  const bottomItems = ICON_BAR_ITEMS.filter(i => i.position === 'bottom');

  return (
    <aside
      className="icon-bar"
      data-hidden={hidden ? 'true' : 'false'}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        width: 48,
        background: 'var(--card, #0a0a0a)',
        borderRight: '0.5px solid var(--border-subtle, #1a1a1a)',
        zIndex: 30,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '12px 0',
        gap: 4,
        transform: hidden ? 'translateX(-100%)' : 'translateX(0)',
        transition: 'transform 200ms var(--ease-out, ease)',
      }}
    >
      {topItems.map(item => (
        <IconButton
          key={item.id}
          item={item}
          active={activeItem === item.id}
          showLabel={showLabels}
          studyBadge={item.id === 'analyses' && studyAvailable}
          onClick={() => {
            if (item.id === 'home') {
              router.push('/dashboard');
              return;
            }
            onItemClick(item.id as OverlayId);
          }}
        />
      ))}
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
        {bottomItems.map(item => (
          <IconButton
            key={item.id}
            item={item}
            active={activeItem === item.id}
            showLabel={showLabels}
            onClick={() => onItemClick(item.id as OverlayId)}
          />
        ))}
      </div>
    </aside>
  );
}

interface IconButtonProps {
  item: IconBarItem;
  active: boolean;
  showLabel: boolean;
  studyBadge?: boolean;
  onClick: () => void;
}

function IconButton({ item, active, showLabel, studyBadge, onClick }: IconButtonProps) {
  const Icon = item.icon;
  const isAI = item.id === 'ai';

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        title={item.label}
        style={{
          width: 40,
          height: showLabel ? 44 : 40,
          borderRadius: 8,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          background: active ? `rgba(${item.rgb}, 0.08)` : 'transparent',
          border: 'none',
          cursor: 'pointer',
          position: 'relative',
          transition: 'background-color 150ms var(--ease-hover, ease), color 150ms var(--ease-hover, ease)',
          color: active || isAI ? item.colorVar : 'var(--text-tertiary, #666666)',
        }}
        onMouseEnter={e => {
          if (!active) e.currentTarget.style.background = 'var(--elevated, #111111)';
        }}
        onMouseLeave={e => {
          if (!active) e.currentTarget.style.background = 'transparent';
        }}
      >
        {/* Indicateur actif vertical à gauche */}
        {active && (
          <span
            style={{
              position: 'absolute',
              left: -4,
              top: 8,
              bottom: 8,
              width: 3,
              borderRadius: '0 2px 2px 0',
              background: item.colorVar,
            }}
          />
        )}
        {/* Pulse dot pour AI */}
        {isAI && (
          <span
            style={{
              position: 'absolute',
              top: 4,
              right: 6,
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--brand-teal, #4ecdc4)',
              boxShadow: '0 0 0 0 rgba(78,205,196,0.6)',
              animation: 'iconBarPulse 2s ease-in-out infinite',
            }}
          />
        )}
        {/* Badge Étude disponible sur Analyses */}
        {studyBadge && (
          <span
            style={{
              position: 'absolute',
              top: 4,
              right: 6,
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--brand-teal, #4ecdc4)',
            }}
          />
        )}
        <Icon size={20} strokeWidth={1.5} />
        {showLabel && (
          <span
            style={{
              fontSize: 8,
              fontFamily: "'Inter', system-ui, sans-serif",
              fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              lineHeight: 1,
              color: 'inherit',
            }}
          >
            {item.label.length > 8 ? item.label.slice(0, 8) : item.label}
          </span>
        )}
      </button>
      {item.separator && (
        <div
          style={{
            width: 24,
            height: 0.5,
            background: 'var(--border-subtle, #1a1a1a)',
            margin: '4px 0',
          }}
        />
      )}
      <style jsx global>{`
        @keyframes iconBarPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(78,205,196,0.6); }
          50% { box-shadow: 0 0 0 4px rgba(78,205,196,0); }
        }
      `}</style>
    </>
  );
}
```

- [ ] **Step 2 : Type-check**

```bash
npx tsc --noEmit
```

Expected : 0 erreurs sur ce nouveau fichier.

- [ ] **Step 3 : Commit (composant seul, non utilisé encore)**

```bash
git add components/map/IconBar.tsx
git commit -m "feat(layout): IconBar verticale 48px — 7 catégories"
```

---

### Task 2.2 : Masquer AppSidebar sur /map

**Files:**
- Modify: `components/AppSidebar.tsx` (ajout d'un guard `usePathname` au top)
- Modify: `app/layout.tsx` (rendre `md:pl-[240px]` conditionnel via classe CSS dynamique)

- [ ] **Step 1 : Lire l'état actuel d'AppSidebar**

```bash
head -30 components/AppSidebar.tsx
```

Confirmer que `'use client'` + `usePathname` sont importables.

- [ ] **Step 2 : Modifier AppSidebar pour return null sur /map**

Ouvrir `components/AppSidebar.tsx`. Localiser le composant `AppSidebar` exporté par défaut (recherche : `export default function`). Au tout début du composant (avant le premier `return`), ajouter :

```typescript
const pathname = usePathname();
if (pathname?.startsWith('/map')) {
  return null;
}
```

S'assurer que `usePathname` est importé en haut du fichier (`import { usePathname } from 'next/navigation'`).

- [ ] **Step 3 : Modifier app/layout.tsx pour padding conditionnel**

Le layout root applique `md:pl-[240px]` en dur. Le `main` doit s'adapter. Solution simple : ajouter un wrapper client-side qui retire le padding sur /map.

Créer `components/layout/MainPadding.tsx` :

```typescript
'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

export function MainPadding({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isMap = pathname?.startsWith('/map');
  return (
    <main className={isMap ? 'min-h-screen' : 'md:pl-[240px] min-h-screen'}>
      <div className={isMap ? '' : 'p-8'}>
        {children}
      </div>
    </main>
  );
}
```

- [ ] **Step 4 : Câbler MainPadding dans app/layout.tsx**

Dans `app/layout.tsx`, remplacer le bloc `<main className="md:pl-[240px] min-h-screen"><div className="p-8">{children}</div></main>` par :

```tsx
<MainPadding>{children}</MainPadding>
```

Et ajouter l'import en haut : `import { MainPadding } from '@/components/layout/MainPadding'`.

- [ ] **Step 5 : Masquer aussi ThemeToggle + SessionBadge top-right sur /map**

Dans `app/layout.tsx`, le bloc `<div style={{ position: 'fixed', top: 0, right: 0, ... }}>` qui contient `<ThemeToggle />` et `<SessionBadge />` doit aussi être conditionnel sur /map (ces éléments seront déplacés dans l'overlay Settings et un futur header carte).

Créer `components/layout/TopRightChrome.tsx` :

```typescript
'use client';

import { usePathname } from 'next/navigation';
import { SessionBadge } from '@/components/SessionBadge';
import { ThemeToggle } from '@/components/ThemeToggle';

export function TopRightChrome() {
  const pathname = usePathname();
  if (pathname?.startsWith('/map')) return null;
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 12px',
      }}
    >
      <ThemeToggle />
      <SessionBadge />
    </div>
  );
}
```

Dans `app/layout.tsx`, remplacer le `<div style={{ position: 'fixed', ... }}>` qui contient ThemeToggle+SessionBadge par `<TopRightChrome />` et ajouter l'import. Retirer les imports `SessionBadge` et `ThemeToggle` du layout root puisqu'ils sont maintenant dans `TopRightChrome`.

- [ ] **Step 6 : Type-check**

```bash
npx tsc --noEmit
```

Expected : 0 erreurs.

- [ ] **Step 7 : Test visuel**

```bash
npm run dev
```

Naviguer :
- `http://localhost:3000/dashboard` → AppSidebar 240px visible + ThemeToggle/SessionBadge top-right ✓
- `http://localhost:3000/map` → AppSidebar absente, padding gauche absent, top-right absent ✓
- `http://localhost:3000/admin/users` → AppSidebar visible ✓

- [ ] **Step 8 : Commit**

```bash
git add components/AppSidebar.tsx components/layout/MainPadding.tsx components/layout/TopRightChrome.tsx app/layout.tsx
git commit -m "feat(layout): masquer AppSidebar et top-right chrome sur /map"
```

---

### Task 2.3 : Mount IconBar dans page.tsx (sans overlay encore)

**Files:**
- Modify: `app/map/page.tsx`

- [ ] **Step 1 : Ajouter état activeOverlay et import IconBar**

Dans `app/map/page.tsx`, en haut des imports (après les imports lucide, vers ligne 43) ajouter :

```typescript
import { IconBar, type OverlayId } from '@/components/map/IconBar';
```

Dans le composant `MapPage` (ligne 68), juste après les états existants, ajouter :

```typescript
const [activeOverlay, setActiveOverlay] = useState<OverlayId | null>(null);

const handleOverlayToggle = useCallback((id: OverlayId) => {
  setActiveOverlay(prev => prev === id ? null : id);
}, []);
```

- [ ] **Step 2 : Mounter l'IconBar dans le JSX root du return**

Localiser le `return (` du composant MapPage (probablement vers la fin du fichier). Ajouter `<IconBar />` comme tout premier élément enfant du wrapper racine, AVANT tout autre rendu :

```tsx
return (
  <>
    <IconBar
      activeItem={activeOverlay}
      onItemClick={handleOverlayToggle}
      studyAvailable={!!studyVille}
    />
    <div style={{ marginLeft: 48, /* … reste du layout existant inchangé pour l'instant */ }}>
      {/* ... layout existant FilterPanel + carte ... */}
    </div>
  </>
);
```

⚠️ Pour cette tâche on ne touche PAS encore au FilterPanel ni au layout flex existant — on ajoute seulement l'IconBar comme élément fixed positionné par-dessus, et un margin-left 48px sur le wrapper pour ne pas chevaucher.

- [ ] **Step 3 : Type-check**

```bash
npx tsc --noEmit
```

Expected : 0 erreurs.

- [ ] **Step 4 : Test visuel**

```bash
npm run dev
```

Sur `/map` : IconBar 48px visible à gauche avec 7 icônes (Home, AI avec pulse teal, Périmètre, Terrain, Analyses, Campagnes, Settings poussé en bas). Cliquer chaque icône met l'IconBar en état actif (barre verticale colorée à gauche + fond teinté). Le FilterPanel et la carte sont décalés de 48px vers la droite.

- [ ] **Step 5 : Commit**

```bash
git add app/map/page.tsx
git commit -m "feat(layout): mount IconBar dans page map (overlay non câblé)"
```

---

## Phase 3 — OverlayPanel (shell vide animé)

### Task 3.1 : Créer `components/map/OverlayPanel.tsx`

**Files:**
- Create: `components/map/OverlayPanel.tsx`

- [ ] **Step 1 : Créer le shell complet avec animation, Esc, click-outside**

```typescript
'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { OverlayId } from './IconBar';

interface OverlayPanelProps {
  category: OverlayId;
  title: string;
  dotColor: string;
  onClose: () => void;
  children: ReactNode;
  /** Largeur (default 280) */
  width?: number;
}

export function OverlayPanel({
  category,
  title,
  dotColor,
  onClose,
  children,
  width = 280,
}: OverlayPanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  // Animation entrée : on démarre invisible, puis on passe visible au tick suivant
  useEffect(() => {
    const timer = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(timer);
  }, []);

  // Esc ferme l'overlay
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Click-outside : ferme si le clic est hors de l'overlay ET hors de l'IconBar
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('.overlay-panel')) return;
      if (target.closest('.icon-bar')) return;
      onClose();
    }
    // Décaler d'un tick pour ne pas catcher le clic d'ouverture
    const t = setTimeout(() => window.addEventListener('mousedown', onClick), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', onClick);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="overlay-panel"
      data-category={category}
      style={{
        position: 'fixed',
        top: 12,
        left: 56, // 48px barre + 8px gap
        width,
        maxHeight: 'calc(100vh - 24px)',
        background: 'var(--card-overlay, rgba(10, 10, 10, 0.95))',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        border: '0.5px solid var(--border-default, #262626)',
        borderRadius: 12,
        boxShadow: '0 4px 24px rgba(0, 0, 0, 0.3)',
        zIndex: 40,
        display: 'flex',
        flexDirection: 'column',
        opacity: mounted ? 1 : 0,
        transform: mounted ? 'translateX(0)' : 'translateX(-8px)',
        transition: 'opacity 150ms ease, transform 150ms ease',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '14px 16px 12px',
          borderBottom: '0.5px solid var(--border-subtle, #1a1a1a)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: dotColor,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontFamily: "'Inter', system-ui, sans-serif",
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--text-primary, #f0f0f0)',
            flex: 1,
          }}
        >
          {title}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: 4,
            display: 'flex',
            alignItems: 'center',
            color: 'var(--text-tertiary, #666666)',
            transition: 'color 150ms ease',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary, #f0f0f0)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-tertiary, #666666)'; }}
        >
          <X size={16} strokeWidth={1.5} />
        </button>
      </div>

      {/* Body scrollable */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px 0',
          minHeight: 0,
        }}
      >
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2 : Ajouter le token CSS `--card-overlay` (light/dark)**

Localiser le fichier de tokens CSS (probablement `app/globals.css`). Ajouter dans la section dark (`:root.dark` ou défaut) :

```css
--card-overlay: rgba(10, 10, 10, 0.95);
```

Et dans la section light (`:root.light`) :

```css
--card-overlay: rgba(248, 248, 248, 0.95);
```

Si le fichier n'a pas ces sections clairement nommées, chercher `--card:` et ajouter la variable juste après dans le même bloc.

- [ ] **Step 3 : Type-check**

```bash
npx tsc --noEmit
```

Expected : 0 erreurs.

- [ ] **Step 4 : Commit (composant seul)**

```bash
git add components/map/OverlayPanel.tsx app/globals.css
git commit -m "feat(layout): OverlayPanel shell flottant 280px avec animation"
```

---

### Task 3.2 : Câbler OverlayPanel temporaire dans page.tsx (placeholder content)

**Files:**
- Modify: `app/map/page.tsx`

- [ ] **Step 1 : Ajouter import OverlayPanel**

```typescript
import { OverlayPanel } from '@/components/map/OverlayPanel';
```

- [ ] **Step 2 : Ajouter rendu conditionnel après IconBar**

Dans le JSX du return, juste après `<IconBar />`, ajouter :

```tsx
{activeOverlay && (
  <OverlayPanel
    category={activeOverlay}
    title={
      activeOverlay === 'ai' ? 'geo.prompt' :
      activeOverlay === 'perimeter' ? 'Périmètre' :
      activeOverlay === 'terrain' ? 'Données terrain' :
      activeOverlay === 'analyses' ? 'Analyses' :
      activeOverlay === 'campaigns' ? 'Campagnes média' :
      'Réglages'
    }
    dotColor={
      activeOverlay === 'ai' ? 'var(--brand-teal)' :
      activeOverlay === 'perimeter' ? 'var(--cat-context, #8a8a8a)' :
      activeOverlay === 'terrain' ? 'var(--cat-terrain, #4ecdc4)' :
      activeOverlay === 'analyses' ? 'var(--cat-analysis, #e8845c)' :
      activeOverlay === 'campaigns' ? 'var(--cat-media, #f7b731)' :
      'var(--text-tertiary)'
    }
    onClose={() => setActiveOverlay(null)}
  >
    <div style={{ padding: 16, color: 'var(--text-secondary)' }}>
      Placeholder pour {activeOverlay}. Contenu migré en Phase 4.
    </div>
  </OverlayPanel>
)}
```

- [ ] **Step 3 : Test visuel**

```bash
npm run dev
```

Sur `/map` :
- Cliquer chaque icône → overlay s'ouvre à gauche (fixed, 280px, semi-transparent, blur visible derrière)
- Cliquer la même icône → overlay se ferme
- Cliquer une autre icône → contenu de l'overlay change (mais l'overlay reste monté car React diff)
- Touche Esc → overlay se ferme
- Cliquer sur la carte (hors overlay) → overlay se ferme
- L'animation entrée (opacity + slide-in 8px) est visible

- [ ] **Step 4 : Commit**

```bash
git add app/map/page.tsx
git commit -m "feat(layout): câble OverlayPanel placeholder dans page map"
```

---

## Phase 4 — Migration contenu vers 6 sous-overlays

> **Stratégie :** Le `FilterPanel.tsx` (3468 lignes) reste vivant et monté en parallèle pendant toute la Phase 4. On crée les 6 fichiers overlay en **déplaçant** le JSX correspondant depuis FilterPanel (copier la section, l'adapter pour qu'elle prenne ses props proprement). L'overlay réel (Phase 5) ne remplace FilterPanel qu'une fois les 6 sous-overlays prêts.

### Task 4.1 : Squelettes des 6 overlays

**Files:**
- Create: `components/map/overlays/AIOverlay.tsx`
- Create: `components/map/overlays/PerimeterOverlay.tsx`
- Create: `components/map/overlays/TerrainOverlay.tsx`
- Create: `components/map/overlays/AnalysesOverlay.tsx`
- Create: `components/map/overlays/CampaignsOverlay.tsx`
- Create: `components/map/overlays/SettingsOverlay.tsx`

- [ ] **Step 1 : Créer chaque fichier squelette**

Pour CHACUN des 6 fichiers, créer un export typé qui prend `props: { /* spécifique à l'overlay */ }` et rend juste un placeholder. Exemple pour `AIOverlay.tsx` :

```typescript
'use client';
import type { ReactNode } from 'react';

export interface AIOverlayProps {
  chatSlot: ReactNode;
}

export function AIOverlay({ chatSlot }: AIOverlayProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {chatSlot}
    </div>
  );
}
```

Pour `PerimeterOverlay.tsx`, `TerrainOverlay.tsx`, `AnalysesOverlay.tsx`, `CampaignsOverlay.tsx`, `SettingsOverlay.tsx` : créer chacun un export du même style avec `props: Record<string, never>` et rendre `<div style={{padding:16}}>TODO migrate {name}</div>`. Les vrais types de props seront définis lors de la migration de chaque overlay (Tasks 4.2 à 4.7).

- [ ] **Step 2 : Type-check**

```bash
npx tsc --noEmit
```

Expected : 0 erreurs.

- [ ] **Step 3 : Commit**

```bash
git add components/map/overlays/
git commit -m "feat(overlays): squelettes des 6 sous-overlays"
```

---

### Task 4.2 : AIOverlay — câbler dans OverlayPanel

**Files:**
- Modify: `app/map/page.tsx`
- Modify: `components/map/overlays/AIOverlay.tsx`

- [ ] **Step 1 : Vérifier que `AIOverlay` accepte un `chatSlot` (déjà fait en 4.1)**

Le `chatSlot` reçoit le `<ChatPanel />` complet (déjà construit dans page.tsx, lignes ~1410-1485). Pour Task 4.2 on garde le bloc `<ChatPanel ... />` existant dans page.tsx et on le passe en prop.

- [ ] **Step 2 : Modifier le placeholder dans page.tsx pour rendre AIOverlay**

Localiser le bloc `{activeOverlay && <OverlayPanel ...>` ajouté en Task 3.2. Remplacer le `<div>Placeholder pour {activeOverlay}...</div>` par un switch :

```tsx
{activeOverlay === 'ai' && <AIOverlay chatSlot={
  <ChatPanel
    containerStyle={{ width: '100%', minWidth: 0, flex: 1, borderRight: 'none', minHeight: 0 }}
    hideHeader={true}
    messages={chat.messages}
    isLoading={chat.isLoading}
    input={chat.input}
    setInput={chat.setInput}
    handleSubmit={chat.handleSubmit}
    handleKeyDown={chat.handleKeyDown}
    sendMessage={chat.sendMessage}
    messagesEndRef={chat.messagesEndRef}
    rateLimitCooldown={rateLimit.rateLimitCooldown}
    cancelCooldown={rateLimit.cancelCooldown}
    error={error}
    showSavePanel={savedMaps.showSavePanel}
    showLoadPanel={savedMaps.showLoadPanel}
    setShowSavePanel={savedMaps.setShowSavePanel}
    setShowLoadPanel={savedMaps.setShowLoadPanel}
    saveName={savedMaps.saveName}
    setSaveName={savedMaps.setSaveName}
    saveLoading={savedMaps.saveLoading}
    saveError={savedMaps.saveError}
    setSaveError={savedMaps.setSaveError}
    savedMaps={savedMaps.savedMaps}
    saveCurrentMap={savedMaps.saveCurrentMap}
    loadSavedMaps={savedMaps.loadSavedMaps}
    loadMap={savedMaps.loadMap}
    deleteMap={savedMaps.deleteMap}
    zoneData={zoneData}
    provider={providerSelector.provider}
    setProvider={providerSelector.setProvider}
    providerStatus={providerSelector.providerStatus}
    statusLoading={providerSelector.statusLoading}
    refreshProviderStatus={providerSelector.refreshStatus}
    sessionTokens={chat.sessionTokens}
    onFlyTo={handleFlyTo}
    onHighlightIris={(codeIris: string | null) => { /* … recopier l'implémentation actuelle ligne 1447-1483 … */ }}
  />
} />}
{activeOverlay !== 'ai' && (
  <div style={{ padding: 16, color: 'var(--text-secondary)' }}>
    Placeholder pour {activeOverlay}. À migrer dans la prochaine tâche.
  </div>
)}
```

⚠️ Important : recopier `onHighlightIris` à l'identique depuis `app/map/page.tsx:1447-1483` pour ne pas perdre la logique IRIS highlighting.

Ajouter l'import en haut : `import { AIOverlay } from '@/components/map/overlays/AIOverlay';`

- [ ] **Step 3 : Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 4 : Test visuel**

```bash
npm run dev
```

Sur `/map`, cliquer l'icône AI : overlay s'ouvre, le chat geo.prompt fonctionne (envoyer un message, vérifier la réponse, scroll OK, sticky input en bas).

- [ ] **Step 5 : Commit**

```bash
git add app/map/page.tsx components/map/overlays/AIOverlay.tsx
git commit -m "feat(overlays): AIOverlay câblé avec ChatPanel — geo.prompt fonctionnel"
```

---

### Task 4.3 : PerimeterOverlay — migration JSX section "Périmètre"

**Files:**
- Modify: `components/map/overlays/PerimeterOverlay.tsx`
- Modify: `app/map/page.tsx`

- [ ] **Step 1 : Identifier la section dans FilterPanel.tsx**

```bash
grep -n 'Perimetre\|Périmètre' app/map/_components/FilterPanel.tsx | head -20
```

La section Périmètre commence ligne ~1550 (`<CategoryGroup title="Perimetre"...>`) et se termine ligne ~1694 (`</CategoryGroup>`).

- [ ] **Step 2 : Lister les props utilisées par cette section**

Lire `app/map/_components/FilterPanel.tsx:1550-1694` pour identifier toutes les variables référencées (scope, regions, departements, recherche locale, etc.). Les noter dans un commentaire en haut de PerimeterOverlay.tsx.

- [ ] **Step 3 : Définir le typage des props de PerimeterOverlay**

Remplacer le squelette `Record<string, never>` par les props réelles. Exemple (à adapter selon ce que tu trouves) :

```typescript
'use client';

import type { ZoneData } from '@/types/spatial';

export interface PerimeterOverlayProps {
  zoneData: ZoneData | null;
  onDirectSearch: (params: DirectPOISearchParams) => void;
  // … toutes les autres props utilisées par la section Périmètre actuelle
  onRecenterFrance: () => void;
  // etc.
}
```

⚠️ Reprendre les types **exacts** depuis `app/map/_components/FilterPanel.tsx` (l'interface `FilterPanelProps` y est définie). Ne pas inventer.

- [ ] **Step 4 : Copier-coller le JSX de la section Périmètre**

Copier le bloc complet `<CategoryGroup title="Perimetre"...>...</CategoryGroup>` (lignes 1550-1694) depuis FilterPanel vers le body de `PerimeterOverlay`.

⚠️ **Adapter** : retirer le wrapper `<CategoryGroup>` (l'overlay a déjà son header avec dot+titre). Ne garder QUE le contenu interne (`<div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 16 }}>...`). Le contenu interne contient déjà des accordéons (`FilterSectionHeader`) — les garder tels quels.

⚠️ Adapter aussi : remplacer toutes les références à des helpers internes du FilterPanel (`C.border`, `C.text`, `fInter`, `sectionsOpen`, `toggleSection`, `filterSearch`) par soit des constantes locales soit des props.

- [ ] **Step 5 : Migrer les helpers locaux nécessaires**

Si la section utilise des constantes (`C.border = 'var(--border-subtle)'`, `fInter = "'Inter', system-ui, sans-serif"`, etc.), créer un fichier partagé `components/map/overlays/_shared/styles.ts` :

```typescript
export const FONTS = {
  inter: "'Inter', system-ui, sans-serif",
  mono: "'JetBrains Mono', 'Fira Mono', monospace",
} as const;

export const COLORS = {
  border: 'var(--border-subtle)',
  borderDefault: 'var(--border-default)',
  borderHover: 'var(--border-hover)',
  bgPanel: 'var(--card)',
  bgSurface: 'var(--bg-surface)',
  bgLevel2: 'var(--bg-level-2)',
  text: 'var(--text-primary)',
  textDim: 'var(--text-secondary)',
  textTertiary: 'var(--text-tertiary)',
  brand: 'var(--brand-teal)',
  red: 'var(--danger)',
  green: 'var(--success)',
} as const;
```

Importer dans PerimeterOverlay.tsx : `import { FONTS, COLORS } from './_shared/styles';`

Pour `sectionsOpen`/`toggleSection` (state local d'accordéons), gérer en local dans PerimeterOverlay :

```typescript
const [sectionsOpen, setSectionsOpen] = useState<Record<string, boolean>>({
  perimetre: true,
  regions: false,
  departements: false,
  rechercheLocale: false,
});
const toggleSection = (k: string) => setSectionsOpen(s => ({ ...s, [k]: !s[k] }));
```

Pour `filterSearch` : la search globale est supprimée (décision Q5). Remplacer toutes les conditions `(!filterSearch || 'xxx'.includes(filterSearch.toLowerCase()))` par `true` (afficher toujours).

Pour `FilterSectionHeader` : c'est un sous-composant interne au FilterPanel. Le **copier dans `components/map/overlays/_shared/FilterSectionHeader.tsx`** comme composant partagé.

- [ ] **Step 6 : Câbler dans page.tsx**

Dans le switch d'overlays de page.tsx, remplacer le placeholder Périmètre par :

```tsx
{activeOverlay === 'perimeter' && (
  <PerimeterOverlay
    zoneData={zoneData}
    onDirectSearch={handleDirectSearch}
    onRecenterFrance={() => mapRef.current?.fitBounds([[-5.5, 41.3], [9.6, 51.1]], { padding: 20, duration: 1000 })}
    /* … toutes les autres props identifiées en Step 2 … */
  />
)}
```

Ajouter l'import : `import { PerimeterOverlay } from '@/components/map/overlays/PerimeterOverlay';`

- [ ] **Step 7 : Type-check**

```bash
npx tsc --noEmit
```

Expected : 0 erreurs.

- [ ] **Step 8 : Test visuel — comparaison avant/après**

```bash
npm run dev
```

Sur `/map` :
- L'ancien FilterPanel reste visible à gauche (avec son tab Expert)
- L'overlay Périmètre s'ouvre avec le **même contenu** que la section Périmètre du FilterPanel
- Les accordéons fonctionnent
- Tous les inputs/boutons fonctionnent (zone search, recenter France, etc.)

- [ ] **Step 9 : Commit**

```bash
git add components/map/overlays/PerimeterOverlay.tsx components/map/overlays/_shared/ app/map/page.tsx
git commit -m "feat(overlays): PerimeterOverlay — JSX migré depuis FilterPanel"
```

---

### Task 4.4 : TerrainOverlay — migration "Données terrain" + IRIS + Carreaux

**Files:**
- Modify: `components/map/overlays/TerrainOverlay.tsx`
- Modify: `app/map/page.tsx`

- [ ] **Step 1 : Identifier la section dans FilterPanel.tsx**

La section "Données terrain" : lignes 1699-2229 (`<CategoryGroup title="Données terrain"...>`).

⚠️ Cette section contient déjà IRIS et Carreaux dans le FilterPanel actuel — donc pas besoin de fusionner avec une autre section. Vérifier en lisant les lignes 1699-2229.

- [ ] **Step 2 : Lister les props utilisées**

Cette section utilise ~35 props : `irisVisible`, `irisIndicateur`, `irisPalette`, `irisOpacity`, `irisStats`, `setIrisVisible`, `setIrisIndicateur`, `setIrisPalette`, `setIrisOpacity`, `setIrisTrueOnly`, `irisTrueOnly`, `carreauxVisible`, `carreauxLoaded`, `carreauxIndicateur`, `carreauxPalette`, `carreauxOpacity`, `carreauxRange`, `carreauxSelectedBucket`, `setCarreauxVisible`, `setCarreauxIndicateur`, `setCarreauxPalette`, `setCarreauxOpacity`, `setCarreauxSelectedBucket`, `radioVisible`, `onToggleRadio`, `radioHeatmapMode`, `onToggleRadioHeatmap`, `radioCoverageMode`, `onToggleRadioCoverage`, `radioLoading`, `radioSystemeFilter`, `onRadioSystemeChange`, `onSelectRadio`, `radioCount`, `radioSelectedNom`, `onClearRadioSelection`, `radioCoverageColor`, `onRadioCoverageColorChange`, `radioCoverageOpacity`, `onRadioCoverageOpacityChange`, `radioBorderWidth`, `onRadioBorderWidthChange`, `radioPointSize`, `onRadioPointSizeChange`, `onLoadTransport`, `onLoadTMJA`, `tmjaVisible`, `onClearTMJA`, `onDirectOOH`, `densityMode`, `onDensityModeChange`, `onPOIStylesChange`, `poiStyles`.

- [ ] **Step 3 : Typer les props (TerrainOverlayProps)**

Reprendre les types exacts depuis `FilterPanelProps` dans FilterPanel.tsx. Définir l'interface complète.

- [ ] **Step 4 : Copier-coller + adapter le JSX**

Copier les lignes 1699-2229 (le contenu interne de `<CategoryGroup>`) vers TerrainOverlay. Retirer le wrapper CategoryGroup. Adapter `sectionsOpen`/`toggleSection` en state local. Remplacer `filterSearch` par `true`.

- [ ] **Step 5 : Câbler dans page.tsx**

```tsx
{activeOverlay === 'terrain' && (
  <TerrainOverlay
    irisVisible={mapLayers.irisVisible}
    irisIndicateur={mapLayers.irisIndicateur}
    /* … toutes les ~35 props … */
  />
)}
```

- [ ] **Step 6 : Type-check + visuel**

```bash
npx tsc --noEmit
npm run dev
```

Sur `/map`, ouvrir overlay Terrain : tous les layers (POI, Panneaux OOH, Transport, TMJA, Radio, IRIS, Carreaux) doivent s'activer/désactiver. Tester chaque toggle.

- [ ] **Step 7 : Commit**

```bash
git add components/map/overlays/TerrainOverlay.tsx app/map/page.tsx
git commit -m "feat(overlays): TerrainOverlay — POI/OOH/Transport/TMJA/Radio/IRIS/Carreaux migrés"
```

---

### Task 4.5 : AnalysesOverlay — migration + CTA Étude

**Files:**
- Modify: `components/map/overlays/AnalysesOverlay.tsx`
- Modify: `app/map/page.tsx`

- [ ] **Step 1 : Identifier la section dans FilterPanel.tsx**

La section "Analyses" : lignes 2234-3240.

- [ ] **Step 2 : Lister props utilisées**

Inclut : `voronoiVisible`, `setVoronoiVisible`, `battleVisible`, `setBattleVisible`, `battleOuterFillVisible`, `setBattleOuterFillVisible`, `isochroneVisible`, `setIsochroneVisible`, `battleFeatures`, `battlePois`, `battleCacheKey`, `onDirectBattle`, `onDirectBattleV2`, `onFillIsochroneCache`, `onApplyBattle`, `clusterGeoJSON`, `clustersVisible`, `clusterLoading`, `clusterDuration`, `onToggleClusters`, `onLoadClusters`, `onClusterDurationChange`, `onWizardHighlight`, `onWizardClose`, `correlationParams`, `onShowResiduals`, `scoringMapRef`, `scoringMapReady`, `mainMapRef`, `onScoreComputed`, `onFlyTo`, `onFitBounds`, `sendMessage`, `isLoading`.

Plus une nouvelle prop pour le CTA Étude : `studyVille: string | null`, `onOpenStudy: () => void`.

- [ ] **Step 3 : Typer + migrer JSX**

Copier les lignes 2234-3240 vers AnalysesOverlay (sans CategoryGroup wrapper). Adapter sectionsOpen.

- [ ] **Step 4 : Ajouter le CTA "Ouvrir l'étude de ville"**

Localiser dans le JSX migré la section Scoring OOH. Ajouter à la fin de cette section (après le résultat de scoring) :

```tsx
{studyVille && (
  <button
    type="button"
    onClick={onOpenStudy}
    style={{
      width: '100%',
      marginTop: 12,
      background: 'transparent',
      border: '0.5px solid var(--brand-teal)',
      color: 'var(--brand-teal)',
      borderRadius: 6,
      padding: '8px 16px',
      fontFamily: "'Inter', system-ui, sans-serif",
      fontSize: 12,
      fontWeight: 500,
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      transition: 'background-color 150ms ease',
    }}
    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(78,205,196,0.1)'; }}
    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
  >
    Ouvrir l'étude de ville → <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, opacity: 0.8 }}>{studyVille}</span>
  </button>
)}
```

- [ ] **Step 5 : Câbler dans page.tsx**

Ajouter l'état `activeStudy` (sera utilisé en Phase 5 — pour Phase 4 on peut juste console.log) :

```typescript
const handleOpenStudy = useCallback(() => {
  // Phase 5 : setActiveStudy(true); setActiveOverlay(null);
  console.log('[study] open requested', studyVille);
}, [studyVille]);
```

```tsx
{activeOverlay === 'analyses' && (
  <AnalysesOverlay
    /* … ~30 props … */
    studyVille={studyVille}
    onOpenStudy={handleOpenStudy}
  />
)}
```

- [ ] **Step 6 : Type-check + visuel**

```bash
npx tsc --noEmit
npm run dev
```

Sur `/map`, overlay Analyses : Voronoï/Battle/Isochrone/Clustering/Couverture/Corrélation/Scoring tous fonctionnels. Calculer un scoring → vérifier que le CTA "Ouvrir l'étude" apparaît avec le nom de la ville.

- [ ] **Step 7 : Commit**

```bash
git add components/map/overlays/AnalysesOverlay.tsx app/map/page.tsx
git commit -m "feat(overlays): AnalysesOverlay + CTA Étude conditionnel"
```

---

### Task 4.6 : CampaignsOverlay — migration "Campagnes média"

**Files:**
- Modify: `components/map/overlays/CampaignsOverlay.tsx`
- Modify: `app/map/page.tsx`

- [ ] **Step 1 : Identifier la section**

Lignes 3245-3408 dans FilterPanel.tsx.

- [ ] **Step 2 : Props utilisées**

`digitalVisible`, `digitalLoading`, `digitalStats`, `digitalPalette`, `onDigitalPaletteChange`, `digitalInverted`, `onDigitalInvertChange`, `digitalScale`, `onDigitalScaleChange`, `onDigitalShowImpressions`, `onDigitalClear`, `onOpenDigitalAnalysis`, `digitalPopField`, `onDigitalPopFieldChange`.

- [ ] **Step 3 : Typer + migrer JSX**

Copier 3245-3408 sans le wrapper CategoryGroup.

- [ ] **Step 4 : Câbler dans page.tsx**

```tsx
{activeOverlay === 'campaigns' && (
  <CampaignsOverlay
    digitalVisible={digitalVisible}
    digitalLoading={digitalLoading}
    digitalStats={digitalStats}
    /* … */
  />
)}
```

- [ ] **Step 5 : Vérifier que TripleMapView fonctionne toujours**

Le toggle "Vue comparée/fusionnée" et le rendu `<TripleMapView>` restent dans page.tsx (statu quo, décision Q3). Vérifier qu'ils ne sont PAS dépendants du FilterPanel.

- [ ] **Step 6 : Test visuel**

```bash
npm run dev
```

Sur `/map`, overlay Campagnes : sélectionner une campagne → KPIs s'affichent → toggle vue comparée → TripleMapView remplace la carte.

- [ ] **Step 7 : Commit**

```bash
git add components/map/overlays/CampaignsOverlay.tsx app/map/page.tsx
git commit -m "feat(overlays): CampaignsOverlay — Digital migré"
```

---

### Task 4.7 : SettingsOverlay — création (NOUVEAU contenu)

**Files:**
- Modify: `components/map/overlays/SettingsOverlay.tsx`
- Modify: `app/map/page.tsx`

- [ ] **Step 1 : Identifier le contenu actuel équivalent**

Le FilterPanel actuel n'a PAS de section Settings dédiée. Le contenu doit reprendre :
- Le sélecteur de fond de carte (cherche `mapStyles` ou `MAP_STYLES` dans page.tsx — il est passé à `MapPanel`)
- La sauvegarde de vue (gérée par `savedMaps.saveCurrentMap` dans page.tsx)
- Le ThemeToggle (importé depuis `@/components/ThemeToggle`)
- Liens de navigation inter-pages (à reprendre depuis `components/AppSidebar.tsx:44-78`)

- [ ] **Step 2 : Typer les props**

```typescript
'use client';

import { ThemeToggle } from '@/components/ThemeToggle';
import { useRouter } from 'next/navigation';
import { LayoutDashboard, Share2, Layers as LayersIcon, FileUp, Radio as RadioIcon, Target, Activity, Database, Users } from 'lucide-react';
import { COLORS, FONTS } from './_shared/styles';

export interface SettingsOverlayProps {
  mapStyles: { id: string; label: string; url: string }[];
  currentMapStyleUrl: string;
  onMapStyleChange: (url: string) => void;
  onSaveCurrentView: () => void;
  saveLoading?: boolean;
}

const NAV_LINKS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/clusters', label: 'Clustering', icon: Share2 },
  { href: '/map/custom-geo', label: 'Zones custom', icon: LayersIcon },
  { href: '/admin/import', label: 'Import POI', icon: FileUp },
  { href: '/admin/radio', label: 'Radio FM/DAB+', icon: RadioIcon },
  { href: '/admin/campaigns', label: 'Campagnes DSP', icon: Target },
  { href: '/admin/users', label: 'Utilisateurs', icon: Users },
  { href: '/admin/sources', label: 'Sources', icon: Database },
  { href: '/admin/health', label: 'Health check', icon: Activity },
];

export function SettingsOverlay({
  mapStyles,
  currentMapStyleUrl,
  onMapStyleChange,
  onSaveCurrentView,
  saveLoading,
}: SettingsOverlayProps) {
  const router = useRouter();

  return (
    <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 20, fontFamily: FONTS.inter }}>
      {/* Section : Fond de carte */}
      <section>
        <h4 style={{ fontSize: 11, fontWeight: 500, color: COLORS.textDim, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8, marginTop: 0 }}>
          Fond de carte
        </h4>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {mapStyles.map(s => (
            <button
              key={s.id}
              type="button"
              onClick={() => onMapStyleChange(s.url)}
              style={{
                background: currentMapStyleUrl === s.url ? 'rgba(78,205,196,0.1)' : 'transparent',
                border: `0.5px solid ${currentMapStyleUrl === s.url ? 'var(--brand-teal)' : COLORS.borderDefault}`,
                color: currentMapStyleUrl === s.url ? 'var(--brand-teal)' : COLORS.textDim,
                borderRadius: 6,
                padding: '8px 10px',
                fontSize: 11,
                cursor: 'pointer',
                transition: 'all 150ms ease',
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </section>

      {/* Section : Vue */}
      <section>
        <h4 style={{ fontSize: 11, fontWeight: 500, color: COLORS.textDim, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8, marginTop: 0 }}>
          Vue
        </h4>
        <button
          type="button"
          onClick={onSaveCurrentView}
          disabled={saveLoading}
          style={{
            width: '100%',
            background: 'transparent',
            border: '0.5px solid var(--brand-teal)',
            color: 'var(--brand-teal)',
            borderRadius: 6,
            padding: '8px 16px',
            fontSize: 12,
            fontWeight: 500,
            cursor: saveLoading ? 'wait' : 'pointer',
            opacity: saveLoading ? 0.6 : 1,
          }}
        >
          {saveLoading ? 'Sauvegarde…' : 'Sauvegarder la vue actuelle'}
        </button>
      </section>

      {/* Section : Apparence */}
      <section>
        <h4 style={{ fontSize: 11, fontWeight: 500, color: COLORS.textDim, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8, marginTop: 0 }}>
          Apparence
        </h4>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ThemeToggle />
          <span style={{ fontSize: 12, color: COLORS.textDim }}>Thème clair / sombre</span>
        </div>
      </section>

      {/* Section : Navigation */}
      <section>
        <h4 style={{ fontSize: 11, fontWeight: 500, color: COLORS.textDim, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8, marginTop: 0 }}>
          Navigation
        </h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {NAV_LINKS.map(link => {
            const Icon = link.icon;
            return (
              <button
                key={link.href}
                type="button"
                onClick={() => router.push(link.href)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  background: 'transparent',
                  border: 'none',
                  color: COLORS.textDim,
                  fontSize: 12,
                  padding: '8px 6px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background-color 120ms ease, color 120ms ease',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = COLORS.bgLevel2; e.currentTarget.style.color = COLORS.text; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = COLORS.textDim; }}
              >
                <Icon size={14} strokeWidth={1.5} />
                {link.label}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 3 : Câbler dans page.tsx**

```tsx
{activeOverlay === 'settings' && (
  <SettingsOverlay
    mapStyles={MAP_STYLES as unknown as { id: string; label: string; url: string }[]}
    currentMapStyleUrl={mapStyleUrl}
    onMapStyleChange={handleMapStyleChange}
    onSaveCurrentView={() => savedMaps.setShowSavePanel(true)}
    saveLoading={savedMaps.saveLoading}
  />
)}
```

Ajouter l'import : `import { SettingsOverlay } from '@/components/map/overlays/SettingsOverlay';`

- [ ] **Step 4 : Type-check + visuel**

```bash
npx tsc --noEmit
npm run dev
```

Sur `/map`, overlay Settings : 4 sections visibles (Fond de carte avec 4 boutons, Vue avec sauvegarde, Apparence avec ThemeToggle, Navigation avec 9 liens). Cliquer un fond de carte → la carte change. Cliquer Sauvegarder → modal de sauvegarde s'ouvre. Cliquer un lien nav → navigation OK.

- [ ] **Step 5 : Commit**

```bash
git add components/map/overlays/SettingsOverlay.tsx app/map/page.tsx
git commit -m "feat(overlays): SettingsOverlay — fond carte + vue + thème + nav"
```

---

## Phase 5 — Layout migration page.tsx (remove FilterPanel mount)

### Task 5.1 : Remplacer mapFullscreen par iconBarHidden + Maximize2 z=50

**Files:**
- Modify: `app/map/page.tsx`

- [ ] **Step 1 : Renommer l'état**

Localiser `const [mapFullscreen, setMapFullscreen] = useState(false);` (ligne ~72). Remplacer par :

```typescript
const [iconBarHidden, setIconBarHidden] = useState(false);
```

- [ ] **Step 2 : Remplacer toutes les références mapFullscreen**

```bash
grep -n 'mapFullscreen' app/map/page.tsx
```

Pour chaque occurrence : remplacer `mapFullscreen` par `iconBarHidden`. Le bouton actuel `<button onClick={() => setMapFullscreen(f => !f)}>` devient `<button onClick={() => setIconBarHidden(h => !h)}>`.

- [ ] **Step 3 : Mettre le bouton à z-index 50**

Localiser le bouton Maximize2 (ligne ~1710-1724 actuelle). Modifier son style inline :

```typescript
style={{
  position: 'absolute', top: 10, right: 10, zIndex: 50, // ← passé de 20 à 50
  /* … reste inchangé … */
}}
```

- [ ] **Step 4 : Passer iconBarHidden à IconBar**

```tsx
<IconBar
  activeItem={activeOverlay}
  onItemClick={handleOverlayToggle}
  hidden={iconBarHidden}
  studyAvailable={!!studyVille}
/>
```

- [ ] **Step 5 : Supprimer le bloc fullscreen wrapper FilterPanel**

Localiser le bloc `<div style={{ transition: 'margin-left 0.3s ease, opacity 0.3s ease', marginLeft: mapFullscreen ? '-100%' : 0, ... }}>` (ligne ~1401). Ce wrapper masquait le FilterPanel. Le supprimer (FilterPanel reste dedans pour l'instant — Phase 6 le supprime).

⚠️ Garder `<FilterPanel ... />` rendu directement (pas d'animation). Il sera supprimé en Phase 6.

- [ ] **Step 6 : Type-check + visuel**

```bash
npx tsc --noEmit
npm run dev
```

Sur `/map` : cliquer Maximize2 → IconBar disparaît avec animation (slide-out vers la gauche). Re-cliquer → revient. Esc → revient.

- [ ] **Step 7 : Commit**

```bash
git add app/map/page.tsx
git commit -m "feat(layout): iconBarHidden remplace mapFullscreen, Maximize2 z=50"
```

---

### Task 5.2 : Remplacer activeTab map/study par activeStudy boolean

**Files:**
- Modify: `app/map/page.tsx`

- [ ] **Step 1 : Renommer l'état**

Localiser `const [activeTab, setActiveTab] = useState<'map' | 'study'>('map');` (ligne 71). Remplacer par :

```typescript
const [activeStudy, setActiveStudy] = useState(false);
```

- [ ] **Step 2 : Remplacer les références**

```bash
grep -n 'activeTab' app/map/page.tsx
```

- `activeTab === 'map'` → `!activeStudy`
- `activeTab === 'study'` → `activeStudy`
- `setActiveTab('map')` → `setActiveStudy(false)`
- `setActiveTab('study')` → `setActiveStudy(true)`

- [ ] **Step 3 : Supprimer le tab bar Carte/Étude**

Localiser le bloc `{(['map', 'study'] as const).map(tab => { ... })}` (lignes 1670-1699). Ce tab bar disparaît complètement (l'utilisateur navigue via overlay Analyses → CTA Étude, et "← Retour" depuis Étude).

⚠️ Garder le `<div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>` qui contient `<ThemeToggle /> <SessionBadge />` ? Non — décision Q1 : ThemeToggle dans SettingsOverlay, SessionBadge masqué sur /map (déplacé dans SettingsOverlay si besoin).

Supprimer entièrement le wrapper tab bar (lignes ~1664-1704).

- [ ] **Step 4 : Implémenter handleOpenStudy / handleCloseStudy**

```typescript
const handleOpenStudy = useCallback(() => {
  setActiveStudy(true);
  setActiveOverlay(null);
}, []);

const handleCloseStudy = useCallback(() => {
  setActiveStudy(false);
}, []);
```

- [ ] **Step 5 : Ajouter le bouton "← Retour carte" en mode Étude**

Localiser le bloc `{activeStudy && (...)` (ex-`activeTab === 'study'`, ligne ~2003). Ajouter un bouton flottant absolute :

```tsx
{activeStudy && (
  <>
    <button
      type="button"
      onClick={handleCloseStudy}
      style={{
        position: 'fixed',
        top: 12,
        left: 60, // 48 IconBar + 12 marge
        zIndex: 50,
        background: 'var(--card)',
        border: '0.5px solid var(--border-default)',
        color: 'var(--text-secondary)',
        borderRadius: 6,
        padding: '6px 12px',
        fontSize: 12,
        fontFamily: "'Inter', system-ui, sans-serif",
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      ← Retour à la carte
    </button>
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden', background: 'var(--bg-primary)', marginLeft: 48 }}>
      {/* StudyDashboard existant */}
    </div>
  </>
)}
```

- [ ] **Step 6 : Type-check + visuel**

```bash
npx tsc --noEmit
npm run dev
```

Sur `/map` :
- Le tab bar Carte/Étude a disparu
- Calculer un scoring → CTA "Ouvrir l'étude" apparaît dans overlay Analyses
- Cliquer CTA → carte remplacée par StudyDashboard, IconBar visible, bouton "← Retour" visible top-left
- Cliquer "← Retour" → retour à la carte
- Esc en mode Étude → ferme l'overlay si ouvert, sinon désactive `activeStudy` (pas implémenté dans OverlayPanel — voir Step 7)

- [ ] **Step 7 : Étendre Esc handler pour Étude**

Dans page.tsx, ajouter un useEffect global :

```typescript
useEffect(() => {
  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    if (activeOverlay) return; // OverlayPanel gère déjà
    if (activeStudy) {
      e.preventDefault();
      setActiveStudy(false);
      return;
    }
    if (iconBarHidden) {
      e.preventDefault();
      setIconBarHidden(false);
    }
  }
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [activeOverlay, activeStudy, iconBarHidden]);
```

- [ ] **Step 8 : Commit**

```bash
git add app/map/page.tsx
git commit -m "feat(layout): activeStudy + CTA Étude + bouton retour, supprime tabs Carte/Étude"
```

---

### Task 5.3 : Démonter FilterPanel du layout (le fichier reste pour Phase 6)

**Files:**
- Modify: `app/map/page.tsx`

- [ ] **Step 1 : Localiser le rendu de FilterPanel**

```bash
grep -n '<FilterPanel' app/map/page.tsx
```

Vers ligne 1409.

- [ ] **Step 2 : Supprimer le bloc `<FilterPanel ... />` et son wrapper**

Supprimer entièrement le JSX `<FilterPanel ...>...</FilterPanel>` (de l'ouverture du tag à la fermeture). Garder le wrapper externe (`<div style={{display: 'flex'}}>`) si nécessaire mais simplifier le layout pour que la carte prenne toute la largeur disponible (moins les 48px de l'IconBar).

Le layout simplifié devrait être :

```tsx
return (
  <>
    <IconBar ... />

    {!activeStudy && (
      <div style={{ position: 'fixed', inset: 0, paddingLeft: 48 }}>
        {/* Maximize2 button (z=50) */}
        <button onClick={...}><Maximize2 /></button>

        {/* Toggle Vue comparée (digital, z=25) */}
        {digitalVisible && (...)}

        {/* TripleMapView (z=15) */}
        {digitalVisible && digitalCompareView && (...)}

        {/* MapPanel (carte principale) */}
        <MapPanel ... />

        {/* Légende résidus etc. (autres overlays existants) */}
      </div>
    )}

    {activeOverlay && (
      <OverlayPanel ...>
        {/* switch sur activeOverlay → 6 sub-overlays */}
      </OverlayPanel>
    )}

    {activeStudy && (
      <>
        <button onClick={handleCloseStudy}>← Retour</button>
        <StudyDashboard ville={studyVille} />
      </>
    )}
  </>
);
```

⚠️ **Garder TOUS les autres composants** : MapPanel, TripleMapView, légendes flottantes (résidus de corrélation), DigitalAnalysisPanel, IrisDetailPanel, CaptureLayers, WelcomeOverlay, etc.

⚠️ Garder l'import `FilterPanel` et l'import `DIGITAL_PALETTES` (ce dernier sera potentiellement déplacé en Phase 6 si nécessaire). Vérifier où DIGITAL_PALETTES est utilisé : si c'est dans onDigitalShowImpressions, garder l'import jusqu'en Phase 6.

- [ ] **Step 3 : Garder DIGITAL_PALETTES accessible**

Le constant `DIGITAL_PALETTES` est exporté depuis `FilterPanel.tsx` et utilisé dans page.tsx. Le déplacer maintenant dans un fichier neutre `lib/digital/palettes.ts` :

```typescript
// lib/digital/palettes.ts
export const DIGITAL_PALETTES = [
  /* … copier le contenu exact depuis FilterPanel.tsx … */
];
```

Modifier l'import dans page.tsx : `import { DIGITAL_PALETTES } from '@/lib/digital/palettes';`

Garder l'export depuis FilterPanel pour ne pas casser d'autres consumers (ré-exporter depuis le nouveau fichier) :

```typescript
// FilterPanel.tsx — en haut
export { DIGITAL_PALETTES } from '@/lib/digital/palettes';
```

- [ ] **Step 4 : Type-check + visuel complet**

```bash
npx tsc --noEmit
npm run dev
```

⚠️ **Tests fonctionnels exhaustifs** :
- La carte est plein écran (moins 48px à gauche)
- Aucun panel Expert visible
- Les 6 overlays fonctionnent (cliquer chaque icône, vérifier le contenu)
- Tous les layers s'activent depuis Terrain
- Scoring fonctionne, CTA Étude apparaît, ouvre StudyDashboard
- Digital fonctionne, toggle Vue comparée fonctionne, TripleMapView affichable
- IrisDetailPanel s'affiche au clic IRIS
- CaptureLayers (custom geo) fonctionne
- Click-outside ferme l'overlay (clic carte)
- Esc ferme overlay/study/iconbar selon priorité
- Maximize2 toggle l'IconBar (z=50, cliquable même avec overlay ouvert)

- [ ] **Step 5 : Commit**

```bash
git add app/map/page.tsx app/map/_components/FilterPanel.tsx lib/digital/palettes.ts
git commit -m "feat(layout): démonte FilterPanel, layout map plein écran complet"
```

---

## Phase 6 — Cleanup (suppression FilterPanel)

### Task 6.1 : Vérifier qu'aucun autre fichier n'importe FilterPanel

**Files:** —

- [ ] **Step 1 : Recherche d'imports**

```bash
grep -rn "from '@/app/map/_components/FilterPanel'" --include='*.ts' --include='*.tsx' .
grep -rn 'FilterPanel' --include='*.ts' --include='*.tsx' . | grep -v 'app/map/_components/FilterPanel.tsx' | grep -v 'docs/'
```

Expected : aucun résultat sauf documentation.

- [ ] **Step 2 : Si DIGITAL_PALETTES est encore importé depuis FilterPanel**

Vérifier `grep -rn "DIGITAL_PALETTES" --include='*.tsx' .` : si certains fichiers importent depuis `@/app/map/_components/FilterPanel`, les rediriger vers `@/lib/digital/palettes`.

---

### Task 6.2 : Supprimer FilterPanel.tsx

**Files:**
- Delete: `app/map/_components/FilterPanel.tsx`

- [ ] **Step 1 : Supprimer le fichier**

```bash
git rm app/map/_components/FilterPanel.tsx
```

- [ ] **Step 2 : Type-check**

```bash
npx tsc --noEmit
```

Expected : 0 erreurs (sinon corriger les imports qui restent).

- [ ] **Step 3 : Build complet**

```bash
npm run build
```

Expected : build réussi, 0 erreurs.

- [ ] **Step 4 : Test visuel**

```bash
npm run dev
```

Vérifier que /map fonctionne identiquement (smoke test rapide).

- [ ] **Step 5 : Commit**

```bash
git commit -m "refactor(layout): supprime FilterPanel.tsx (3468 lignes — code mort post-migration)"
```

---

## Phase 7 — Responsive

### Task 7.1 : IconBar responsive (bottom bar mobile)

**Files:**
- Modify: `components/map/IconBar.tsx`

- [ ] **Step 1 : Détecter le viewport via media query CSS**

L'approche la plus simple est CSS-only via `@media`. Modifier le `style` inline de l'IconBar pour utiliser des classes au lieu (ou un mix style + className). Plus robuste : utiliser un hook `useMediaQuery`.

Créer `lib/hooks/useMediaQuery.ts` :

```typescript
import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const handler = () => setMatches(mq.matches);
    handler();
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [query]);
  return matches;
}
```

- [ ] **Step 2 : Adapter IconBar pour mode mobile**

Dans `IconBar.tsx`, importer `useMediaQuery` et adapter :

```typescript
const isMobile = useMediaQuery('(max-width: 767px)');
const isTablet = useMediaQuery('(min-width: 768px) and (max-width: 1023px)');
const showLabels = !isMobile && !isTablet;
```

Si `isMobile` :

```typescript
style={{
  position: 'fixed',
  bottom: 0, // au lieu de top:0
  left: 0,
  right: 0,  // au lieu de bottom:0
  width: '100%',  // au lieu de 48
  height: 56,
  flexDirection: 'row',  // au lieu de column
  borderRight: 'none',
  borderTop: '0.5px solid var(--border-subtle)',
  padding: '0 8px',
  gap: 8,
  transform: hidden ? 'translateY(100%)' : 'translateY(0)',  // slide vers le bas
  /* … */
}}
```

Et adapter `IconButton` : pas de label si `isMobile` ou `isTablet` (déjà géré par `showLabels`).

Le `mt-auto` sur Settings ne s'applique plus en horizontal — le pousser à droite via `marginLeft: 'auto'` quand `isMobile`. Adapter le `<div style={{ marginTop: 'auto', ... }}>` :

```typescript
<div style={{
  marginTop: isMobile ? 0 : 'auto',
  marginLeft: isMobile ? 'auto' : 0,
  display: 'flex',
  flexDirection: isMobile ? 'row' : 'column',
  gap: isMobile ? 8 : 4,
  alignItems: 'center',
}}>
```

- [ ] **Step 3 : Adapter le padding du contenu page.tsx**

Quand `isMobile`, le wrapper carte ne doit plus avoir `paddingLeft: 48` mais `paddingBottom: 56`. Solution : utiliser CSS classes responsive ou passer le mode au layout. Simple : exporter une constante depuis IconBar (`ICON_BAR_OFFSET_PROPERTY`) ou utiliser CSS variables.

Approche CSS variable : dans `IconBar.tsx` useEffect :

```typescript
useEffect(() => {
  document.documentElement.style.setProperty('--icon-bar-offset-left', isMobile ? '0px' : '48px');
  document.documentElement.style.setProperty('--icon-bar-offset-bottom', isMobile ? '56px' : '0px');
}, [isMobile]);
```

Dans `page.tsx`, le wrapper carte utilise :

```typescript
style={{
  position: 'fixed',
  inset: 0,
  paddingLeft: 'var(--icon-bar-offset-left, 48px)',
  paddingBottom: 'var(--icon-bar-offset-bottom, 0px)',
}}
```

- [ ] **Step 4 : Type-check + visuel mobile (devtools responsive)**

```bash
npx tsc --noEmit
npm run dev
```

Resize la fenêtre à 600px de large : IconBar passe en bas (horizontal). Resize à 900px : labels masqués mais IconBar reste à gauche. Resize à 1200px : labels visibles.

- [ ] **Step 5 : Commit**

```bash
git add components/map/IconBar.tsx lib/hooks/useMediaQuery.ts app/map/page.tsx
git commit -m "feat(layout): IconBar responsive — bottom bar mobile, labels conditionnels"
```

---

### Task 7.2 : OverlayPanel responsive (bottom sheet mobile)

**Files:**
- Modify: `components/map/OverlayPanel.tsx`

- [ ] **Step 1 : Détecter mobile dans OverlayPanel**

Importer et utiliser `useMediaQuery('(max-width: 767px)')` dans OverlayPanel.

- [ ] **Step 2 : Adapter le style si mobile**

```typescript
const isMobile = useMediaQuery('(max-width: 767px)');
const isTablet = useMediaQuery('(min-width: 768px) and (max-width: 1023px)');

const overlayStyle = isMobile ? {
  position: 'fixed' as const,
  bottom: 56, // au-dessus de la bottom bar
  left: 0,
  right: 0,
  width: '100%',
  maxHeight: '70vh',
  borderRadius: '16px 16px 0 0',
  transform: mounted ? 'translateY(0)' : 'translateY(100%)',
  transition: 'transform 200ms ease',
} : {
  position: 'fixed' as const,
  top: 12,
  left: 56,
  width: isTablet ? 260 : 280,
  maxHeight: 'calc(100vh - 24px)',
  borderRadius: 12,
  transform: mounted ? 'translateX(0)' : 'translateX(-8px)',
  transition: 'opacity 150ms ease, transform 150ms ease',
};
```

Appliquer ce `overlayStyle` au `<div ref={ref}>`. Pour le mobile, ajouter une drag handle en haut du header :

```tsx
{isMobile && (
  <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 0' }}>
    <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--border-default)' }} />
  </div>
)}
```

- [ ] **Step 3 : Type-check + visuel**

```bash
npx tsc --noEmit
npm run dev
```

Resize à 600px : overlay devient bottom sheet 70vh avec drag handle.

- [ ] **Step 4 : Commit**

```bash
git add components/map/OverlayPanel.tsx
git commit -m "feat(layout): OverlayPanel responsive — bottom sheet mobile avec drag handle"
```

---

## Phase 8 — Cleanup post-livraison

### Task 8.1 : Lance cleanup-geomatik partie 2 (lint + types)

**Files:** —

- [ ] **Step 1 : Type-check global**

```bash
npx tsc --noEmit
```

Expected : 0 erreurs.

- [ ] **Step 2 : Lint global**

```bash
npm run lint
```

Lister toutes les erreurs/warnings sur les fichiers modifiés cette session :
- `components/map/IconBar.tsx`
- `components/map/OverlayPanel.tsx`
- `components/map/overlays/*.tsx`
- `components/layout/MainPadding.tsx`
- `components/layout/TopRightChrome.tsx`
- `app/layout.tsx`
- `app/map/page.tsx`
- `lib/hooks/useMediaQuery.ts`
- `lib/digital/palettes.ts`

- [ ] **Step 3 : Corriger toutes les erreurs**

Pour chaque erreur de lint/types, corriger inline. Aucune erreur ne doit subsister.

- [ ] **Step 4 : Build complet**

```bash
npm run build
```

Expected : build OK, 0 warnings critiques.

- [ ] **Step 5 : Commit**

```bash
git add -A
git commit -m "chore(cleanup): lint + types post-refonte overlay"
```

---

### Task 8.2 : Lance cleanup-geomatik partie 3 (sécurité)

**Files:** —

- [ ] **Step 1 : Audit sécurité sur les fichiers modifiés**

Pour chaque nouveau fichier, vérifier :
- Pas d'`any` non typé
- Pas de `dangerouslySetInnerHTML` non sanitizé
- Pas de `eval` ou Function constructor
- Pas de fetch sans gestion d'erreur
- Catch blocks correctement typés (`catch (err: unknown)`)
- Pas de leak d'event listener (cleanup dans useEffect return)

- [ ] **Step 2 : Vérifier les useEffect cleanup**

```bash
grep -rn "useEffect" components/map/ lib/hooks/useMediaQuery.ts | wc -l
```

Pour chaque `useEffect` ajouté, vérifier qu'il y a un `return () => ...` qui cleanup les listeners.

- [ ] **Step 3 : Vérifier qu'aucune route API battle/* n'est touchée**

```bash
git diff main..HEAD --name-only | grep -E '(api/isochrone-battle|battle_)'
```

Expected : aucun résultat (interdit modif selon CLAUDE.md).

- [ ] **Step 4 : Si corrections nécessaires, appliquer + commit**

```bash
git add -A
git commit -m "chore(cleanup): sécurité post-refonte overlay"
```

---

### Task 8.3 : Tag de version + récap final

**Files:**
- Modify: `lib/version.ts` (incrémenter APP_VERSION)

- [ ] **Step 1 : Lire la version actuelle**

```bash
cat lib/version.ts
```

Actuellement `7.14.0`. Bump en `7.15.0` (feature majeure UI).

- [ ] **Step 2 : Modifier lib/version.ts**

Remplacer `7.14.0` par `7.15.0`.

- [ ] **Step 3 : Commit final + tag**

```bash
git add lib/version.ts
git commit -m "feat(layout): barre icônes + overlay flottant — carte plein écran (v7.15.0)"
git tag "icon-bar-overlay-$(date +%Y%m%d)"
```

- [ ] **Step 4 : Récap pour l'utilisateur**

Résumer : nombre de commits, fichiers créés/modifiés/supprimés, breaking changes (FilterPanel supprimé), nouvelle structure, comment merger dans main (PR ou fast-forward).

---

## Critères d'acceptation finaux (à valider avant de considérer la tâche close)

- [ ] `npm run build` — 0 erreurs
- [ ] `npx tsc --noEmit` — 0 erreurs
- [ ] `npm run lint` — 0 erreurs (warnings tolérés si déjà présents avant)
- [ ] La carte est plein écran (uniquement 48px IconBar à gauche)
- [ ] Les 7 icônes IconBar visibles + cliquables
- [ ] Clic icône X ouvre overlay X, re-clic ferme
- [ ] Switch entre overlays sans flash de fermeture
- [ ] Esc ferme overlay (priorité 1), puis Étude, puis IconBar caché
- [ ] Touche `/` ouvre overlay AI (sauf si focus dans input)
- [ ] Click-outside (carte) ferme overlay
- [ ] Maximize2 toggle iconBarHidden (z=50, accessible avec overlay ouvert)
- [ ] geo.prompt fonctionne dans overlay AI
- [ ] Tous les layers fonctionnent dans overlay Terrain (POI/OOH/Transport/TMJA/Radio/IRIS/Carreaux)
- [ ] Scoring fonctionne, CTA "Ouvrir l'étude" apparaît dans overlay Analyses, badge teal sur icône
- [ ] StudyDashboard plein écran avec bouton "← Retour carte" top-left
- [ ] Digital fonctionne, TripleMapView en vue comparée OK
- [ ] Settings : fond carte change, sauvegarde vue OK, ThemeToggle OK, liens nav OK
- [ ] Responsive : <768px = bottom bar + bottom sheet
- [ ] AppSidebar masquée sur /map, présente ailleurs
- [ ] FilterPanel.tsx supprimé
- [ ] Aucune route API battle/* modifiée

---

*Fin du plan. Total estimé : 8 phases × 2-7 tâches = ~30 tâches, ~15-20 commits, branche `feat/icon-bar-overlay`.*
