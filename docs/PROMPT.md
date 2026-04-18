# REFONTE HIÉRARCHIE VISUELLE PANEL EXPERT

## SKILLS OBLIGATOIRES
@verification-before-completion @executing-plans @systematic-debugging @smart-explore @finishing-a-development-branch @writing-plans @brainstorming @dispatching-parallel-agents @receiving-code-review @requesting-code-review @subagent-driven-development @test-driven-development @using-git-worktrees @using-superpowers @writing-skills @do @make-plan @mem-search @timeline-report @frontend-design

## LECTURE PRÉALABLE — OBLIGATOIRE AVANT TOUTE LIGNE DE CODE
1. DESIGN_SYSTEM.md
2. .claude/skills/geomatik-ux/SKILL.md
3. .claude/skills/geomatik-product-vision/SKILL.md
4. .claude/skills/frontend-design/SKILL.md
5. .claude/skills/cleanup-geomatik/SKILL.md

## POINT DE SAUVEGARDE
```bash
git add -A && git commit -m "checkpoint: avant refonte hiérarchie panel expert"
git checkout -b fix/panel-expert-hierarchie
```

## OBJECTIF
Les catégories maîtres (PÉRIMÈTRE, DONNÉES TERRAIN, ANALYSES, CAMPAGNES MÉDIA)
doivent se distinguer FORTEMENT des layers enfants. Actuellement tout se ressemble.

# ============================================================
# PHASE 1 : RENOMMER + RESTRUCTURER LES CATÉGORIES
# ============================================================

### Renommer "CONTEXTE" → "PÉRIMÈTRE"
Trouver et remplacer dans FilterPanel.tsx :
- Le titre "CONTEXTE" ou "Contexte" → "PÉRIMÈTRE"
- Regrouper dedans : Périmètre global + Régions + Départements + Recherche locale
- **defaultOpen: false** (fermé par défaut — 90% du temps on touche pas)
- La couleur catégorie reste var(--cat-context) gris

### Supprimer "DONNÉES SOCIO-DÉMO" comme catégorie séparée
IRIS et Carreaux Filosofi bougent dans DONNÉES TERRAIN.
C'est des données qu'on affiche sur la carte, comme les POI ou le TMJA.
Pas besoin d'une catégorie à part pour 2 layers.

### Structure finale (4 catégories, pas 5) :

```
PÉRIMÈTRE          → gris    var(--cat-context)   → fermé par défaut
  Périmètre global
  Régions
  Départements
  Recherche locale

DONNÉES TERRAIN    → teal    var(--cat-terrain)    → ouvert par défaut
  Points d'intérêt (POI)
  Panneaux OOH et DOOH
  Arrêts de transport
  Flux routier (TMJA)
  Radio FM/DAB+
  IRIS
  Carreaux Filosofi

ANALYSES           → coral   var(--cat-analysis)   → fermé par défaut
  Analyse spatiale
  Scoring OOH
  Corrélation IRIS × POI
  Clustering
  Couverture

CAMPAGNES MÉDIA    → ambre   var(--cat-media)      → fermé par défaut
  Campagne digitale
```

Commit : `refactor(panel): 4 catégories — Périmètre, Terrain, Analyses, Campagnes`

# ============================================================
# PHASE 2 : HEADER CATÉGORIE — BANDEAU COLORÉ DISTINCTIF
# ============================================================

Modifier CategoryGroup.tsx — le header catégorie doit être VISUELLEMENT
différent d'un layer enfant. Pas juste un dot de couleur.

### Spec du header catégorie maître :

```css
/* Le bandeau prend toute la largeur */
.category-header {
  background: rgba(var(--cat-color-rgb), 0.06);  /* fond teinté subtil */
  border-top: 1px solid rgba(var(--cat-color-rgb), 0.12);
  border-bottom: 1px solid rgba(var(--cat-color-rgb), 0.08);
  padding: 10px 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  transition: background 0.15s;
}

.category-header:hover {
  background: rgba(var(--cat-color-rgb), 0.10);
}

/* Dot catégorie */
.category-dot {
  width: 8px;           /* 8px, plus gros que les dots layers (6px) */
  height: 8px;
  border-radius: 50%;
  background: var(--cat-color);
  flex-shrink: 0;
}

/* Label catégorie */
.category-label {
  font-family: 'Inter', sans-serif;
  font-weight: 600;        /* 600 bold — les layers sont 400 regular */
  font-size: 11px;
  color: var(--cat-color);  /* COULEUR de la catégorie, pas blanc/gris */
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

/* Chevron */
.category-chevron {
  margin-left: auto;
  width: 14px;
  height: 14px;
  color: var(--cat-color);  /* Même couleur que le label */
  opacity: 0.5;
  transition: transform 0.2s;
}
```

### Tokens RGB pour les rgba()

Ajouter dans globals.css les versions RGB pour pouvoir faire rgba() :
```css
:root {
  --cat-context: #8a8a8a;
  --cat-context-rgb: 138, 138, 138;
  --cat-terrain: #4ecdc4;
  --cat-terrain-rgb: 78, 205, 196;
  --cat-socio: #5b9bd5;
  --cat-socio-rgb: 91, 155, 213;
  --cat-media: #f7b731;
  --cat-media-rgb: 247, 183, 49;
  --cat-analysis: #e8845c;
  --cat-analysis-rgb: 232, 132, 92;
}
```

Et en light mode, mêmes valeurs RGB ajustées.

### Passer la couleur comme prop

CategoryGroup reçoit `color` et `colorRgb` :
```typescript
interface CategoryGroupProps {
  title: string;
  color: string;       // "var(--cat-terrain)"
  colorRgb: string;    // "var(--cat-terrain-rgb)" pour les rgba()
  defaultOpen?: boolean;
  collapsible?: boolean; // true par défaut
  children: React.ReactNode;
}
```

Alternative plus simple si rgba avec var() pose problème :
passer directement les styles inline avec les hex.

Commit : `feat(panel): header catégorie avec bandeau coloré distinctif`

# ============================================================
# PHASE 3 : LAYERS ENFANTS — INDENT + DISCRÉTION
# ============================================================

Les layers enfants doivent être visuellement SUBORDONNÉS à leur catégorie.

### Spec du layer enfant :

```css
/* Indent par rapport au header catégorie */
.layer-item {
  padding: 8px 14px 8px 30px;  /* 30px left = indent 16px sous le dot catégorie */
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  transition: background 0.1s;
}

.layer-item:hover {
  background: var(--elevated);  /* #111 dark, #f0f0f0 light */
}

/* Dot layer — plus petit que le dot catégorie */
.layer-dot {
  width: 6px;          /* 6px vs 8px pour la catégorie */
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

/* Layer INACTIF */
.layer-dot--inactive {
  background: var(--cat-color);
  opacity: 0.25;
}
.layer-name--inactive {
  color: var(--text-tertiary);  /* #8a8a8a */
  font-size: 13px;
  font-weight: 400;
}

/* Layer ACTIF */
.layer-dot--active {
  background: var(--cat-color);
  opacity: 1.0;
}
.layer-name--active {
  color: var(--text-primary);  /* #f0f0f0 */
  font-size: 13px;
  font-weight: 500;           /* medium quand actif */
}

/* Accordéon ouvert — border-left coloré */
.layer-content {
  margin-left: 30px;
  padding: 8px 12px 12px 14px;
  border-left: 2px solid rgba(var(--cat-color-rgb), 0.25);
  border-bottom: 0.5px solid var(--border-subtle);
}
```

### Switch on/off dans les layers

Le switch toggle le layer sans ouvrir l'accordéon.
Le switch actif utilise la couleur de la catégorie :
```
Switch INACTIF :
  track: var(--border-subtle) #1a1a1a
  thumb: var(--text-tertiary) #8a8a8a

Switch ACTIF :
  track: var(--cat-color) — teal pour terrain, ambre pour média, etc.
  thumb: var(--text-primary) #f0f0f0
```

Commit : `feat(panel): layers enfants indentés + hiérarchie actif/inactif`

# ============================================================
# PHASE 4 : GAPS ENTRE CATÉGORIES
# ============================================================

Ajouter un espace clair entre chaque bloc de catégorie :

```css
.category-group {
  margin-bottom: 12px;  /* Gap entre catégories */
}

/* Dernier layer d'une catégorie ouverte : pas de border-bottom 
   (le gap suffit comme séparateur) */
.category-group:last-child .layer-item:last-child {
  border-bottom: none;
}
```

Le gap de 12px crée une rupture visuelle nette entre les 4 blocs.
C'est ce qui fait que le planneur voit 4 zones distinctes, pas une liste.

Commit : `feat(panel): gaps 12px entre catégories`

# ============================================================
# PHASE 5 : BOUTONS CTA — DERNIERS ORANGE
# ============================================================

```bash
grep -rn "orange\|#f97316\|#ea580c\|#fb923c\|bg-orange\|text-orange" \
  --include="*.tsx" --include="*.ts" --include="*.css" \
  components/ app/
```

Tout remplacer par le style teal CTA DESIGN_SYSTEM :
```
background: transparent
border: 0.5px solid var(--brand-teal)
color: var(--brand-teal)
border-radius: 6px
padding: 8px 16px
font: Inter 500, 12px
width: 100%
text-align: center
hover: background rgba(78,205,196,0.1)
```

Commit : `fix(buttons): zéro orange — tous CTA en teal`

# ============================================================
# VÉRIFICATION FINALE
# ============================================================

1. `npm run build` — 0 erreurs
2. 4 catégories visibles : PÉRIMÈTRE, DONNÉES TERRAIN, ANALYSES, CAMPAGNES MÉDIA
3. Chaque catégorie a un bandeau de fond coloré subtil (teinté, pas opaque)
4. Le label de catégorie est en couleur de catégorie (pas blanc/gris)
5. Les layers enfants sont indentés de 16px sous le header catégorie
6. Les layers inactifs sont visuellement discrets (dot 25%, texte tertiary)
7. Les layers actifs sont clairs (dot 100%, texte primary, font medium)
8. Les accordéons ont un border-left coloré quand ouverts
9. Gap 12px entre chaque catégorie
10. PÉRIMÈTRE est fermé par défaut
11. DONNÉES TERRAIN est ouvert par défaut
12. ANALYSES et CAMPAGNES MÉDIA sont fermés par défaut
13. AUCUN bouton orange restant
14. Fonctionne en dark ET light mode

## POST-LIVRAISON — CLEANUP OBLIGATOIRE
1. Lance `@cleanup-geomatik` Partie 2 (lint + types) sur les fichiers modifiés
2. Lance `@cleanup-geomatik` Partie 3 (sécurité) sur les fichiers modifiés
3. Rapport : failles sécu + `any` introduits + catch non typés + imports inutilisés
4. Corrige TOUT avant de considérer la tâche terminée
5. Commit : `chore(cleanup): lint + types + sécurité post-refonte panel`
6. Utilise `requesting-code-review` pour le résumé
7. Utilise `timeline-report` pour le rapport

## INTERDIT
- Ne PAS modifier la logique métier des layers
- Ne PAS modifier /api/isochrone-battle/route.ts ni les fonctions battle_*
- Ne PAS utiliser de violet (#a855f7)
- Ne PAS hardcoder les types de POI ou régies

Commit final : `feat(panel): hiérarchie visuelle — bandeaux colorés + indent + gaps`
Tag : `git tag panel-hierarchie-$(date +%Y%m%d)`