# FIX CARTES NOIRES + REFONTE VISUELLE PANEL EXPERT

## SKILLS OBLIGATOIRES
@verification-before-completion @executing-plans @systematic-debugging @smart-explore @finishing-a-development-branch @writing-plans @brainstorming @dispatching-parallel-agents @receiving-code-review @requesting-code-review @subagent-driven-development @test-driven-development @using-git-worktrees @using-superpowers @writing-skills @do @make-plan @mem-search @timeline-report @frontend-design

## LECTURE PRÉALABLE — OBLIGATOIRE AVANT TOUTE LIGNE DE CODE
1. DESIGN_SYSTEM.md
2. .claude/skills/geomatik-product-vision/SKILL.md
3. .claude/skills/geomatik-ux/SKILL.md
4. .claude/skills/frontend-design/SKILL.md
5. .claude/skills/cleanup-geomatik/SKILL.md

## POINT DE SAUVEGARDE
```bash
git add -A && git commit -m "checkpoint: avant fix cartes noires + refonte panel"
git checkout -b fix/cartes-noires-panel-expert
```

# ============================================================
# PARTIE A — FIX CRITIQUE : CARTES NOIRES (priorité absolue)
# ============================================================

Les 2 cartes droites (Impressions + Population) en vue comparée Digital
ont un fond noir — les tuiles MapLibre ne se chargent pas.
La carte Ratio à gauche fonctionne.

## Diagnostic obligatoire AVANT de coder

```bash
# Comment l'ancienne page passait le style aux cartes
grep -rn "style\|mapStyle\|styleUrl\|cartocdn\|positron\|dark-matter\|openfreemap" \
  --include="*.tsx" --include="*.ts" \
  app/map/analyse/digital/_components/SyncMap.tsx

# Comment le nouveau TripleMapView passe le style
grep -rn "style\|mapStyle\|styleUrl\|cartocdn\|positron\|dark-matter\|openfreemap" \
  --include="*.tsx" --include="*.ts" \
  components/digital/TripleMapView.tsx

# Le style de la carte principale (qui fonctionne)
grep -rn "mapStyle\|STYLE_URL\|style:" --include="*.tsx" --include="*.ts" \
  app/map/page.tsx lib/map/
```

## Causes probables (vérifier dans l'ordre)
1. Le style URL n'est pas passé aux 2e et 3e instances MapLibre
2. Les cartes sont créées avant que le style soit chargé (timing)
3. Le composant SyncMap attend un prop style qui n'est plus passé depuis la migration
4. Les cartes re-render et perdent leur style à cause d'un state cycle

## Fix
- Comparer prop par prop entre l'ancien SyncMap dans /map/analyse/digital/ et le nouveau
- Le même style URL que la carte principale doit être passé aux 3 cartes
- Tester en vue comparée : les 3 cartes doivent avoir des tuiles visibles

Commit : `fix(digital): cartes noires — passer style URL aux 3 instances MapLibre`

# ============================================================
# PARTIE B — REFONTE VISUELLE PANEL EXPERT
# ============================================================

## CONCEPT : Couleurs par catégorie

Chaque catégorie a sa propre couleur. Le dot de la catégorie ET les dots
des layers enfants utilisent cette couleur. Ça permet de se repérer
instantanément dans le panel.

### Palette des catégories

```
CONTEXTE        → #8a8a8a (gris — structurel, neutre, toujours là)
DONNÉES TERRAIN → #4ecdc4 (teal — cœur métier OOH, couleur brand)  
DONNÉES SOCIO   → #5b9bd5 (bleu info — données statistiques)
CAMPAGNES MÉDIA → #f7b731 (ambre warning — données chaudes, action)
ANALYSES        → #e8845c (coral — résultats, outputs)
```

Ajouter ces tokens dans globals.css :
```css
:root {
  --cat-context: #8a8a8a;
  --cat-terrain: #4ecdc4;
  --cat-socio: #5b9bd5;
  --cat-media: #f7b731;
  --cat-analysis: #e8845c;
}
/* Versions light mode */
.light {
  --cat-context: #737373;
  --cat-terrain: #0d9488;
  --cat-socio: #2563eb;
  --cat-media: #d97706;
  --cat-analysis: #c2410c;
}
```

### Modifier CategoryGroup.tsx

Le composant reçoit un nouveau prop `color` :
```typescript
interface CategoryGroupProps {
  title: string;
  color?: string;        // NOUVEAU — CSS variable ex: "var(--cat-terrain)"
  defaultOpen?: boolean;
  children: React.ReactNode;
}
```

Le dot utilise cette couleur au lieu du teal fixe.
Le header catégorie :
```
- background: var(--elevated) (#111 dark, #f0f0f0 light)
- border-top: 1px solid var(--border-subtle)
- padding: 10px 14px
- Dot : 6px × 6px, border-radius 50%, background: props.color
- Label : Inter 500, 11px, couleur du dot (props.color), uppercase, letter-spacing 0.06em
- Chevron : 14px, var(--text-tertiary), ml-auto
```

Note : le label de catégorie utilise la COULEUR de la catégorie, pas le gris.
Ça renforce l'identification visuelle.

### Modifier LayerSwitch.tsx

Le dot du layer hérite la couleur de sa catégorie MAIS en version atténuée :
- Layer inactif : dot en couleur catégorie à 30% opacité
- Layer actif : dot en couleur catégorie à 100%

```typescript
interface LayerSwitchProps {
  // ... props existants
  color?: string;   // NOUVEAU — hérité de la catégorie parente
}
```

Styles layer selon état :
```
Layer INACTIF (switch off) :
- Hauteur : 36px
- Dot : 6px, couleur catégorie opacity 0.3
- Texte : var(--text-tertiary) #8a8a8a
- Pas de fond spécial
- Switch : track var(--border-subtle), thumb var(--text-tertiary)

Layer ACTIF (switch on) :
- Hauteur : 36px (+ accordéon si ouvert)
- Dot : 6px, couleur catégorie opacity 1.0
- Texte : var(--text-primary) #f0f0f0
- Fond léger : rgba(couleur-catégorie, 0.03)
- Switch : track couleur-catégorie, thumb var(--text-primary)
```

### Accordéon déplié — border-left couleur

Quand un layer est déplié, le contenu de l'accordéon a un border-left 
dans la couleur de la catégorie :
```
- border-left: 2px solid rgba(couleur-catégorie, 0.3)
- margin-left: 20px (aligné sous le dot)
- padding-left: 12px
```

### Appliquer les couleurs dans FilterPanel.tsx

```tsx
<CategoryGroup title="CONTEXTE" color="var(--cat-context)" defaultOpen={true}>
  {/* Périmètre, Régions, Départements, Recherche locale */}
</CategoryGroup>

<CategoryGroup title="DONNÉES TERRAIN" color="var(--cat-terrain)" defaultOpen={true}>
  <LayerSwitch name="Points d'intérêt" color="var(--cat-terrain)" ...>
  <LayerSwitch name="Panneaux OOH et DOOH" color="var(--cat-terrain)" ...>
  <LayerSwitch name="Arrêts de transport" color="var(--cat-terrain)" ...>
  <LayerSwitch name="Flux routier TMJA" color="var(--cat-terrain)" ...>
  <LayerSwitch name="Radio FM/DAB+" color="var(--cat-terrain)" ...>
</CategoryGroup>

<CategoryGroup title="DONNÉES SOCIO-DÉMO" color="var(--cat-socio)" defaultOpen={false}>
  <LayerSwitch name="IRIS" color="var(--cat-socio)" ...>
  <LayerSwitch name="Carreaux Filosofi" color="var(--cat-socio)" ...>
</CategoryGroup>

<CategoryGroup title="CAMPAGNES MÉDIA" color="var(--cat-media)" defaultOpen={false}>
  <LayerSwitch name="Campagne digitale" color="var(--cat-media)" ...>
</CategoryGroup>

<CategoryGroup title="ANALYSES" color="var(--cat-analysis)" defaultOpen={false}>
  <LayerSwitch name="Analyse spatiale" color="var(--cat-analysis)" ...>
  <LayerSwitch name="Scoring OOH" color="var(--cat-analysis)" ...>
  {/* etc */}
</CategoryGroup>
```

### État par défaut des catégories
- CONTEXTE : ouvert, non collapsible (toujours visible)
- DONNÉES TERRAIN : ouvert par défaut
- DONNÉES SOCIO-DÉMO : fermé par défaut
- CAMPAGNES MÉDIA : fermé par défaut
- ANALYSES : fermé par défaut

### Gap entre catégories
Ajouter `margin-bottom: 8px` après chaque CategoryGroup fermé.
Ajouter `margin-bottom: 4px` après chaque CategoryGroup ouvert.
Ça crée des blocs visuels séparés.

### Boutons CTA restants en orange
S'il reste des boutons orange (Afficher arrêts, Afficher TMJA), 
les remplacer par le style teal CTA du DESIGN_SYSTEM :
```
background: transparent
border: 0.5px solid var(--brand-teal)
color: var(--brand-teal)
hover: background rgba(78,205,196,0.1)
```

```bash
grep -rn "orange\|#f97316\|#ea580c\|#fb923c\|bg-orange\|text-orange" \
  --include="*.tsx" --include="*.ts" --include="*.css"
```

# ============================================================
# VÉRIFICATION FINALE
# ============================================================

1. `npm run build` — 0 erreurs
2. Les 3 cartes Digital ont des tuiles (PAS de fond noir)
3. Chaque catégorie a sa couleur distincte (gris, teal, bleu, ambre, coral)
4. Les layers inactifs sont visuellement discrets (dot 30%, texte tertiary)
5. Les layers actifs sont visuellement clairs (dot 100%, texte primary)
6. Les accordéons dépliés ont un border-left coloré
7. Les catégories fermées par défaut sont bien fermées
8. Il y a un gap visible entre les catégories
9. AUCUN bouton orange restant
10. Le panel fonctionne en dark ET light mode

## POST-LIVRAISON — CLEANUP OBLIGATOIRE
1. Lance `@cleanup-geomatik` Partie 2 (lint + types) sur les fichiers modifiés
2. Lance `@cleanup-geomatik` Partie 3 (sécurité) sur les fichiers modifiés
3. Rapport : failles sécu + `any` introduits + catch non typés + imports inutilisés
4. Corrige TOUT avant de considérer la tâche terminée
5. Commit : `chore(cleanup): lint + types + sécurité post-fix`
6. Utilise `requesting-code-review` pour générer le résumé
7. Utilise `timeline-report` pour le rapport chronologique

## INTERDIT
- Ne PAS modifier la logique métier des layers
- Ne PAS modifier /api/isochrone-battle/route.ts ni les fonctions battle_*
- Ne PAS hardcoder les types de POI ou régies
- Ne PAS utiliser de violet (#a855f7)

Commit final : `feat(panel): couleurs catégories + fix cartes noires + layers actif/inactif`