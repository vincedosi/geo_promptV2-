# REFONTE UX — Panel POI : Accordéons DESIGN_SYSTEM

## SKILLS OBLIGATOIRES
@verification-before-completion @executing-plans @systematic-debugging @smart-explore @finishing-a-development-branch @writing-plans @brainstorming @dispatching-parallel-agents @receiving-code-review @requesting-code-review @subagent-driven-development @test-driven-development @using-git-worktrees @using-superpowers @writing-skills @do @make-plan @mem-search @timeline-report @frontend-design

## LECTURE PRÉALABLE — OBLIGATOIRE
Lis ces fichiers AVANT de toucher au code :
1. DESIGN_SYSTEM.md
2. .claude/skills/geomatik-ux/SKILL.md
3. .claude/skills/frontend-design/SKILL.md

## CONTEXTE
Page /map, onglet Expert > POI. Le panel latéral gauche affiche 5 sections 
de données géographiques empilées en vrac avec des styles incohérents :
- Points d'intérêt (POI)
- Panneaux OOH et DOOH
- Arrêts de transport en commun
- Flux routier (TMJA)
- Radio FM/DAB+

Problèmes actuels :
- Chaque section a un style différent (boutons oranges, layouts variés)
- Tout est ouvert en même temps = scroll infini
- Les boutons CTA sont orange (INTERDIT par le design system)
- Pas de cohérence avec le pattern accordéon de la section Analyse
- Le dot teal + bandeau #111 du DESIGN_SYSTEM n'est pas appliqué

## OBJECTIF
Refactoriser en accordéons collapsibles uniformes, identiques au pattern 
utilisé dans le panel Analyse (section headers avec bandeau).

## POINT DE SAUVEGARDE
```bash
git add -A && git commit -m "checkpoint: avant refonte accordéons POI"
git checkout -b fix/poi-panel-accordeons
```

## PHASE 1 : RECONNAISSANCE
Utilise smart-explore pour trouver :
```bash
# Trouver les composants du panel POI
grep -rn "Points d'intérêt\|POI\|Panneaux OOH\|transport en commun\|TMJA\|Radio FM" --include="*.tsx" --include="*.ts" components/ app/
# Trouver le pattern accordéon existant dans Analyse
grep -rn "Collapsible\|Accordion\|collapsible\|accordion" --include="*.tsx" components/
# Trouver les boutons orange à éliminer
grep -rn "orange\|#f97316\|bg-orange\|text-orange" --include="*.tsx" --include="*.css" components/ app/
```

Fais un make-plan avant d'exécuter.

## PHASE 2 : COMPOSANT ACCORDÉON RÉUTILISABLE

Crée (ou réutilise si existant) un composant `components/ui/LayerAccordion.tsx` :

```typescript
interface LayerAccordionProps {
  title: string;           // "Points d'intérêt (POI)"
  icon?: React.ReactNode;  // Icône lucide optionnelle
  badge?: string;          // Badge info "3 types" ou "1 434 panneaux"
  defaultOpen?: boolean;   // false par défaut
  children: React.ReactNode;
}
```

Style du header accordéon — EXACTEMENT le pattern DESIGN_SYSTEM section header :
```
- background: #111111
- border-top: 1px solid #1a1a1a
- padding: 10px 14px
- display: flex, align-items: center, gap: 8px
- Dot teal : div 6px × 6px, border-radius 50%, background #4ecdc4
- Texte : Inter 500, 12px, #f0f0f0, sentence case
- Chevron : lucide ChevronDown/ChevronUp, 14px, #666, ml-auto, rotation animée 200ms
- Badge (optionnel) : à droite du texte, avant le chevron
  background #181818, border 0.5px solid #262626, color #666
  font: Inter 400, 10px, border-radius 4px, padding 2px 8px
```

Corps de l'accordéon :
```
- padding: 12px 14px
- background: transparent (#0a0a0a hérite du panel)
- border-bottom: 1px solid #1a1a1a
- Transition height : 200ms ease, overflow hidden pendant l'animation
```

Utilise shadcn Collapsible si disponible, sinon implémente avec useState + CSS transition.

## PHASE 3 : REFACTORISER CHAQUE SECTION

### 3.1 — Points d'intérêt (POI)
- Wrapper dans LayerAccordion title="Points d'intérêt" badge="{count} types"
- Garder : select type POI, bouton afficher
- Bouton CTA : remplacer orange par style teal DESIGN_SYSTEM
  (background transparent, border 0.5px solid #4ecdc4, color #4ecdc4, hover bg rgba(78,205,196,0.1))
- defaultOpen: true (c'est l'onglet POI, logique)

### 3.2 — Panneaux OOH et DOOH
- Wrapper dans LayerAccordion title="Panneaux OOH et DOOH" badge="{count} panneaux"
- Garder : info réseau, filtre régie, bouton afficher
- Bouton CTA : même style teal
- defaultOpen: false

### 3.3 — Arrêts de transport en commun
- Wrapper dans LayerAccordion title="Arrêts de transport" badge="zone visible"
- Garder : toggle group Bus/Train/Tramway/Métro, bouton afficher
- Toggle group : utiliser le style DESIGN_SYSTEM (pas des boutons outline gris)
  Actif : fond #181818, texte #f0f0f0, border-bottom 2px #4ecdc4
  Inactif : texte #666, hover #b0b0b0
- Bouton CTA : même style teal
- defaultOpen: false

### 3.4 — Flux routier (TMJA)
- Wrapper dans LayerAccordion title="Flux routier (TMJA)" badge="CEREMA"
- Garder : légende trafic, bouton afficher
- Icône info (ⓘ) : garder si fonctionnelle
- Bouton CTA : même style teal
- defaultOpen: false

### 3.5 — Radio FM/DAB+
- Wrapper dans LayerAccordion title="Radio FM/DAB+" badge="ANFR"
- Garder : bouton afficher émetteurs
- Bouton CTA : même style teal
- defaultOpen: false

## PHASE 4 : ÉLIMINER TOUT L'ORANGE

```bash
# Vérification exhaustive
grep -rn "orange\|#f97316\|#ea580c\|#fb923c\|bg-orange\|text-orange\|border-orange" --include="*.tsx" --include="*.ts" --include="*.css"
```

Chaque occurrence trouvée : remplacer par le style teal CTA du DESIGN_SYSTEM.
AUCUNE couleur orange ne doit subsister dans l'application.

## PHASE 5 : COMPORTEMENT ACCORDÉON

- Un seul accordéon ouvert à la fois (optionnel mais recommandé pour éviter le scroll)
  → Implémenter avec un state parent `openSection` qui toggle
  → OU laisser multiple ouvert si le contenu est court
- Boutons "Tout réduire" / "Tout déployer" existants : les garder mais 
  styler en boutons outline neutres DESIGN_SYSTEM (pas outline gris)
- Barre de recherche en haut : garder, elle filtre les sections

## PHASE 6 : VÉRIFICATION

Utilise verification-before-completion :
1. `npm run build` — 0 erreurs
2. `npm run lint` — corriger les warnings
3. Vérifier visuellement :
   - Tous les accordéons ont le bandeau #111 + dot teal
   - AUCUN bouton orange visible
   - Les chevrons s'animent à l'ouverture/fermeture
   - Le contenu de chaque section est fonctionnel (boutons afficher marchent)
4. grep orange = 0 résultats dans les composants

## POST-LIVRAISON
Après le dernier commit, lance @cleanup-geomatik Partie 2 + Partie 3 
sur les fichiers modifiés uniquement. Rapport rapide : failles sécu + 
any introduits + catch non typés. Corrige avant de considérer la tâche terminée.

## INTERDIT
- Ne PAS modifier la logique métier (fetch POI, fetch panneaux, etc.)
- Ne PAS modifier les handlers onClick qui chargent les layers sur la carte
- Ne PAS modifier /api/isochrone-battle/route.ts ni les fonctions battle_*
- Ne PAS utiliser de couleur orange, violet, ou toute couleur hors DESIGN_SYSTEM
- Ne PAS hardcoder les types de POI ou les régies — tout vient de la data

Commit final : `feat(poi-panel): accordéons design system — bandeau #111 + dot teal + suppression orange`
Tag : `git tag poi-accordeons-$(date +%Y%m%d)`
