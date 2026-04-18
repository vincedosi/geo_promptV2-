# 🎨 GEOMATIK Dark/Light Mode — Phase 1 (Customer-Facing)

## 🎯 OBJECTIF PRÉCIS

Implémenter dark/light mode **production-ready** pour les composants visibles aux utilisateurs finaux:
- ✅ ThemeProvider + toggle persistant (localStorage)
- ✅ CSS variables globales (`globals.css`)
- ✅ Scope Phase 1: **6 fichiers uniquement** (layout, sidebar, dashboard principal, cartes, charts)
- ✅ Accent teal `#4ecdc4` en **dark ET light mode** (brand identity)
- ✅ Zéro flicker au chargement
- ⛔ Phase 2 (future): admin routes, health check, import flows — hors scope

**Durée estimée:** 2–3 jours pour Phase 1  
**Thème par défaut:** DARK (comme actuellement)

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
// Pseudo-code structure
export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState<"dark" | "light">("dark"); // default dark
  
  // Au mount, lire localStorage
  useEffect(() => {
    const saved = localStorage.getItem("geomatik-theme");
    if (saved) setTheme(saved as "dark" | "light");
    else document.documentElement.classList.add("dark"); // default dark
  }, []);
  
  // Sync avec DOM
  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    localStorage.setItem("geomatik-theme", theme);
  }, [theme]);
  
  return (
    <ThemeContext.Provider value={{ theme, toggleTheme: () => setTheme(t => t === "dark" ? "light" : "dark") }}>
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

### 2b. **CSS Variables Globales** (`globals.css`)

```css
/* Dark Mode (défaut) */
:root {
  --bg-primary: #0f0f0f;
  --bg-surface: #1a1a1a;
  --bg-hover: #2a2a2a;
  --border: #333333;
  --text-primary: #ffffff;
  --text-secondary: #aaaaaa;
  --accent: #4ecdc4; /* teal GEOMATIK — invariant */
}

/* Light Mode */
html.light {
  --bg-primary: #ffffff;
  --bg-surface: #f5f5f5;
  --bg-hover: #eeeeee;
  --border: #d0d0d0;
  --text-primary: #1a1a1a;
  --text-secondary: #666666;
  --accent: #4ecdc4; /* teal GEOMATIK — invariant */
}

/* Apply CSS variables globalement */
* {
  color: var(--text-primary);
}

body, html {
  background-color: var(--bg-primary);
  color: var(--text-primary);
  transition: background-color 0.3s ease, color 0.3s ease;
}
```

### 2c. **Tailwind Config** (`tailwind.config.ts`)

```typescript
export default {
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: {
          primary: "var(--bg-primary)",
          surface: "var(--bg-surface)",
          hover: "var(--bg-hover)",
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

### 3. **Scope Phase 1 : Fichiers à Tokeniser**

**Exactement ces 6 fichiers à modifier** (autres fichiers = Phase 2):

1. **`globals.css`** — CSS variables + dark/light mode root styles (PRIORITY)
2. **`app/layout.tsx`** — Wrapper ThemeProvider, ajouter ThemeToggle en header
3. **`components/AppSidebar.tsx`** — Couleurs hardcodées → CSS variables
4. **`app/analyse/page.tsx`** (ou main dashboard) — Couleurs → CSS variables
5. **`components/map/*`** (MapLibre wrappers) — Canvas background, légendes, overlays
6. **`components/charts/*`** (si recharts/plotly) — Adapter stroke, fill, background au theme

**Phase 2 (future, NOT this week):**
- Admin routes (`/admin/*`) — garder dark mode forcé pour l'instant
- Health check, Imports, etc. — style peut rester dark

---

### 4. **Toggle Button Component** (`components/ThemeToggle.tsx`)

Placer en haut à droite du header (à côté du workspace selector):

```typescript
import { useTheme } from "@/lib/theme/ThemeProvider";
import { Sun, Moon } from "lucide-react"; // ou icônes custom

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  
  return (
    <button
      onClick={toggleTheme}
      className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
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

### 5. **Layout Root** (`app/layout.tsx`)

- Wrapper `ThemeProvider` au top level (wraps `{children}`)
- S'assurer que root `<html>` n'a **pas de `className="dark"`** hardcoded (c'est le ThemeProvider qui le gère)
- Import + rendu `ThemeToggle` dans le header

```typescript
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <ThemeProvider>
          {/* Header avec ThemeToggle */}
          <header className="flex justify-between items-center px-6 py-4 border-b border-gray-200 dark:border-gray-800">
            <div>{/* Logo, etc. */}</div>
            <div className="flex items-center gap-4">
              {/* Workspace selector ici */}
              <WorkspaceSelector />
              {/* Theme Toggle */}
              <ThemeToggle />
            </div>
          </header>
          
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
```

---

## 🎨 PALETTE COULEUR (Définitive)

**Accent invariant:** `#4ecdc4` (teal GEOMATIK) — **même en light et dark mode**

### Dark Mode (défaut actuellement)
```
--bg-primary:       #0F0F0F
--bg-surface:       #1A1A1A
--bg-hover:         #2A2A2A
--border:           #333333
--text-primary:     #FFFFFF
--text-secondary:   #AAAAAA
--accent:           #4ecdc4 (teal GEOMATIK)
```

### Light Mode
```
--bg-primary:       #FFFFFF
--bg-surface:       #F5F5F5
--bg-hover:         #EEEEEE
--border:           #D0D0D0
--text-primary:     #1A1A1A
--text-secondary:   #666666
--accent:           #4ecdc4 (teal GEOMATIK)
```

💡 **Pourquoi teal partout?** Brand consistency — l'accent ne change pas, c'est le contexte (fond sombre vs clair) qui change.

---

## 📋 CHECKLIST IMPLÉMENTATION — PHASE 1

### Infrastructure (Jour 1)
- [ ] Créer `lib/theme/ThemeProvider.tsx` avec Context + Hook
- [ ] Créer `components/ThemeToggle.tsx` avec icônes (Sun/Moon)
- [ ] Mettre à jour `globals.css` avec CSS variables (dark + light mode)
- [ ] Mettre à jour `tailwind.config.ts` avec `darkMode: "class"` + colors à partir de var()
- [ ] Mettre à jour `app/layout.tsx` pour wrapper `ThemeProvider`
- [ ] Importer + placer `ThemeToggle` dans le header (à côté workspace selector)

### Tokenisation des 6 fichiers customer-facing (Jour 2–3)
- [ ] **`globals.css`** — CSS variables ✅ (déjà fait ci-dessus)
- [ ] **`app/layout.tsx`** — Couleurs hardcodées → `bg-bg-primary`, `text-text-primary`, etc.
- [ ] **`components/AppSidebar.tsx`** — Idem
- [ ] **`app/analyse/page.tsx`** (dashboard principal) — Idem
- [ ] **`components/map/*`** — MapLibre canvas background, border colors
- [ ] **`components/charts/*`** — Recharts/Plotly theme props adaptés

### Vérification (Jour 3 EOD)
- [ ] Hydration: **pas de hydration mismatch** (ThemeProvider lit localStorage au useEffect)
- [ ] Dark mode par défaut au premier chargement
- [ ] Toggle light ↔ dark fonctionne instantanément
- [ ] Persistence localStorage (refresh page → theme conservé)
- [ ] Icônes Sun/Moon se mettent à jour correctement
- [ ] Aucun flickering au chargement (script blocking en <head>)
- [ ] Teal accent `#4ecdc4` visible ET cohérent en light ET dark

### 🚫 HORS SCOPE PHASE 1
- ❌ Admin routes (`/admin/*`) — garder dark forcé
- ❌ Health check, Imports, Intégrations — pas à tokeniser cette semaine
- ❌ Animations complexes ou transitions spéciales
- ❌ Dark mode sur toutes les 80 pages — on prend l'essentiel

---

## ⚠️ PIÈGES À ÉVITER

### 1. SSR Hydration Mismatch
- ThemeProvider doit lire localStorage au `useEffect`, **pas au rendu initial**
- Utiliser `useEffect` avec `[theme]` pour syncer le DOM
- **Pattern sûr:**
  ```typescript
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem("geomatik-theme");
    if (saved) setTheme(saved as "dark" | "light");
  }, []);
  
  if (!mounted) return null; // ou render avec default
  ```

### 2. Flickering au chargement
- **OBLIGATOIRE:** Ajouter un script bloquant en `<head>` de `layout.tsx`:
  ```html
  <script dangerouslySetInnerHTML={{ __html: `
    const theme = localStorage.getItem('geomatik-theme') || 'dark';
    if (theme === 'light') {
      document.documentElement.classList.remove('dark');
    } else {
      document.documentElement.classList.add('dark');
    }
  ` }} />
  ```

### 3. MapLibre + Charts
- **MapLibre:** canvas background doit changer au toggle
  ```typescript
  const bgColor = theme === 'dark' ? '#0f0f0f' : '#ffffff';
  map.setStyle(`${styleUrl}?fg=${theme}`); // ou re-render canvas
  ```
- **Recharts:** passer `theme` en prop, changer `stroke`, `fill`, `cartesianGrid`
- **Plotly:** `layout.plot_bgcolor` et `layout.paper_bgcolor` dynamiques

### 4. Hardcoded colors in Tailwind classes
- ❌ `className="bg-gray-900 dark:bg-gray-100"` → OBSOLÈTE, utiliser `bg-bg-primary`
- ✅ `className="bg-bg-primary text-text-primary border border-border"`
- Tout color hardcoding doit passer par CSS variables

### 5. Ne pas modifier l'HTML root class
- ✅ ThemeProvider le fait avec `document.documentElement.classList.add/remove("dark")`
- ❌ **N'ajoute pas** `className="dark"` statiquement sur `<html>`

### 6. Scope creep — Phase 1 strict!
- 6 fichiers customer-facing SEULEMENT
- Admin routes peuvent rester dark pour l'instant
- Pas de perfectionism sur les couleurs intermédiaires cette semaine



---

## 🎯 RÉSULTAT FINAL — PHASE 1

✅ ThemeProvider + toggle **production-ready**  
✅ CSS variables définies (`globals.css`)  
✅ Persistence localStorage + anti-flickering  
✅ Bouton toggle en haut à droite (header)  
✅ Thème sombre par défaut  
✅ **6 composants customer-facing** tokenisés (layout, sidebar, dashboard, map, charts)  
✅ Teal `#4ecdc4` accent partout (brand preserved)  
✅ Admin routes + autres pages = Phase 2 (pas bloquant)

---

## 📅 TIMELINE ESTIMÉE

| Jour | Tâche | Effort |
|------|-------|--------|
| **J1** | Infrastructure (ThemeProvider, globals.css, tailwind.config) + ThemeToggle | 4–5h |
| **J2–J3** | Tokeniser 6 fichiers customer-facing | 6–8h |
| **J3 EOD** | Tests + QA (hydration, flicker, persistence, toggles) | 2–3h |
| **Total** | | 12–16h (2–3 jours) |

**⚡ Milestones:**
- EOD J1: Toggle visible et clickable, localStorage persist (pas de couleurs changées encore)
- EOD J2: Dashboard + sidebar changent de couleur au toggle
- EOD J3: Maps + charts themed, tous les tests verts

---

## 🚀 LANCEMENT CLAUDE CODE

**Prerequisites:**
```bash
cd C:\GENESIS\genesis_app
$env:CLAUDE_CODE_GIT_BASH_PATH = "C:\Users\vsidol01\AppData\Local\Programs\Git\bin\bash.exe"
$env:PATH += ";C:\Users\LA_vsidol01\AppData\Roaming\npm"
claude
```

**Commandes dans Claude Code terminal:**
```bash
# Claude Code créera les fichiers auto, toi tu valides/modifies
# Commits atomiques:
git add -A && git commit -m "feat(theme): dark/light mode phase 1 infrastructure"
git add -A && git commit -m "feat(theme): tokenize customer-facing components"
```

---

## 📝 NOTES FINALES

- **Teal `#4ecdc4` est l'accent INVARIANT** — ne change JAMAIS d'un theme à l'autre
- **Phase 2 (future):** Admin routes, edge cases, fine-tuning des couleurs intermédiaires
- **Pas de perfectionism cette semaine** — l'objectif est la deliverability rapide
- **Tous les nouveaux composants** doivent utiliser CSS variables (pattern établi)  
