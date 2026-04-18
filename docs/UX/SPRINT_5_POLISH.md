# SPRINT 5 — POLISH
# Loading states, transitions, légendes carte, finitions UX
# Pré-requis : Sprints 0-4 terminés et mergés

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
git add -A && git commit -m "checkpoint: avant sprint 5 polish"
git checkout -b sprint/5-polish
```

## PHASE 1 : LOADING STATES

### 1.1 — Skeleton pour chaque layer
Quand un layer se charge (fetch en cours), son accordéon affiche un skeleton :
- Rectangles gris (#111) avec animation pulse
- Forme du skeleton = forme du contenu final
- Durée : visible pendant le fetch, remplacé par le contenu réel

Layers concernés :
- Panneaux OOH : skeleton = 3 lignes texte + 1 bouton
- POI : skeleton = select + bouton
- Transport : skeleton = toggle group + bouton
- TMJA : skeleton = bouton
- Radio : skeleton = bouton
- IRIS : skeleton = select + infos
- Campagne digitale : skeleton = railroad stepper + KPI cards

### 1.2 — Progress bar pour opérations longues
Les opérations > 3 secondes ont une barre de progression :
- Isochrone battle : barre + message "Calcul des isochrones... X/Y"
- Scoring OOH : barre + message "Scoring en cours..."
- Import DSP : barre + message "Import des données..."

Style progress bar :
```
Track : height 3px, background #1a1a1a, border-radius 2px, width 100%
Fill : background #4ecdc4, border-radius 2px, transition width 200ms
```

### 1.3 — Loading sur la carte
Quand un layer charge des données pour la carte :
- Indicateur en haut de la carte : barre fine #4ecdc4 animée (indeterminate)
- Disparaît quand le chargement est terminé

Commit : `feat(loading): skeletons layers + progress bars opérations longues`

## PHASE 2 : EMPTY STATES

Chaque layer avec aucun résultat affiche un empty state :

```
┌─────────────────────────────┐
│    [icône contextuelle]     │
│                             │
│  Aucun panneau dans cette   │
│  zone. Zoomez ou changez    │
│  de périmètre.              │
│                             │
│  [Réinitialiser le filtre]  │  ← CTA si un filtre est actif
└─────────────────────────────┘
```

Style :
- Icône : lucide, 24px, #8a8a8a
- Texte : Inter 400, 13px, #8a8a8a, text-align center
- CTA : style teal outline

Messages par layer :
- Panneaux OOH : "Aucun panneau dans cette zone."
- POI : "Aucun point d'intérêt de ce type dans cette zone."
- Transport : "Aucun arrêt de transport dans cette zone."
- TMJA : "Aucune donnée trafic dans cette zone."
- Digital : "Aucune campagne disponible."
- Scoring : "Activez les panneaux et les POI pour lancer le scoring."
- Corrélation : "Activez IRIS et POI pour lancer la corrélation."

Commit : `feat(empty-states): messages contextuels + CTA pour chaque layer`

## PHASE 3 : ERROR STATES

Quand un fetch échoue :

```
┌─────────────────────────────┐
│  ⚠ Erreur de chargement    │
│                             │
│  Impossible de charger les  │
│  panneaux. Vérifiez votre   │
│  connexion.                 │
│                             │
│  [Réessayer]                │
└─────────────────────────────┘
```

Style :
- Background : rgba(255,87,87,0.05)
- Border : 0.5px solid rgba(255,87,87,0.2)
- Texte erreur : #ff5757
- Bouton réessayer : style outline neutre

Important : conserver le dernier état valide quand possible (stale-while-revalidate).

Commit : `feat(error-states): messages d'erreur + retry pour chaque layer`

## PHASE 4 : TRANSITIONS

### 4.1 — Activation de layer
Quand un switch passe on :
- Le dot de couleur du layer fait un scale(1 → 1.2 → 1) en 200ms
- L'accordéon s'ouvre avec height transition 200ms

### 4.2 — Split 3 cartes
Quand le layer Digital active la vue comparée :
- Les 3 cartes apparaissent avec un fade-in 300ms staggeré
  (gauche 0ms, centre 100ms, droite 200ms)

### 4.3 — Catégories collapse
- Height transition 200ms ease
- Chevron rotation 200ms

### 4.4 — Feedback actions
- Toast notification pour les actions réussies :
  "1 434 panneaux chargés" — 2s auto-dismiss
  Style : background #111, border 0.5px #262626, radius 8px
  Icône check teal + texte Inter 400 13px
  Position : bottom-right, au-dessus du FAB geo.prompt

Commit : `feat(transitions): animations layers, cartes, catégories, toasts`

## PHASE 5 : AMÉLIORATIONS CARTE

### 5.1 — Badge zoom
Le "z5 —" actuel → badge discret :
- Position : bottom-left, au-dessus de l'attribution
- Style : background rgba(10,10,10,0.7), border-radius 4px, padding 2px 6px
- Texte : JetBrains Mono 10px, #8a8a8a
- Contenu : "z5" (pas de tiret)

### 5.2 — Sélecteur fond de carte
Les boutons actuels (FOND, Lib, Bn, Pos, GEO) :
Remplacer par des labels lisibles avec thumbnails :
- "Standard" (Positron light / Dark Matter dark)
- "Satellite" (si disponible)
- "OSM" (OpenStreetMap)
- "Terrain" (si disponible)

Style : boutons radio compacts, 24px thumbnails miniatures du fond

### 5.3 — Indicateur synchronisation 3 cartes
Quand les 3 cartes Digital sont affichées :
- Petit badge "Vues synchronisées" entre les cartes, #8a8a8a, 11px
- Les mouvements (pan, zoom) sont synchronisés entre les 3

### 5.4 — Titres des 3 cartes
Remplacer les titres techniques par des titres compréhensibles :
- "Ratio imp. / 15-29 ans" → "Pression média vs cible"
- "Impressions" → "Distribution des impressions"
- "Population 15-29 ans" → "Population cible (15-29 ans)"

Commit : `feat(carte): badge zoom, fonds de carte, synchro, titres lisibles`

## PHASE 6 : MICRO-DÉTAILS

### 6.1 — Bouton "Sauvegarder"
Renommer clairement selon sa fonction réelle :
- Si c'est sauvegarder une config de layers → "Sauvegarder la vue"
- Si c'est autre chose → label explicite
- Déplacer en bas du panel, style outline neutre

### 6.2 — Curseurs carte
- Curseur pointer sur les éléments cliquables (panneaux, POI)
- Curseur grab pendant le pan
- Curseur crosshair en mode sélection de zone

### 6.3 — Tooltips carte
- Hover sur un panneau : tooltip avec nom + régie + type
- Hover sur un POI : tooltip avec nom + catégorie
- Style tooltip : background #0a0a0a, border #262626, radius 6px, padding 8px
- Max 3 lignes, font 12px

Commit : `feat(polish): bouton sauvegarder, curseurs, tooltips carte`

## VÉRIFICATION FINALE

Checklist complète (tous sprints cumulés) :
1. `npm run build` — 0 erreurs
2. `npm run lint` — 0 warnings
3. Panel unique avec catégories et layers — PAS de sous-tabs
4. Digital intégré comme layer — 3 cartes fonctionnelles
5. Toggle vue comparée / fusionnée — fonctionne
6. Thème dark/light — fonctionne partout
7. ZÉRO couleur orange dans le codebase
8. Contraste WCAG AA partout
9. Loading skeleton sur chaque layer
10. Empty state sur chaque layer
11. Error state avec retry sur chaque layer
12. Transitions fluides (accordéons, cartes, toasts)
13. Badge zoom discret
14. Fonds de carte avec labels lisibles
15. Titres des 3 cartes compréhensibles
16. Tooltips carte fonctionnels
17. Footer debug masqué en production
18. Logo dupliqué supprimé

## POST-LIVRAISON — CLEANUP OBLIGATOIRE
Après le dernier commit de code fonctionnel :
1. Lance `@cleanup-geomatik` Partie 2 (lint + types) sur les fichiers modifiés
2. Lance `@cleanup-geomatik` Partie 3 (sécurité) sur les fichiers modifiés
3. Rapport : failles sécu + `any` introduits + catch non typés + imports inutilisés
4. Corrige TOUT avant de considérer la tâche terminée
5. Commit : `chore(cleanup): lint + types + sécurité post-sprint-5`
6. Utilise `requesting-code-review` pour générer le résumé des changements
7. Utilise `timeline-report` pour le rapport chronologique

## INTERDIT
- Ne PAS modifier la logique métier
- Ne PAS modifier /api/isochrone-battle/route.ts ni les fonctions battle_*

Commit final : `feat(sprint-5): polish UX — loading, transitions, légendes, tooltips`
Tag : `git tag sprint-5-polish-$(date +%Y%m%d)`
Tag release : `git tag v2.0-ux-refonte-$(date +%Y%m%d)`
