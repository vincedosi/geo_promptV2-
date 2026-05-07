# SPRINT 4 — THÈME LIGHT/DARK COMPLET
# Le toggle thème s'applique partout : panel, sidebar, carte, cartes Digital
# Pré-requis : Sprint 0 (ThemeProvider créé) + Sprints 1-3 mergés

## SKILLS OBLIGATOIRES
@verification-before-completion @executing-plans @systematic-debugging @smart-explore @finishing-a-development-branch @writing-plans @brainstorming @dispatching-parallel-agents @receiving-code-review @requesting-code-review @subagent-driven-development @test-driven-development @using-git-worktrees @using-superpowers @writing-skills @do @make-plan @mem-search @timeline-report @frontend-design

## LECTURE PRÉALABLE — OBLIGATOIRE AVANT TOUTE LIGNE DE CODE
Lis ces fichiers dans l'ordre :
1. DESIGN_SYSTEM.md — tokens visuels, composants, règles d'or
2. .claude/skills/magelian-product-vision/SKILL.md — architecture UX cible
3. .claude/skills/magelian-ux/SKILL.md — règles UX (états, contraste, feedback)
4. .claude/skills/frontend-design/SKILL.md — design visuel et esthétique
5. .claude/skills/magelian-metier/SKILL.md — vocabulaire métier OOH/IRIS
6. .claude/skills/cleanup-magelian/SKILL.md — règles de cleanup post-dev

## STRATÉGIE D'EXÉCUTION — AGENTS

### Planification
- `make-plan` : plan complet AVANT d'écrire du code
- `smart-explore` : cartographier les fichiers impactés
- `brainstorming` : si un choix d'architecture n'est pas évident
- `mem-search` : vérifier le contexte des décisions passées
- Soumettre le plan pour VALIDATION avant d'exécuter

### Exécution
- `executing-plans` : dérouler phase par phase
- `dispatching-parallel-agents` : tâches indépendantes en parallèle
- `subagent-driven-development` : sous-tâches complexes
- `systematic-debugging` : si bug pendant le dev
- `frontend-design` : CHAQUE composant UI créé ou modifié — le design est obligatoire

### Vérification
- `verification-before-completion` : AVANT de considérer terminé
- `requesting-code-review` : résumé des changements
- `finishing-a-development-branch` : merge propre
- `timeline-report` : rapport final


## POINT DE SAUVEGARDE
```bash
git add -A && git commit -m "checkpoint: avant sprint 4 thème"
git checkout -b sprint/4-theme
```

## PHASE 1 : AUDIT DES COULEURS HARDCODÉES

Le Sprint 0 a créé les CSS variables et le ThemeProvider.
Mais beaucoup de composants utilisent encore des couleurs en dur.

```bash
# Toutes les couleurs hardcodées dans les composants
grep -rn "#050505\|#0a0a0a\|#111111\|#181818\|#1a1a1a\|#262626\|#333333" \
  --include="*.tsx" --include="*.ts" components/ app/
grep -rn "#f0f0f0\|#a0a0a0\|#b0b0b0\|#8a8a8a\|#666666" \
  --include="*.tsx" --include="*.ts" components/ app/
grep -rn "#4ecdc4\|#3dbdb5" --include="*.tsx" --include="*.ts" components/ app/
# Couleurs dans les fichiers CSS/modules
grep -rn "#050505\|#0a0a0a\|#111\|#181818\|#f0f0f0" \
  --include="*.css" --include="*.module.css" styles/ app/
```

## PHASE 2 : MIGRATION VERS CSS VARIABLES

Pour chaque occurrence hardcodée trouvée :

| Hardcodé | Variable CSS |
|----------|-------------|
| #050505 | var(--background) |
| #0a0a0a | var(--card) |
| #111111, #111 | var(--elevated) |
| #181818 | var(--overlay) |
| #1a1a1a | var(--border-subtle) |
| #262626 | var(--border-default) |
| #333333 | var(--border-hover) |
| #f0f0f0 | var(--text-primary) |
| #b0b0b0 | var(--text-secondary) |
| #8a8a8a | var(--text-tertiary) |
| #4ecdc4 | var(--brand-teal) |
| #3dbdb5 | var(--brand-teal-hover) |
| #3dffa0 | var(--success) |
| #ff5757 | var(--danger) |
| #f7b731 | var(--warning) |

### Exceptions — NE PAS migrer :
- Les couleurs dans les légendes de carte (TMJA, choroplèthes) — elles sont sémantiques
- Les couleurs des sparklines et charts — elles sont data-driven
- Les couleurs dans les styles MapLibre — elles changent autrement (Phase 3)

Procéder fichier par fichier. Commit par lot de 5-10 fichiers :
`fix(theme): migrer couleurs hardcodées → CSS variables — composants map/`
`fix(theme): migrer couleurs hardcodées → CSS variables — composants ui/`
`fix(theme): migrer couleurs hardcodées → CSS variables — composants digital/`

## PHASE 3 : CARTE MAPLIBRE

### 3.1 — Styles de carte par thème

Définir les URLs de style par thème :
```typescript
const MAP_STYLES = {
  dark: {
    default: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    positron: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    satellite: '...' // si disponible
  },
  light: {
    default: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
    positron: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
    satellite: '...'
  }
};
```

### 3.2 — Changement dynamique
Quand le thème toggle :
1. `map.setStyle(MAP_STYLES[theme].default)`
2. Réappliquer les sources et layers actifs après le style change
   (MapLibre supprime tout au setStyle — il faut re-add)
3. Transition : pas de fade possible sur MapLibre, mais les layers 
   se réappliquent instantanément

### 3.3 — Labels de fond de carte
Les boutons actuels (FOND, Lib, Bn, Pos, GEO) sont cryptiques.
Les renommer :
- "Standard" (Positron/Dark Matter selon thème)
- "Satellite"
- "OSM"
Utiliser des thumbnails 24×24px si possible, sinon des labels lisibles.

Commit : `feat(theme): styles carte MapLibre light/dark + labels lisibles`

## PHASE 4 : SIDEBAR

La sidebar doit répondre au thème.
Actuellement elle est toujours dark (#0a0a0a).

En light mode :
- Background : var(--card) → #f8f8f8
- Border-right : var(--border-subtle) → #e5e5e5
- Logo MAGELIAN : "GEOM" en var(--text-primary), "ATIK" en var(--brand-teal)
- Items : var(--text-secondary)
- Item actif : var(--elevated) bg, var(--text-primary) color

Si la sidebar utilise déjà des CSS variables depuis Sprint 0, ça devrait
fonctionner automatiquement. Sinon, migrer les couleurs hardcodées.

Commit : `feat(theme): sidebar responsive au thème light/dark`

## PHASE 5 : COMPOSANTS SPÉCIFIQUES

### 5.1 — Les 3 cartes Digital
Les choroplèthes sur fond dark ont des couleurs calibrées pour le dark.
En light mode, les couleurs de la palette divergente (rouge-bleu) restent
les mêmes — elles sont data-driven, pas UI.
MAIS : les labels, légendes, et titres au-dessus des cartes doivent utiliser
les CSS variables pour s'adapter.

### 5.2 — Le railroad stepper
Les noeuds, tracks, et popovers utilisent des couleurs du design system.
Si Sprint 2 les a codés avec les CSS variables, ça s'adapte automatiquement.
Sinon, migrer.

### 5.3 — Toasts, modales, drawers
Vérifier que tous les overlays (drawer analyse, toasts) utilisent les variables.

### 5.4 — Le login
La page login doit aussi répondre au thème.

Commit : `feat(theme): composants spécifiques — digital, railroad, login`

## PHASE 6 : TEST VISUEL COMPLET

Basculer entre dark et light et vérifier CHAQUE écran :

Checklist dark mode :
- [ ] Sidebar : fond dark, texte lisible
- [ ] Panel Expert : fond dark, tous les layers lisibles
- [ ] Carte : fond dark (CartoDB Dark Matter)
- [ ] 3 cartes Digital : choroplèthes lisibles sur fond dark
- [ ] Railroad stepper : noeuds et tracks visibles
- [ ] Drawer analyse : fond dark, heatmap lisible
- [ ] Header : fond dark, toggle visible
- [ ] Login : fond dark

Checklist light mode :
- [ ] Sidebar : fond clair, texte lisible
- [ ] Panel Expert : fond clair, tous les layers lisibles
- [ ] Carte : fond clair (Positron)
- [ ] 3 cartes Digital : choroplèthes lisibles sur fond clair
- [ ] Railroad stepper : noeuds et tracks visibles
- [ ] Drawer analyse : fond clair, heatmap lisible
- [ ] Header : fond clair, toggle visible
- [ ] Login : fond clair

## VÉRIFICATION FINALE

1. `npm run build` — 0 erreurs
2. Le toggle dark/light fonctionne sur TOUTES les pages
3. AUCUNE couleur hardcodée restante (sauf exceptions documentées)
4. La carte MapLibre change de style avec le thème
5. La préférence persiste en localStorage
6. Le système respecte prefers-color-scheme au premier chargement

## POST-LIVRAISON — CLEANUP OBLIGATOIRE
Après le dernier commit de code fonctionnel :
1. Lance `@cleanup-magelian` Partie 2 (lint + types) sur les fichiers modifiés
2. Lance `@cleanup-magelian` Partie 3 (sécurité) sur les fichiers modifiés
3. Rapport : failles sécu + `any` introduits + catch non typés + imports inutilisés
4. Corrige TOUT avant de considérer la tâche terminée
5. Commit : `chore(cleanup): lint + types + sécurité post-sprint-4`
6. Utilise `requesting-code-review` pour générer le résumé des changements
7. Utilise `timeline-report` pour le rapport chronologique

## INTERDIT
- Ne PAS changer les couleurs des palettes de données (choroplèthes, heatmap)
- Ne PAS modifier la logique métier
- Ne PAS modifier /api/isochrone-battle/route.ts ni les fonctions battle_*

Commit final : `feat(sprint-4): thème light/dark complet — panel + carte + sidebar + digital`
Tag : `git tag sprint-4-theme-$(date +%Y%m%d)`
