# SPRINT 3 — ACCORDÉONS POI & SUPPRESSION ORANGE
# Refonte des 5 sections données terrain en accordéons design system
# Pré-requis : Sprint 1 terminé (les layers sont déjà dans le layer manager)

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
git add -A && git commit -m "checkpoint: avant sprint 3 accordéons POI"
git checkout -b sprint/3-accordeons-poi
```

## CONTEXTE
Après Sprint 1, les 5 sections données terrain sont dans le layer manager
mais leur CONTENU interne n'a pas été refactorisé. Chaque section a encore
un style incohérent (boutons oranges, layouts variés). Ce sprint uniformise
le contenu de chaque LayerSwitch.

## PHASE 1 : AUDIT DU CONTENU ACTUEL

```bash
# Contenu de chaque section dans le layer manager
grep -rn "Panneaux OOH\|Points d'intérêt\|transport en commun\|TMJA\|Radio FM" --include="*.tsx" components/
# Boutons orange
grep -rn "orange\|#f97316\|#ea580c\|#fb923c\|bg-orange\|text-orange\|border-orange" --include="*.tsx" --include="*.ts" --include="*.css"
```

## PHASE 2 : REFACTORISER CHAQUE LAYER

Pour chaque layer, le contenu de l'accordéon suit le même pattern :

```
┌─────────────────────────────┐
│ [Filtres / options]         │  ← Contrôles spécifiques au layer
│                             │
│ [Info contextuelle]         │  ← Badge, compteur, source
│                             │
│ Bouton CTA teal             │  ← Style uniforme
└─────────────────────────────┘
```

### 2.1 — Panneaux OOH et DOOH
- Compteur : "{count} panneaux · {réseaux}" — badge dans le LayerSwitch
- Filtre régie : select shadcn, label "Filtrer par régie" visible au-dessus
- Toggle "Tout" : bouton outline neutre (pas orange)
- Bouton CTA : "Afficher les panneaux" style teal
- Source : texte discret #8a8a8a en bas

### 2.2 — Points d'intérêt
- Compteur : "{count} types" — badge dans le LayerSwitch
- Select type POI : shadcn Select, label visible
- Icône refresh (⟳) : garder, styler en #8a8a8a hover #f0f0f0
- Bouton CTA : "Afficher les POI" style teal

### 2.3 — Arrêts de transport
- Toggle group Bus/Train/Tramway/Métro :
  Style DESIGN_SYSTEM toggle group (pas des boutons outline gris) :
  - Container : background #0a0a0a, border 0.5px #1a1a1a, radius 8px
  - Actif : background #181818, color #f0f0f0, border-bottom 2px #4ecdc4
  - Inactif : color #666, hover #b0b0b0
- Info : "Chargé pour la zone visible" — texte #8a8a8a
- Bouton CTA : "Afficher les arrêts" style teal

### 2.4 — Flux routier TMJA
- Icône info (ⓘ) : garder si fonctionnelle
- Légende trafic : DÉPLACER sur la carte (overlay bas-gauche)
  La légende n'apparaît QUE quand le layer TMJA est actif
  Ne plus l'afficher dans le panel (gaspillage d'espace)
- Source : "CEREMA — tronçons zone visible" — texte #8a8a8a
- Bouton CTA : "Afficher le trafic" style teal

### 2.5 — Radio FM/DAB+
- Source : "ANFR data.gouv.fr" — texte #8a8a8a
- Bouton CTA : "Afficher les émetteurs" style teal
- Icône radio : garder

## PHASE 3 : STYLE UNIFORME DES BOUTONS CTA

Tous les boutons "Afficher ..." :
```css
background: transparent;
border: 0.5px solid #4ecdc4;
color: #4ecdc4;
border-radius: 6px;
padding: 8px 16px;
font: Inter 500, 12px;
width: 100%;
text-align: center;
cursor: pointer;
transition: background 0.15s;
```
Hover : `background: rgba(78,205,196,0.1)`

Quand le layer est actif (switch ON), le bouton change :
```css
background: rgba(78,205,196,0.1);
border-color: #4ecdc4;
color: #4ecdc4;
```
Et le label change : "Masquer les panneaux" / "Masquer les arrêts" etc.

## PHASE 4 : LÉGENDE TMJA SUR LA CARTE

Créer un composant `components/map/MapLegend.tsx` :
- Position : absolute, bottom 40px, left 16px (par-dessus la carte)
- Background : rgba(10,10,10,0.85), backdrop-filter blur 4px (exception au no-blur)
- Border : 0.5px solid #262626, border-radius 8px
- Padding : 10px 14px
- Contenu : les 4 niveaux de trafic avec leurs couleurs
- Visible seulement quand le layer TMJA est actif
- Bouton × pour dismiss temporairement

## PHASE 5 : ÉLIMINATION TOTALE DE L'ORANGE

```bash
# Scan exhaustif
grep -rn "orange\|#f97316\|#ea580c\|#fb923c\|#f59e0b\|bg-orange\|text-orange\|border-orange" \
  --include="*.tsx" --include="*.ts" --include="*.css" --include="*.module.css" \
  components/ app/ styles/
```

Chaque occurrence trouvée → remplacer par le token teal ou neutre approprié.
Objectif : 0 résultat orange dans le codebase (hors node_modules).

Commit : `fix(colors): suppression totale orange — 0 occurrences`

## VÉRIFICATION FINALE

1. `npm run build` — 0 erreurs
2. Tous les layers ont le même style d'accordéon
3. Tous les boutons CTA sont teal, AUCUN orange
4. La légende TMJA s'affiche sur la carte, pas dans le panel
5. Les toggle groups transport suivent le design system
6. Chaque layer a un badge contextuel dans le LayerSwitch
7. Les fonctionnalités sont identiques (fetch, affichage carte, filtres)

## POST-LIVRAISON — CLEANUP OBLIGATOIRE
Après le dernier commit de code fonctionnel :
1. Lance `@cleanup-magelian` Partie 2 (lint + types) sur les fichiers modifiés
2. Lance `@cleanup-magelian` Partie 3 (sécurité) sur les fichiers modifiés
3. Rapport : failles sécu + `any` introduits + catch non typés + imports inutilisés
4. Corrige TOUT avant de considérer la tâche terminée
5. Commit : `chore(cleanup): lint + types + sécurité post-sprint-3`
6. Utilise `requesting-code-review` pour générer le résumé des changements
7. Utilise `timeline-report` pour le rapport chronologique

## INTERDIT
- Ne PAS modifier la logique de fetch/affichage des layers
- Ne PAS modifier /api/isochrone-battle/route.ts ni les fonctions battle_*
- Ne PAS hardcoder les types de POI, régies, ou types de transport

Commit final : `feat(sprint-3): accordéons POI uniformes + légende carte + zéro orange`
Tag : `git tag sprint-3-accordeons-$(date +%Y%m%d)`
