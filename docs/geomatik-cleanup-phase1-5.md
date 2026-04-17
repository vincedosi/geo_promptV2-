# 🎨 GEOMATIK Dark/Light Mode — CLEANUP PHASE 1.5

## 🎯 OBJECTIF URGENT

Nettoyer TOUS les éléments mal stylisés en dark/light mode visible sur les pages customer-facing:
- ❌ Cards/panels blancs ou mal colorés
- ❌ Texte gris sur gris (contraste insuffisant)
- ❌ Inputs, buttons, selects mal stylisés
- ❌ Badges, tags, labels mal colorés
- ❌ Borders/séparateurs invisible
- ❌ Hover/focus states pas adaptés au thème
- ❌ MapLibre overlays mal visibles

**Durée:** 1 jour (5-6h)  
**Scope:** `/map`, `/copilote`, `/admin` (admin = Phase 2, mais nettoyer quand même)

---

## 🏗️ STEP 0: DIAGNOSTIC AUTOMATISÉ

**Avant tout code:**

```bash
# Localiser TOUTES les couleurs hardcodées (pas via CSS vars)
grep -r "bg-\(gray\|slate\|neutral\|black\|white\)" app/ components/ --include="*.tsx" | grep -v "bg-bg-" | head -50

# Couleurs en style={} ou #hex directs
grep -r "backgroundColor:\|#[0-9a-fA-F]\{6\}" app/ components/ --include="*.tsx" | grep -v "var(--" | head -50

# Inputs/selects/buttons mal stylisés
grep -r "className=.*input\|className=.*select\|className=.*button" app/ components/ --include="*.tsx" | grep -v "text-text-" | head -30
```

**Action:** Noter les fichiers problématiques pour Phase 1.5

---

## 📋 CHECKLIST CLEANUP — FICHIERS CRITIQUES

### 1. **Inputs, Selects, TextAreas** (`components/ui/*`)
```typescript
// AVANT (mauvais)
<input className="px-3 py-2 border border-gray-300 dark:border-gray-700" />

// APRÈS (correct)
<input className="px-3 py-2 border border-border bg-bg-surface text-text-primary placeholder:text-text-secondary" />
```

**Fichiers à scanner:**
- `components/ui/input.tsx`
- `components/ui/select.tsx`
- `components/ui/textarea.tsx`
- `components/ui/button.tsx`
- Tous les `shadcn/ui` imports

### 2. **FilterPanel** (`app/map/_components/FilterPanel.tsx`)
```typescript
// Panel background
<div className="bg-bg-surface border border-border p-4">

// Inputs dedans
<input className="bg-bg-primary border border-border text-text-primary" />

// Labels
<label className="text-text-primary text-sm font-medium" />
```

**Problèmes visibles:**
- ❌ Panel reste blanc/gris
- ❌ Inputs mal contrastés
- ❌ Labels invisibles

### 3. **ChatPanel** (`app/copilote/_components/ChatPanel.tsx`)
```typescript
// Message bubbles
<div className="bg-bg-hover p-3 rounded">  // user message
<div className="bg-bg-surface p-3 rounded">  // assistant message

// Input chat
<input className="bg-bg-primary border border-border text-text-primary" />
```

**Problèmes visibles:**
- ❌ Messages bubbles mal contrastés
- ❌ Chat input sur fond blanc

### 4. **Badges, Tags, Pills** (partout)
```typescript
// AVANT
<span className="px-2 py-1 bg-gray-200 text-gray-900 rounded-full">

// APRÈS
<span className="px-2 py-1 bg-accent text-white rounded-full">
// ou si besoin variant:
<span className="px-2 py-1 bg-bg-hover text-text-primary border border-border rounded-full">
```

### 5. **Section Headers** (`components/ui/section-header.tsx`)
```typescript
// Background band derrière le titre
<div className="bg-bg-hover px-4 py-2 rounded">
  <h2 className="text-text-primary font-semibold">

// Divider line
<div className="border-b border-border my-4" />
```

### 6. **Dialogs/Modals** (`components/ui/dialog.tsx`)
```typescript
// Dialog overlay
<div className="bg-black/50 dark:bg-black/70" />

// Dialog content
<div className="bg-bg-primary text-text-primary border border-border" />

// Dialog header
<div className="border-b border-border py-4" />
```

### 7. **Dropdowns/Combobox** (`app/map/_components/*`, `app/copilote/_components/*`)
```typescript
// Dropdown content
<div className="bg-bg-surface border border-border shadow-lg rounded" />

// Dropdown items
<button className="px-3 py-2 hover:bg-bg-hover text-text-primary w-full text-left" />
```

### 8. **Tables** (si present sur /map ou /copilote)
```typescript
<table className="w-full">
  <thead className="bg-bg-hover border-b border-border">
    <th className="text-text-primary" />
  </thead>
  <tbody>
    <tr className="border-b border-border hover:bg-bg-hover">
      <td className="text-text-primary" />
    </tr>
  </tbody>
</table>
```

### 9. **MapLibre Overlays** (`app/map/_components/MapContainer.tsx`)
```typescript
// Legend panels
<div className="bg-bg-surface/95 border border-border px-3 py-2 rounded">

// Legend items
<div className="flex items-center gap-2">
  <div className="w-4 h-4" style={{ backgroundColor: colorFromTheme }} />
  <span className="text-text-primary text-xs" />
</div>

// Map attribution (bottom right)
<div className="bg-bg-surface/90 text-text-secondary text-xs" />
```

### 10. **Floating Panels** (partout)
```typescript
// Top-right panels (stats cards)
<div className="fixed top-16 right-6 z-40 bg-bg-surface border border-border rounded-lg p-4">
  <p className="text-text-primary font-semibold" />
  <p className="text-text-secondary text-sm" />
</div>
```

---

## 🎨 RÈGLES TOKENISATION CLEANUP

**Avant d'ajouter une couleur en dur:**

```typescript
// ❌ JAMAIS
<div style={{ backgroundColor: "#f5f5f5" }} />
<div className="bg-gray-100" />

// ✅ TOUJOURS
<div className="bg-bg-surface" />
<div className="border border-border" />
<div className="text-text-primary" />
<div className="text-text-secondary" />
```

**Palette de référence (dans globals.css):**
```css
--bg-level-0: #050505  (primary background)
--bg-level-1: #0a0a0a  (surface cards)
--bg-level-2: #111111  (elevated)
--bg-level-3: #181818  (hover)
--text-primary: #ffffff
--text-secondary: #aaaaaa
--border: #333333
--accent: #4ecdc4 (teal — JAMAIS toucher)
```

---

## 🧪 WORKFLOW CLEANUP

### Jour 1: Scan + Plan Détaillé

```bash
# 1. Identifier ALL Tailwind color hardcodes
grep -r "bg-gray\|bg-white\|bg-black\|bg-slate\|text-gray" app/ components/ --include="*.tsx" > hardcoded-colors.txt

# 2. Identifier ALL style={} color hardcodes
grep -r "backgroundColor:\|color:\|borderColor:" app/ components/ --include="*.tsx" > inline-colors.txt

# 3. Pour CHAQUE fichier problématique, créer un mini-plan:
# - Quelles sections à changer
# - Tokens à utiliser (bg-bg-surface vs bg-bg-primary)
# - Variables MapLibre à adapter si cartes
```

### Jour 1: Tokenisation Massive

**Par catégorie:**

1. **UI Primitives** (composants shadcn/ui)
   - `input.tsx`, `select.tsx`, `button.tsx`, `textarea.tsx`
   - Replace: `border-gray-*` → `border-border`
   - Replace: `bg-white/gray` → `bg-bg-surface` ou `bg-bg-primary`
   - Replace: `text-gray-*` → `text-text-secondary`

2. **FilterPanel** (`app/map/_components/FilterPanel.tsx`)
   - Panel outer: `bg-bg-surface border border-border`
   - Input: `bg-bg-primary border border-border text-text-primary`
   - Labels: `text-text-primary`

3. **ChatPanel** (`app/copilote/_components/ChatPanel.tsx`)
   - User message: `bg-accent text-white`
   - Assistant message: `bg-bg-hover text-text-primary`
   - Chat input: `bg-bg-primary border border-border text-text-primary`

4. **MapLibre Overlays**
   - Legend: `bg-bg-surface/95 border border-border`
   - Items: `text-text-primary` + `text-text-secondary`

5. **Section Headers** (partout)
   - Header band: `bg-bg-hover px-4 py-2`
   - Text: `text-text-primary`

6. **Badges/Tags**
   - Primary: `bg-accent text-white`
   - Secondary: `bg-bg-hover text-text-primary border border-border`

7. **Dialogs**
   - Overlay: `bg-black/50 dark:bg-black/70`
   - Content: `bg-bg-primary text-text-primary border border-border`

8. **Dropdowns**
   - Content: `bg-bg-surface border border-border`
   - Items: `hover:bg-bg-hover text-text-primary`

---

## 🔍 VÉRIFICATIONS POST-CLEANUP

```bash
# 1. Aucun bg-gray/bg-white/bg-black restant
grep -r "bg-gray\|bg-white\|bg-black\|bg-slate" app/ components/ --include="*.tsx" | wc -l
# Résultat attendu: 0 (ou < 5 exceptions intentionnelles)

# 2. Aucun inline style color hardcodé
grep -r "backgroundColor:\|borderColor:" app/ components/ --include="*.tsx" | wc -l
# Résultat attendu: 0 (ou < 5 exceptions intentionnelles)

# 3. Tous les inputs/selects/buttons via CSS vars
npm run build  # Vérifier aucune erreur TypeScript
```

---

## 📸 TEST VISUEL (À TOI DE VÉRIFIER)

### /map page
- [ ] FilterPanel background = sombre (bg-bg-surface)
- [ ] Inputs dans FilterPanel = visible
- [ ] MapLibre legend = visible + bon contraste
- [ ] Overlay panels (stats) = lisible

### /copilote page
- [ ] ChatPanel background = sombre
- [ ] Messages = bien contrastés (user = teal accent, assistant = gris)
- [ ] Chat input = visible
- [ ] Expert panel = lisible

### Toggle dark ↔ light
- [ ] Tout change couleur harmonieusement
- [ ] Aucun élément blanc qui reste blanc en dark
- [ ] Aucun élément noir qui reste noir en light

---

## ## SKILLS À UTILISER

### 1. **@frontend-design**
   - Audit visuel complet de la palette
   - Proposer refinements si nécessaire (contraste, cohérence)
   - Vérifier harmonie teal #4ecdc4 sur les deux thèmes

### 2. **@geomatik-metier**
   - Vérifier MapLibre choropleth colors (JAMAIS tokeniser)
   - Vérifier data-viz (recharts, etc.) — NE JAMAIS changer
   - Vérifier isochrone battle layers — colors = data-driven

### 3. **@supabase-geomatik**
   - Si besoin de vérifier RLS ou auth pendant tests
   - Vérifier que localStorage persist fonctionne bien

### 4. **@dsp-campaigns** (si /copilote affiche des campagnes)
   - S'assurer que les données DSP s'affichent avec bon contraste

### 5. **Claude Sonnet (Web Search)**
   - Rechercher best practices pour dark mode inputs/selects (si besoin)
   - Inspiration design si refinements nécessaires

---

## ## AGENTS MISTRAL À ROUTER (si complexe)

Si tu veux dispatcher le travail:

1. **Agent Frontend** → Tokeniser tous les UI components
2. **Agent Maps** → Nettoyer MapLibre overlays + legend
3. **Agent Chat** → Nettoyer ChatPanel + message bubbles
4. **Agent QA** → Vérifier contraste + visibilité

---

## 📋 COMMANDES CLAUDE CODE

```bash
# STEP 0: Diagnostic
grep -r "bg-gray\|bg-white\|bg-black\|bg-slate\|text-gray" app/ components/ --include="*.tsx" | wc -l
grep -r "backgroundColor:\|borderColor:" app/ components/ --include="*.tsx" | wc -l

# STEP 1: Tokeniser par catégorie (voir workflow ci-dessus)
# (Claude Code va proposer les remplacements)

# STEP 2: Vérifier
npm run build
npm run type-check

# STEP 3: Commits
git add -A && git commit -m "refactor(theme): cleanup hardcoded colors → CSS vars (inputs, panels, overlays)"
git add -A && git commit -m "refactor(theme): tokenize MapLibre overlays, ChatPanel, FilterPanel"
```

---

## ⚠️ PIÈGES À ÉVITER (CLEANUP)

### ❌ Toucher aux couleurs data-viz
- Choropleth colors = hardcodés intentionnellement
- Recharts series colors = pas de tokenisation
- MapLibre paint properties = data-driven

### ❌ Oublier les variants Tailwind
- `hover:bg-bg-hover` (pas `hover:bg-gray-700`)
- `dark:text-text-primary` (mais ça change rien si on utilise CSS vars)
- `focus:border-accent` (teal)

### ❌ Hardcoder des opacités
- ✅ `bg-bg-surface/95` (avec opacity)
- ✅ `border-border` (color var)
- ❌ `bg-black/50` hardcodé (utiliser `bg-black/50 dark:bg-black/70`)

### ❌ Oublier les disabled states
- `disabled:opacity-50 disabled:cursor-not-allowed`
- `disabled:bg-bg-hover disabled:text-text-secondary`

---

## 🎯 RÉSULTAT FINAL CLEANUP

✅ **ZÉRO** hardcoded Tailwind colors (sauf exceptions data-viz)  
✅ **ZÉRO** inline `style={{ backgroundColor }}` (sauf MapLibre canvas)  
✅ **TOUS** inputs/selects/buttons/badges via CSS vars  
✅ **TOUS** overlays/panels visible + bon contraste  
✅ **TEAL #4ecdc4** cohérent sur accent partout  
✅ Toggle dark ↔ light = smooth + complètement harmonieux  

---

## 📝 NOTES FINALES

- **Cette phase est la "finition" de Phase 1** — rend tout production-ready
- **Ne pas toucher aux data-viz** — couleurs = meaning
- **Utiliser les skills + agents = meilleure qualité** + plus rapide
- **Commits atomiques = easy to review**
- **Tests visuels browser = responsabilité humaine** (toi)
