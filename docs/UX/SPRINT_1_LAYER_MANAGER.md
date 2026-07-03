# SPRINT 1 — LAYER MANAGER
# Fusion Territoire/POI/Analyse → panel unique avec catégories + layers
# Pré-requis : Sprint 0 terminé et mergé

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
git add -A && git commit -m "checkpoint: avant sprint 1 layer manager"
git checkout -b sprint/1-layer-manager
```

## PHASE 1 : RECONNAISSANCE

Utilise smart-explore pour cartographier :
```bash
# Les tabs actuels Territoire/POI/Analyse
grep -rn "Territoire\|POI\|Analyse" --include="*.tsx" components/map/ components/expert/
# Le composant panel Expert
grep -rn "Expert\|expert-panel\|ExpertPanel" --include="*.tsx" components/ app/
# Les tabs/toggle Geo.Prompt / Expert
grep -rn "Geo.Prompt\|GeoPrompt\|geo-prompt\|geoPrompt" --include="*.tsx" components/ app/
# Le contenu de chaque onglet actuel
find components/ -name "*.tsx" | head -50
```

Fais un make-plan complet avant d'exécuter. Le plan doit :
- Lister tous les composants à migrer
- Mapper chaque composant vers sa catégorie cible
- Identifier les dépendances (state partagé, callbacks carte)

## PHASE 2 : CRÉER LE NOUVEAU PANEL

Créer `components/map/LayerManagerPanel.tsx`

Ce composant remplace le contenu du tab "Expert" (PAS le toggle Geo.Prompt/Expert).
Le toggle Geo.Prompt/Expert RESTE tel quel.

Structure du composant :
```tsx
export function LayerManagerPanel() {
  return (
    <div className="layer-manager">
      {/* Barre de recherche fixe */}
      <SearchFilter />
      
      {/* Catégorie CONTEXTE — toujours ouverte */}
      <CategoryGroup title="Contexte" defaultOpen={true} collapsible={false}>
        {/* Contenu de l'ancien tab Territoire */}
        {/* Périmètre France Métro / DROM */}
        {/* Régions select */}
        {/* Départements select */}
        {/* Recherche locale ville/CP */}
      </CategoryGroup>
      
      {/* Catégorie DONNÉES TERRAIN */}
      <CategoryGroup title="Données terrain" defaultOpen={true}>
        <LayerSwitch name="Panneaux OOH et DOOH" ...>
          {/* Contenu actuel de la section Panneaux dans POI */}
        </LayerSwitch>
        <LayerSwitch name="Points d'intérêt" ...>
          {/* Contenu actuel de la section POI */}
        </LayerSwitch>
        <LayerSwitch name="Arrêts de transport" ...>
          {/* Contenu actuel de la section Transport */}
        </LayerSwitch>
        <LayerSwitch name="Flux routier TMJA" ...>
          {/* Contenu actuel de la section TMJA */}
        </LayerSwitch>
        <LayerSwitch name="Radio FM/DAB+" ...>
          {/* Contenu actuel de la section Radio */}
        </LayerSwitch>
      </CategoryGroup>
      
      {/* Catégorie DONNÉES SOCIO-DÉMO */}
      <CategoryGroup title="Données socio-démo" defaultOpen={false}>
        <LayerSwitch name="IRIS" ...>
          {/* Contenu actuel de la section IRIS dans Analyse */}
        </LayerSwitch>
        <LayerSwitch name="Carreaux Filosofi" ...>
          {/* Contenu actuel de la section Carreaux dans Analyse */}
        </LayerSwitch>
      </CategoryGroup>
      
      {/* Catégorie CAMPAGNES MÉDIA */}
      <CategoryGroup title="Campagnes média" defaultOpen={false}>
        <LayerSwitch name="Campagne digitale" ...>
          {/* Placeholder — contenu migré en Sprint 2 */}
          <p>Bientôt disponible ici</p>
        </LayerSwitch>
      </CategoryGroup>
      
      {/* Catégorie ANALYSES */}
      <CategoryGroup title="Analyses" defaultOpen={false}>
        <LayerSwitch name="Analyse spatiale" ...>
          {/* Contenu actuel */}
        </LayerSwitch>
        <LayerSwitch name="Scoring OOH" ...>
          {/* Contenu actuel */}
        </LayerSwitch>
        <LayerSwitch name="Corrélation IRIS × POI" ...>
          {/* Contenu actuel */}
        </LayerSwitch>
        <LayerSwitch name="Clustering" ...>
          {/* Contenu actuel */}
        </LayerSwitch>
        <LayerSwitch name="Couverture" ...>
          {/* Contenu actuel */}
        </LayerSwitch>
      </CategoryGroup>
    </div>
  );
}
```

## PHASE 3 : MIGRATION DU CONTENU

### Règle d'or : DÉPLACER, pas réécrire

Chaque section existante (POI, Panneaux, Transport, etc.) est un composant
ou un bloc de JSX. On le DÉPLACE dans le bon LayerSwitch sans modifier
sa logique interne. Les props, callbacks, state partagé ne changent pas.

### Mapping précis :

| Ancien emplacement | Nouveau emplacement |
|---|---|
| Tab Territoire > Périmètre global | Catégorie CONTEXTE |
| Tab Territoire > Régions | Catégorie CONTEXTE |
| Tab Territoire > Départements | Catégorie CONTEXTE |
| Tab Territoire > Recherche locale | Catégorie CONTEXTE |
| Tab POI > Points d'intérêt | DONNÉES TERRAIN > Points d'intérêt |
| Tab POI > Panneaux OOH | DONNÉES TERRAIN > Panneaux OOH |
| Tab POI > Arrêts de transport | DONNÉES TERRAIN > Arrêts de transport |
| Tab POI > Flux routier TMJA | DONNÉES TERRAIN > Flux routier TMJA |
| Tab POI > Radio FM/DAB+ | DONNÉES TERRAIN > Radio FM/DAB+ |
| Tab Analyse > Analyse spatiale | ANALYSES > Analyse spatiale |
| Tab Analyse > Clustering | ANALYSES > Clustering |
| Tab Analyse > Carreaux | DONNÉES SOCIO-DÉMO > Carreaux Filosofi |
| Tab Analyse > IRIS | DONNÉES SOCIO-DÉMO > IRIS |
| Tab Analyse > Couverture | ANALYSES > Couverture |
| Tab Analyse > Corrélation | ANALYSES > Corrélation IRIS × POI |
| Tab Analyse > Scoring OOH | ANALYSES > Scoring OOH |
| Tab Analyse > Digital | CAMPAGNES MÉDIA > Campagne digitale (Sprint 2) |

### Chaque migration :
1. Identifier le composant ou bloc JSX
2. Vérifier ses dépendances (props, hooks, context)
3. Le wrapper dans un LayerSwitch avec les bons props
4. Vérifier que le switch on/off active/désactive le layer sur la carte
5. Tester que l'accordéon ouvre/ferme correctement

Commit après chaque catégorie migrée :
- `feat(layer-manager): migrer catégorie Contexte depuis Territoire`
- `feat(layer-manager): migrer catégorie Données terrain depuis POI`
- `feat(layer-manager): migrer catégorie Données socio-démo depuis Analyse`
- `feat(layer-manager): migrer catégorie Analyses depuis Analyse`

## PHASE 4 : SUPPRIMER LES ANCIENS TABS

Une fois TOUT migré et testé :
1. Supprimer les tabs Territoire / POI / Analyse
2. Supprimer les composants de navigation entre ces tabs
3. Le panel Expert affiche directement LayerManagerPanel
4. Le toggle Geo.Prompt / Expert continue de fonctionner normalement

```bash
# Vérifier qu'il ne reste rien des anciens tabs
grep -rn "Territoire\|activeTab.*POI\|activeTab.*Analyse\|tab.*territoire\|tab.*poi" --include="*.tsx"
```

Commit : `feat(layer-manager): supprimer tabs Territoire/POI/Analyse — panel unique`

## PHASE 5 : BARRE DE RECHERCHE

La barre de recherche existante ("Rechercher un filtre...") :
1. Doit filtrer les layers PAR NOM (pas juste les sections)
2. Si la recherche matche un layer, sa catégorie parente s'ouvre automatiquement
3. Les layers non matchés se masquent (display none)
4. Vider la recherche = tout réafficher dans l'état précédent

Commit : `feat(layer-manager): recherche filtrante sur layers et catégories`

## PHASE 6 : STYLE DES BOUTONS CTA

Tous les boutons CTA dans les layers (Afficher panneaux, Afficher arrêts, etc.)
doivent utiliser le style teal du DESIGN_SYSTEM :
```
background: transparent
border: 0.5px solid #4ecdc4
color: #4ecdc4
border-radius: 6px
padding: 8px 16px
font: Inter 500, 12px
hover: background rgba(78,205,196,0.1)
```

```bash
# Trouver TOUS les boutons orange restants
grep -rn "orange\|#f97316\|#ea580c\|#fb923c\|bg-orange\|text-orange" --include="*.tsx" --include="*.css"
```

AUCUNE couleur orange ne doit subsister.

Commit : `fix(buttons): tous les CTA en teal — suppression orange`

## VÉRIFICATION FINALE

Utilise verification-before-completion :
1. `npm run build` — 0 erreurs
2. Plus aucun sous-tab Territoire/POI/Analyse visible
3. Toutes les fonctionnalités existantes marchent dans leur nouveau container
4. Les switches activent les layers sur la carte
5. Les accordéons ouvrent/ferment correctement
6. La recherche filtre layers et catégories
7. AUCUN bouton orange restant
8. Le toggle Geo.Prompt / Expert fonctionne toujours

## POST-LIVRAISON — CLEANUP OBLIGATOIRE
Après le dernier commit de code fonctionnel :
1. Lance `@cleanup-magelian` Partie 2 (lint + types) sur les fichiers modifiés
2. Lance `@cleanup-magelian` Partie 3 (sécurité) sur les fichiers modifiés
3. Rapport : failles sécu + `any` introduits + catch non typés + imports inutilisés
4. Corrige TOUT avant de considérer la tâche terminée
5. Commit : `chore(cleanup): lint + types + sécurité post-sprint-1`
6. Utilise `requesting-code-review` pour générer le résumé des changements
7. Utilise `timeline-report` pour le rapport chronologique

## INTERDIT
- Ne PAS modifier le toggle Geo.Prompt / Expert
- Ne PAS modifier la logique métier des layers
- Ne PAS migrer le contenu Digital (c'est Sprint 2)
- Ne PAS modifier /api/isochrone-battle/route.ts ni les fonctions battle_*

Commit final : `feat(sprint-1): layer manager — panel unique catégories + layers`
Tag : `git tag sprint-1-layer-manager-$(date +%Y%m%d)`
