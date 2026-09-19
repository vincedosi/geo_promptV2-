# Audit et plan de refactor — « zone à risque industriel »

> Périmètre STRICT : la couche carte, les deux écrans de l'overlay, et leurs
> sept routes. Rien d'autre n'a été audité et rien d'autre ne sera touché.
>
> **Ce document ne remplace pas `ARCHITECTURE.md` à la racine**, qui reste la
> seule source de vérité du projet. `CLAUDE.md` interdit un second document
> d'architecture, et sous Windows `docs/architecture.md` et
> `docs/ARCHITECTURE.md` sont le **même fichier** : écrire l'un écrase l'autre
> en silence. D'où ce nom, et cette note.
>
> Audit du 2026-09-19. Méthode : `.claude/skills/audit-refactor`. Chaque
> constat est cité en `fichier:ligne` et a été lu dans le code.

---

## 1. Cartographie

### Le périmètre

22 fichiers, 4 585 lignes de front, 7 routes, 15 RPC.

| Couche | Fichiers | Lignes |
|---|---|---|
| Overlay d'analyse | `components/risques/AnalysePopulationOverlay.tsx` | **1 482** |
| | `components/risques/OngletRayonInfluence.tsx` | 430 |
| | `components/risques/CarteMiniFrance.tsx` | 489 |
| Carte | `app/map/_components/RisqueIndustrielLayer.tsx` | 511 |
| | `app/map/_components/PprtLayer.tsx` | 284 |
| Panneau | `app/map/_components/filter-panel/RisqueIndustrielSection.tsx` | 655 |
| | `.../filter-panel/use-risque-industriel.ts` | 100 |
| Palettes | `lib/carte/palette-risques.ts`, `palette-pprt.ts` | 294 |

Seuils du projet : **300 lignes/fichier, 50 lignes/fonction**. Trois fichiers
les dépassent, dont un d'un facteur cinq.

### Le trajet des données

Le graphe d'appel est **propre : une route = une RPC**, sans exception.

| Route | RPC | Garde | Quota |
|---|---|---|---|
| `map/risques-industriels` | `risques_industriels_carte` | `requireAuth` | **aucun** |
| `map/pprt` | `pprt_perimetres_carte` | `requireAuth` | **aucun** |
| `risques/[siteId]/exposition` | `population_exposee_site` | `requireAuth` | **aucun** |
| `risques/exposition/agregats` | `population_exposee_agregee` | `requireAuth` | 20/min |
| `risques/exposition/export` | `population_exposee_agregee` | `requireAuth` | 6/min |
| `risques/exposition/rayon` | `lire_couverture_rayon` + `compter_sites_rayon` | `requireAuth` | 30/min |
| `risques/exposition/cibles` | lecture `cibles_exposition` | `requireAuth` | aucun (catalogue, cache 24 h) |

Aucune de ces routes n'est dans `PROTECTED_API_PREFIXES` de `middleware.ts` —
la protection réelle est le `requireAuth` en tête de handler, présent partout.

**Poids côté base** : `population_exposee_agregee` fait **26 493 caractères**
de PL/pgSQL, soit 2,3 fois la deuxième plus grosse fonction du périmètre
(`construire_couverture_rayon`, 11 507). Elle est appelée par deux routes.

### Autonomie vis-à-vis du cloud

**Le périmètre est entièrement autonome en local** — aucune de ses sept routes
n'a besoin du projet Supabase hébergé :

| Table | Lignes en local |
|---|---:|
| `carreaux_filosofi` | 2 324 577 |
| `poi_france` (catégorie `risque_industriel`) | 99 152 |
| `couverture_rayon_risque` | 115 962 |
| `pprt_perimetres` / `pprt_documents` | 664 / 415 |
| `cibles_exposition` / `icpe_rubrique_familles` | 24 / 15 |

---

## 2. Baseline de comportement (référence des tests de caractérisation)

Mesurée sur la base locale le 2026-09-19. **C'est ce que le refactor doit
laisser identique.**

| RPC | Valeurs |
|---|---|
| `population_exposee_agregee('departement','ind')` | 423 893 exposés · 96 unités · 1 259 sites |
| `lire_couverture_rayon('ind')` | couverture 100 % · 120 bandes + 2 zones · 14 courbes · 42 409 940 à 10 km |
| `compter_sites_rayon(null)` | 1 259 sites · 14 natures |
| `risques_industriels_carte(Étang de Berre, r=500)` | 482 sites · 120 `pprt` · 4 `non_soumis` · 358 `non_concerne` |
| `pprt_perimetres_carte(Étang de Berre)` | 12 zones · tolérance 0,0001° |

État de l'outillage : `npm run build` vert · `npx tsc --noEmit` propre ·
`npm test` 153 fichiers / 1 451 tests verts · `npm run lint` avertissements
préexistants seulement.

⚠ **La couverture de tests n'est pas mesurable** : aucun provider installé
(`@vitest/coverage-v8` absent), aucune configuration. L'exigence « >80 % » de
`production-clean-code` ne peut donc pas être vérifiée aujourd'hui. Ajouter la
dépendance est un lot à part entière (lot 0), pas un geste réflexe.

---

## 3. Constats

Gravité : Critique / Haute / Moyenne / Basse. Effort : S / M / L.

### Haute

| ID | Où | Constat | Impact |
|---|---|---|---|
| **R-01** | `api/risques/[siteId]/exposition/route.ts` | Aucun quota, alors que les trois routes sœurs en ont un. La route **calcule** (~300 ms d'intersection sur 2,3 M carreaux) **et écrit** (`upsert seveso_exposition`). `siteId` est énumérable sur 99 152 sites. | Famille exacte de l'incident du 28/03. La doc de la route dit elle-même « ce n'est PAS un pré-calcul de masse » — rien ne l'empêche. |
| **R-02** | `api/map/risques-industriels/route.ts:50` + `sql/179:112` | Le commentaire dit « bbox absente = France entière : **réservé aux Seveso** ». Rien ne l'applique : `bbox` est `.optional()` sans garde, les 6 gravités sont acceptées, la RPC fait `p_bbox is null or …`. Pas de quota. | `?gravites=autre&limite=5000&rayon_m=20000` sans bbox = balayage national de 41 690 sites + 5 000 `ST_Buffer` de 20 km. Règle I/O contournée par un paramètre que le code accepte et que son propre commentaire interdit. |
| **R-03** | `RisqueIndustrielLayer.tsx:365,463` | Les écouteurs `click`/`mouseenter` sont posés sous `if (!getLayer(ID_POINT))`, mais `nettoyer()` supprime la couche **sans `off()`**. Chaque cycle décocher/recocher empile un écouteur. `PprtLayer.tsx:85` résout exactement ce cas avec `clicPoseRef`, et le documente. | Après N cycles, **un clic déclenche N appels** à la route non quotée de R-01. Les deux défauts se multiplient. Variante corrigée d'un côté, pas de l'autre. |
| **R-04** | `RisqueIndustrielLayer.tsx:493` vs `PprtLayer.tsx:272` | Le `return` de l'effet ne rappelle pas `nettoyer()` ; `onCompte` est capturé en closure hors dépendances. `PprtLayer` fait les deux correctement. | Sources et couches MapLibre survivent au démontage. Deux couches sœurs, deux cycles de vie : la prochaine correction ne s'appliquera qu'à une. |
| **R-05** | `OngletRayonInfluence.tsx:51` | `TEINTES = ['#e07a3f', …]` — huit hex en dur, sans variante thème clair, sans jeton CSS, sans test. Le **même fichier** prouve que `var()` fonctionne dans Recharts (l.290, 323). | Violation directe de la règle formelle du projet. Les quatre autres palettes ont toutes `dark`/`light` + test de verrouillage. |
| **R-06** | 4 fichiers | La liste des 6 niveaux réglementaires est écrite **quatre fois**, et les libellés **divergent déjà** : « Seveso haut / IED / Autre » contre « Seveso seuil haut / Directive IED / Régime déclaratif ou non précisé ». Les routes `exposition/*` n'ont **aucune liste blanche**. | Le même site est nommé de deux façons selon l'écran. Une gravité inconnue rend zéro site **sans erreur**. |
| **R-07** | `AnalysePopulationOverlay.tsx` | 1 482 lignes, corps de 1 123 lignes, 17 `useState`, 6 `useMemo`, 5 `useEffect`. Seuils : 300 et 50. Aucun test unitaire ne l'atteint. | Tout changement se fait dans un fichier que personne ne relit en entier. |
| **R-08** | `AnalysePopulationOverlay.tsx:517` et `:625` | Deux constructions d'`URLSearchParams` **identiques sur 12 lignes** (seuil : 10). | C'est la définition de « ce qui est demandé ». Un filtre ajouté d'un seul côté fait diverger le tableur de l'écran — précisément ce que l'en-tête de `export/route.ts` déclare empêcher. |

### Moyenne

| ID | Où | Constat |
|---|---|---|
| **R-09** | `export:45` vs `agregats:63` vs overlay `:72` | Trois listes blanches de `dimension` pour la même donnée (5 / 4 / 4). La maille `arrondissement` est **inatteignable** : l'écran ne la propose pas, `/agregats` la refuse en 400, `/export` l'accepte. |
| **R-10** | `export:108` vs `agregats:156` | `/agregats` filtre `modes` contre une liste blanche, `/export` passe la valeur brute. Pour `?modes=xxx`, l'un répond « les deux modes », l'autre **un classeur vide** sans message. |
| **R-11** | `AnalysePopulationOverlay.tsx:423` | `rayon ?? agregat?.rayon_m ?? 532` — le 532 en dur, alors que `sql/185` commente « jamais écrit en dur, recalculé à chaque import ». |
| **R-12** | `RisqueIndustrielLayer.tsx:360` | `circle-stroke-color: rgba(255,255,255,0.9)` non indexé par `theme`, contrairement à toutes les autres peintures de la couche. En thème clair, le point perd son détourage. |
| **R-13** | `RisqueIndustrielSection.tsx:33` vs `:138` | L'en-tête affirme que les motifs viennent de `TIRETE_ZONE_CALCULEE` ; la légende écrit `1px dashed` en dur. La constante ne sert que dans une phrase. |
| **R-14** | `RisqueIndustrielSection.tsx:498` | « 99 152 installations classées » en dur sans date, alors qu'`ARCHITECTURE.md` mesure **96 427** en production le 18/09. Le bloc voisin date ses chiffres, lui. |
| **R-15** | `AnalysePopulationOverlay.tsx:238` vs `:591` | `niveaux` initialisé une seule fois depuis la prop ; `natures` relu à chaque rendu. `setNiveaux` ne remonte jamais au panneau. |
| **R-16** | overlay `:591` et layer `:228` | Même règle métier (type → libellés de nature) écrite deux fois, avec le même commentaire recopié. |
| **R-17** | 3 + 2 routes | `liste()` copiée à l'identique dans trois routes ; `bboxValide()` dans deux. Un durcissement ne s'appliquerait qu'à une copie. |
| **R-18** | overlay `:1371` et onglet `:397` | Composant `Kpi` dupliqué sur 15 lignes. |
| **R-19** | 6 occurrences | `toFixed(1).replace('.', ',')` alors que `CLAUDE.md` désigne `lib/format/nombre.ts` comme source unique (« il y en avait quinze avant le 11/09 »). Dont une **côté serveur**. |
| **R-20** | overlay `:70` vs panneau `:73` | Deux listes de rayons pour le même réglage — le palier 300 m n'existe que dans l'une. |
| **R-21** | `agregats:199,222` | Deux `as unknown as {…}` pour relire des champs que l'interface `Agregat` du même fichier ne déclare pas. Le contrat de la RPC est décrit à trois endroits, aucun complet. |
| **R-22** | `RisqueIndustrielLayer.tsx:270` | Deux `JSON.stringify` par feature à chaque `moveend`, jusqu'à 5 000 features — 10 000 sérialisations sur le thread principal par panoramique, pour des données ré-analysées au clic. |
| **R-23** | `export/route.ts:87` | Handler de 147 lignes mêlant validation, RPC, mise en forme **et 20 lignes de texte méthodologique en dur** — texte qui existe déjà, autrement formulé, dans l'overlay. |

### Basse

| ID | Où | Constat |
|---|---|---|
| **R-24** | 3 composants + `tokens.ts` | `fInter`/`fMono` redéclarés et **divergents** : le repli `Fira Mono` du design system saute sur tout l'écran d'analyse. |
| **R-25** | `export/route.ts:222` | `await wb.xlsx.writeBuffer()` hors `try/catch`, contrairement au reste de la route. |
| **R-26** | `AnalysePopulationOverlay.tsx:513` | `exporter` défini avant les valeurs qu'il capture. Correct aujourd'hui, couplage temporel implicite. |
| **R-27** | `AnalysePopulationOverlay.tsx:558` | Cast `dimension as 'region' \| 'departement'` dont l'invariant est porté par une garde à distance. |
| **R-28** | `CarteMiniFrance.tsx:183,253,331` | Trois balayages complets des géométries par recalcul. Sans conséquence mesurée aujourd'hui. |

### À vérifier (non prouvé depuis le code seul)

1. **R-03 à l'exécution** : le raisonnement repose sur le fait que
   `removeLayer()` ne retire pas les écouteurs délégués — comportement
   documenté de MapLibre et raison d'être explicite de `clicPoseRef` dans
   `PprtLayer`, mais non reproduit. Test : décocher/recocher trois fois, puis
   cliquer un site et compter les appels réseau.
2. **Gravité inconnue côté `exposition/*`** : absence de liste blanche
   constatée ; reste à savoir si la RPC lève ou rend un résultat vide. Si
   c'est un vide, l'écran affiche « aucune population exposée » pour une faute
   de frappe.
3. **Charge réelle de R-02** : extrapolée depuis un payload documenté. Un
   `EXPLAIN ANALYZE` **en local** trancherait.
4. **R-20 / `rayon_max_m`** : `OngletRayonInfluence` initialise `rayon = 1000`
   et ne le reclampe pas quand `rayon_max_m` arrive. Aucun périmètre connu
   avec `rayon_max_m < 1000`.

---

## 4. Ce qu'il ne faut PAS casser

Ce périmètre a une densité inhabituelle de garde-fous **mesurés**, chacun
documenté avec le chiffre et la date qui l'a motivé. Plusieurs sont la seule
trace d'un piège qui a déjà coûté.

**Invariants de véracité — le cœur du module.**
- La distinction `pprt` / `buffer` et le drapeau `indicatif`, portés de bout en
  bout du SQL jusqu'à l'onglet Excel. Aplatir ce booléen ferait passer un
  cercle de 532 m pour une servitude d'État.
- La convention de tracé (`lib/carte/nature-zone.ts`) : plein = réglementaire,
  tireté = calculé. Elle a été **inversée pendant un mois**.
- « La colonne sites ne s'additionne pas », répété à quatre endroits.
- `--donnee-absente` ≠ valeur faible ; DROM : donnée absente ≠ exposition nulle.

**Garde-fous de coût.** Plafonds venant de la BASE et non recopiés côté client
(`rayon_max_m`) · quotas partagés avec le différentiel 20/6/30 justifié ·
`Promise.all` de deux appels avec le budget de 3 cité · plancher de zoom PPRT
avec remontée d'état.

**Qualité React/carto.** `useMemo` sur `perim` (sans lui, le calcul de 4 s
tournait en boucle) · débounce 450 ms corrigeant un 429 observé · jeton
anti-course · `idExpo` unique par popup · `adminFetch` et non `fetch` ·
projection Mercator en radians (une carte aplatie à 5 px) · séparation
métropole/outre-mer par la **géographie** et non le code INSEE · échappement
HTML systématique des popups.

**Documentation intégrée.** `ProvenanceDesZones` et l'onglet « Méthode et
limites » du classeur. Le second **voyage avec le fichier hors de
l'application** : si un refactor déplace l'export côté client, cet onglet doit
partir avec.

---

## 5. Plan de refactor

Ordre imposé par la skill : filet de sécurité → quick wins → dédoublonnage →
découplage → performance. Chaque lot est indépendant et révocable seul.

### Lot 0 — filet de sécurité (obligatoire, aucun code de prod touché)

Tests de caractérisation figeant la baseline du §2 : les cinq RPC, puis un
test de contrat par route (forme du payload, codes d'erreur, présence des
gardes). Décision à prendre : installer `@vitest/coverage-v8` pour rendre la
couverture mesurable — **c'est une dépendance ajoutée, donc un choix explicite**.

Commit : `test: tests de caractérisation avant refactor`.

### Lot 1 — dédoublonnage à comportement constant

R-17 (`liste()`, `bboxValide()` → module partagé) · R-08 (une seule fabrique
d'`URLSearchParams`) · R-18 (`Kpi` partagé) · R-19 (`lib/format/nombre.ts`) ·
R-24 (jetons de police) · R-16 (type → libellés) · R-06 partiel (la liste des
gravités devient une source unique, **sans toucher aux libellés divergents**,
qui sont un choix produit).

Risque : faible. Vérification : baseline identique, tests verts.

### Lot 2 — découplage

R-07 : découper `AnalysePopulationOverlay.tsx` en sous-composants (fil
d'Ariane, barre de filtres, KPI, tableau, notes de méthode) sans toucher à la
logique. R-23 : sortir le texte méthodologique de la route vers un module
partagé avec l'overlay — ce qui règle aussi la double rédaction.

Risque : moyen (beaucoup de lignes déplacées). Vérification : baseline + revue
visuelle de l'écran.

### Lot 3 — design system

R-05 (palette de courbes → jetons CSS + test de verrouillage, avec variante
thème clair) · R-12 (cerne indexé par `theme`) · R-13 (légende alignée sur le
tracé réel).

⚠ **Changement observable assumé** : en thème clair, les couleurs changent
— c'est le but. À valider visuellement.

### Lot 4 — corrections de défauts (change le comportement, à valider)

R-03 (écouteurs empilés) · R-04 (cycle de vie de la couche). Ce ne sont pas des
refactors : ce sont des corrections. Le nombre d'appels réseau passe de N à 1.

### Lot 5 — performance

R-22 (sérialisations par `moveend`) · R-28 (balayages de `CarteMiniFrance`).

Risque : faible. Vérification : baseline identique + mesure avant/après.

---

## 6. Hors périmètre — à arbitrer par un humain

La skill l'impose : **une correction qui bloque un accès aujourd'hui autorisé
est un changement de comportement**, pas un refactor. Ces points ne seront
pas touchés sans accord explicite.

| ID | Ce qu'il faudrait décider |
|---|---|
| **R-01** | Ajouter un quota à `/api/risques/[siteId]/exposition` **bride un usage aujourd'hui libre**. Recommandation : le faire, 30/min, par symétrie avec `rayon`. |
| **R-02** | Appliquer la règle que le commentaire annonce (bbox absente ⇒ Seveso seuls) **refuse des requêtes aujourd'hui acceptées**. Recommandation : le faire, et ajouter un quota. |
| **R-06** | Les libellés divergents (« Seveso haut » vs « Seveso seuil haut ») : lequel fait foi ? Choix produit. |
| **R-09** | La maille `arrondissement` est inatteignable. L'exposer (nouvelle fonctionnalité) ou retirer l'entrée morte ? |
| **R-11** | Le repli 532 doit-il disparaître (afficher « — » avant la réponse) ou rester ? |
| **R-14** | 99 152 ou 96 427 sites ? Un des deux chiffres est faux — à mesurer avant de l'écrire. |
| **R-15** / **R-20** | Les filtres de l'overlay doivent-ils remonter au panneau, et les paliers de rayon être les mêmes des deux côtés ? Choix produit. |
