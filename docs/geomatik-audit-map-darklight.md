# 🔍 AUDIT COMPLET DARK/LIGHT MODE — PAGE /map

## 🎯 OBJECTIF PRECISION

Auditer **complètement** la page `/map` pour garantir:
- ✅ Mode jour (light) = AUCUNE trace de dark mode
- ✅ Mode nuit (dark) = AUCUNE trace de light mode
- ✅ Tous les éléments changeent couleur en toggle
- ✅ Trois cartes (Ratio, Impressions, Population) affichent le bon thème
- ✅ Contraste + lisibilité sur les 2 thèmes
- ✅ MapLibre overlays, legends, panels adaptés
- ✅ Inputs, selects, buttons stylisés correctement
- ✅ Zéro hardcodes Tailwind colors restants

**Scope:** `/map` page + tous les composants visuels  
**Durée:** 2-3h (diagnostic + corrections)  
**Thèmes testés:** Dark (`:root`) + Light (`html.light`)

---

## 🏗️ STEP 0: DIAGNOSTIC AUTOMATISÉ (CRUCIAL)

### A. Lister TOUS les hardcodes Tailwind colors sur /map

```bash
# Dans le projet:
echo "=== HARDCODED TAILWIND COLORS ==="
grep -r "bg-gray\|bg-white\|bg-black\|bg-slate\|text-gray\|text-white\|text-black\|border-gray" \
  app/map/ components/ \
  --include="*.tsx" \
  | grep -v "bg-bg-\|text-text-\|border-border\|bg-accent" \
  | sort | uniq

echo ""
echo "=== INLINE STYLE COLORS ==="
grep -r "backgroundColor:\|color:\|borderColor:" \
  app/map/ components/ \
  --include="*.tsx" \
  | grep -v "var(--" \
  | sort | uniq

echo ""
echo "=== MAPLIBRE CANVAS/STYLE REFERENCES ==="
grep -r "style.*map\|mapStyle\|setStyle\|addLayer\|paint\|layout" \
  app/map/ \
  --include="*.tsx" \
  | head -20
```

**Action:** Exécuter ces commands et noter:
- Fichiers problématiques
- Types de hardcodes (Tailwind vs inline)
- MapLibre layers/styles à corriger

---

## 📋 STEP 1: AUDIT VISUEL SYSTÉMATIQUE (À TOI DE VÉRIFIER)

Tu vas naviguer `/map` et vérifier chaque élément. Je vais guide par catégorie.

### 1️⃣ TOGGLE BUTTON (Top-Right)
```
🎯 Dark Mode (défaut):
  [ ] Toggle visible (Sun icon = yellow)
  [ ] Toggle au bon endroit (fixed top-right z-50)
  [ ] Hover state = distinctif
  
🎯 Light Mode (après clic):
  [ ] Toggle visible (Moon icon = gray)
  [ ] Même position, pas de déplacement
  [ ] Hover state = distinctif
  
🎯 Persistance:
  [ ] Refresh page → garde le thème choisi
  [ ] localStorage.getItem('geomatik-theme') = "light" ou "dark"
```

### 2️⃣ SIDEBAR LEFT (PERIMETER, DONNEES, ANALYSES, CAMPAGNES)
```
🎯 Dark Mode:
  [ ] Background = #0a0a0a (bg-bg-surface)
  [ ] Text = #ffffff (text-text-primary)
  [ ] Borders = #333333 (border-border)
  [ ] Hover state = #181818 (bg-bg-hover)
  [ ] Section titles (DONNEES TERRAIN, etc) = lisibles
  
🎯 Light Mode:
  [ ] Background = #f5f5f5 (bg-bg-surface light)
  [ ] Text = #1a1a1a (text-text-primary light)
  [ ] Borders = #d0d0d0 (border-border light)
  [ ] Hover state = #e8e8e8 (bg-bg-hover light)
  [ ] **CRITIQUE:** Pas de blanc cassé/gris clair restant
  
🎯 Pas d'Artefact:
  [ ] Pas de bg-gray-100 visible
  [ ] Pas de text-gray-500 visible
  [ ] Aucune "double couleur" (dark + light ensemble)
```

### 3️⃣ FILTERPANEL (Analyse Spatiale, Mode Transport, Bataille V2, etc)
```
🎯 Dark Mode:
  [ ] Panel container = #0a0a0a (bg-bg-surface)
  [ ] Inputs = #050505 bg (bg-bg-primary) + #333333 border
  [ ] Labels = #ffffff (text-text-primary)
  [ ] Dropdowns = #0a0a0a (bg-bg-surface)
  [ ] Buttons = #4ecdc4 (accent teal) ou #181818 (bg-bg-hover)
  [ ] Help text = #aaaaaa (text-text-secondary)
  
🎯 Light Mode:
  [ ] Panel container = #f5f5f5 (bg-bg-surface light)
  [ ] Inputs = #ffffff bg (bg-bg-primary light) + #d0d0d0 border
  [ ] Labels = #1a1a1a (text-text-primary light)
  [ ] Dropdowns = #f5f5f5 (bg-bg-surface light)
  [ ] Buttons = #4ecdc4 (accent teal — INVARIANT)
  [ ] Help text = #666666 (text-text-secondary light)
  [ ] **CRITIQUE:** Pas de gris foncé restant (dark mode colors)
  
🎯 Inputs Spécifiques:
  [ ] "Temps de trajet" sliders = lisibles
  [ ] "Voronoi géométrique" dropdown = bien colorée
  [ ] "Bataille V2" dropdown = bien colorée
  [ ] "Isochrones routiers (ORS)" = contrasté
  [ ] Boutons VERIFIER, LANCER, RECALCULE = distincts
```

### 4️⃣ TROIS CARTES PRINCIPALES (CRITIQUE — Ton problème!)
```
🎯 Carte 1 (Ratio) — TOP LEFT
  Dark Mode:
    [ ] MapLibre canvas background = #050505 (bg-primary dark)
    [ ] Overlays (legend, stats) = #0a0a0a (bg-bg-surface dark)
    [ ] Text sur overlays = #ffffff (text-text-primary dark)
    [ ] Border overlays = #333333 (border-border dark)
    [ ] Teal accents = #4ecdc4 (invariant)
  
  Light Mode:
    [ ] MapLibre canvas background = #ffffff (bg-primary light) — **CRUCIAL**
    [ ] Overlays = #f5f5f5 (bg-bg-surface light)
    [ ] Text = #1a1a1a (text-text-primary light)
    [ ] Border = #d0d0d0 (border-border light)
    [ ] **JAMAIS** noir/gris foncé visible
  
  Choroplèthe Data:
    [ ] Colors = data-driven (NON tokenisées) — OK si différentes
    [ ] Légende = lisible (texte adapté au bg)

🎯 Carte 2 (Impressions) — TOP RIGHT
  [Même checklist que Carte 1]

🎯 Carte 3 (Population) — BOTTOM
  [Même checklist que Carte 1]

🎯 **PROBLÈME SPÉCIFIQUE À TOI:**
  ❌ "Trois cartes sur fond noir en mode jour"
  
  À vérifier:
  [ ] MapLibre container a-t-il un style hardcodé?
  [ ] `mapStyle` change-t-il au toggle theme?
  [ ] CSS var `--bg-primary` affecte-t-elle le canvas bg?
  [ ] Y a-t-il un `style={{ backgroundColor: "#050505" }}` hardcodé?
  
  Fichiers à checker:
  - `app/map/_components/MapContainer.tsx` (ou similaire)
  - `app/map/_components/RatioMap.tsx`
  - `app/map/_components/ImpressionsMap.tsx`
  - `app/map/_components/PopulationMap.tsx`
```

### 5️⃣ STATS CARDS (Floating Panels Top-Right)
```
🎯 Dark Mode:
  [ ] Background = #0a0a0a (bg-bg-surface)
  [ ] Text principal = #ffffff (text-text-primary)
  [ ] Text secondaire = #aaaaaa (text-text-secondary)
  [ ] Border = #333333 (border-border)
  [ ] Lisible et contrasté
  
🎯 Light Mode:
  [ ] Background = #f5f5f5 (bg-bg-surface light)
  [ ] Text principal = #1a1a1a (text-text-primary light)
  [ ] Text secondaire = #666666 (text-text-secondary light)
  [ ] Border = #d0d0d0 (border-border light)
  [ ] **Pas de blanc pur, pas de gris foncé**
```

### 6️⃣ TABS (Carte, Étude)
```
🎯 Dark Mode:
  [ ] Tab inactive = #0a0a0a bg, #aaaaaa text
  [ ] Tab active = #ffffff text, underline teal
  
🎯 Light Mode:
  [ ] Tab inactive = #f5f5f5 bg, #666666 text
  [ ] Tab active = #1a1a1a text, underline teal
  [ ] Pas de noir/gris foncé
```

### 7️⃣ LEGEND PANELS (Sur les cartes)
```
🎯 Dark Mode:
  [ ] Panel = #0a0a0a (bg-bg-surface), #333333 border
  [ ] Legend items = #ffffff text (text-text-primary)
  [ ] Color swatches = visibles + distingés
  
🎯 Light Mode:
  [ ] Panel = #f5f5f5 (bg-bg-surface light), #d0d0d0 border
  [ ] Legend items = #1a1a1a text (text-text-primary light)
  [ ] Color swatches = visibles + distingés
  [ ] Pas de gris/noir foncé
```

### 8️⃣ BUTTONS & INTERACTIVE
```
🎯 Primary Buttons (couleur accent):
  [ ] Dark: bg-accent (#4ecdc4), white text
  [ ] Light: bg-accent (#4ecdc4), white text — **INVARIANT**
  [ ] Hover: bg-accent/90
  [ ] Focus: ring-2 ring-accent
  
🎯 Secondary Buttons:
  [ ] Dark: bg-bg-hover (#181818), white text, border
  [ ] Light: bg-bg-hover (#e8e8e8), #1a1a1a text, border
  [ ] Pas de gris foncé en light
  
🎯 Disabled State:
  [ ] opacity-50 appliquée
  [ ] Text distinctif
```

### 9️⃣ SCROLLBARS & NATIVE ELEMENTS
```
🎯 Si present:
  [ ] Scrollbar track = adaptée au thème
  [ ] Scrollbar thumb = visible + contrasté
  [ ] Pas de scrollbar "stuck" en dark sur light
```

### 🔟 ANIMATIONS & TRANSITIONS
```
🎯 Dark ↔ Light Toggle:
  [ ] Transition smooth (0.3s) — pas de flash
  [ ] Tous les éléments changent ensemble
  [ ] Pas d'artefact visuel (blanc flash, noir flash)
  [ ] Zéro lag au toggle
```

---

## 📊 STEP 2: DIAGNOSTIC DÉTAILLÉ PAR FICHIER

**Pour CHAQUE problème détecté, creuser:**

### Pattern A: Hardcoded Tailwind Colors
```bash
# Exemple: Trouver tous les "bg-gray-*" dans /map
grep -n "bg-gray" app/map/_components/*.tsx
# Résultat: app/map/_components/FilterPanel.tsx:42: className="bg-gray-100"

# Fixer:
# bg-gray-100 → bg-bg-surface (ou bg-bg-hover selon contexte)
```

### Pattern B: Inline Styles
```bash
# Trouver all style={{ ... }} avec colors
grep -n "backgroundColor\|borderColor\|color:" app/map/_components/*.tsx
# Résultat: app/map/_components/MapContainer.tsx:58: style={{ backgroundColor: "#050505" }}

# Fixer:
# style={{ backgroundColor: "#050505" }} → className="bg-bg-primary"
# OU (si MapLibre canvas): style={{ backgroundColor: "var(--bg-primary)" }}
```

### Pattern C: MapLibre Canvas Not Changing Theme
```typescript
// ❌ PROBLÈME: Canvas reste noir en light mode
<div style={{ backgroundColor: "#050505" }} id="map" />

// ✅ SOLUTION 1: CSS var direct
<div style={{ backgroundColor: "var(--bg-primary)" }} id="map" />

// ✅ SOLUTION 2: useTheme hook
import { useTheme } from "@/lib/theme/ThemeProvider";
const { theme } = useTheme();
const bgColor = theme === 'dark' ? '#050505' : '#ffffff';
<div style={{ backgroundColor: bgColor }} id="map" />

// ✅ SOLUTION 3: Tailwind (préféré)
<div className="bg-bg-primary w-full h-full" id="map" />
```

---

## 🛠️ STEP 3: CORRECTIONS SYSTÉMATIQUES

### Fix #1: Hardcoded Tailwind Colors

```bash
# BEFORE (bad):
grep -rn "bg-gray\|bg-white\|bg-black\|text-gray" app/map/ --include="*.tsx"

# AFTER (good):
# Replace ALL:
# bg-white → bg-bg-primary
# bg-gray-50/100 → bg-bg-surface
# bg-gray-200 → bg-border
# text-gray-500 → text-text-secondary
# text-white → text-text-primary
```

### Fix #2: MapLibre Canvas Background

```typescript
// File: app/map/_components/MapContainer.tsx (ou similaire)

import { useTheme } from "@/lib/theme/ThemeProvider";

export function MapContainer() {
  const { theme } = useTheme();
  
  return (
    <div 
      className="w-full h-full bg-bg-primary"  // ← CSS var via Tailwind
      id="map"
    >
      {/* MapLibre renders here */}
    </div>
  );
}
```

### Fix #3: Overlay Panels on Maps

```typescript
// BEFORE (bad):
<div className="absolute bottom-4 right-4 bg-white text-black p-3">
  <p>Legend</p>
</div>

// AFTER (good):
<div className="absolute bottom-4 right-4 bg-bg-surface border border-border rounded p-3">
  <p className="text-text-primary">Legend</p>
</div>
```

### Fix #4: FilterPanel Colors

```typescript
// BEFORE (bad):
<div className="bg-white p-4">
  <input className="border border-gray-300" />
  <label className="text-gray-700">Mode de transport</label>
</div>

// AFTER (good):
<div className="bg-bg-surface border border-border p-4">
  <input className="bg-bg-primary border border-border text-text-primary" />
  <label className="text-text-primary">Mode de transport</label>
</div>
```

---

## 🔬 STEP 4: VÉRIFICATIONS POST-FIX

### A. Aucun Hardcode Restant

```bash
# SHOULD RETURN 0:
grep -r "bg-gray\|bg-white\|bg-black\|bg-slate\|text-gray\|text-white\|text-black" \
  app/map/ components/ \
  --include="*.tsx" \
  | grep -v "bg-bg-\|text-text-\|border-border\|bg-accent\|text-white" \
  | wc -l

# Expected: 0 or < 5 (intentional exceptions)
```

### B. Build & Type Check

```bash
npm run build  # No errors
npm run type-check  # No errors
```

### C. Visual Regression Test

```bash
# In browser console:
console.log(getComputedStyle(document.documentElement).getPropertyValue('--bg-primary'));
// Dark: " #050505"
// Light: " #ffffff"

console.log(document.documentElement.className);
// Dark: "dark"
// Light: ""
```

---

## 📸 STEP 5: TEST BROWSER COMPLET (À TOI)

### Checklist Finale

```
🎯 DARK MODE (Défaut):
  [ ] /map charges en dark
  [ ] Sidebar = #0a0a0a
  [ ] FilterPanel = #0a0a0a
  [ ] Trois cartes = #050505 background
  [ ] Overlays = #0a0a0a surface
  [ ] Texte = blanc (#ffffff)
  [ ] Borders = #333333
  [ ] Toggle button = Sun (yellow)
  [ ] Aucune couleur light mode visible

🎯 SWITCH TO LIGHT MODE:
  [ ] Sidebar = #f5f5f5
  [ ] FilterPanel = #f5f5f5
  [ ] Trois cartes = #ffffff background — **CRUCIAL**
  [ ] Overlays = #f5f5f5 surface
  [ ] Texte = noir (#1a1a1a)
  [ ] Borders = #d0d0d0
  [ ] Toggle button = Moon (gray)
  [ ] Aucune couleur dark mode visible
  [ ] Zéro noir/gris foncé

🎯 PERSISTENCE:
  [ ] Refresh → thème persiste
  [ ] DevTools → localStorage.getItem('geomatik-theme') = "light"

🎯 TOGGLE SMOOTH:
  [ ] Aucun flash au toggle
  [ ] Transition fluide (0.3s)
  [ ] Tous les éléments changent ensemble

🎯 CONTRASTE & A11y:
  [ ] Texte lisible sur tous les fonds (4.5:1 contrast)
  [ ] Dark mode: blanc sur sombre OK
  [ ] Light mode: noir sur clair OK
  [ ] Icons visibles + distingés

🎯 DATA-VIZ:
  [ ] Choroplèthe colors = inchangées (data-driven)
  [ ] Legend colors = visibles
  [ ] No color collision
```

---

## 🧠 SKILLS À UTILISER

```markdown
## SKILLS OBLIGATOIRES

- @geomatik-dark-light-mode
  → Audit palette CSS vars, hardcodes, tokenisation
  → Tous les Tailwind colors, inline styles
  → MapLibre overlays, buttons, inputs, selects

- @frontend-design
  → Vérifier contraste (WCAG AA minimum 4.5:1)
  → Cohérence visuelle dark/light
  → Pas d'artefacts UI, transitions smooth
  → Design tokens cohérents

- @geomatik-metier
  → Cartes + données: choroplèthe colors (data-driven)
  → Ne pas tokeniser les couleurs de signification
  → Overlays sur MapLibre = metadata, pas data

- @supabase-geomatik
  → Si besoin de vérifier localStorage/auth pendant tests
```

---

## 📝 COMMANDES CLAUDE CODE FINALE

```bash
# STEP 0: Diagnostic
echo "=== Hardcoded Tailwind ==="
grep -r "bg-gray\|bg-white\|bg-black\|bg-slate\|text-gray" app/map/ --include="*.tsx" | head -30

echo ""
echo "=== Inline Styles ==="
grep -r "backgroundColor:\|borderColor:" app/map/ --include="*.tsx" | head -20

# STEP 1-3: Fixes (Claude Code va proposer)
# (Remplacements automatiques)

# STEP 4: Verify
npm run build
npm run type-check

# STEP 5: Commit
git add -A && git commit -m "fix(theme): audit & fix /map dark/light mode — MapLibre canvas, overlays, FilterPanel"
```

---

## 🎯 RÉSULTAT ATTENDU

✅ **Dark Mode:** `/map` complètement noir/gris foncé  
✅ **Light Mode:** `/map` complètement blanc/gris clair (ZÉRO noir)  
✅ **Trois Cartes:** Background change correctement au toggle  
✅ **Persistence:** localStorage garde le thème  
✅ **Smooth:** Aucun flash au toggle  
✅ **Contraste:** Texte lisible sur les 2 thèmes  
✅ **Data-Viz:** Choroplèthe colors intactes (non tokenisées)  

---

## 📋 NOTES FINALES

- **MapLibre canvas = problème principal** → utiliser CSS var ou useTheme hook
- **FilterPanel = deuxième priorité** → tokeniser TOUS les inputs/labels
- **Trois cartes = CRITIQUE** → vérifier background + overlays
- **Ne pas toucher data-viz colors** → elles ont du sens (data-driven)
- **Utiliser les skills = meilleure qualité** + catch des edge cases
