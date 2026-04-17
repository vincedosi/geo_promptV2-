# Design Heatmap Régies — Expand overlay + Transposée
## Prompt Claude Code CLI

---

## SKILLS OBLIGATOIRES

@verification-before-completion @executing-plans @systematic-debugging @smart-explore @finishing-a-development-branch @writing-plans @brainstorming @dispatching-parallel-agents @receiving-code-review @requesting-code-review @subagent-driven-development @test-driven-development @using-git-worktrees @using-superpowers @writing-skills @do @make-plan @mem-search @timeline-report @frontend-design

## FICHIERS INTERDITS

- `/api/isochrone-battle/route.ts`
- Toute fonction `battle_*`, `get_isochrone_battle`, `clip_geojson_to_france`, `clip_rings_to_france`

---

## 3 MODIFICATIONS

### 1. Supprimer les boutons "Régions" et "Depts" dans le heatmap

Dans le composant `MediaHeatmap.tsx` (ou équivalent), il y a deux boutons/tabs "Régions" et "Depts" en haut à droite du bloc "Régies × géographie". 

**Les supprimer.** Le heatmap suit déjà le niveau d'agrégation sélectionné dans la top bar (le toggle CP/Dept/Région). Pas besoin de doublons.

```bash
# Trouver le composant
find app -path "*DIGITAL*" -name "*Heatmap*" -o -name "*heatmap*" | head -5
cat <fichier_trouvé>
# Chercher les boutons Régions/Depts
grep -n "Regions\|Depts\|region.*dept\|tab.*heatmap" <fichier_trouvé>
# Supprimer les boutons et le state associé
```

### 2. Bouton "Expand" → overlay plein écran du heatmap

Ajouter un petit bouton **expand** (icône ↗ ou ⛶) en haut à droite du bloc heatmap. Au click → le heatmap s'affiche dans un **overlay plein écran** par-dessus le volet analyse.

**L'overlay heatmap :**

```
┌─────────────────────────────────────────────────────────────────┐
│ Régies × géographie                    [Transposer] [✕ Fermer] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  (Le heatmap en grand — toute la largeur et hauteur dispo)      │
│  (scroll horizontal si beaucoup de colonnes)                    │
│  (scroll vertical si beaucoup de régies)                        │
│                                                                 │
│              Auvergne  Bourgogne  Bretagne  Centre  Corse  ...  │
│ Antvoice    [+1.3]    [+1.2]     [+1.6]    [-0.9]  [0.0]  ...  │
│ Gravity     [+1.9]    [+1.3]     [+4.9]    [-0.1]  [-0.1] ...  │
│ KWords      [+1.1]    [+1.2]     [+0.6]    [-0.7]  [-8.6] ...  │
│ ...                                                             │
│                                                                 │
│         ◀━━━━━━━━━━━━━━━━━━━━●━━━━━━━━━━━━━━━━━━━━━━━━━━━▶     │
│         sous-servi          ═          sur-servi                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Specs overlay :**
- Position : `absolute inset-0 z-50` par-dessus le volet analyse
- Fond : `#0a0a0f` (opaque, couvre tout)
- Le heatmap prend toute la surface disponible
- Bouton Fermer (✕) en haut à droite → retour au volet analyse normal
- Escape ferme aussi l'overlay
- Transition : fade 200ms

### 3. Bouton "Transposer" — inverser lignes et colonnes

Un bouton **"Transposer"** (icône ⇅ ou 🔄) qui inverse les axes du heatmap :

**Mode normal (défaut) :**
- Lignes = régies
- Colonnes = zones géographiques (régions ou départements)

**Mode transposé :**
- Lignes = zones géographiques
- Colonnes = régies

C'est utile quand il y a beaucoup de zones (96 départements) — en transposé, les zones sont en lignes (scroll vertical naturel) et les régies en colonnes (peu de colonnes, pas de scroll horizontal).

```typescript
const [transposed, setTransposed] = useState(false);

// En mode normal :
// rows = medias, cols = zones
// En mode transposé :
// rows = zones, cols = medias

const rows = transposed ? zones : medias;
const cols = transposed ? medias : zones;
const getCellValue = (row, col) => {
  const media = transposed ? col : row;
  const zone = transposed ? row : col;
  return cells.find(c => c.media === media && c.zone_code === zone);
};
```

**Le bouton Transposer est visible :**
- Dans le bloc heatmap compact (à côté du bouton expand)
- Dans l'overlay plein écran (en haut à droite, à côté du bouton fermer)

---

## DIAGNOSTIC (`@smart-explore`)

```bash
# Le composant heatmap
find app -path "*DIGITAL*" -name "*Heatmap*" -o -name "*heatmap*" | head -5
cat <fichier_trouvé>

# Les boutons Régions/Depts à supprimer
grep -n "Regions\|Depts\|region\|dept" <fichier_trouvé>

# Comment l'overlay analyse est structuré (pour savoir où mettre l'overlay heatmap)
grep -rn "overlay\|z-50\|z-40\|absolute.*inset" --include="*.tsx" app/**/DIGITAL/ | head -10
```

---

## DESIGN (`@frontend-design` — lire `DESIGN_SYSTEM.md`)

### Bouton expand
- Icône : `↗` ou icône expand de lucide-react (`Maximize2` ou `Expand`)
- Taille : 28×28px
- Fond : transparent
- Hover : `bg-white/10`
- Border-radius : 6px
- Position : en haut à droite du bloc heatmap, à côté du titre

### Bouton transposer
- Icône : `⇅` ou lucide-react `ArrowUpDown` ou `RotateCw`
- Même style que le bouton expand
- Tooltip on hover : "Transposer lignes/colonnes"

### Overlay heatmap
- Fond : `#0a0a0f` opaque
- Padding : 24px
- Le heatmap prend `calc(100vh - 80px)` de hauteur (toute la vue moins le header)
- Scroll : `overflow: auto` dans les deux directions
- Titre "Régies × géographie" en `text-lg font-medium text-white/80`
- Légende en bas : gradient sous-servi → sur-servi

### Heatmap en grand format
- Les cellules peuvent être plus grandes (40×40px au lieu de 28×28px en compact)
- Font-size des valeurs : 12px (au lieu de 10px en compact)
- Les headers (noms de régies et zones) sont plus lisibles
- Sticky first column (noms des lignes restent visibles au scroll horizontal)
- Sticky header row (noms des colonnes restent visibles au scroll vertical)

---

## VÉRIFICATION (`@verification-before-completion`)

1. Les boutons "Régions" et "Depts" ont disparu du heatmap compact ✅
2. Le bouton expand (↗) est visible en haut à droite du heatmap ✅
3. Click expand → overlay plein écran avec le heatmap en grand ✅
4. Click fermer (✕) ou Escape → retour au volet analyse ✅
5. Le bouton Transposer est visible (compact + overlay) ✅
6. Click Transposer → les axes s'inversent (régies ↔ zones) ✅
7. Re-click Transposer → retour au mode normal ✅
8. En mode transposé avec beaucoup de zones → scroll vertical naturel ✅
9. Headers sticky en overlay (first col + header row) ✅
10. Les données sont identiques en mode normal et transposé ✅

## GIT

```
git commit -m "feat(digital-heatmap): remove redundant tabs, add expand overlay and transpose"
```
