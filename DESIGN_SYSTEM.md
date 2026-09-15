# MAGELIAN — Design System Reference

> Ce fichier est la source de vérité pour TOUT travail frontend.
> Claude Code DOIT lire et appliquer ces règles avant toute modification UI.

---

## 1. Identité de marque

- **Nom** : MAGELIAN
- **Tagline** : Geospatial intelligence
- **Logotype** : Wordmark SVG `MAGELIAN` (public/magelian-icon.svg) — hauteur 18-24px selon contexte
- **Logo dans le SaaS** : `<img src="/magelian-icon.svg" alt="MAGELIAN" />` partout (sidebar, splash, topbar, login)
- **geo.prompt** : Nom de la fonctionnalité copilote IA à l'intérieur de la plateforme

---

## 2. Direction visuelle : Dark Minimal

Style inspiré de Linear, Vercel, Raycast. Monochrome par défaut, couleur avec intention.

### Principes
- Flat total : pas de gradient, pas de shadow, pas de glow, pas de blur
- Monochrome par défaut : la couleur n'apparaît que pour le statut ou l'interaction
- CTA principal : bouton blanc (#f0f0f0) sur fond noir, ou teal (#4ecdc4) pour les accents
- Sentence case partout : jamais d'UPPERCASE sauf acronymes (OOH, IRIS, POI, TMJA)
- Deux fonts max : Inter (UI) + JetBrains Mono (données/code)
- Pas d'Orbitron, pas de Michroma, jamais

---

## 3. Tokens de couleur

### Surfaces (du plus sombre au plus clair)
| Token | Hex | Usage |
|-------|-----|-------|
| --background | #050505 | Fond de page principal |
| --card | #0a0a0a | Panels, sidebar, cards |
| --elevated | #111111 | Éléments surélevés, bandeaux de section, hover |
| --overlay | #181818 | Overlays, muted backgrounds |

### Borders
| Token | Hex | Usage |
|-------|-----|-------|
| --border-subtle | #1a1a1a | Séparateurs par défaut, borders de cards |
| --border-default | #262626 | Inputs, boutons outline |
| --border-hover | #333333 | Hover state, focus ring |

### Texte
| Token | Hex | Usage |
|-------|-----|-------|
| --text-primary | #f0f0f0 | Titres, texte principal, labels actifs |
| --text-secondary | #a0a0a0 | Corps de texte, labels inactifs |
| --text-tertiary | #666666 | Hints, placeholders, métadonnées |

### Accent de marque
| Token | Hex | Usage |
|-------|-----|-------|
| --brand-teal | #4ecdc4 | Accent MAGELIAN : tabs actifs, boutons send, dots de section, liens, focus |
| --brand-teal-hover | #3dbdb5 | Hover du teal |
| --brand-teal-30 | rgba(78,205,196,0.3) | Borders hover subtiles, badges |
| --brand-teal-50 | rgba(78,205,196,0.5) | Focus ring des inputs |

### Statut (seules couleurs sémantiques autorisées)
| Token | Hex | Usage |
|-------|-----|-------|
| --success | #3dffa0 | Statut système OK, dot "Online" |
| --danger | #ff5757 | Erreurs, alertes destructives |
| --warning | #f7b731 | Avertissements, billing |
| --info | #5b9bd5 | Liens informatifs (usage rare) |

### Échelle divergente (écart au plan média)
Seule échelle divergente du projet — toutes les autres sont séquentielles. Encode
l'écart en % entre la pression livrée et la pression planifiée d'une campagne :
sous-pression d'un côté, conformité au centre, sur-pression de l'autre. Valeurs
dans `app/globals.css` (`:root` et `html.light`) et dupliquées en hex littéraux
dans `lib/campagne/palette-divergente.ts` (`RAMPE_MAPLIBRE`) — MapLibre ne résout
pas `var()` dans `paint`, d'où les deux copies, verrouillées ensemble par
`tests/unit/campagne/palette-divergente.test.ts`.

| Token | Hex (dark) | Hex (light) | Usage |
|-------|-----------|-------------|-------|
| --diverge-sous-3 | #c2410c | #9a2f08 | Sous-pression forte (< -25 %) |
| --diverge-sous-2 | #ea7c4a | #cc5f27 | Sous-pression |
| --diverge-sous-1 | #f0b48c | #e8a878 | Légèrement sous |
| --diverge-neutre | #4a4a4a | #c6d2cf | Conforme au plan |
| --diverge-sur-1 | #8fb8d8 | #7ba7cc | Légèrement au-dessus |
| --diverge-sur-2 | #4a86b8 | #2f6fa3 | Sur-pression |
| --diverge-sur-3 | #1f5c8f | #14496f | Sur-pression forte (> +25 %) |

**Le sens doit aussi se lire par la POSITION sur la barre, jamais la teinte
seule** — sinon illisible pour un daltonien. Bornes symétriques autour de zéro
(`BORNES_DIVERGENTES`) : la sur-pression ne doit jamais paraître moins grave
que la sous-pression équivalente.

### Échelle séquentielle (intensité — vignettes carte du Suivi V2)
Toute échelle qui n'est PAS l'écart au plan (ci-dessus) est séquentielle : une
seule direction, du plus faible au plus fort, sans signe. Encode une intensité
croissante — nombre d'impressions livrées, valeur d'un indicateur INSEE — sur
les vignettes « Impressions » et « Variable du plan » du cockpit de suivi.
Même patron de duplication que l'échelle divergente et pour la même raison
(MapLibre ne résout pas `var()` dans `paint`) : valeurs dans `app/globals.css`
(`:root` et `html.light`) et dupliquées en hex littéraux dans
`lib/campagne/palette-sequentielle.ts` (`RAMPE_SEQUENTIELLE`), les deux copies
verrouillées ensemble par
`tests/unit/campagne/palette-sequentielle-css.test.ts`.

| Token | Hex (dark) | Hex (light) | Usage |
|-------|-----------|-------------|-------|
| --seq-1 | #132625 | #eaf7f5 | Intensité la plus faible |
| --seq-2 | #1b3d3a | #c3ebe6 | Faible |
| --seq-3 | #2a6b62 | #8ed6cc | Médiane |
| --seq-4 | #3a9e91 | #4fb3a6 | Forte |
| --seq-5 | #4ecdc4 | #1f8a7c | Intensité la plus forte (= --brand-teal en dark) |

Une seule rampe sert les deux vignettes séquentielles — ce n'est pas la couleur
qui distingue « Impressions » de « Variable du plan » (les deux sont des
intensités croissantes, sans signe), mais le domaine de données et la légende
de chaque vignette. Dérivée de l'accent de marque (`--brand-teal`), du plus
sombre/neutre (valeur faible) au teal plein (valeur forte), cohérente avec la
RÈGLE D'OR ci-dessus (« la couleur n'apparaît que pour le statut ou
l'interaction », ici l'intensité de la donnée). Choix visuel neuf (Tâche 13A,
2026-09-15) — à valider par un designer au même titre que toute palette de
données, pas encore éprouvé en usage.

### RÈGLE D'OR
Pas de violet (#a855f7) nulle part. Pas de vert fluo (#3dffa0) sauf indicateur de statut système. Pas d'orange sur les boutons.

---

## 4. Typographie

| Rôle | Font | Weight | Size | Couleur |
|------|------|--------|------|---------|
| Titres de page | Inter | 500 | 18-24px | #f0f0f0 |
| Titres de section | Inter | 500 | 12-14px | #f0f0f0 |
| Corps de texte | Inter | 400 | 13px | #a0a0a0 |
| Labels de champ | Inter | 400 | 12px | #666666 |
| Données numériques | JetBrains Mono | 400-500 | 11-16px | #a0a0a0 |
| Statut/debug | JetBrains Mono | 400 | 11px | #666666 |

### Règles typographiques
- Sentence case TOUJOURS : "Analyse spatiale" pas "ANALYSE SPATIALE"
- Exceptions uppercase : acronymes métier (OOH, DOOH, IRIS, POI, TMJA, DROM)
- Letter-spacing : 0 par défaut, -0.02em sur les titres 18px+
- Line-height : 1.4 pour les labels, 1.6 pour le corps de texte

---

## 5. Composants — Patterns obligatoires

### Section header (panel Expert et toute page avec sections)
```
Style obligatoire pour chaque titre de section dans un panel latéral :
- background: #111111
- border-top: 1px solid #1a1a1a
- padding: 10px 14px
- display: flex, align-items: center, gap: 8px
- Dot teal : div 6px × 6px, border-radius: 50%, background: #4ecdc4
- Texte : Inter 500, 12px, #f0f0f0
- Chevron (si collapsible) : lucide ChevronDown/Up, 14px, #666666, à droite (ml-auto)
```

### Bouton CTA principal
```
- background: #f0f0f0
- color: #050505
- border: none
- border-radius: 6px
- padding: 10px 16px
- font: Inter 500, 13px
- hover: background #d4d4d4
- Utiliser shadcn Button variant="default"
```

### Bouton CTA teal (actions métier : afficher, charger, appliquer)
```
- background: transparent
- border: 0.5px solid #4ecdc4
- color: #4ecdc4
- border-radius: 6px
- padding: 8px 16px
- font: Inter 500, 12px
- hover: background rgba(78,205,196,0.1)
- PAS d'uppercase sur le label
```

### Bouton outline neutre
```
- background: transparent
- border: 0.5px solid #262626
- color: #a0a0a0
- border-radius: 6px
- hover: border #333333, background #111111, color #f0f0f0
- Utiliser shadcn Button variant="outline"
```

### Inputs / Selects
```
- background: #111111
- border: 0.5px solid #1a1a1a
- border-radius: 6px
- padding: 8px 12px
- font: Inter 400, 13px, color #f0f0f0
- placeholder: #666666
- focus: border rgba(78,205,196,0.5)
- Utiliser shadcn Input ou Select
```

### Tabs (navigation interne)
```
- Actif : color #f0f0f0, border-bottom 2px solid #4ecdc4
- Inactif : color #666666, hover #a0a0a0
- font: Inter 500, 12-13px
- Pas d'uppercase
- Utiliser shadcn Tabs quand possible
```

### Sliders
```
- Track : height 4px, background #1a1a1a
- Track filled : background #f0f0f0
- Thumb : 14px cercle, background #f0f0f0
- Label : Inter 400, 11px, #666666, sentence case
- Valeur : JetBrains Mono, 11px, #a0a0a0
```

### Cards de suggestion (chat copilote)
```
- background: #111111
- border: 0.5px solid #1a1a1a
- border-radius: 8px
- padding: 12px 14px
- text: Inter 400, 13px, #a0a0a0
- hover: border rgba(78,205,196,0.3), background #151515
```

### Badges
```
- background: #181818
- border: 0.5px solid #262626
- color: #666666
- font: Inter 400, 10px
- border-radius: 4px
- padding: 2px 8px
```

### Alertes / Statut
```
- Success : background rgba(61,255,160,0.1), border rgba(61,255,160,0.2), text #3dffa0
- Danger : background rgba(255,87,87,0.1), border rgba(255,87,87,0.2), text #ff5757
- Warning : background rgba(247,183,49,0.1), border rgba(247,183,49,0.2), text #f7b731
```

---

## 6. Layout

### Sidebar
- Largeur : 240px, position fixed left
- Background : #0a0a0a, border-right 0.5px solid #1a1a1a
- Logo MAGELIAN en haut : `<img src="/magelian-icon.svg" />` (hauteur 18px)
- Items : Inter 400, 13px, #a0a0a0
- Item actif : background #151515, color #f0f0f0, border-left 2px solid #f0f0f0
- Sections labels : Inter 400, 11px, #666666, lowercase
- Footer : dot vert #3dffa0 + "Online" JetBrains Mono 11px #666666

### Page login
- Pas de sidebar
- Split screen : formulaire à gauche, vitrine à droite
- Logo MAGELIAN complet en haut du formulaire

### Page copilote/map
- Pas de sidebar (plein écran)
- Panel chat à gauche (redimensionnable)
- Carte MapLibre à droite (flex: 1)

### Responsive
- < 768px : sidebar en Sheet (slide from left)
- < 768px sur login : panel droit masqué

---

## 7. Règles globales (à ne jamais enfreindre)

1. **Pas de violet** (#a855f7, #a78bfa, #818cf8) — nulle part, jamais
2. **Pas d'Orbitron, pas de Michroma** — Inter + JetBrains Mono uniquement
3. **Sentence case** — "Afficher les panneaux" pas "AFFICHER LES PANNEAUX"
4. **Section headers avec bandeau** — background #111111 + dot teal + border-top
5. **Focus = teal** — tout focus ring utilise rgba(78,205,196,0.5)
6. **Bouton send = teal** — cercle #4ecdc4 avec icône #050505
7. **Statut = vert/rouge/orange** — les seules couleurs vives autorisées hors teal
8. **Borders = 0.5px** — jamais 1px sauf les séparateurs de section (1px)
9. **Inline styles → Tailwind + shadcn** — migrer progressivement
10. **Pas de glow, shadow, gradient, blur** — flat total

---

## 8. Checklist avant commit frontend

- [ ] Aucune couleur violette ajoutée
- [ ] Tous les labels en sentence case
- [ ] Section headers avec bandeau #111111 + dot teal
- [ ] Inputs ont un focus teal
- [ ] Boutons CTA sont blancs ou teal (pas d'autre couleur)
- [ ] Fonts : Inter ou JetBrains Mono uniquement
- [ ] Logique métier non modifiée
- [ ] Tous les handlers/onClick préservés
