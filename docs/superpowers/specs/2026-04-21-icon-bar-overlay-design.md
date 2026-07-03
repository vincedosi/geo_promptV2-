# Refonte panel Expert → IconBar 48px + Overlay flottant 280px

> Spec brainstormé le 2026-04-21 à partir de `docs/PROMPT2.md`.
> Branche d'implémentation : `feat/icon-bar-overlay`

## 1. Problème

La page `/map` affiche actuellement un `FilterPanel` fixe de 240px à gauche qui scrolle 4 catégories empilées (Périmètre, Données terrain, Analyses, Campagnes média) plus 2 onglets maîtres (Geo.Prompt / Expert). Le panel mange un quart de l'écran en permanence — un problème pour une app dont le cœur est la cartographie. Le `FilterPanel.tsx` actuel pèse 3 468 lignes et concentre toute la chrome de la page.

L'AppSidebar global (240px, monté dans `app/layout.tsx`) ajoute encore 240px de chrome. Sur un écran 1440px, l'utilisateur a 960px de carte utile au lieu des 1392px disponibles — 31% perdus.

## 2. Solution

Remplacer le panel Expert par une **barre d'icônes verticale fine (48px)** toujours visible et un **overlay flottant (280px)** qui apparaît par-dessus la carte au clic. La carte devient plein écran par défaut. L'AppSidebar global est masquée uniquement sur `/map`.

Un seul overlay est affiché à la fois. Cliquer ailleurs, sur la même icône, ou presser `Esc` le ferme.

## 3. Décisions tranchées en brainstorming

| # | Question | Décision |
|---|---|---|
| 1 | AppSidebar 240px vs nouvelle IconBar 48px | IconBar **remplace** AppSidebar uniquement sur `/map`. AppSidebar conservée sur toutes les autres routes. Une icône Home en haut de l'IconBar pour retour, et liens de navigation inter-pages dans l'overlay Settings. |
| 2 | Onglet "Étude" actuel | Étude **déclenchée depuis l'overlay Analyses** (CTA "Ouvrir l'étude de ville →" visible quand `studyVille` est set). Remplace la carte plein écran. IconBar reste visible. Bouton "← Retour carte" flottant top-left. Badge teal sur l'icône Analyses quand un scoring est calculé. |
| 3 | Toggle Vue comparée + TripleMapView | **Statu quo** — toggle reste flottant top-center, TripleMapView remplace la carte (z=15), overlay Campagnes peut rester ouvert par-dessus (z=40). |
| 4 | Bouton Maximize2 (ancien fullscreen toggle) | **Mode immersif** — toggle la visibilité de l'IconBar. Re-clic ou Esc = IconBar revient. Bouton à `z-index: 50` pour rester cliquable au-dessus de l'overlay. |
| 5 | Search filter + boutons Tout réduire/déployer | **Suppression pure**. Avec 4 overlays dédiés (max 7 sections chacun), la recherche cross-catégorie n'a plus de sens. Reviendra naturellement via la Smart Bar geo.prompt si besoin. |

## 4. Architecture

```
┌─────────────────────────────────────────────────────┐
│  app/layout.tsx (root)                              │
│  - AppSidebar 240px (masquée sur /map)              │
│  - ThemeToggle + SessionBadge top-right (z=200)     │
│      (masqués sur /map, déplacés dans overlays)     │
└─────────────────────────────────────────────────────┘
                          │
              ┌───────────┴────────────┐
              │  app/map/page.tsx      │
              │  (carte plein écran)   │
              └───────────┬────────────┘
                          │
        ┌─────────────────┴─────────────────┐
        │                                   │
        ▼                                   ▼
┌──────────────┐                  ┌──────────────────┐
│ IconBar      │                  │ MapPanel         │
│ 48px fixed   │                  │ MapLibre canvas  │
│ z=30         │                  │ ml-[48px]        │
│              │                  │                  │
│ Home         │   ┌──────────────┴──────────────┐   │
│ ──           │   │ Maximize2 (z=50)            │   │
│ AI ●         │   │ Vue toggle (z=25, digital)  │   │
│ ──           │   │ TripleMapView (z=15)        │   │
│ Périmètre    │   └─────────────────────────────┘   │
│ Terrain      │                  │                  │
│ Analyses     │   ┌──────────────┴──────────────┐   │
│ Campagnes    │   │ OverlayPanel z=40           │   │
│              │   │ ┌─────────────────────────┐ │   │
│ ──mt-auto    │   │ │ ● Titre overlay     ×  │ │   │
│ Settings     │   │ ├─────────────────────────┤ │   │
└──────────────┘   │ │ AI / Périmètre / etc.   │ │   │
                   │ │ (contenu déplacé        │ │   │
                   │ │  depuis FilterPanel)    │ │   │
                   │ └─────────────────────────┘ │   │
                   └─────────────────────────────┘   │
                                                     │
                    StudyDashboard (mode plein écran)│
                    Affiché si activeStudy === true  │
                    Bouton "← Retour" top-left z=50  │
```

### Composants nouveaux

| Fichier | Responsabilité |
|---|---|
| `components/map/IconBar.tsx` | Barre verticale 48px, 7 boutons icônes. Reçoit `activeOverlay` + `onItemClick(id)` + `onMaximizeToggle`. Gère le rendu visuel (active/hover) et le shortcut `/` pour AI. |
| `components/map/OverlayPanel.tsx` | Shell flottant 280px : header (dot + titre + close), body scrollable, animation 150ms entrée/sortie, listener Esc + click-outside. Switch interne sur `category` qui rend le bon sous-overlay (`AIOverlay`, `PerimeterOverlay`, etc.) avec ses props dédiées. |
| `components/map/overlays/AIOverlay.tsx` | Wrappe `ChatPanel`, sticky bottom input, scroll messages. |
| `components/map/overlays/PerimeterOverlay.tsx` | Périmètre global + Régions + Départements + Recherche locale. |
| `components/map/overlays/TerrainOverlay.tsx` | POI + Panneaux OOH + Transport + TMJA + Radio + IRIS + Carreaux (fusion ancien `terrain` + `socio` du store). |
| `components/map/overlays/AnalysesOverlay.tsx` | Analyse spatiale + Scoring (avec CTA Étude conditionnel) + Corrélation + Clustering + Couverture. |
| `components/map/overlays/CampaignsOverlay.tsx` | Sélecteur campagne + Railroad stepper + KPIs digital. |
| `components/map/overlays/SettingsOverlay.tsx` | Fond de carte + Sauvegarder la vue + ThemeToggle + Liens nav inter-pages. |

### Composants supprimés (Phase 6, après validation migration)

- `app/map/_components/FilterPanel.tsx` (3 468 lignes)
- Tabs Geo.Prompt / Expert dans page.tsx
- État `mapFullscreen` (remplacé par `iconBarHidden`)
- Search filter input + boutons "Tout réduire/déployer"
- HOME link dans FilterPanel (remplacé par icône Home en haut de l'IconBar)

## 5. State management

```typescript
// app/map/page.tsx — nouveaux états
type OverlayId = 'ai' | 'perimeter' | 'terrain' | 'analyses' | 'campaigns' | 'settings';

const [activeOverlay, setActiveOverlay] = useState<OverlayId | null>(null);
const [iconBarHidden, setIconBarHidden] = useState(false); // mode immersif
const [activeStudy, setActiveStudy] = useState(false);     // remplace activeTab === 'study'

function handleOverlayToggle(id: OverlayId) {
  setActiveOverlay(prev => prev === id ? null : id);
}

function handleOpenStudy() {
  setActiveStudy(true);
  setActiveOverlay(null); // ferme l'overlay Analyses
}

function handleCloseStudy() {
  setActiveStudy(false);
}
```

`useLayerStore` (Zustand) reste **inchangé** — orthogonal à la nav UI.
`mapFullscreen` est remplacé par `iconBarHidden`.
`activeTab: 'map' | 'study'` est remplacé par `activeStudy: boolean`.

## 6. Distribution des props

`page.tsx` passe au plus haut :

```tsx
<IconBar
  activeItem={activeOverlay}
  onItemClick={handleOverlayToggle}
  hidden={iconBarHidden}
  studyAvailable={!!studyVille}
/>

<button onClick={() => setIconBarHidden(h => !h)} style={{ zIndex: 50 }}>
  {iconBarHidden ? <Maximize2 /> : <Minimize2 />}
</button>

{activeOverlay && !activeStudy && (
  <OverlayPanel
    category={activeOverlay}
    onClose={() => setActiveOverlay(null)}
    {...overlayProps}  // objet groupé, voir ci-dessous
  />
)}

{activeStudy && (
  <StudyDashboard ville={studyVille} onClose={handleCloseStudy} />
)}
```

`overlayProps` est un objet structuré pour éviter d'avoir 80 props plates :

```typescript
interface OverlayPanelProps {
  category: OverlayId;
  onClose: () => void;
  ai: AIOverlayProps;          // chat + chatSlot props
  perimeter: PerimeterOverlayProps;
  terrain: TerrainOverlayProps;
  analyses: AnalysesOverlayProps & { onOpenStudy: () => void };
  campaigns: CampaignsOverlayProps;
  settings: SettingsOverlayProps;
}
```

`OverlayPanel` route vers le bon sous-overlay selon `category`. Chaque sous-overlay reçoit uniquement son sous-objet de props.

## 7. Comportements

| Action | Résultat |
|---|---|
| Clic icône X (overlay fermé) | Ouvre overlay X (animation 150ms) |
| Clic icône X (overlay X ouvert) | Ferme overlay |
| Clic icône Y (overlay X ouvert) | Switch contenu, pas de close/reopen |
| Clic carte (hors overlay et IconBar) | Ferme overlay |
| Touche `Esc` | Ferme overlay (priorité 1), sinon ferme StudyDashboard, sinon désactive iconBarHidden |
| Touche `/` (focus pas dans input) | Ouvre overlay AI + focus input chat |
| Clic Maximize2 | Toggle `iconBarHidden` |
| `studyVille` set | Badge teal pulse sur icône Analyses + CTA "Ouvrir l'étude" visible dans l'overlay Analyses |
| Clic CTA Étude | `activeStudy = true`, ferme overlay, affiche StudyDashboard plein écran |
| Clic "← Retour carte" (depuis Étude) | `activeStudy = false`, retour à la carte |

## 8. Z-index hiérarchique

| Élément | z-index | Justification |
|---|---|---|
| Carte MapLibre | 0 | Base |
| TripleMapView (digital compare) | 15 | Au-dessus de la carte de base |
| Toggle Vue comparée/fusionnée | 25 | Visible au-dessus de TripleMapView |
| IconBar | 30 | Au-dessus de la carte, sous l'overlay |
| OverlayPanel | 40 | Au-dessus de l'IconBar |
| **Bouton Maximize2** | **50** | **Cliquable même quand l'overlay est ouvert** |
| Bouton "← Retour carte" (StudyDashboard) | 50 | Cliquable au-dessus de l'overlay |
| StudyDashboard plein écran | 35 | Au-dessus de la carte, sous l'overlay |
| Splash / toasts | 200+ | Inchangé (global layout) |

## 9. Style — exceptions au design system

Le design system MAGELIAN interdit `box-shadow`, `backdrop-filter` et `gradient`. L'OverlayPanel **fait exception** sur deux points :

- `backdrop-filter: blur(8px)` — l'overlay flotte au-dessus de la carte, le blur léger laisse percevoir le contexte cartographique sous-jacent.
- `box-shadow: 0 4px 24px rgba(0,0,0,0.3)` — distingue visuellement l'overlay flottant du fond.

**Justification** : ces effets sont **fonctionnels** (signaler le statut "flottant" et préserver le contexte spatial), pas décoratifs. Aucune autre exception au design system.

## 10. Responsive

- **>1024px** : IconBar 48px avec labels 8px sous chaque icône, OverlayPanel 280px
- **768-1024px** : IconBar 48px sans labels (icône seule centrée), OverlayPanel 260px
- **<768px** : IconBar devient **bottom bar horizontale 56px** (fixed bottom, flex horizontal), OverlayPanel devient **bottom sheet 70vh** avec drag handle en haut, border-radius `16px 16px 0 0`

## 11. Plan de migration phasé

| Phase | Contenu | Fichiers | Commit |
|---|---|---|---|
| 1 | Reconnaissance + checkpoint git + branche | — | `checkpoint: avant refonte panel expert → barre icônes + overlay` puis `git checkout -b feat/icon-bar-overlay` |
| 2 | `IconBar.tsx` créée (sans contenu overlay) + état `activeOverlay` dans page.tsx + Home/Settings/etc. cliquent et console.log | `components/map/IconBar.tsx`, `app/map/page.tsx` (additif), `app/layout.tsx` (masquage AppSidebar conditionnel) | `feat(layout): barre d'icônes verticale 48px — 7 catégories` |
| 3 | `OverlayPanel.tsx` shell vide avec animation 150ms + Esc + click-outside | `components/map/OverlayPanel.tsx`, `app/map/page.tsx` (rendu conditionnel) | `feat(layout): overlay flottant 280px — semi-transparent + animation` |
| 4 | Création des 6 sous-overlays par **déplacement** du JSX existant depuis FilterPanel (FilterPanel reste vivant en parallèle) | `components/map/overlays/*.tsx` (6 fichiers) | `feat(layout): mapping contenu catégories → overlay` |
| 5 | Layout page.tsx : `iconBarHidden` + Maximize2 z=50 + `activeStudy` + bouton retour Étude + câblage complet props vers overlays | `app/map/page.tsx` | `feat(layout): migration page map — carte plein écran + barre + overlay` |
| 6 | Suppression FilterPanel + tabs Geo.Prompt/Expert + état `mapFullscreen` + search/collapse-all + HOME link FilterPanel | `app/map/_components/FilterPanel.tsx` (suppression), `app/map/page.tsx` (cleanup) | `refactor(layout): supprimer ancien panel Expert et tabs` |
| 7 | Responsive : bottom bar mobile + sheet overlay + breakpoints | `components/map/IconBar.tsx`, `OverlayPanel.tsx` | `feat(layout): responsive — bottom bar mobile + sheet overlay` |
| 8 | Cleanup post-livraison : `cleanup-magelian` parties 2 (lint+types) et 3 (sécurité) sur fichiers modifiés | — | `chore(cleanup): lint + types + sécurité post-refonte overlay` |

## 12. Hors scope

- Refonte globale de l'AppSidebar (juste masquée sur /map)
- Modification de la logique métier des layers (`useMapLayers`, `useLayerStore`)
- Modification de `/api/isochrone-battle/*` et fonctions PostGIS battle_*
- Nouvelle recherche globale cross-catégorie
- Modification du `StudyDashboard` (réutilisé tel quel)
- Modification du `ChatPanel` (réutilisé tel quel dans AIOverlay)
- Modification de `MapPanel` ou des hooks `useMapInit/useMapLayers`

## 13. Risques & mitigations

| Risque | Mitigation |
|---|---|
| `FilterPanel.tsx` 3468 lignes — découpage en 6 fichiers risqué | Phase 4 = déplacement strict du JSX (pas de réécriture). FilterPanel reste vivant jusqu'en Phase 6. Tests visuels après chaque section migrée. |
| Click-outside sur carte conflits avec MapLibre handlers | Listener global avec `event.target.closest('.overlay-panel, .icon-bar')` skip. N'empêche pas la propagation, juste vérifie la cible. |
| Shortcut `/` bloque la frappe dans inputs | Désactivé si `document.activeElement` est `INPUT`/`TEXTAREA`/`[contenteditable]` |
| TripleMapView z-index conflit avec overlay | OverlayPanel z=40 > TripleMapView z=15 ✓ |
| Maximize2 inaccessible quand overlay ouvert | z=50 > overlay z=40 ✓ |
| Animation overlay sur switch (close-then-open) | Switch sans fermeture : on garde l'overlay monté, on swap juste le contenu (cross-fade interne 100ms) |
| AppSidebar masquée mais nav pages perdue | Liens nav dans SettingsOverlay + icône Home en top de l'IconBar |

## 14. Critères d'acceptation

1. `npm run build` — 0 erreurs
2. La carte est plein écran par défaut (uniquement 48px d'IconBar à gauche)
3. Les 7 icônes sont visibles et cliquables
4. Clic sur une icône = overlay flottant avec le bon contenu
5. Clic sur la même icône = ferme l'overlay
6. Clic sur une autre icône = switch contenu sans fermeture
7. Clic sur la carte = ferme l'overlay
8. `Esc` = ferme l'overlay
9. `/` = ouvre overlay AI + focus input
10. L'icône active a la barre verticale colorée + fond teinté
11. L'overlay a `backdrop-filter: blur(8px)` + `box-shadow`
12. Geo.prompt fonctionne dans l'overlay AI
13. Tous les layers fonctionnent depuis l'overlay Terrain
14. Campagne digitale fonctionne depuis Campagnes (TripleMapView affichable)
15. Le bouton Maximize2 toggle l'IconBar (z=50 reste cliquable)
16. Étude accessible via CTA dans Analyses (uniquement si scoring calculé)
17. Étude affichée plein écran avec bouton "← Retour" top-left
18. Badge teal sur Analyses quand `studyVille` est set
19. Responsive < 768px : IconBar bas + bottom sheet
20. AppSidebar global masquée sur /map, présente sur les autres routes
21. Liens nav inter-pages dans SettingsOverlay
22. Toutes les fonctionnalités existantes préservées (zéro régression)

---

*Spec validé par l'utilisateur le 2026-04-21. Prêt pour writing-plans.*
