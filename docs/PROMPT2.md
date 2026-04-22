# CORRECTIONS UX + BUGS — Post-livraison IconBar/Overlay

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
git add -A && git commit -m "checkpoint: avant corrections UX overlay"
git checkout -b fix/overlay-ux-corrections
```

# ============================================================
# BUG 1 — Supprimer l'accueil geo.prompt dans l'overlay AI
# ============================================================

Quand on clique sur l'icône geo.prompt, l'overlay affiche une page d'accueil
"Que voulez-vous analyser ?" avec des suggestions. Ce n'est PAS le bon endroit
pour ça — c'est un overlay, pas une landing page.

L'overlay AI doit afficher DIRECTEMENT le chat geo.prompt :
- L'historique des messages (si existant)
- L'input de message en bas (sticky bottom)
- PAS de page d'accueil, PAS de titre "Que voulez-vous analyser ?"
- PAS de cards de suggestions (ou alors en PETIT sous l'input, comme des chips,
  pas comme des cards plein écran)

Si les suggestions sont utiles, les transformer en chips compacts sous l'input :
```
┌─────────────────────────────────────┐
│                                     │
│  (historique chat vide ou messages) │
│                                     │
│  ┌─────────────────────────────────┐│
│  │ Posez votre question...     ⬆  ││  ← Input sticky bottom
│  └─────────────────────────────────┘│
│  densité 18-24 · panneaux Brest ·   │  ← Chips suggestions, petits
└─────────────────────────────────────┘
```

```bash
grep -rn "Que voulez-vous\|voulez.*analyser\|WelcomeScreen\|welcomeScreen\|suggestions" \
  --include="*.tsx" components/map/overlays/AIOverlay.tsx components/copilote/
```

Commit : `fix(ai-overlay): supprimer page accueil — afficher chat direct`

# ============================================================
# BUG 2 — Icône disquette → item IconBar avec overlay
# ============================================================

L'icône disquette (sauvegarder) flotte en haut à droite de la carte.
Elle doit être intégrée dans la barre IconBar comme un item à part entière.

### Position dans l'IconBar :
Entre "Campagnes" et "Réglages" (poussé en bas avec mt-auto comme Settings)
Ou mieux : DANS l'overlay Réglages comme une action.

### Option recommandée : dans l'overlay Réglages
L'overlay Réglages contient déjà fond de carte + thème + navigation.
Ajouter une section "Vues sauvegardées" :
- Bouton "Sauvegarder la vue actuelle" (style teal CTA)
- Liste des vues sauvegardées (si existant)
- Supprimer l'icône disquette flottante sur la carte

```bash
grep -rn "save\|disquette\|sauvegarder\|SaveIcon\|savedMap" --include="*.tsx" app/map/ components/map/
```

Commit : `fix(settings): déplacer sauvegarde dans overlay Réglages`

# ============================================================
# BUG 3 — Accordéons fermés par défaut à l'arrivée
# ============================================================

Quand l'utilisateur ouvre un overlay (Terrain, Analyses, etc.), tous les
accordéons/layers à l'intérieur sont DÉPLIÉS. Ils doivent être FERMÉS par défaut.

L'utilisateur clique pour déplier le layer qu'il veut.
Seul un layer ACTIF (switch on) peut avoir son accordéon ouvert par défaut.

### Règle :
- Layer switch OFF → accordéon fermé, non ouvrable
- Layer switch ON → accordéon fermé par défaut, ouvrable au clic sur le nom
- Layer switch ON + vient d'être activé → accordéon s'ouvre automatiquement

Vérifier dans FilterPanel.tsx le state des sections collapsées :
```bash
grep -rn "defaultOpen\|isOpen\|collapsed\|expanded\|setCollapsed\|setExpanded" \
  --include="*.tsx" components/map/ app/map/_components/FilterPanel.tsx
```

Forcer `defaultOpen={false}` sur toutes les sections dans le FilterPanel
quand il est rendu via visibleCategory dans un overlay.

Commit : `fix(overlay): accordéons fermés par défaut — ouvrir au clic`

# ============================================================
# BUG 4 — Bouton "Afficher les émetteurs" dans l'accordéon
# ============================================================

Le bouton "Afficher les émetteurs" de Radio FM/DAB+ est visible même quand
l'accordéon Radio est fermé. Il doit être DANS l'accordéon, pas en dessous.

Même chose pour tous les boutons CTA de chaque layer :
- "Afficher les panneaux" → dans l'accordéon Panneaux
- "Afficher arrêts" → dans l'accordéon Transport
- "Afficher TMJA" → dans l'accordéon TMJA
- "Afficher les émetteurs" → dans l'accordéon Radio

Vérifier que le JSX du bouton est ENFANT du bloc collapsible, pas frère.

```bash
grep -rn "Afficher.*émetteurs\|Afficher.*panneaux\|Afficher.*arrêts\|Afficher.*TMJA" \
  --include="*.tsx" app/map/_components/FilterPanel.tsx
```

Commit : `fix(layers): boutons CTA dans l'accordéon — masqués quand fermé`

# ============================================================
# BUG 5 — Titre de catégorie en doublon
# ============================================================

L'overlay "Données terrain" affiche :
```
● Données terrain          ×    ← Header de l'overlay (OverlayPanel)
● DONNÉES TERRAIN          ∨    ← Header de la CategoryGroup dans FilterPanel
```

C'est un doublon. Le header de l'OverlayPanel REMPLACE le header CategoryGroup.
Quand FilterPanel est rendu avec visibleCategory, le header de la catégorie
correspondante ne doit PAS s'afficher (il est redondant avec le header overlay).

### Fix :
Ajouter un prop `hideHeader={true}` au CategoryGroup quand il est rendu
dans un overlay. Ou simplement ne pas rendre le CategoryGroup wrapper —
rendre directement les LayerSwitch enfants.

```bash
grep -rn "CategoryGroup\|categoryGroup\|category-group" \
  --include="*.tsx" app/map/_components/FilterPanel.tsx
```

Commit : `fix(overlay): supprimer titre catégorie en doublon`

# ============================================================
# BUG 6 — Transparence légère sur l'overlay
# ============================================================

L'overlay est actuellement opaque ou presque. Ajouter une légère transparence
pour qu'on aperçoive la carte en dessous — ça donne une sensation de "flottant".

### Modifier OverlayPanel.tsx :

```css
/* Background avec transparence */
background: rgba(10, 10, 10, 0.92);     /* dark — 92% opaque, 8% transparent */
backdrop-filter: blur(12px);             /* blur pour lisibilité du texte */
-webkit-backdrop-filter: blur(12px);

/* Light mode */
.light background: rgba(248, 248, 248, 0.90);  /* un peu plus transparent en light */
```

Si les variables CSS sont utilisées, modifier la variable :
```css
:root {
  --overlay-bg: rgba(10, 10, 10, 0.92);
}
.light {
  --overlay-bg: rgba(248, 248, 248, 0.90);
}
```

Le blur est une exception validée au design system (overlay flottant = besoin 
fonctionnel de distinguer l'overlay du fond).

```bash
grep -rn "background\|backdrop\|opacity\|rgba" --include="*.tsx" \
  components/map/OverlayPanel.tsx
```

Commit : `fix(overlay): transparence 92% + backdrop blur 12px`

# ============================================================
# VÉRIFICATION FINALE
# ============================================================

1. `npm run build` — 0 erreurs nouvelles
2. Overlay AI : affiche le chat directement, PAS de page d'accueil
3. Icône disquette : supprimée de la carte, sauvegarde dans overlay Réglages
4. Accordéons : TOUS fermés par défaut à l'ouverture d'un overlay
5. Bouton "Afficher les émetteurs" : masqué quand accordéon Radio fermé
6. Pas de titre en doublon dans aucun overlay
7. L'overlay laisse apercevoir la carte en transparence
8. Fonctionne en dark ET light mode

## POST-LIVRAISON — CLEANUP OBLIGATOIRE
1. Lance `@cleanup-geomatik` Partie 2 (lint + types) sur les fichiers modifiés
2. Lance `@cleanup-geomatik` Partie 3 (sécurité) sur les fichiers modifiés
3. Rapport : failles sécu + `any` introduits + catch non typés + imports inutilisés
4. Corrige TOUT avant de considérer la tâche terminée
5. Commit : `chore(cleanup): lint + types + sécurité post-corrections overlay`
6. Utilise `requesting-code-review` pour le résumé
7. Utilise `timeline-report` pour le rapport

## INTERDIT
- Ne PAS modifier la logique métier des layers
- Ne PAS modifier /api/isochrone-battle/route.ts ni les fonctions battle_*
- Ne PAS réécrire FilterPanel — modifier par props/conditions

Commit final : `fix(overlay): 6 corrections UX — accueil, sauvegarde, accordéons, doublons, transparence`