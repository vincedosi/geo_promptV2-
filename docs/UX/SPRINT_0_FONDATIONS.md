# SPRINT 0 — FONDATIONS
# Composants de base, toggle thème, contraste, briques réutilisables
# Aucune page ne change visuellement. On prépare les briques.

## SKILLS OBLIGATOIRES
@verification-before-completion @executing-plans @systematic-debugging @smart-explore @finishing-a-development-branch @writing-plans @brainstorming @dispatching-parallel-agents @receiving-code-review @requesting-code-review @subagent-driven-development @test-driven-development @using-git-worktrees @using-superpowers @writing-skills @do @make-plan @mem-search @timeline-report @frontend-design

## LECTURE PRÉALABLE — OBLIGATOIRE AVANT TOUTE LIGNE DE CODE
Lis ces fichiers dans l'ordre :
1. DESIGN_SYSTEM.md — tokens visuels, composants, règles d'or
2. .claude/skills/geomatik-product-vision/SKILL.md — architecture UX cible
3. .claude/skills/geomatik-ux/SKILL.md — règles UX (états, contraste, feedback)
4. .claude/skills/frontend-design/SKILL.md — design visuel et esthétique
5. .claude/skills/geomatik-metier/SKILL.md — vocabulaire métier OOH/IRIS
6. .claude/skills/cleanup-geomatik/SKILL.md — règles de cleanup post-dev

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
git add -A && git commit -m "checkpoint: avant sprint 0 fondations"
git checkout -b sprint/0-fondations
```

## PHASE 1 : CONTRASTE GLOBAL

### 1.1 — Variables CSS
Dans le fichier CSS global (globals.css ou equivalent) :
- --text-secondary : #a0a0a0 → #b0b0b0
- --text-tertiary : #666666 → #8a8a8a

### 1.2 — Audit couleurs hardcodées
```bash
grep -rn "#666" --include="*.tsx" --include="*.ts" --include="*.css" --include="*.module.css"
grep -rn "#a0a0a0" --include="*.tsx" --include="*.ts" --include="*.css"
grep -rn "text-gray-500\|text-neutral-500\|text-zinc-500" --include="*.tsx" --include="*.ts"
```
Chaque occurrence : remplacer par le token CSS variable correspondant.

Commit : `fix(tokens): contraste WCAG AA — text-secondary #b0b0b0, text-tertiary #8a8a8a`

## PHASE 2 : COMPOSANT CategoryGroup

Créer `components/ui/CategoryGroup.tsx` :

```typescript
interface CategoryGroupProps {
  title: string;             // "DONNÉES TERRAIN"
  defaultOpen?: boolean;     // true par défaut
  children: React.ReactNode;
}
```

Style du header catégorie :
```
- background: #111111
- border-top: 1px solid #1a1a1a
- padding: 10px 14px
- display: flex, align-items: center, gap: 8px
- Dot teal : 6px × 6px, border-radius 50%, background #4ecdc4
- Label : Inter 500, 11px, #8a8a8a, uppercase, letter-spacing 0.06em
- Chevron : lucide ChevronDown, 14px, #666, ml-auto
- Rotation chevron : transition transform 200ms
```

Corps :
```
- padding: 0 (les enfants gèrent leur propre padding)
- Collapse/expand avec transition height 200ms ease
- overflow hidden pendant l'animation
```

L'état ouvert/fermé persiste en localStorage (clé : `geomatik-cat-${title}`).

Commit : `feat(ui): composant CategoryGroup — header bandeau + collapse`

## PHASE 3 : COMPOSANT LayerSwitch

Créer `components/ui/LayerSwitch.tsx` :

```typescript
interface LayerSwitchProps {
  name: string;              // "Panneaux OOH"
  icon?: React.ReactNode;    // Icône lucide
  badge?: string;            // "1 434" ou "ANFR"
  active: boolean;           // Switch on/off
  onToggle: () => void;
  expanded?: boolean;        // Accordéon ouvert/fermé
  onExpand?: () => void;
  children?: React.ReactNode; // Contenu de l'accordéon
}
```

Layout de la ligne layer :
```
┌─────────────────────────────────────────┐
│ [●] Panneaux OOH        [1434]   [⊙]  │  ← 40px height
│                                         │
│   (accordéon réglages si expanded)      │  ← height variable
│   Filtre régie : [Toutes ▾]            │
│   [Afficher sur la carte]              │
│                                         │
└─────────────────────────────────────────┘
```

Styles :
```
Ligne compacte (40px) :
- padding: 8px 14px
- display: flex, align-items: center, gap: 8px
- Dot : 6px cercle, couleur dépend du layer (teal par défaut)
- Nom : Inter 400, 13px, #b0b0b0 (inactif) ou #f0f0f0 (actif)
- Nom cliquable : cursor pointer, hover #f0f0f0
- Badge : même style que DESIGN_SYSTEM badges
- Switch : 32px × 18px, track #1a1a1a, thumb 14px #666
  Actif : track #4ecdc4, thumb #f0f0f0

Accordéon réglages :
- padding: 8px 14px 12px 28px (indenté sous le dot)
- border-bottom: 0.5px solid #1a1a1a
- Transition: height 200ms ease, overflow hidden
```

Important : le switch toggle le layer SANS ouvrir l'accordéon.
Clic sur le nom du layer ouvre/ferme l'accordéon.

Commit : `feat(ui): composant LayerSwitch — toggle + accordéon réglages`

## PHASE 4 : TOGGLE THÈME (préparation)

### 4.1 — Restructurer les CSS variables

Dans globals.css, encapsuler toutes les couleurs dans des sélecteurs thème :

```css
[data-theme="dark"] {
  --background: #050505;
  --card: #0a0a0a;
  --elevated: #111111;
  --overlay: #181818;
  --border-subtle: #1a1a1a;
  --border-default: #262626;
  --border-hover: #333333;
  --text-primary: #f0f0f0;
  --text-secondary: #b0b0b0;
  --text-tertiary: #8a8a8a;
  --brand-teal: #4ecdc4;
  --brand-teal-hover: #3dbdb5;
  --success: #3dffa0;
  --danger: #ff5757;
  --warning: #f7b731;
}

[data-theme="light"] {
  --background: #ffffff;
  --card: #f8f8f8;
  --elevated: #f0f0f0;
  --overlay: #e8e8e8;
  --border-subtle: #e5e5e5;
  --border-default: #d4d4d4;
  --border-hover: #a3a3a3;
  --text-primary: #0a0a0a;
  --text-secondary: #525252;
  --text-tertiary: #737373;
  --brand-teal: #0d9488;
  --brand-teal-hover: #0f766e;
  --success: #16a34a;
  --danger: #dc2626;
  --warning: #d97706;
}
```

### 4.2 — ThemeProvider

Créer `components/providers/ThemeProvider.tsx` :
- Lit localStorage("geomatik-theme") au mount
- Fallback sur prefers-color-scheme du système
- Applique data-theme sur <html>
- Expose un hook useTheme() → { theme, toggleTheme }

### 4.3 — Toggle bouton

Créer `components/ui/ThemeToggle.tsx` :
- Icône Sun/Moon de lucide-react
- Position : dans le header, avant le sélecteur user
- Transition 200ms sur l'icône (rotation + fade)
- Ne PAS encore changer le style de la carte MapLibre (c'est Sprint 4)

Commit : `feat(theme): toggle light/dark — CSS variables + ThemeProvider + bouton header`

## PHASE 5 : NETTOYAGE

### 5.1 — Masquer debug en production
Trouver le footer "Online 18:06:49" :
```bash
grep -rn "Online\|18:06\|online-status\|connection-status" --include="*.tsx" --include="*.ts"
```
Wrapper dans : `{process.env.NODE_ENV === 'development' && (...)}`

### 5.2 — Supprimer logo dupliqué header
Le logo GEOMATIK dans le header top-right est un doublon de la sidebar.
Le supprimer. Garder : sélecteur org + theme toggle + user info.

Commit : `fix(layout): masquer debug prod, supprimer logo dupliqué header`

## VÉRIFICATION FINALE

Utilise verification-before-completion :
1. `npm run build` — 0 erreurs
2. `npm run lint` — 0 warnings non résolus
3. Les composants CategoryGroup et LayerSwitch sont créés et exportés
4. Le toggle thème fonctionne (dark ↔ light)
5. Le contraste est corrigé partout (grep #666 = 0 dans les composants)
6. Le footer debug est masqué en prod
7. Le logo dupliqué est supprimé

## POST-LIVRAISON — CLEANUP OBLIGATOIRE
Après le dernier commit de code fonctionnel :
1. Lance `@cleanup-geomatik` Partie 2 (lint + types) sur les fichiers modifiés
2. Lance `@cleanup-geomatik` Partie 3 (sécurité) sur les fichiers modifiés
3. Rapport : failles sécu + `any` introduits + catch non typés + imports inutilisés
4. Corrige TOUT avant de considérer la tâche terminée
5. Commit : `chore(cleanup): lint + types + sécurité post-sprint-0`
6. Utilise `requesting-code-review` pour générer le résumé des changements
7. Utilise `timeline-report` pour le rapport chronologique

## INTERDIT
- Ne PAS modifier les pages existantes (ça c'est Sprint 1+)
- Ne PAS modifier la logique métier
- Ne PAS modifier /api/isochrone-battle/route.ts ni les fonctions battle_*

Commit final : `feat(sprint-0): fondations UX — composants + thème + contraste`
Tag : `git tag sprint-0-fondations-$(date +%Y%m%d)`
