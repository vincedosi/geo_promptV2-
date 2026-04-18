# SPRINT 2 — DIGITAL INTÉGRÉ
# La page /digital migre dans le layer manager comme un layer carte
# Activer le layer = split 3 cartes avec toggle
# Pré-requis : Sprint 1 terminé et mergé

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
git add -A && git commit -m "checkpoint: avant sprint 2 digital intégré"
git checkout -b sprint/2-digital-integration
```

## PHASE 1 : RECONNAISSANCE

```bash
# La page Digital actuelle
find app/digital/ -name "*.tsx" -o -name "*.ts"
# Les composants Digital
grep -rn "digital\|Digital\|benchmark\|choropleth" --include="*.tsx" components/
# Le railroad stepper existant
grep -rn "railroad\|Railroad\|stepper\|Stepper\|pipeline\|Pipeline" --include="*.tsx" components/
# La sidebar — entrée Digital
grep -rn "Digital" --include="*.tsx" components/sidebar/ components/nav/
# Les 3 cartes MapLibre
grep -rn "MapLibre\|maplibre\|mapRef\|Map " --include="*.tsx" app/digital/ components/digital/
```

Fais un make-plan. Points critiques à identifier :
- Comment les 3 cartes sont rendues (3 instances MapLibre ? 1 seule ?)
- Comment la choroplèthe est appliquée (GeoJSON ? MVT ? source data ?)
- Le state management (campagne sélectionnée, cible, vue géo, focus)
- Les KPI cards — d'où viennent les données

## PHASE 2 : LAYER "CAMPAGNE DIGITALE" DANS LE PANEL

Le LayerSwitch "Campagne digitale" dans la catégorie CAMPAGNES MÉDIA.

### État 1 : Switch OFF (par défaut)
Layer affiché en ligne compacte, 40px. Rien sur la carte.

### État 2 : Switch ON, aucune campagne sélectionnée
L'accordéon s'ouvre et affiche la page d'accueil inline :
- Titre : "Sélectionnez une campagne" (Inter 400, 13px, #b0b0b0)
- Cards campagne empilées :
  - Nom + badge teal impressions + nombre régies + nombre CP
  - Hover : border teal 30%, background #111
  - Source : DISTINCT sur dsp_campaigns (JAMAIS hardcodé)

### État 3 : Switch ON, campagne sélectionnée
L'accordéon affiche :
1. Bouton "← Changer de campagne" (lien discret, pas un bouton CTA)
2. Le railroad stepper compact (5 noeuds en ligne)
3. Les KPI cards (4 max, en grille 2×2 dans le panel 260px)

La carte passe en mode split 3 (ou fusionné selon le toggle).

### Valeurs par défaut du railroad :
- Campagne : celle cliquée
- Cible : première disponible (DISTINCT)
- Vue géo : RÉGIONS
- Régies : Toutes
- Focus : RATIO

## PHASE 3 : TOGGLE VUE COMPARÉE / VUE FUSIONNÉE

Créer un toggle qui apparaît AU-DESSUS de la carte (pas dans le panel)
quand le layer Digital est actif.

```
┌────────────────────────────────────────┐
│  [Vue comparée ●] [Vue fusionnée ○]    │  ← Toggle au-dessus de la carte
├────────────────────────────────────────┤
│  Ratio    │  Impressions  │  Population │  ← 3 cartes
│           │               │             │
```

### Vue comparée (par défaut, ON)
- La carte se split en 3 colonnes égales
- Carte gauche : Ratio (choroplèthe divergente rouge-bleu)
- Carte centre : Impressions (choroplèthe séquentielle)
- Carte droite : Population cible (choroplèthe séquentielle)
- Les 3 cartes sont synchronisées (zoom, pan)
- Titre au-dessus de chaque carte : lisible, pas technique
  - "Ratio pression / cible" (pas "Ratio imp. / 15-29 ans")
  - "Impressions" 
  - "Population 15-29 ans"

### Vue fusionnée
- Retour à 1 seule carte plein écran
- La choroplèthe active (selon le Focus sélectionné) s'affiche
- Les autres layers peuvent se superposer (panneaux, POI, TMJA...)
- C'est LE mode qui permet le croisement multi-layers

### Transition
- Fade 200ms entre les deux modes
- La carte ne se recharge pas, juste le layout change

## PHASE 4 : ANALYSE DÉTAILLÉE — DRAWER BAS

Le contenu analytique de l'ancien module Digital (heatmap régies×géo,
tables sur/sous-servis, recommandation bidding) migre dans un drawer bas.

### Bouton déclencheur
Dans le panel, sous les KPI du layer Digital :
"Ouvrir l'analyse détaillée →" (style lien teal, pas bouton)

### Le drawer
- Slide depuis le bas de l'écran
- Hauteur : 50% de la viewport (resizable par drag)
- Background : #0a0a0a, border-top 1px #262626
- Contenu : la heatmap, les tables, la reco bidding
- Bouton fermer : × en haut à droite
- La carte reste visible au-dessus (compressée)

### Si pas de campagne sélectionnée
Le bouton "Ouvrir l'analyse détaillée" n'apparaît pas.

Commit : `feat(digital): drawer analyse détaillée — heatmap, tables, bidding`

## PHASE 5 : MIGRATION DES COMPOSANTS

### 5.1 — Identifier et déplacer
Chaque composant de app/digital/ doit être :
1. Rendu autonome (pas dépendant du layout page)
2. Déplacé dans components/digital/ si pas déjà fait
3. Importable depuis le LayerSwitch et le drawer

### 5.2 — Les 3 cartes choroplèthes
Si les 3 cartes sont actuellement dans la page Digital :
- Les extraire dans un composant `components/digital/TripleMapView.tsx`
- Ce composant est rendu dans la zone carte principale (pas dans le panel)
- Il reçoit les props : campagne, cible, vueGeo, régies, focus
- Il est conditionné par : layer Digital actif + vue comparée

### 5.3 — La sidebar
L'entrée "Digital" dans la sidebar devient un raccourci :
- Clic = ouvre /map + active le layer Campagne digitale
- Pas une page séparée, juste un shortcut
- router.push('/map') + setState layer digital = on

## PHASE 6 : NETTOYAGE

### Supprimer la page Digital
```bash
# La page et sa route
ls app/digital/
```
Supprimer le dossier app/digital/ et sa route.
Rediriger /digital vers /map avec le layer Digital pré-activé.

### Vérifier les liens cassés
```bash
grep -rn "/digital\|href.*digital\|push.*digital\|Link.*digital" --include="*.tsx" --include="*.ts"
```
Chaque lien vers /digital → rediriger vers /map avec activation du layer.

Commit : `feat(digital): supprimer page /digital — tout migré dans layer carte`

## VÉRIFICATION FINALE

Utilise verification-before-completion :
1. `npm run build` — 0 erreurs
2. La page /digital n'existe plus (404 ou redirect)
3. Le layer "Campagne digitale" dans le panel Expert fonctionne
4. Les 3 cartes s'affichent quand le layer est actif + vue comparée
5. Le toggle vue comparée / vue fusionnée marche
6. Le railroad stepper dans l'accordéon fonctionne
7. Les valeurs par défaut sont Régions + Ratio
8. Le drawer analyse s'ouvre/ferme correctement
9. La sidebar "Digital" active le layer au lieu de naviguer
10. Les autres layers (panneaux, POI...) ne sont pas cassés

## POST-LIVRAISON — CLEANUP OBLIGATOIRE
Après le dernier commit de code fonctionnel :
1. Lance `@cleanup-geomatik` Partie 2 (lint + types) sur les fichiers modifiés
2. Lance `@cleanup-geomatik` Partie 3 (sécurité) sur les fichiers modifiés
3. Rapport : failles sécu + `any` introduits + catch non typés + imports inutilisés
4. Corrige TOUT avant de considérer la tâche terminée
5. Commit : `chore(cleanup): lint + types + sécurité post-sprint-2`
6. Utilise `requesting-code-review` pour générer le résumé des changements
7. Utilise `timeline-report` pour le rapport chronologique

## INTERDIT
- Ne PAS casser les autres layers du layer manager
- Ne PAS modifier la logique de calcul des choroplèthes
- Ne PAS modifier /api/isochrone-battle/route.ts ni les fonctions battle_*
- Ne PAS supprimer les composants Digital avant d'avoir vérifié qu'ils marchent dans leur nouveau container

Commit final : `feat(sprint-2): digital intégré — layer carte + 3 cartes + drawer analyse`
Tag : `git tag sprint-2-digital-$(date +%Y%m%d)`
