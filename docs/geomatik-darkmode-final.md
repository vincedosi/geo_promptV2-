# 🎨 GEOMATIK Dark/Light Mode — Phase 1 (Customer-Facing) — FINAL

## 🎯 OBJECTIF PRÉCIS

Implémenter dark/light mode **production-ready** pour les composants visibles aux utilisateurs finaux:
- ✅ ThemeProvider + toggle persistant (localStorage)
- ✅ CSS variables globales (`globals.css`) — **basées sur l'échelle dark existante**
- ✅ Scope Phase 1: **6 groupes de fichiers** (layout, sidebar, map, copilote, ui primitives)
- ✅ Accent teal `#4ecdc4` en **dark ET light mode** (brand identity)
- ✅ Zéro flicker au chargement
- ⛔ Phase 2 (future): admin routes, health check, import flows — hors scope

**Durée estimée:** 2–3 jours pour Phase 1  
**Thème par défaut:** DARK (comme actuellement)

---

## ⚠️ 4 CORRECTIONS VALIDÉES

### Correction 1: Palette dark = échelle existante (pas spec #0F0F0F)
- **Spec initial (naïf):** `#0F0F0F` / `#1A1A1A`
- **Réalité GEOMATIK:** `#050505` / `#0a0a0a` / `#111111` / `#181818` (4 niveaux subtils)
- **Action:** **Garder l'échelle existante** comme CSS vars dark, évite régression visuelle
- Light mode sera en symétrie perceptuelle (pas copie spec #FFFFFF brutale)

### Correction 2: Fichiers réels du projet
- ❌ `app/analyse/page.tsx` n'existe pas
- ❌ `components/map/*` n'existe pas (maps en `app/map/_components/`)
- ✅ **Mapping réel:** voir section "Scope Phase 1" ci-dessous

### Correction 3: Pas de header ni WorkspaceSelector existants
- Layout actuel = pas de header centralisé
- SessionBadge floating top-right (z-200) = position existante
- **Action:** ThemeToggle en fixed top-right, même container que SessionBadge

### Correction 4: Pas de `* { color: var(--text-primary) }` agressif
- Omis — force trop les couleurs tertiaires
- **Action:** Composants tokenisés gèrent couleurs explicitement via `text-text-primary` / `text-text-secondary`

---

## 🏗️ STEP 0: DIAGNOSTIC PRÉALABLE (CRUCIAL)

**Avant de coder quoi que ce soit, extraire les couleurs dark existantes du code:**

```bash
# Dans le projet, localiser TOUS les usages de:
grep -r "#050505\|#0a0a0a\|#111111\|#181818\|#1a1a1a\|#0f0f0f" app/ components/ --include="*.tsx" --include="*.css"
```

**Attendu:** Trouver l'échelle dark existante et valider:
- Niveau 1 (bg principal): `#050505` ou similaire
- Niveau 2 (surface): `#0a0a0a` ou `#111111`
- Niveau 3 (hover): `#181818` ou similaire

**Action:** Noter ces valeurs exactes pour les utiliser en CSS vars.

---

## 🏗️ ARCHITECTURE

### 1. **Context + Hook React** (`lib/theme/ThemeProvider.tsx`)

Créer un **ThemeContext** qui:
- Stocke `theme: "dark" | "light"`
- Expose `toggleTheme()` et `setTheme()`
- Syncs automatiquement avec **localStorage** (clé: `"geomatik-theme"`)
- Syncs avec **HTML root class** (`dark` / pas de classe) → Tailwind dark mode
- **Hydration-safe**: Check localStorage au mount, pas SSR hazard

```typescript
import { createContext, useContext, useState, useEffect, ReactNode } from "react";

type ThemeContextType = {
  theme: "dark" | "light";
  toggleTheme: () => void;
  setTheme: (theme: "dark" | "light") => void;
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [theme, setThemeState] = useState<"dark" | "light">("dark"); // default dark
  const [mounted, setMounted] = useState(false);

  // Au mount, lire localStorage et hydrater le DOM
  useEffect(() => {
    const saved = localStorage.getItem("geomatik-theme") as "dark" | "light" | null;
    const initialTheme = saved || "dark";
    setThemeState(initialTheme);
    
    // Sync avec DOM
    if (initialTheme === "light") {
      document.documentElement.classList.remove("dark");
    } else {
      document.documentElement.classList.add("dark");
    }
    
    setMounted(true);
  }, []);

  // Quand le theme change, sync DOM + localStorage
  useEffect(() => {
    if (!mounted) return; // Skip render initial
    
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    localStorage.setItem("geomatik-theme", theme);
  }, [theme, mounted]);

  const toggleTheme = () => {
    setThemeState(t => t === "dark" ? "light" : "dark");
  };

  // Avoid hydration mismatch: render null jusqu'à mounted
  if (!mounted) {
    return <>{children}</>;
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme: setThemeState }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be within ThemeProvider");
  return ctx;
};
```

### 2. **CSS Variables Globales** (`globals.css`)

**IMPORTANT:** Valider les valeurs dark existantes via step 0, puis utiliser celles-ci.

```css
/* Dark Mode (défaut) — valeurs extraites du code existant */
:root {
  /* Niveaux de fond (du plus sombre au plus clair) */
  --bg-level-0: #050505;   /* Primary background (actuellement utilisé) */
  --bg-level-1: #0a0a0a;   /* Surface cards/panels */
  --bg-level-2: #111111;   /* Elevated elements */
  --bg-level-3: #181818;   /* Hover/focus states */
  
  /* Alias sémantiques (pour faciliter utilisation) */
  --bg-primary: var(--bg-level-0);
  --bg-surface: var(--bg-level-1);
  --bg-hover: var(--bg-level-3);
  
  /* Texte et bordures */
  --text-primary: #ffffff;
  --text-secondary: #aaaaaa;
  --border: #333333;
  
  /* Accent invariant */
  --accent: #4ecdc4; /* teal GEOMATIK — NE CHANGE JAMAIS */
}

/* Light Mode — symétrie perceptuelle (inverse logique) */
html.light {
  /* Niveaux de fond (du plus clair au plus sombre) */
  --bg-level-0: #ffffff;    /* Primary background */
  --bg-level-1: #f5f5f5;    /* Surface cards/panels */
  --bg-level-2: #eeeeee;    /* Elevated elements */
  --bg-level-3: #e8e8e8;    /* Hover/focus states */
  
  /* Alias sémantiques */
  --bg-primary: var(--bg-level-0);
  --bg-surface: var(--bg-level-1);
  --bg-hover: var(--bg-level-3);
  
  /* Texte et bordures */
  --text-primary: #1a1a1a;
  --text-secondary: #666666;
  --border: #d0d0d0;
  
  /* Accent invariant */
  --accent: #4ecdc4; /* teal GEOMATIK — NE CHANGE JAMAIS */
}

/* Transitions globales pour les changements de thème */
body, html {
  transition: background-color 0.3s ease, color 0.3s ease;
}
```

### 3. **Tailwind Config** (`tailwind.config.ts`)

```typescript
import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: {
          primary: "var(--bg-primary)",
          surface: "var(--bg-surface)",
          hover: "var(--bg-hover)",
          level0: "var(--bg-level-0)",
          level1: "var(--bg-level-1)",
          level2: "var(--bg-level-2)",
          level3: "var(--bg-level-3)",
        },
        text: {
          primary: "var(--text-primary)",
          secondary: "var(--text-secondary)",
        },
        border: "var(--border)",
        accent: "var(--accent)",
      },
    },
  },
} satisfies Config;
```

---

## 📋 SCOPE PHASE 1 — FICHIERS RÉELS À TOKENISER

**Exactement ces 6 groupes de fichiers à modifier** (autres fichiers = Phase 2):

### 1. **`globals.css`** (PRIORITY)
CSS variables + base styles dark/light (voir section 2 ci-dessus)

### 2. **`app/layout.tsx`**
- Wrapper `ThemeProvider` au **top level** (wraps `{children}`)
- Couleurs hardcodées → CSS variables
- Importer + rendu `ThemeToggle` en **fixed top-right** (voir section ci-dessous)
- Ajouter script bloquant en `<head>` pour anti-flickering

### 3. **`components/AppSidebar.tsx`**
- Couleurs hardcodées → CSS variables (`bg-bg-primary`, `text-text-primary`, etc.)
- Backgrounds, borders, text colors, hover states

### 4. **`app/map/page.tsx` + `app/map/_components/FilterPanel.tsx`**
- **C'est le vrai dashboard client** (pas `app/analyse/page.tsx` qui n'existe pas)
- MapLibre canvas backgrounds, overlays, legend panels
- Couleurs → CSS variables

### 5. **`app/copilote/page.tsx` + `app/copilote/_components/ChatPanel.tsx`**
- **L'autre surface client majeure** (chat + expert panel)
- Couleurs hardcodées → CSS variables
- Message bubbles, panels, borders

### 6. **`components/ui/section-header.tsx` + primitives `.g-card`/`.g-btn` dans `globals.css`**
- UI primitives (cards, buttons, headers, etc.)
- Couleurs → CSS variables ou Tailwind color utils

**Phase 2 (future, NOT this week):**
- Admin routes (`/admin/*`) — garder dark mode forcé pour l'instant
- Health check, Imports, Intégrations — pas à tokeniser cette semaine

---

## 🔘 TOGGLE BUTTON & LAYOUT

### `components/ThemeToggle.tsx`

```typescript
import { useTheme } from "@/lib/theme/ThemeProvider";
import { Sun, Moon } from "lucide-react";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  
  return (
    <button
      onClick={toggleTheme}
      className="p-2 rounded-lg hover:bg-bg-hover transition-colors"
      title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      aria-label={`Toggle theme (currently ${theme})`}
    >
      {theme === "dark" ? (
        <Sun className="w-5 h-5 text-yellow-400" />
      ) : (
        <Moon className="w-5 h-5 text-gray-700" />
      )}
    </button>
  );
}
```

### `app/layout.tsx` — Pattern

```typescript
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SessionBadge } from "@/components/SessionBadge"; // composant existant

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <head>
        {/* Script bloquant pour anti-flicker — s'exécute avant React hydrate */}
        <script dangerouslySetInnerHTML={{ __html: `
          const theme = localStorage.getItem('geomatik-theme') || 'dark';
          if (theme === 'light') {
            document.documentElement.classList.remove('dark');
          } else {
            document.documentElement.classList.add('dark');
          }
        ` }} />
      </head>
      <body>
        <ThemeProvider>
          {/* Theme Toggle + SessionBadge en fixed top-right */}
          <div className="fixed top-6 right-6 z-50 flex items-center gap-3">
            <ThemeToggle />
            <SessionBadge />
          </div>
          
          {/* Contenu principal */}
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
```

---

## 🎨 PALETTE COULEUR (RÉFÉRENCE)

**Accent invariant:** `#4ecdc4` (teal GEOMATIK) — **même en light et dark mode**

### Dark Mode (défaut actuellement)
```
--bg-level-0:       #050505 (primary bg — VALIDER via grep)
--bg-level-1:       #0a0a0a (surface)
--bg-level-2:       #111111 (elevated)
--bg-level-3:       #181818 (hover)
--text-primary:     #ffffff
--text-secondary:   #aaaaaa
--border:           #333333
--accent:           #4ecdc4 (teal GEOMATIK)
```

### Light Mode
```
--bg-level-0:       #ffffff (primary bg)
--bg-level-1:       #f5f5f5 (surface)
--bg-level-2:       #eeeeee (elevated)
--bg-level-3:       #e8e8e8 (hover)
--text-primary:     #1a1a1a
--text-secondary:   #666666
--border:           #d0d0d0
--accent:           #4ecdc4 (teal GEOMATIK)
```

---

## 📋 CHECKLIST IMPLÉMENTATION — PHASE 1

### Step 0: Diagnostic (Avant de coder)
- [ ] `grep -r "#050505\|#0a0a0a\|#111111\|#181818"` pour valider l'échelle dark existante
- [ ] Noter les valeurs exactes pour les CSS vars

### Infrastructure (Jour 1)
- [ ] Créer `lib/theme/ThemeProvider.tsx` avec Context + Hook (hydration-safe)
- [ ] Créer `components/ThemeToggle.tsx` avec icônes (Sun/Moon)
- [ ] Mettre à jour `globals.css` avec CSS variables (dark + light mode)
- [ ] Mettre à jour `tailwind.config.ts` avec `darkMode: "class"` + colors via var()
- [ ] Mettre à jour `app/layout.tsx` pour wrapper `ThemeProvider`
- [ ] Ajouter script bloquant en `<head>` (anti-flicker)
- [ ] Placer `ThemeToggle` en fixed top-right à côté `SessionBadge`

### Tokenisation des 6 groupes customer-facing (Jour 2–3)
- [ ] **`globals.css`** — CSS variables ✅ (déjà fait)
- [ ] **`app/layout.tsx`** — Couleurs hardcodées → `bg-bg-primary`, `text-text-primary`, etc.
- [ ] **`components/AppSidebar.tsx`** — Idem
- [ ] **`app/map/page.tsx` + `app/map/_components/FilterPanel.tsx`** — MapLibre + panels
- [ ] **`app/copilote/page.tsx` + `app/copilote/_components/ChatPanel.tsx`** — Chat + panels
- [ ] **`components/ui/section-header.tsx` + `.g-card`/`.g-btn`** — UI primitives

### Vérification (Jour 3 EOD)
- [ ] **Hydration:** Pas de hydration mismatch — localStorage lu au useEffect
- [ ] **Default theme:** Dark mode au premier chargement
- [ ] **Toggle:** Light ↔ dark fonctionne instantanément
- [ ] **Persistence:** Refresh page → theme conservé
- [ ] **Icônes:** Sun/Moon se mettent à jour
- [ ] **Anti-flicker:** Aucun flickering au chargement (script bloquant)
- [ ] **Accent:** Teal `#4ecdc4` visible ET cohérent en light ET dark
- [ ] **No regressions:** Dashboard + map + sidebar restent visuellement cohérents

### 🚫 HORS SCOPE PHASE 1
- ❌ Admin routes (`/admin/*`) — garder dark forcé
- ❌ Health check, Imports, Intégrations — pas à tokeniser cette semaine
- ❌ Animations complexes
- ❌ Dark mode sur toutes les 80+ pages — on prend l'essentiel

---

## ⚠️ PIÈGES À ÉVITER

### 1. SSR Hydration Mismatch
- **OBLIGATOIRE:** ThemeProvider lit localStorage au `useEffect`, PAS au rendu initial
- Pattern sûr: `if (!mounted) return <>{children}</>` ou `if (!mounted) return null`
- Valider que la classe `dark` est appliquée au DOM **avant** React render

### 2. Flickering au chargement
- **OBLIGATOIRE:** Script bloquant en `<head>` (voir `app/layout.tsx` pattern)
- Ce script s'exécute **avant** React hydrate et applique la classe `dark` immédiatement
- Sans ce script = flash blanc sur light mode → pire UX possible

### 3. MapLibre canvas backgrounds
- MapLibre canvas hérite des couleurs CSS du DOM
- À adapter: canvas background, legend background, overlay backgrounds
- **Pattern:** `const bgColor = theme === 'dark' ? 'var(--bg-primary)' : 'var(--bg-primary)'` — c'est le CSS qui change via theme

### 4. Hardcoded colors in classes (ANTIPATTERN)
- ❌ `className="bg-gray-900 dark:bg-gray-100"` → OBSOLÈTE
- ❌ `style={{ backgroundColor: "#050505" }}`
- ✅ `className="bg-bg-primary"` ou `className="text-text-primary border border-border"`
- Tout color hardcoding doit passer par **CSS variables**

### 5. Ne pas modifier l'HTML root class statiquement
- ✅ ThemeProvider le fait dynamiquement avec `classList.add/remove("dark")`
- ❌ **N'ajoute jamais** `className="dark"` sur `<html>` ou `<body>` en dur
- ❌ N'ajoute jamais `html { --bg-primary: ... }` en dur (CSS vars se définissent au `:root`)

### 6. Ne pas forcer les couleurs globalement
- ❌ `* { color: var(--text-primary) }` — trop agressif, force même les couleurs tertiaires
- ✅ Laisser les composants tokenisés gérer leurs couleurs explicitement

### 7. Scope creep — Phase 1 strict!
- 6 groupes customer-facing SEULEMENT
- Admin routes = Phase 2
- Pas de perfectionism sur les intermédiaires cette semaine

---

## 🚀 LANCEMENT CLAUDE CODE

**Prerequisites:**
```bash
cd C:\GENESIS\genesis_app
$env:CLAUDE_CODE_GIT_BASH_PATH = "C:\Users\vsidol01\AppData\Local\Programs\Git\bin\bash.exe"
$env:PATH += ";C:\Users\LA_vsidol01\AppData\Roaming\npm"
claude
```

**Workflow Claude Code:**
1. Exécute `grep` pour valider l'échelle dark existante (Step 0)
2. Crée les fichiers d'infra (ThemeProvider, ThemeToggle, CSS vars)
3. Tokenise les 6 groupes customer-facing
4. Tests + validation (hydration, toggle, persistence)
5. Commits atomiques avec messages sémantiques

**Commandes dans Claude Code terminal:**
```bash
# Commits atomiques:
git add -A && git commit -m "feat(theme): dark/light mode phase 1 infrastructure & providers"
git add -A && git commit -m "feat(theme): tokenize customer-facing components (layout, sidebar, map, copilote, ui)"
git add -A && git commit -m "test(theme): validate hydration, toggle, anti-flicker"
```

---

## 📝 NOTES FINALES

- **Teal `#4ecdc4` est l'accent INVARIANT** — ne change JAMAIS d'un theme à l'autre
- **Valider les couleurs dark existantes AVANT de coder** — le spec #050505 est valide si utilisé actuellement
- **Phase 2 (future):** Admin routes, edge cases, fine-tuning des couleurs intermédiaires
- **Pas de perfectionism cette semaine** — l'objectif est la deliverability + foundation robuste
- **Tous les nouveaux composants** doivent utiliser CSS variables (pattern établi = maintenabilité future)
