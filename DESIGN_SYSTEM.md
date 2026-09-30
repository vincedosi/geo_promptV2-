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

> **Ce tableau décrit `app/globals.css`, il ne le précède pas.** Tout jeton
> listé ici est défini dans `:root` ET dans `html.light`, et
> `tests/unit/design/jetons-css.test.ts` fait échouer la suite si l'un des deux
> dérive — dans les deux sens : un `var(--x)` employé par le code sans jeton en
> face, ou un jeton documenté ici sans définition en CSS.
>
> Ce test existe parce que le second sens a menti deux fois. Jusqu'au
> 2026-09-16, ce document présentait `--elevated` et `--overlay` comme des
> jetons du système alors que le CSS ne les a **jamais** portés : neuf
> `background: var(--elevated)` écrits de bonne foi rendaient un fond
> **transparent**, sans erreur console, sans rien de rouge. Un `var()` inconnu
> n'échoue pas — la déclaration est simplement ignorée.

> **Côté Angular** (`angular/src/styles/jetons.css`, copie verrouillée par
> `tests/unit/angular/jetons-paritaires.test.ts`), les mêmes jetons sont
> aussi déclarés sur `:host` et `:host(.light)` : l'interface Angular vit dans
> des racines d'ombre (isolation CSS du lot AIDA), et c'est sur leur élément
> hôte que `var(--x)` doit les trouver. Mêmes noms, mêmes valeurs.

### ⚠ Deux familles de jetons, à ne pas confondre

`app/globals.css` porte **deux** jeux de variables, et ils ne s'emploient pas
de la même façon :

| Famille | Exemples | Valeur en CSS | Emploi |
|---|---|---|---|
| Jetons MAGELIAN (ce document) | `--surface`, `--text-primary`, `--brand-teal` | une **couleur** (`#0a0a0a`, `rgba(…)`) | `background: var(--surface)` |
| Jetons shadcn/ui | `--background`, `--card`, `--popover`, `--muted`, `--border`, `--ring` | un **triplet HSL sans fonction** (`0 0% 4%`) | `hsl(var(--card))`, ou via les classes Tailwind `bg-card` / `text-foreground` |

**`background: var(--card)` ne produit pas un fond sombre, il ne produit
rien** : `0 0% 4%` n'est pas une couleur valide. Six occurrences de ce défaut
ont été corrigées le 2026-09-16. Pour une surface, le jeton MAGELIAN
`--surface` porte exactement le rôle que ce document appelait `--card` ; le nom
était déjà pris par shadcn, d'où le doublon.

### Surfaces (du plus sombre au plus clair, en thème sombre)
Quatre paliers numérotés, plus trois alias **nommés par le rôle**. Les deux
écritures désignent la même couleur : préférer l'alias de rôle dans du code
neuf, il dit ce que l'élément EST.

| Token | Hex (dark) | Hex (light) | Usage |
|-------|-----------|-------------|-------|
| --bg-level-0 (alias --bg-primary) | #050505 | #ffffff | Fond de page principal |
| --bg-level-1 (alias **--surface**, --bg-surface) | #0a0a0a | #f5f5f5 | Panels, sidebar, cards |
| --bg-level-2 (alias **--elevated**) | #111111 | #eeeeee | Éléments surélevés, bandeaux de section |
| --bg-level-3 (alias **--overlay**, --bg-hover) | #181818 | #e2e2e2 | Fond de badge, hover, muted |
| --card-overlay | rgba(10,10,10,0.92) | rgba(248,248,248,0.90) | Panneau **flottant sur la carte** (légendes, cartes de contexte) — translucide à dessein |

### Borders
| Token | Hex (dark) | Hex (light) | Usage |
|-------|-----------|-------------|-------|
| --border-subtle | #1a1a1a | #e5e5e5 | Séparateurs par défaut, borders de cards |
| --border-default | #262626 | #d0d0d0 | Inputs, boutons outline |
| --border-hover | #333333 | #b8b8b8 | Hover state, focus ring |

### Texte
| Token | Hex (dark) | Hex (light) | Usage |
|-------|-----------|-------------|-------|
| --text-primary | #f0f0f0 | #1a1a1a | Titres, texte principal, labels actifs |
| --text-secondary | #b0b0b0 | #555555 | Corps de texte, labels inactifs |
| --text-tertiary | #8a8a8a | #8a8a8a | Hints, placeholders, métadonnées |

> Les valeurs de `--text-secondary` et `--text-tertiary` ont été **éclaircies**
> en thème sombre (de `#a0a0a0` / `#666666` aux valeurs ci-dessus) pour le
> contraste. Ce document annonçait encore les anciennes le 2026-09-16 : un
> composant qui aurait retapé `#666666` en dur aurait donc été *moins* lisible
> que le reste de l'interface tout en se croyant conforme.

### Accent de marque
| Token | Hex (dark) | Hex (light) | Usage |
|-------|-----------|-------------|-------|
| --brand-teal | #4ecdc4 | #4ecdc4 | Accent MAGELIAN : tabs actifs, boutons send, dots de section, liens, focus |
| --brand-teal-hover | #3dbdb5 | #3dbdb5 | Hover du teal |
| --brand-teal-10 | rgba(78,205,196,0.1) | rgba(78,205,196,0.1) | Fond d'un élément teal (tag, pastille) |
| --brand-teal-30 | rgba(78,205,196,0.3) | rgba(78,205,196,0.3) | Borders hover subtiles, badges |
| --brand-teal-50 | rgba(78,205,196,0.5) | rgba(78,205,196,0.5) | Focus ring des inputs |
| --brand-teal-fg | #050505 | #050505 | Texte/icône POSÉ SUR un aplat teal — **invariant**, comme le teal lui-même |
| --logo-accent | #2aa9a8 | #2aa9a8 | Accents du logotype (vert du fichier `magelian-icon.svg`, plus sombre que le teal de marque) — **invariant** |
| --logo-lettre | var(--text-primary) | #0d1316 | Lettres du logotype : #0D1316 du fichier en clair ; en sombre la couleur du texte, le fichier noir y étant invisible |

Le teal ne bascule pas avec le thème : c'est l'accent de marque, pas une
surface. `--brand-teal-fg` est invariant pour la même raison — le dériver de
`--bg-level-0` le ferait passer au blanc sur un aplat teal clair, illisible.

### Statut (seules couleurs sémantiques autorisées)
| Token | Hex (dark) | Hex (light) | Usage |
|-------|-----------|-------------|-------|
| --success | #3dffa0 | #0fa958 | Statut système OK, dot "Online" |
| --danger | #ff5757 | #d4202f | Erreurs, alertes destructives |
| --warning | #f7b731 | #c08400 | Avertissements, billing |
| --info | #5b9bd5 | #3a78c0 | Liens informatifs (usage rare) |

Les quatre sont **assombris** en thème clair : le vert fluo et le rouge vif du
thème sombre sont illisibles sur blanc.

### Donnée absente, et les deux jetons de carte
| Token | Hex (dark) | Hex (light) | Usage |
|-------|-----------|-------------|-------|
| --donnee-absente | #9aa0a6 | #9aa0a6 | Gris NEUTRE d'une valeur absente — jamais une teinte de l'échelle en cours, qui ferait lire « faible » là où il n'y a rien |
| --contour-carte | rgba(255,255,255,0.16) | rgba(0,0,0,0.22) | Contour des polygones MapLibre — **inversé** entre thèmes |
| --halo-carte | rgba(0,0,0,0.75) | rgba(255,255,255,0.85) | Halo des étiquettes MapLibre — inversé lui aussi |

### Échelle divergente (écart au plan média)
Seule échelle divergente du projet — toutes les autres sont séquentielles. Encode
l'écart en % entre la pression livrée et la pression planifiée d'une campagne :
sous-pression d'un côté, conformité au centre, sur-pression de l'autre. Valeurs
dans `app/globals.css` (`:root` et `html.light`) et dupliquées en hex littéraux
dans `lib/campagne/palette-divergente.ts` (`RAMPE_MAPLIBRE`) — MapLibre ne résout
pas `var()` dans `paint`, d'où les deux copies, verrouillées ensemble par
`tests/unit/campagne/palette-divergente.test.ts`.

Les bornes sont `BORNES_DIVERGENTES = [-50, -25, -10, 10, 25, 50]`, six bornes
donc **sept** tranches, et `trancheDivergente()` en est la seule marche.
L'intervalle porté par chaque jeton est écrit ci-dessous **tel que la fonction
le calcule** — jusqu'au 2026-09-16 ce tableau annonçait « forte » à ±25 %, soit
la frontière de `sous-2`/`sur-2`, la bande *intermédiaire* : un code postal à
+30 % était décrit « sur-pression forte » par ce document et peint
« sur-pression » par la carte.

| Token | Hex (dark) | Hex (light) | Écart au plan | Usage |
|-------|-----------|-------------|---------------|-------|
| --diverge-sous-3 | #c2410c | #9a2f08 | < −50 % | Sous-pression forte — « moins de la moitié » |
| --diverge-sous-2 | #ea7c4a | #cc5f27 | −50 % à −25 % | Sous-pression |
| --diverge-sous-1 | #f0b48c | #e8a878 | −25 % à −10 % | Légèrement sous |
| --diverge-neutre | #4a4a4a | #c6d2cf | −10 % à +10 % | Conforme au plan |
| --diverge-sur-1 | #8fb8d8 | #7ba7cc | +10 % à +25 % | Légèrement au-dessus |
| --diverge-sur-2 | #4a86b8 | #2f6fa3 | +25 % à +50 % | Sur-pression |
| --diverge-sur-3 | #1f5c8f | #14496f | ≥ +50 % | Sur-pression forte — « plus de 50 % au-dessus » |

Chaque borne appartient à la tranche du HAUT (`ecart >= borne` fait monter
d'un cran) : −50 % exactement est donc `sous-2`, pas `sous-3`. Les libellés de
la colonne Usage sont ceux de `LIBELLES_TRANCHES`, dans le même ordre.

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

### Échelle qualitative (natures de risque — courbes du rayon d'influence)

Ni divergente ni séquentielle : **qualitative**. Les natures de risque ne
s'ordonnent pas — il n'y a ni plus ni moins entre « Explosibles » et
« Déchets » — donc il faut des teintes distinctes, pas les paliers d'une rampe.
Huit courbes au plus, une par nature présente.

| Token | Hex (dark) | Hex (light) |
|-------|-----------|-------------|
| --nature-1 | #e07a3f | #b85c22 |
| --nature-2 | #3d8bb5 | #2a6d92 |
| --nature-3 | #4aa06b | #2f7d4d |
| --nature-4 | #c2554e | #9e3b35 |
| --nature-5 | #6d8fa8 | #4d6d85 |
| --nature-6 | #b58b34 | #8c6a1c |
| --nature-7 | #4f7d7a | #35605d |
| --nature-8 | #a06c8c | #7e4e6c |

Alternance chaud/froid et non un dégradé rouge-vert : c'est ce qui les garde
distinguables en niveaux de gris ET pour un daltonisme deutan. Assombries en
thème clair, comme les quatre `--risque-*` et les quatre couleurs de statut.

**La courbe TOTALE ne prend aucune de ces huit** : elle porte `--brand-teal`, et
elle seule — c'est ce qui la distingue au premier coup d'œil d'une nature parmi
d'autres. Elle n'est d'ailleurs pas la somme des autres (un carreau proche de
deux natures compte dans les deux), et l'écran le dit.

> **Pas de duplication en TypeScript ici**, contrairement aux échelles
> divergente et séquentielle : celles-là alimentent MapLibre, qui ne résout pas
> `var()` dans `paint`. Ces courbes-ci sont servies par Recharts, **qui le
> résout**. Une seule définition suffit donc, dans `app/globals.css`.
>
> Ces huit teintes étaient écrites EN DUR dans `OngletRayonInfluence.tsx`
> jusqu'au 2026-09-19, sans variante de thème clair et hors de tout test — dans
> un fichier qui prouvait pourtant trois lignes plus bas que `var()` y marche.

### Niveau réglementaire d'un site à risque

⚠ **À ne pas confondre avec les quatre `--risque-*`**, qui sont juste au-dessus
dans `globals.css` et répondent à une autre question. Les `--risque-*` disent
**de quoi** il s'agit (toxique, inflammable, pollution) ; ceux-ci disent **à
quel seuil** le site est classé. Deux questions, deux palettes — les mélanger
ferait lire « inflammable » là où l'écran veut dire « seuil haut ».

| Token | Hex (dark) | Hex (light) | Usage |
|-------|-----------|-------------|-------|
| --niveau-haut | #e0603f | #b8431f | Seveso seuil haut — zones, bandes, légende |
| --niveau-bas | #d99a1f | #a8720a | Seveso seuil bas |
| --niveau-autres | #7a8b9c | #5a6b7c | Autres régimes, non calculés à ce jour |

**Chaud contre ambre, et non rouge contre vert.** Le seuil bas n'est pas « sans
danger », c'est un seuil plus bas : un couple rouge/vert le dirait faux, en plus
d'être illisible pour un daltonisme deutan. Le gris bleuté des autres régimes
les sort de l'échelle de gravité plutôt que de les y placer en bas.

L'intensité à l'intérieur d'un niveau ne passe PAS par la teinte mais par
**l'opacité**, dégressive du cœur vers l'extérieur (0,45 · 0,28 · 0,16 · 0,08).
C'est ce qui permet de lire la distance et le niveau d'un seul coup d'œil : la
teinte dit lequel, l'opacité dit combien on s'en éloigne.

### Contour du point de site à risque

| Token | Valeur (dark) | Valeur (light) | Usage |
|-------|---------------|----------------|-------|
| `CONTOUR_POINT` (`lib/carte/palette-risques.ts`) | rgba(255,255,255,0.9) | rgba(26,26,26,0.85) | Cerne du point ICPE sur la carte |

**Inversé** entre thèmes, comme `--contour-carte` et `--halo-carte`. Il valait
`rgba(255,255,255,0.9)` en dur : sur fond clair, un cerne blanc ne détoure plus
rien et le point perd ce qui le rend lisible au-dessus d'une zone colorée.

Opacité 0,9 et non 0,16 comme `--contour-carte` : celui-ci sépare deux
polygones voisins, celui-là détache un point de ce qu'il recouvre. Deux besoins
différents, pas deux réglages du même.

⚠ Valeurs littérales et non `var()` : c'est MapLibre qui les consomme.

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
- Line-height : 1.4 pour les labels, 1.6 pour le corps de texte — ⚠ **le line-height effectif est 1,5**, tel que React le rend via le préflight de Tailwind (`app/globals.css` n'en pose aucun) et qu'Angular l'aligne ; le 1,6 de ce document n'est rendu par aucune des deux applications

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
