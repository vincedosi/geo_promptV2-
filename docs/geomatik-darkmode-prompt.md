# 🎨 GEOMATIK Dark/Light Mode — Prompt Claude Code

## OBJECTIF
Implémenter un **système global de dark/light mode** pour le projet GEOMATIK (Next.js 14 + TypeScript + Tailwind CSS) avec:
1. **Persistence locale** (localStorage + cookies)
2. **Bouton toggle** en haut à droite (header, à côté du workspace selector)
3. **Variables CSS + Tailwind classes** appliquées au DOM entier
4. **Thème par défaut**: **DARK** (comme actuellement)
5. **Pas de reflows/flickers** au chargement

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

### 2. **Tailwind Config** (`tailwind.config.ts`)

S'assurer que:
- `darkMode: "class"` est activé
- Les couleurs **dark** et **light** sont bien définies (voir palette ci-dessous)

```typescript
export default {
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Light mode
        light: {
          bg: "#FFFFFF",
          surface: "#F5F5F5",
          border: "#E0E0E0",
          text: "#1A1A1A",
          textSecondary: "#666666",
        },
        // Dark mode (actuel)
        dark: {
          bg: "#0F0F0F",
          surface: "#1A1A1A",
          border: "#333333",
          text: "#FFFFFF",
          textSecondary: "#AAAAAA",
        },
      },
    },
  },
} satisfies Config;
```

### 3. **Toggle Button Component** (`components/ThemeToggle.tsx`)

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

### 4. **Layout Root** (`app/layout.tsx`)

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

## 🎨 PALETTE COULEUR

### Dark Mode (défaut actuel)
```
Background:      #0F0F0F
Surface/Card:    #1A1A1A
Border:          #333333
Text Primary:    #FFFFFF
Text Secondary:  #AAAAAA
Accent (cyan):   #06B6D4
```

### Light Mode
```
Background:      #FFFFFF
Surface/Card:    #F5F5F5
Border:          #E0E0E0
Text Primary:    #1A1A1A
Text Secondary:  #666666
Accent (blue):   #0084FF
```

---

## 📋 CHECKLIST IMPLÉMENTATION

- [ ] Créer `lib/theme/ThemeProvider.tsx` avec Context + Hook
- [ ] Créer `components/ThemeToggle.tsx` avec icônes (Sun/Moon)
- [ ] Mettre à jour `tailwind.config.ts` avec `darkMode: "class"` + couleurs étendues
- [ ] Mettre à jour `app/layout.tsx` pour wrapper `ThemeProvider`
- [ ] Importer + placer `ThemeToggle` dans le header (à côté workspace selector)
- [ ] Vérifier hydration: **pas de hydration mismatch** (ThemeProvider lit localStorage au useEffect)
- [ ] Tester tous les états:
  - [ ] Dark mode par défaut au premier chargement
  - [ ] Toggle light ↔ dark fonctionne
  - [ ] Persistence localStorage (refresh page → theme conservé)
  - [ ] Icônes Sun/Moon se mettent à jour correctement
- [ ] Vérifier tous les **composants existants** qui ont des couleurs hardcodées:
  - [ ] MapLibre canvas background (adapter au theme)
  - [ ] Charts (recharts, etc.) — vérifier séries de couleurs
  - [ ] Tables, cards, borders
  - [ ] Dialogs/modals
  - [ ] Charts interactifs (Plotly, etc.)
- [ ] Aucun flickering au chargement (stocker preference en cookie + script de blocking)

---

## ⚠️ PIÈGES À ÉVITER

1. **SSR Hydration Mismatch**
   - Le ThemeProvider doit lire localStorage au `useEffect`, **pas au rendu initial**
   - Utiliser `useEffect` avec `[theme]` pour syncer le DOM

2. **Flickering au chargement**
   - Ajouter un **script blocking** en `<head>` qui lit localStorage et applique la classe avant rendu React:
   ```html
   <script>
     const theme = localStorage.getItem('geomatik-theme') || 'dark';
     if (theme === 'dark') document.documentElement.classList.add('dark');
   </script>
   ```

3. **MapLibre + Charts**
   - MapLibre canvas background → adapter couleur au theme
   - Recharts, Plotly → passer `theme` en prop, changer `stroke`, `fill`, `background`

4. **Ne pas hardcoder `className="dark"`** sur `<html>` ou `<body>`
   - C'est le ThemeProvider qui le fait dynamiquement

---

## 🚀 COMMANDES CLAUDE CODE À EXÉCUTER

```bash
# Depuis C:\GENESIS\genesis_app (PowerShell):

# 1. Lancer Claude Code
$env:CLAUDE_CODE_GIT_BASH_PATH = "C:\Users\vsidol01\AppData\Local\Programs\Git\bin\bash.exe"
$env:PATH += ";C:\Users\LA_vsidol01\AppData\Roaming\npm"
claude

# 2. Une fois dans Claude Code terminal, créer les fichiers:
# Claude Code va proposer de créer/modifier les fichiers automatiquement
```

---

## 📝 NOTES DE DESIGN

- **Default theme: DARK** (comme maintenant) — user preference is saved
- **Bouton toggle:** placer au même niveau que workspace selector, sans trop d'espace
- **Icônes:** Sun (light mode) et Moon (dark mode) de lucide-react
- **Transition smooth:** utiliser Tailwind `transition-colors` pour les changements
- **Accessibilité:** `aria-label` + `title` sur le bouton toggle
- **Performance:** localStorage est synchrone, pas de delay observable

---

## 🎯 RÉSULTAT FINAL

✅ Système de dark/light mode **global** sur GEOMATIK  
✅ Persistence localStorage + cookies  
✅ Bouton toggle en haut à droite (header)  
✅ Thème sombre par défaut  
✅ Pas de flicker au chargement  
✅ Tous les composants (cartes, charts, UI) adaptés au thème  
