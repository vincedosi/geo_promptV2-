# Dark/Light Mode Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a production-ready dark/light mode for GEOMATIK customer-facing surfaces, with persistent user preference, zero-flicker load, and teal `#4ecdc4` accent invariant across both themes.

**Architecture:** A React `ThemeProvider` context + `useTheme` hook drives a `"dark" | "light"` class on `<html>`. All colors flow through CSS variables defined at `:root` (dark, default) and `html.light`. Existing 4-level dark scale (`#050505`/`#0a0a0a`/`#111111`/`#181818`) is preserved; light mode mirrors it. Tailwind config exposes the CSS vars as utility classes (`bg-bg-primary`, `text-text-secondary`, etc.). An inline blocking `<script>` in `<head>` sets the class before React hydrates, eliminating flash. Phase 1 scope is six customer-facing surfaces; admin routes keep hardcoded dark until Phase 2.

**Tech Stack:** Next.js 14 App Router, React 19, TypeScript strict, Tailwind CSS 3.4 + shadcn, lucide-react icons, localStorage for persistence.

**Source of truth spec:** `docs/geomatik-darkmode-final.md`

---

## File Structure

**Created:**
- `lib/theme/ThemeProvider.tsx` — Context + `useTheme` hook + hydration-safe mount gate
- `components/ThemeToggle.tsx` — Fixed top-right button with Sun/Moon icons
- `tests/unit/theme/ThemeProvider.test.tsx` — Vitest covering localStorage hydration & toggle

**Modified:**
- `app/globals.css` — Add `:root` + `html.light` CSS var blocks; migrate `.g-*` primitives to vars
- `tailwind.config.ts` — Expose `bg.*`, `text.*`, `border`, `accent` tokens backed by CSS vars
- `app/layout.tsx` — Remove static `className="dark"`, add blocking script, wrap in `ThemeProvider`, mount `ThemeToggle` next to `SessionBadge`
- `components/AppSidebar.tsx` — Replace hardcoded `#0a0a0a`/`#f0f0f0`/`#1a1a1a`/`#111111` with Tailwind theme tokens
- `components/ui/section-header.tsx` — Tokenize
- `app/map/page.tsx` — Tokenize chrome (backgrounds, borders, text)
- `app/map/_components/FilterPanel.tsx` — Tokenize surfaces and borders (keep map layer colors as-is)
- `app/copilote/layout.tsx` — Tokenize
- `app/copilote/_components/ChatPanel.tsx` — Tokenize message bubbles & panel chrome
- `app/copilote/_components/MapPanel.tsx` — Tokenize chrome only

**Out of scope (Phase 2):** everything under `app/admin/*`, `app/dashboard/iris-crawler`, `app/integration-panneaux`, `app/clusters`, `app/login`, all other `app/copilote/_components/*.tsx` beyond ChatPanel/MapPanel.

---

## Task 1: Create ThemeProvider with hydration-safe mount gate

**Files:**
- Create: `lib/theme/theme-utils.ts` (pure helpers — testable in node env)
- Create: `lib/theme/ThemeProvider.tsx` (React context + hook)
- Create: `tests/unit/theme/theme-utils.test.ts` (Vitest)

**Constraint:** Project Vitest uses `environment: 'node'` and includes only `tests/**/*.test.ts`. We test pure helpers — not React rendering — so no `@testing-library/react` or `jsdom` install is needed.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/theme/theme-utils.test.ts
import { describe, it, expect } from 'vitest'
import { resolveInitialTheme, nextTheme, STORAGE_KEY } from '@/lib/theme/theme-utils'

function makeStorage(initial: Record<string, string> = {}) {
  const data: Record<string, string> = { ...initial }
  return {
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => {
      data[k] = v
    },
  }
}

describe('resolveInitialTheme', () => {
  it('returns "dark" when storage is empty', () => {
    expect(resolveInitialTheme(makeStorage())).toBe('dark')
  })

  it('returns "light" when storage has "light"', () => {
    expect(resolveInitialTheme(makeStorage({ [STORAGE_KEY]: 'light' }))).toBe('light')
  })

  it('returns "dark" when storage has "dark"', () => {
    expect(resolveInitialTheme(makeStorage({ [STORAGE_KEY]: 'dark' }))).toBe('dark')
  })

  it('falls back to "dark" when storage has garbage', () => {
    expect(resolveInitialTheme(makeStorage({ [STORAGE_KEY]: 'purple' }))).toBe('dark')
  })

  it('returns "dark" when storage is null (SSR)', () => {
    expect(resolveInitialTheme(null)).toBe('dark')
  })
})

describe('nextTheme', () => {
  it('toggles dark → light', () => {
    expect(nextTheme('dark')).toBe('light')
  })

  it('toggles light → dark', () => {
    expect(nextTheme('light')).toBe('dark')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/theme/theme-utils.test.ts`
Expected: FAIL — `Cannot find module '@/lib/theme/theme-utils'`.

- [ ] **Step 3: Implement the pure helpers**

```ts
// lib/theme/theme-utils.ts
export type Theme = 'dark' | 'light'

export const STORAGE_KEY = 'geomatik-theme'

type StorageLike = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

export function resolveInitialTheme(storage: StorageLike | null | undefined): Theme {
  if (!storage) return 'dark'
  const raw = storage.getItem(STORAGE_KEY)
  return raw === 'light' || raw === 'dark' ? raw : 'dark'
}

export function nextTheme(current: Theme): Theme {
  return current === 'dark' ? 'light' : 'dark'
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/theme/theme-utils.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Implement ThemeProvider on top of the helpers**

```tsx
// lib/theme/ThemeProvider.tsx
'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { type Theme, STORAGE_KEY, resolveInitialTheme, nextTheme } from './theme-utils'

type ThemeContextValue = {
  theme: Theme
  toggleTheme: () => void
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

function applyThemeClass(theme: Theme) {
  const root = document.documentElement
  if (theme === 'dark') {
    root.classList.add('dark')
    root.classList.remove('light')
  } else {
    root.classList.add('light')
    root.classList.remove('dark')
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() =>
    resolveInitialTheme(typeof window === 'undefined' ? null : window.localStorage)
  )

  useEffect(() => {
    applyThemeClass(theme)
    try {
      window.localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      /* localStorage may be unavailable (SSR/iframe) — ignore */
    }
  }, [theme])

  const value: ThemeContextValue = {
    theme,
    setTheme: setThemeState,
    toggleTheme: () => setThemeState(nextTheme),
  }

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within <ThemeProvider>')
  return ctx
}

export type { Theme }
```

The React provider wraps the pure helpers. No additional test needed — the React rendering itself is validated by manual smoke in Task 5.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/theme/theme-utils.ts lib/theme/ThemeProvider.tsx tests/unit/theme/theme-utils.test.ts
git commit -m "feat(theme): add ThemeProvider context with localStorage persistence"
```

---

## Task 2: Create ThemeToggle component

**Files:**
- Create: `components/ThemeToggle.tsx`

- [ ] **Step 1: Implement ThemeToggle**

```tsx
// components/ThemeToggle.tsx
'use client'

import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@/lib/theme/ThemeProvider'

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  const next: 'dark' | 'light' = theme === 'dark' ? 'light' : 'dark'

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={`Passer en ${next === 'dark' ? 'mode sombre' : 'mode clair'}`}
      aria-label={`Basculer le thème (actuel : ${theme})`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 30,
        height: 30,
        padding: 0,
        borderRadius: 6,
        background: 'transparent',
        border: '0.5px solid transparent',
        cursor: 'pointer',
        color: 'var(--text-secondary)',
        transition: 'all 0.15s ease',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'var(--bg-level-2)'
        e.currentTarget.style.borderColor = 'var(--border-default)'
        e.currentTarget.style.color = 'var(--text-primary)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.borderColor = 'transparent'
        e.currentTarget.style.color = 'var(--text-secondary)'
      }}
    >
      {theme === 'dark' ? <Sun size={15} strokeWidth={1.5} /> : <Moon size={15} strokeWidth={1.5} />}
    </button>
  )
}
```

Rationale on styling: inline styles using `var(--*)` keep ThemeToggle self-contained and reactive to theme without relying on Tailwind config changes (which happen in Task 4). 30×30 sizing matches the visual weight of SessionBadge's 22×22 org chip + 10px padding.

- [ ] **Step 2: Commit**

```bash
git add components/ThemeToggle.tsx
git commit -m "feat(theme): add ThemeToggle button with Sun/Moon icons"
```

---

## Task 3: Add CSS variables to globals.css

**Files:**
- Modify: `app/globals.css` (replace the `@layer base { :root { ... } .dark { ... } }` block)

- [ ] **Step 1: Replace the existing `:root` + `.dark` block with the dual-theme token block**

Find the current block that starts with `@layer base {` and ends at the closing `}` before the `/* ─── Base ─── */` banner (around lines 8-73 of current `globals.css`). Replace it with:

```css
@layer base {
  :root {
    /* shadcn/ui HSL tokens — dark mode values (default) */
    --background: 0 0% 2%;
    --foreground: 0 0% 94%;
    --card: 0 0% 4%;
    --card-foreground: 0 0% 94%;
    --popover: 0 0% 7%;
    --popover-foreground: 0 0% 94%;
    --primary: 0 0% 94%;
    --primary-foreground: 0 0% 2%;
    --secondary: 0 0% 7%;
    --secondary-foreground: 0 0% 63%;
    --muted: 0 0% 9%;
    --muted-foreground: 0 0% 54%;
    --accent: 174 52% 55%;
    --accent-foreground: 0 0% 2%;
    --destructive: 0 100% 67%;
    --destructive-foreground: 0 0% 94%;
    --border: 0 0% 10%;
    --input: 0 0% 10%;
    --ring: 174 52% 55%;
    --radius: 0.375rem;

    /* GEOMATIK scale (dark defaults) */
    --bg-level-0: #050505;   /* primary background */
    --bg-level-1: #0a0a0a;   /* surface cards/panels */
    --bg-level-2: #111111;   /* elevated / section bands */
    --bg-level-3: #181818;   /* hover/focus */
    --bg-primary: var(--bg-level-0);
    --bg-surface: var(--bg-level-1);
    --bg-hover:   var(--bg-level-3);

    --border-subtle:  #1a1a1a;
    --border-default: #262626;
    --border-hover:   #333333;

    --text-primary:   #f0f0f0;
    --text-secondary: #a0a0a0;
    --text-tertiary:  #666666;

    --brand-teal: #4ecdc4;
    --brand-teal-hover: #3dbdb5;
    --brand-teal-30: rgba(78,205,196,0.3);
    --brand-teal-50: rgba(78,205,196,0.5);
    --brand-teal-10: rgba(78,205,196,0.1);

    --success: #3dffa0;
    --danger:  #ff5757;
    --warning: #f7b731;
    --info:    #5b9bd5;

    --sidebar-width: 240px;
  }

  /* Light mode — triggered by <html class="light"> */
  html.light {
    --background: 0 0% 100%;
    --foreground: 0 0% 10%;
    --card: 0 0% 96%;
    --card-foreground: 0 0% 10%;
    --popover: 0 0% 100%;
    --popover-foreground: 0 0% 10%;
    --primary: 0 0% 10%;
    --primary-foreground: 0 0% 100%;
    --secondary: 0 0% 94%;
    --secondary-foreground: 0 0% 30%;
    --muted: 0 0% 92%;
    --muted-foreground: 0 0% 40%;
    --accent: 174 52% 45%;
    --accent-foreground: 0 0% 100%;
    --destructive: 0 84% 55%;
    --destructive-foreground: 0 0% 100%;
    --border: 0 0% 85%;
    --input: 0 0% 85%;
    --ring: 174 52% 45%;

    /* GEOMATIK scale (light mirror) */
    --bg-level-0: #ffffff;
    --bg-level-1: #f5f5f5;
    --bg-level-2: #eeeeee;
    --bg-level-3: #e2e2e2;
    --bg-primary: var(--bg-level-0);
    --bg-surface: var(--bg-level-1);
    --bg-hover:   var(--bg-level-3);

    --border-subtle:  #e5e5e5;
    --border-default: #d0d0d0;
    --border-hover:   #b8b8b8;

    --text-primary:   #1a1a1a;
    --text-secondary: #555555;
    --text-tertiary:  #8a8a8a;

    /* Accent invariant — teal stays the same across themes */
    --brand-teal: #4ecdc4;
    --brand-teal-hover: #3dbdb5;
    --brand-teal-30: rgba(78,205,196,0.3);
    --brand-teal-50: rgba(78,205,196,0.5);
    --brand-teal-10: rgba(78,205,196,0.1);

    --success: #0fa958;
    --danger:  #d4202f;
    --warning: #c08400;
    --info:    #3a78c0;
  }

  /* Keep .dark selector for compatibility with shadcn components that target it */
  .dark {
    color-scheme: dark;
  }

  html.light {
    color-scheme: light;
  }
}
```

Then update the existing `html, body` block (around line 83-90) to use tokens:

```css
html,
body {
  height: 100%;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: 'Inter', system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  transition: background-color 0.2s ease, color 0.2s ease;
}
```

Leave everything below `html, body` unchanged in this task — the `.g-*` primitives migrate in Task 6.

- [ ] **Step 2: Verify build still compiles**

Run: `npx tsc --noEmit`
Expected: PASS (no TypeScript errors — CSS changes don't touch TS).

Run: `npm run build`
Expected: Build succeeds. If pre-existing iris-crawler TS error (see memory `1451`) appears, note it but do not fix here.

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "feat(theme): add dual-mode CSS variables (dark default + light)"
```

---

## Task 4: Extend Tailwind config with theme tokens

**Files:**
- Modify: `tailwind.config.ts`

- [ ] **Step 1: Add theme-backed color tokens alongside existing ones**

In `tailwind.config.ts`, inside `theme.extend.colors`, add the following entries. Do not remove existing shadcn tokens or `geo-*` tokens — both continue to work.

```ts
// Append inside theme.extend.colors, after the existing `geo-*` block:

        // ── Theme-backed tokens (dark/light via CSS vars) ────────────────
        'bg-primary':  'var(--bg-primary)',
        'bg-surface':  'var(--bg-surface)',
        'bg-hover':    'var(--bg-hover)',
        'bg-level-0':  'var(--bg-level-0)',
        'bg-level-1':  'var(--bg-level-1)',
        'bg-level-2':  'var(--bg-level-2)',
        'bg-level-3':  'var(--bg-level-3)',
        'text-primary':   'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-tertiary':  'var(--text-tertiary)',
        'border-subtle':  'var(--border-subtle)',
        'border-default': 'var(--border-default)',
        'border-hover':   'var(--border-hover)',
        'accent-teal':    'var(--brand-teal)',
        'accent-teal-hover': 'var(--brand-teal-hover)',
```

Flat color keys (not nested objects) are used so classes resolve as `bg-bg-primary`, `text-text-primary`, `border-border-subtle`, etc. — explicit and unambiguous.

- [ ] **Step 2: Verify Tailwind picks up the tokens**

Run: `npx tsc --noEmit`
Expected: PASS.

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add tailwind.config.ts
git commit -m "feat(theme): expose theme CSS vars as Tailwind color tokens"
```

---

## Task 5: Wire ThemeProvider + anti-flicker + ThemeToggle into layout

**Files:**
- Modify: `app/layout.tsx` (full rewrite — current file is 40 lines)

- [ ] **Step 1: Rewrite `app/layout.tsx`**

```tsx
import type { Metadata } from 'next'
import './globals.css'
import AppSidebar from '@/components/AppSidebar'
import { SessionBadge } from '@/components/SessionBadge'
import { ToastProvider } from '@/components/ui/geo-toast'
import { SplashScreen } from '@/components/ui/SplashScreen'
import { ThemeProvider } from '@/lib/theme/ThemeProvider'
import { ThemeToggle } from '@/components/ThemeToggle'

export const metadata: Metadata = {
  title: 'GEOMATIK — Geospatial intelligence',
  description: 'Plateforme de géomarketing OOH — ciblage, scoring et mesure de campagnes d\'affichage extérieur.',
  icons: [{ rel: 'icon', url: '/geomatik-icon.svg', type: 'image/svg+xml' }],
}

// Blocking script: runs before React hydrates, so the correct `dark`/`light`
// class is already on <html> when the first frame paints. Prevents flash.
const themeInitScript = `
(function() {
  try {
    var saved = localStorage.getItem('geomatik-theme');
    var theme = (saved === 'light' || saved === 'dark') ? saved : 'dark';
    var root = document.documentElement;
    if (theme === 'light') {
      root.classList.add('light');
      root.classList.remove('dark');
    } else {
      root.classList.add('dark');
      root.classList.remove('light');
    }
  } catch (e) {
    document.documentElement.classList.add('dark');
  }
})();
`

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
        <ThemeProvider>
          <SplashScreen minDuration={2000} />
          <ToastProvider>
            <AppSidebar />
            <div
              style={{
                position: 'fixed',
                top: 0,
                right: 0,
                zIndex: 200,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
              }}
            >
              <ThemeToggle />
              <SessionBadge />
            </div>
            <main
              className="md:pl-[240px] min-h-screen"
              style={{ background: 'var(--bg-primary)' }}
            >
              <div className="p-8">
                {children}
              </div>
            </main>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
```

Changes vs current file:
1. Removed static `className="dark"` from `<html>`.
2. Added `suppressHydrationWarning` on `<html>` because the blocking script mutates `classList` before React hydrates.
3. Added blocking script in `<head>`.
4. Wrapped everything in `<ThemeProvider>`.
5. Inlined `ThemeToggle` before `SessionBadge` inside the existing fixed top-right container.
6. Body + main backgrounds use `var(--bg-primary)` instead of `#050505`.

- [ ] **Step 2: Type-check and build**

Run: `npx tsc --noEmit`
Expected: PASS.

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Manual smoke test (dev server)**

Run: `npm run dev`

Checks (open http://localhost:3000):
1. First load: page is dark, no light flash.
2. Click ThemeToggle (top-right Sun icon): page switches to light, icon becomes Moon. All `.g-card`/`.g-btn` primitives may still look dark — that's expected; Task 6 fixes them.
3. Refresh: stays light.
4. Click toggle back to dark: refresh stays dark.
5. DevTools → Application → Local Storage: `geomatik-theme` key present with correct value.
6. DevTools → Elements: `<html class="dark">` or `<html class="light">` flips on toggle.

- [ ] **Step 4: Commit**

```bash
git add app/layout.tsx
git commit -m "feat(theme): wire ThemeProvider and ThemeToggle into root layout"
```

---

## Task 6: Migrate `.g-*` primitives in globals.css to CSS variables

**Files:**
- Modify: `app/globals.css` (the `.g-card`, `.g-btn-*`, `.g-input`, `.g-badge*`, `.g-alert*`, `.g-label`, `.g-divider`, `.g-progress*`, `.g-row`, `.g-radio-card`, `.geo-section-header`, `.page-*`, `.stat-*`, `.g-code`, scrollbar, selection, `details` blocks)

- [ ] **Step 1: Replace hardcoded colors inside each primitive with `var(--*)` tokens**

Apply these substitutions globally within `globals.css` (everything below the `@layer base` block). Use Edit tool for each rule.

Substitution table:
- `#050505` → `var(--bg-primary)`
- `#0a0a0a` → `var(--bg-surface)` (for `.g-card`, `.stat-card`, `.g-code`, `.g-row`, `.maplibregl-popup-content`)
- `#111111` → `var(--bg-level-2)`
- `#181818` → `var(--bg-level-3)`
- `#1a1a1a` → `var(--border-subtle)` (for borders) or `var(--bg-level-2)` for shimmer keyframe middle stop — prefer keeping shimmer middle as a light/dark-safe value: replace `#1a1a1a` in the shimmer gradient with `var(--bg-level-2)` so shimmer adapts.
- `#262626` → `var(--border-default)`
- `#333333` → `var(--border-hover)`
- `#f0f0f0` → `var(--text-primary)`
- `#a0a0a0` → `var(--text-secondary)`
- `#666666` → `var(--text-tertiary)`
- `#4ecdc4` → `var(--brand-teal)`
- `rgba(78,205,196,0.5)` → `var(--brand-teal-50)`
- `rgba(78,205,196,0.3)` → `var(--brand-teal-30)`
- `rgba(78,205,196,0.1)` → `var(--brand-teal-10)`
- `rgba(78,205,196,0.2)` → keep inline (border accent with fixed alpha) OR replace with a new `--brand-teal-20` var. For this task, keep inline — noise/value ratio too low.

Keep the scrollbar track `#050505` → `var(--bg-primary)`.

The dot/status colors `#3dffa0`, `#ff5757`, `#f7b731` map to `var(--success)`, `var(--danger)`, `var(--warning)`. Their `rgba(...)` variants (alerts, badges) keep inline rgba because mixing alpha with CSS var color-mix complicates browser support — acceptable trade-off for Phase 1.

Example — `.g-card`:

```css
.g-card {
  background: var(--bg-surface);
  border: 0.5px solid var(--border-subtle);
  border-radius: 6px;
  transition: border-color 0.15s ease;
}

.g-card:hover {
  border-color: var(--border-default);
}

.g-card-header {
  padding: 10px 14px;
  background: var(--bg-level-2);
  border-bottom: 1px solid var(--border-subtle);
  display: flex;
  align-items: center;
  gap: 8px;
}

.g-card-header::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--brand-teal);
  flex-shrink: 0;
}

.g-card-title {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
  font-family: 'Inter', sans-serif;
}
```

Apply the analogous substitution to every `.g-*`, `.geo-*`, `.page-*`, `.stat-*`, `.maplibregl-popup-*`, scrollbar, `details > summary` rule in the file.

- [ ] **Step 2: Build and smoke test**

Run: `npm run build`
Expected: Build succeeds.

Run: `npm run dev` and manually verify:
1. Dark mode looks identical to before (visual regression check).
2. Toggle to light: `.g-card`, `.g-btn-ghost`, `.geo-section-header`, `.stat-card`, `.page-title` all flip to light surfaces + dark text.
3. Scrollbar thumb is visible in both modes.
4. Teal accents (section dots, focus rings, buttons) are identical in both modes.

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "refactor(theme): migrate .g-* primitives in globals.css to CSS variables"
```

---

## Task 7: Tokenize `components/ui/section-header.tsx`

**Files:**
- Modify: `components/ui/section-header.tsx`

- [ ] **Step 1: Read the file and identify hardcoded colors**

Read `components/ui/section-header.tsx`. Map each literal color hex / rgba to its token from the Task 6 table.

- [ ] **Step 2: Replace hardcoded colors with `var(--*)` in inline styles or `bg-bg-level-2`/`text-text-primary` in className**

Prefer `var(--*)` inline for style props, Tailwind classes (`bg-bg-level-2`, `text-text-primary`, `border-border-subtle`) when already using className.

Concrete substitutions (use the Task 6 mapping table). Example:
- `style={{ background: '#111111' }}` → `style={{ background: 'var(--bg-level-2)' }}`
- `style={{ color: '#f0f0f0' }}` → `style={{ color: 'var(--text-primary)' }}`
- `className="bg-[#111111]"` → `className="bg-bg-level-2"`
- `borderTop: '1px solid #1a1a1a'` → `borderTop: '1px solid var(--border-subtle)'`

Keep the dot color `#4ecdc4` → `var(--brand-teal)` (invariant anyway, but tokenize for consistency).

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/ui/section-header.tsx
git commit -m "refactor(theme): tokenize section-header primitive"
```

---

## Task 8: Tokenize `components/AppSidebar.tsx`

**Files:**
- Modify: `components/AppSidebar.tsx`

- [ ] **Step 1: Apply substitutions from the Task 6 mapping to both inline `style` props and Tailwind arbitrary values**

Concrete replacements in this file:
- `style={{ background: '#0a0a0a' }}` → `style={{ background: 'var(--bg-surface)' }}` (sidebar container, Sheet)
- `style={{ background: '#1a1a1a', height: '0.5px' }}` → `style={{ background: 'var(--border-subtle)', height: '0.5px' }}` (Separator)
- `stroke="#4ecdc4"` → keep as-is (SVG attribute, teal is invariant) or use `var(--brand-teal)` via `style` prop on SVG. Keep literal for simplicity — teal doesn't change.
- `color: '#f0f0f0'` → `color: 'var(--text-primary)'`
- `color: '#666666'` → `color: 'var(--text-tertiary)'`
- `color: '#8a8a8a'` → `color: 'var(--text-tertiary)'` (close enough; `#8a8a8a` is not a design system token, map to nearest)
- `color: '#a0a0a0'` → `color: 'var(--text-secondary)'`
- `color: '#333333'` → `color: 'var(--border-hover)'`
- `background: '#181818'` → `background: 'var(--bg-level-3)'`
- `border: '0.5px solid #262626'` → `border: '0.5px solid var(--border-default)'`
- `border: '0.5px solid #1a1a1a'` → `border: '0.5px solid var(--border-subtle)'`
- `borderRight: '0.5px solid #1a1a1a'` → `borderRight: '0.5px solid var(--border-subtle)'`
- `background: '#3dffa0'` → keep literal (status indicator, dark-only semantic).

Tailwind arbitrary value swaps in the `NavLink` component (lines 97-131):
- `'bg-[#151515] text-[#f0f0f0] border-[#f0f0f0]'` → `'bg-bg-level-3 text-text-primary border-text-primary'`
- `'text-[#a0a0a0] border-transparent hover:bg-[#111111] hover:text-[#f0f0f0] ...'` → `'text-text-secondary border-transparent hover:bg-bg-level-2 hover:text-text-primary ...'`
- `'text-[#f0f0f0]'` inside the icon className → `'text-text-primary'`
- `'text-[#666666] group-hover:text-[#a0a0a0]'` → `'text-text-tertiary group-hover:text-text-secondary'`

The badge style block (lines 121-127) already uses inline style — apply the substitutions to `#181818`, `#262626`, `#666666`.

Note on `#151515`: not in the design system. Map to nearest: `var(--bg-level-3)` (`#181818`) — imperceptible.

- [ ] **Step 2: Build and smoke test**

Run: `npx tsc --noEmit` → PASS.
Run: `npm run build` → succeeds.
Run: `npm run dev`. Toggle theme; sidebar flips light (white background, dark text, teal logo accent unchanged). Active nav item remains readable. Hover states visible.

- [ ] **Step 3: Commit**

```bash
git add components/AppSidebar.tsx
git commit -m "refactor(theme): tokenize AppSidebar inline styles and arbitrary Tailwind values"
```

---

## Task 9: Tokenize `app/map/page.tsx` and `FilterPanel.tsx`

**Files:**
- Modify: `app/map/page.tsx`
- Modify: `app/map/_components/FilterPanel.tsx`

- [ ] **Step 1: Apply substitutions from Task 6 table to both files**

Use the Grep tool to locate all hardcoded colors in each file:

```
Grep pattern: #[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}\b
Path: app/map/page.tsx
Path: app/map/_components/FilterPanel.tsx
```

For each match, apply the mapping from Task 6. Edit tool with `replace_all` is appropriate when a single hex appears many times **and** each occurrence is semantically the same (e.g., every `#1a1a1a` is a border). Verify by eye before bulk-replacing.

Three rules of thumb for map surfaces specifically:
1. **Chrome** (panels, borders, buttons, legend wrapper): tokenize to CSS vars.
2. **MapLibre layer paint** (`fill-color`, `line-color`, `circle-color` inside `addLayer({ paint: ... })`): **keep hardcoded**. These are data-visualization colors, not theme chrome. If a Phase-2 ticket emerges, revisit.
3. **Text labels on the map** (legend rows, attribution): tokenize.

- [ ] **Step 2: Build and smoke test**

Run: `npx tsc --noEmit` → PASS.
Run: `npm run dev` → open `/map`. Toggle light: panel chrome flips, map tiles remain their own theme (OpenFreeMap style unchanged).

- [ ] **Step 3: Commit**

```bash
git add app/map/page.tsx app/map/_components/FilterPanel.tsx
git commit -m "refactor(theme): tokenize /map page and FilterPanel chrome"
```

---

## Task 10: Tokenize copilote surface (`layout.tsx`, `ChatPanel.tsx`, `MapPanel.tsx`)

**Files:**
- Modify: `app/copilote/layout.tsx`
- Modify: `app/copilote/_components/ChatPanel.tsx`
- Modify: `app/copilote/_components/MapPanel.tsx`

Note: there is no `app/copilote/page.tsx` — the copilote entry point is the layout + components, accessed via sub-routes.

- [ ] **Step 1: Apply substitutions from Task 6 table across all three files**

Same approach as Task 9:
1. Grep each file for hex colors.
2. For inline styles, substitute with `var(--*)`.
3. For Tailwind arbitrary values (`bg-[#xxxxxx]`), substitute with named tokens (`bg-bg-level-2`, etc.).
4. MapPanel: treat the same as `/map` — chrome tokenized, data layer paint left hardcoded.

ChatPanel specifics: message bubbles use `#0a0a0a`/`#111111` backgrounds and `#f0f0f0`/`#a0a0a0` text — all tokenize cleanly.

- [ ] **Step 2: Build and smoke test**

Run: `npx tsc --noEmit` → PASS.
Run: `npm run dev` → navigate to `/copilote/*`. Toggle light: chat bubbles, prompt panel, map chrome flip. Teal send button stays teal.

- [ ] **Step 3: Commit**

```bash
git add app/copilote/layout.tsx app/copilote/_components/ChatPanel.tsx app/copilote/_components/MapPanel.tsx
git commit -m "refactor(theme): tokenize /copilote layout, ChatPanel, MapPanel chrome"
```

---

## Task 11: Final verification pass

**Files:** (no changes unless a regression is found)

- [ ] **Step 1: Type-check and production build**

Run: `npx tsc --noEmit`
Expected: PASS (no new errors vs baseline).

Run: `npm run build`
Expected: Build succeeds. Note any pre-existing error unrelated to this branch.

- [ ] **Step 2: Run the full Vitest suite**

Run: `npm test`
Expected: `ThemeProvider.test.tsx` passes. No pre-existing tests regress.

- [ ] **Step 3: Manual acceptance checklist**

Run: `npm run dev`. Go through each item:

- [ ] First-ever load (clear `localStorage.removeItem('geomatik-theme')` in console, then hard refresh): page renders dark with no flash of light.
- [ ] Set light in toggle, refresh: page renders light with no flash of dark.
- [ ] Toggle between themes 5× rapidly: no visual breakage, no console errors.
- [ ] Navigate `/` → `/map` → `/copilote/*` → back: theme is persistent across routes.
- [ ] DevTools Elements: `<html>` has exactly one of `dark` or `light` at all times (never both, never neither).
- [ ] `localStorage.getItem('geomatik-theme')` returns `"dark"` or `"light"`.
- [ ] Teal accent (`#4ecdc4`) is pixel-identical in both themes on: sidebar logo "ATIK", section dots, CTA teal buttons, focus ring on inputs.
- [ ] Admin routes (`/admin/*`) still render — may look off in light mode (known Phase 2 limitation); verify nothing throws.
- [ ] No new hydration warnings in the browser console (except the one silenced by `suppressHydrationWarning` on `<html>`).

- [ ] **Step 4: Commit any fixes uncovered**

If steps 1-3 surface any regression, fix inline, then:

```bash
git add -A
git commit -m "fix(theme): address regressions found in verification pass"
```

If nothing needs fixing, skip the commit.

- [ ] **Step 5: Summary commit / tag (optional)**

No additional commit needed — the incremental atomic commits from Tasks 1-10 tell the story.

---

## Out-of-scope acknowledgments (Phase 2 backlog)

The following surfaces intentionally remain hardcoded-dark after Phase 1:
- `app/admin/*` (all admin routes, including imports, campaigns, organizations, sources, health)
- `app/dashboard/iris-crawler`
- `app/integration-panneaux`
- `app/clusters`
- `app/login` (standalone split-screen, separate styling scope)
- Copilote components beyond ChatPanel/MapPanel: `WelcomeOverlay`, `PromptsPanel`, `ZoneCard`, `AnalyseCard`, `CoverageCard`, `DataGouvCard`, `SynergyResults`, etc.
- MapLibre data layer paint colors across the app

Each remains functional — they render identically to before because they never touched the CSS vars. In light mode they'll look inconsistent with the rest of the app; that's an acknowledged Phase 2 cleanup, not a regression.
