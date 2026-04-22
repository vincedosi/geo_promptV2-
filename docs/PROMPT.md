# FIX — Résultats analyses : revenir au volet gauche

## SKILLS OBLIGATOIRES
@verification-before-completion @executing-plans @systematic-debugging @smart-explore @finishing-a-development-branch @writing-plans @brainstorming @dispatching-parallel-agents @receiving-code-review @requesting-code-review @subagent-driven-development @test-driven-development @using-git-worktrees @using-superpowers @writing-skills @do @make-plan @mem-search @timeline-report @frontend-design

## LECTURE PRÉALABLE
1. DESIGN_SYSTEM.md
2. .claude/skills/geomatik-ux/SKILL.md
3. .claude/skills/geomatik-product-vision/SKILL.md
4. .claude/skills/cleanup-geomatik/SKILL.md

## POINT DE SAUVEGARDE
```bash
git add -A && git commit -m "checkpoint: avant fix résultats analyses volet gauche"
git checkout -b fix/analyses-results-panel
```

## CONTEXTE — LE PROBLÈME

Avant la refonte, les résultats des analyses (Clustering, Couverture, 
Scoring, Corrélation, etc.) s'affichaient dans un VOLET À GAUCHE 
dédié — un panel de résultats qui prenait la place du FilterPanel 
quand une analyse était lancée.

Maintenant, avec le système d'overlays, ces résultats sont coincés 
dans les overlays de 280px. C'est une régression :
- Les résultats d'analyse sont riches (tableaux, charts, listes)
- Un overlay de 280px est trop étroit pour ça
- Le workflow était : lancer l'analyse depuis le panel → les résultats 
  REMPLACENT le panel → la carte montre la visualisation

## OBJECTIF — SÉPARER CONTRÔLES vs RÉSULTATS

Les overlays servent à CONFIGURER et LANCER les analyses.
Les RÉSULTATS s'affichent dans un volet gauche dédié (comme avant).

### Overlay Analyses = contrôles uniquement
- Boutons pour lancer Scoring, Clustering, Couverture, Corrélation
- Paramètres de configuration (s'il y en a)
- PAS de résultats

### Volet résultats = panel gauche quand une analyse est terminée
- Quand une analyse est calculée, un panel de résultats slide depuis la gauche
- Ce panel est à côté de la barre d'icônes (left: 48px)
- Il affiche les résultats complets (tableaux, charts, stats)
- Largeur : 360-400px (plus large qu'un overlay, adapté aux tableaux)
- Bouton "× Fermer" ou "← Retour carte" pour le masquer
- La carte se compresse pour faire de la place (comme l'ancien FilterPanel)

## PHASE 1 : DIAGNOSTIC

```bash
# Comment les résultats étaient affichés AVANT la refonte
# Chercher les composants de résultats
grep -rn "ClusterResult\|ClusterPanel\|CoverageResult\|CoveragePanel\|ScoringResult\|ScoringPanel\|CorrelationResult" \
  --include="*.tsx" components/ app/map/

# Chercher l'ancien mécanisme de "remplacement" du panel
grep -rn "activeView\|activePanel\|showResults\|resultsPanel\|studyMode" \
  --include="*.tsx" app/map/page.tsx app/map/_components/

# Le state qui pilotait l'affichage des résultats
grep -rn "isCluster\|isCoverage\|isScoring\|isCorrelation\|showCluster\|showCoverage" \
  --include="*.tsx" app/map/page.tsx
```

Utilise smart-explore pour comprendre l'ancien mécanisme.
Fais un make-plan avant de coder.

## PHASE 2 : CRÉER LE COMPOSANT ResultsPanel

Créer `components/map/ResultsPanel.tsx`

C'est un panel fixe (pas un overlay flottant) qui affiche les résultats.

```typescript
interface ResultsPanelProps {
  title: string;           // "Résultats clustering", "Couverture", etc.
  onClose: () => void;     // Fermer le panel
  children: React.ReactNode; // Le contenu des résultats
}
```

### Style :
```css
.results-panel {
  position: fixed;
  left: 48px;                    /* après la barre d'icônes */
  top: var(--header-height);     /* sous le header */
  width: 380px;
  height: calc(100vh - var(--header-height));
  background: var(--card);       /* opaque, PAS transparent */
  border-right: 0.5px solid var(--border-default);
  z-index: 35;                   /* entre IconBar (30) et Overlay (40) */
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.results-panel-header {
  padding: 16px;
  border-bottom: 0.5px solid var(--border-subtle);
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.results-panel-header .title {
  font: Inter 500 14px;
  color: var(--text-primary);
  flex: 1;
}

.results-panel-header .close-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: all 0.15s;
}

.results-panel-header .close-btn:hover {
  background: var(--elevated);
  color: var(--text-primary);
}

.results-panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}
```

### Animation d'entrée :
```css
/* Slide depuis la gauche */
transform: translateX(-100%);
transition: transform 200ms ease;

/* Ouvert */
transform: translateX(0);
```

### Comportement avec la carte :
Quand le ResultsPanel est ouvert, la carte se décale :
```css
.map-container {
  margin-left: 48px;  /* normal : juste l'icon bar */
}

.map-container.results-open {
  margin-left: calc(48px + 380px);  /* icon bar + results panel */
  transition: margin-left 200ms ease;
}
```

## PHASE 3 : CÂBLER LES RÉSULTATS D'ANALYSES

### State dans page.tsx :
```typescript
const [activeResults, setActiveResults] = useState<{
  type: 'clustering' | 'coverage' | 'scoring' | 'correlation' | null;
  data: any;  // les résultats de l'analyse
} | null>(null);
```

### Quand une analyse termine :
1. Les résultats arrivent (callback existant)
2. `setActiveResults({ type: 'clustering', data: results })`
3. Le ResultsPanel s'affiche avec le bon contenu
4. L'overlay Analyses se FERME automatiquement (les contrôles ne sont plus nécessaires)

### Quand l'utilisateur ferme les résultats :
1. `setActiveResults(null)`
2. Le ResultsPanel se ferme
3. La carte reprend sa taille plein écran

### Mapping résultats → composants :
Chaque type d'analyse a son composant de résultats (qui existait AVANT) :

```tsx
function ResultsContent({ type, data }) {
  switch (type) {
    case 'clustering':
      return <ClusteringResults data={data} />;
    case 'coverage':
      return <CoverageResults data={data} />;
    case 'scoring':
      return <ScoringResults data={data} />;
    case 'correlation':
      return <CorrelationResults data={data} />;
    default:
      return null;
  }
}
```

Retrouver les composants de résultats existants :
```bash
grep -rn "Cluster\|Coverage\|Scoring\|Correlation" --include="*.tsx" \
  app/map/_components/ components/map/ | grep -i "result\|panel\|detail"
```

## PHASE 4 : MODIFIER L'OVERLAY ANALYSES

L'overlay Analyses ne contient plus les résultats. Il contient :
- Les boutons pour LANCER chaque analyse
- Les paramètres de configuration (si applicable)
- Un indicateur quand une analyse est en cours (loading)
- Un lien "Voir les résultats →" si des résultats existent déjà

Quand une analyse est lancée depuis l'overlay :
1. L'overlay affiche un loading
2. L'analyse se calcule
3. Quand terminé : l'overlay se ferme, le ResultsPanel s'ouvre

Si l'utilisateur a déjà des résultats et rouvre l'overlay :
- Afficher un badge "Résultats disponibles" sur chaque analyse calculée
- Bouton "Voir les résultats →" qui ferme l'overlay et ouvre le ResultsPanel

## PHASE 5 : COHÉRENCE AVEC L'ÉTUDE DE VILLE

Le StudyDashboard (étude de ville après scoring) fonctionne déjà en plein écran
(feat livré dans icon-bar-overlay, CTA dans overlay Analyses).

Le ResultsPanel est pour les résultats INTERMÉDIAIRES (clustering, couverture).
L'étude de ville est le résultat FINAL après scoring.

Hiérarchie :
1. Overlay Analyses → lancer les analyses (contrôles)
2. ResultsPanel → résultats intermédiaires (clustering, couverture, corrélation)
3. StudyDashboard → résultat final (étude de ville après scoring)

## PHASE 6 : VÉRIFICATION

1. `npm run build` — 0 erreurs nouvelles
2. Overlay Analyses : contient UNIQUEMENT les boutons de lancement, PAS de résultats
3. Lancer Clustering → overlay se ferme → ResultsPanel s'ouvre avec les résultats
4. Lancer Couverture → idem
5. Lancer Scoring → résultats dans ResultsPanel, CTA "Étude de ville" → StudyDashboard
6. Lancer Corrélation → idem ResultsPanel
7. Fermer ResultsPanel → carte reprend plein écran
8. La carte se compresse proprement quand le ResultsPanel est ouvert
9. Rouvrir overlay Analyses → badge "Résultats disponibles" visible
10. Tout fonctionne en dark ET light mode

## POST-LIVRAISON — CLEANUP OBLIGATOIRE
1. Lance `@cleanup-geomatik` Partie 2 (lint + types) sur les fichiers modifiés
2. Lance `@cleanup-geomatik` Partie 3 (sécurité) sur les fichiers modifiés
3. Rapport : failles sécu + `any` introduits + catch non typés + imports inutilisés
4. Corrige TOUT avant de considérer la tâche terminée
5. Commit : `chore(cleanup): lint + types + sécurité post-fix résultats`
6. Utilise `requesting-code-review` pour le résumé
7. Utilise `timeline-report` pour le rapport

## INTERDIT
- Ne PAS modifier les overlays (sauf l'overlay Analyses pour retirer les résultats)
- Ne PAS modifier la logique de calcul des analyses
- Ne PAS modifier /api/isochrone-battle/route.ts ni les fonctions battle_*
- Ne PAS réécrire les composants de résultats — les RÉUTILISER tels quels

Commit final : `fix(analyses): résultats dans volet gauche — overlays = contrôles uniquement`
Tag : `git tag fix-results-panel-$(date +%Y%m%d)`