# Plan — Overlay « Population exposée »

> Rédigé le 2026-09-18. Toutes les valeurs chiffrées ici sont **mesurées sur la
> production**, pas estimées.

## Ce qui est demandé

Un écran dédié récapitulant la population exposée au risque industriel, avec :

- le choix de la **maille de population** : carreaux INSEE 200 m **ou** IRIS ;
- une ventilation **par type de risque** ;
- une ventilation **par département** ;
- un **export Excel**.

---

## 1. La question qui décide de tout : « et si un habitant est près de deux sites ? »

Il ne doit être compté **qu'une fois**. Additionner la population de chaque
site compte deux fois les habitants des zones qui se recouvrent.

### Ce que ça coûte, mesuré

| Cas | Somme naïve | Comptage juste | Surestimation |
|---|---|---|---|
| Les 664 **périmètres PPRT**, France entière | 173 819 | **173 669** | **+0,1 %** |
| Les 69 **Seveso des Bouches-du-Rhône**, rayon 2 km | 334 401 | **206 169** | **+62,2 %** |

**Deux régimes complètement différents**, et c'est la conclusion centrale :

- les **PPRT ne se recouvrent presque pas** — chacun couvre son bassin, et
  quand plusieurs usines partagent un bassin elles sont dans le même plan. La
  somme naïve y est acceptable, mais ce n'est **pas une raison de la coder** :
  rien ne garantit que ça reste vrai au prochain import ;
- les **rayons calculés se recouvrent massivement** : dans un département
  industriel, sommer 69 cercles de 2 km annonce **128 232 habitants qui
  n'existent pas**. Un tel chiffre dans une recommandation client est
  indéfendable.

### La méthode retenue

**Unir les zones à l'intérieur de CHAQUE carreau, puis compter une fois.**
Jamais un `ST_Union` global sur des centaines de polygones — l'union reste
locale à un carreau, où elle ne porte que deux ou trois morceaux.

```sql
with par_carreau as (
  select c.id,
         max((c.metadata->>'ind')::numeric)              as pop,
         max(ST_Area(c.geom_3857))                       as aire,
         -- L'union se fait ICI, dans le carreau : un habitant du recouvrement
         -- n'est compté qu'une fois, et on n'unit jamais 664 polygones.
         ST_Union(ST_Intersection(c.geom_3857, z.geom_3857)) as couvert
    from carreaux_filosofi c
    join <zones> z
      on c.geom_3857 && z.geom_3857 and ST_Intersects(c.geom_3857, z.geom_3857)
   group by c.id
)
select sum(pop * (ST_Area(couvert) / nullif(aire, 0))::numeric) from par_carreau;
```

Mesuré à **5 443 carreaux** concernés pour les 664 PPRT : le coût reste celui
d'un parcours d'index, pas d'une union géante.

### Trois corollaires que l'écran doit assumer

1. **La somme des départements ne fera pas le total national.** Une zone à
   cheval appartient aux deux. Il faut la **découper** par
   `ST_Intersection(zone, departement)` avant de compter, sinon le même
   habitant réapparaît dans deux lignes.
2. **La somme des types de risque ne fera pas le total non plus.** Un site
   porte plusieurs natures (`metadata.natures_risque`). Décision proposée :
   **ventiler sur la nature DOMINANTE uniquement**, celle qui colore déjà le
   point sur la carte — une seule règle dans tout le produit. Sinon l'écran
   doit afficher « un site peut apparaître dans plusieurs lignes » et le total
   n'est plus additionnable.
3. **`seveso_exposition` ne peut pas servir à cet écran.** C'est un cache PAR
   SITE ; sommer ses lignes, c'est exactement la méthode naïve. Il faut une
   seconde RPC. Ne pas céder à la tentation de réutiliser le cache existant.

---

## 2. Maille de population : carreaux ou IRIS

| | Carreaux 200 m | IRIS |
|---|---|---|
| Table | `carreaux_filosofi` (2,3 M) | `iris` (49 448) |
| Maille | 0,04 km² | ~2 000 habitants, surface très variable |
| Face à un PPRT (0,94 km² en moyenne) | ~23 carreaux — découpage fin | souvent **1 seul IRIS, bien plus grand que la zone** |
| Prorata de surface | hypothèse raisonnable | **fragile** — un IRIS rural fait des dizaines de km² |
| Couverture | carreaux **habités** seulement | tout le territoire |
| Apporte en plus | — | âge, revenus, logement (colonnes dynamiques) |

**L'IRIS n'est pas un raffinement du carreau, c'est un autre compromis.** Les
deux mailles donneront deux nombres différents pour la même question, et c'est
normal. → La maille retenue s'affiche **à côté du chiffre**, jamais reléguée
dans un réglage qu'on oublie, et elle part dans l'export.

---

## 3. L'export Excel

`exceljs` est déjà une dépendance du projet (lecture d'imports) ; l'écriture
utilise la même bibliothèque, rien à installer.

**Un classeur, trois feuilles** — parce qu'un export à une seule feuille oblige
le lecteur à refaire les totaux à la main :

| Feuille | Contenu |
|---|---|
| **Synthèse** | Les paramètres du calcul (maille, date, périmètre, rayon par défaut), le total national, et les avertissements — dont « la somme des lignes ne fait pas le total » |
| **Par département** | 101 lignes : population exposée, nombre de sites, dont sites sans PPRT, part indicative |
| **Par site** | Le détail : nom, commune, gravité, nature dominante, mode (`pprt` / `buffer`), population, **`indicatif` en colonne** |

Deux exigences non négociables sur le fichier :

- **`indicatif` est une COLONNE, pas une note de bas de page.** Un tableur se
  trie, se filtre et se recopie ; une note disparaît au premier copier-coller.
- **La feuille Synthèse porte la date et la source de chaque chiffre.** Un
  export sans millésime ressort six mois plus tard comme s'il était d'hier.

Format : `.xlsx` (pas CSV — on a besoin de plusieurs feuilles et d'un minimum
de mise en forme pour que les en-têtes restent lisibles).

---

## 4. Forme : un overlay ouvert depuis « Zones à risque »

Règle structurelle du projet : tout passe par `/map` et ses overlays.

**Tranché le 2026-09-18 :** pas de nouvelle entrée de rail, pas de déplacement
vers Analyse. L'écran reste rattaché à la section **« Zones à risque
industriel »** du panneau Calques, ouvert par un bouton pleine largeur :

```
  ╭────────────────────────────────────────╮
  │  ▣  Analyser la population à risque  →  │
  ╰────────────────────────────────────────╯
```

Il ouvre l'overlay **avec les filtres déjà cochés dans le panneau** (gravités,
types de risque, paliers). On ne redemande pas ce à quoi l'utilisateur vient de
répondre deux centimètres plus haut.

---

## 5. Découpage du travail

### Étape 1 — La RPC d'agrégation

`population_exposee_agregee(p_maille, p_groupe, p_filtres)` :

- `p_maille` : `'carreaux'` | `'iris'`
- `p_groupe` : `'region'` | `'departement'` (défaut) | `'code_postal'` | `'type_risque'` | `'gravite'` | `'national'`
- `p_filtres` : gravités, types de risque, mode, rayon par défaut

Union **dans chaque carreau**, découpe par département avant comptage. Retour
`jsonb` — jamais `RETURNS TABLE` : 101 départements passent, mais le jour où
quelqu'un groupe par commune, PostgREST tronque à 5 000 **sans rien dire**.

**À mesurer avant d'écrire la suite :** l'agrégat national en mode buffer sur
les 1 326 Seveso. Le test sur un seul département a déjà croisé plusieurs
milliers de carreaux ; si ça dépasse quelques secondes, l'agrégat devient un
pré-calcul et non un appel interactif.

### Étape 2 — Le cache d'agrégats

`exposition_agregats` (maille, groupe, clé, population, n_sites, n_indicatifs,
surface_km2, calculé_le). Rafraîchi **par lots**, jamais à la volée sur les
96 427 sites — c'est la famille de l'incident du 28/03.

### Étape 3 — Les routes

- `GET /api/risques/exposition/agregats?maille=&groupe=&…` — lit le cache
- `GET /api/risques/exposition/export?…` — rend le `.xlsx`

### Étape 4 — L'overlay

- Sélecteur de maille **visible en permanence**
- Tableau trié par population décroissante, avec la part du total
- Mini-carte de France à côté du tableau — voir § 9. Elle n'entre **PAS** au
  registre des dégradés : elle vit sur son propre canvas dans l'overlay
- Bandeau d'honnêteté : *« 4 des 12 sites de ce département n'ont pas de
  périmètre publié — leur part repose sur un rayon choisi »*
- Bouton d'export

### Étape 5 — Vérification

- **Rejouer la mesure du § 1** : l'écart naïf/juste doit être nul par
  construction, puisque la RPC ne somme jamais
- Comparer carreaux et IRIS sur dix zones : 20-30 % d'écart attendu, un
  facteur 3 signale une erreur
- Vérifier que la somme des départements **diffère** du national, et que
  l'écart correspond aux zones à cheval — si elle tombe juste, c'est qu'on a
  oublié de découper
- `EXPLAIN ANALYZE` sur l'agrégat le plus lourd

---

## 6. Arbitrages rendus (2026-09-18)

**Emplacement — tranché.** L'overlay reste rattaché à « Zones à risque
industriel » dans le panneau Calques, ouvert par un bouton **« Analyser la
population à risque »** placé sous les deux cartes de zone. Il hérite des
filtres déjà cochés dans le panneau : on ne redemande pas ce qui est répondu.

**Zones à cheval — tranché : on DÉCOUPE.** Une zone qui chevauche deux
départements est coupée par `ST_Intersection(zone, departement)` avant le
comptage, et chaque moitié compte dans son département. Conséquence à écrire
DANS l'écran, pas seulement ici : **un site peut apparaître dans deux lignes**,
et la somme des lignes dépasse alors le total national. L'alternative
— attribuer la zone entière à son département dominant — ferait des lignes
fausses là où le découpage ne fait que des lignes qui ne s'additionnent pas.

**Dimension — tranché.** Elle se choisit DANS l'overlay (région / département /
code postal), **défaut : département**. Pas de hiérarchie imposée, pas de
fil d'Ariane obligatoire : le média planner sait ce qu'il cherche.

**Cibles — tranché : uniquement celles qui se calculent.** Voir § 8.

**Reste ouvert :** le rayon par défaut pour les sites sans PPRT dans un export
(il faut une valeur stable, sinon deux exports ne se comparent pas —
proposition : 500 m, affiché dans la synthèse).

---

## 8. Les cibles — uniquement celles qui se calculent

Mesuré le 2026-09-18 : `carreaux_filosofi.metadata` porte **26 champs, tous
renseignés à 100 %**. Trois sont des identifiants (`idcar_1km`, `idcar_nat`,
`lcog_geo`) et ne sont pas des cibles. Restent **23 champs numériques, tous des
SOMMES** — donc tous proratables par la surface.

| Famille | Cibles |
|---|---|
| Population | totale (`ind`) |
| Âge | 0-3, 4-5, 6-10, 11-17, 18-24, 25-39, 40-54, 55-64, 65-79, 80+ |
| Ménages | total, pauvres, monoparentaux, 1 personne, 5 pers. et +, propriétaires, en maison, en collectif |
| Logement | sociaux, avant 1945, 1945-70, 1970-90, après 1990 |

### La règle qui rend tout ça juste

**Une cible est un EFFECTIF, jamais un taux.** On peut prendre 30 % des
habitants d'un carreau ; on ne peut pas prendre 30 % d'un revenu médian.

Les taux restent disponibles, mais **comme colonnes dérivées, calculées APRÈS
agrégation** — jamais proratées :

- part de ménages pauvres = `Σ men_pauv / Σ men`
- revenu moyen = `Σ ind_snv / Σ ind`

C'est la distinction que `classe_iris` (sql/138) porte déjà pour la cascade
IRIS : effectif / densité / proportion. **On la réutilise, on n'en invente pas
une seconde.**

### Corollaire pour la maille IRIS

Les colonnes d'`iris` sont **dynamiques**, et certaines sont des proportions
(`part_*`, `taux_*`, `rev_*`). Le menu des cibles doit donc être construit
depuis le registre, filtré sur `classe_iris(...) = 'effectif'`. Proposer une
cible non proratable serait proposer un chiffre faux.

---

## 9. La mini-carte

Une carte de France **à côté du tableau**, qui réagit aux mêmes filtres : deux
représentations d'une seule donnée, jamais deux calculs.

### ⚠ Le piège cartographique, et la proposition

Colorer un polygone par un **effectif brut** est l'erreur classique de la
choroplèthe : un grand département paraît plus intense simplement parce qu'il
est grand. La couleur doit porter une grandeur **comparable entre unités**.

Trois encodages possibles, et ils ne disent pas la même chose :

| Encodage | Ce qu'on lit | Défaut |
|---|---|---|
| Population exposée (effectif) | « combien de gens » | Fausse la lecture : la surface domine |
| Densité (hab/km² de zone exposée) | « à quel point c'est dense là où ça touche » | Un site isolé en ville sort en tête |
| **Part de la population exposée (%)** | **« quelle fraction des habitants d'ici vit en zone à risque »** | Demande la population totale de l'unité |

**Proposition : la part (%).** C'est la seule grandeur qui se compare entre un
code postal parisien et un code postal rural, et c'est la phrase que le média
planner veut pouvoir dire : *« 12 % des habitants de ce CP vivent en zone à
risque industriel »*. L'effectif brut reste dans le tableau, à côté.

→ *À confirmer avec Vincent : il a demandé « la densité, plus c'est rouge plus
il y a de monde ». Densité et volume sont deux choses différentes, et la part
est encore une troisième. Ne pas trancher à sa place.*

### Contraintes techniques

- **6 187 polygones au palier code postal.** Trop pour une mini-carte servie
  brute. Géométrie **simplifiée**, et avec `ST_SimplifyPreserveTopology`, pas
  `ST_Simplify` : la leçon de sql/178 vaut ici aussi — à une tolérance dérivée
  de l'étendue France, `ST_Simplify` a **vidé 602 polygones PPRT sur 664**. Un
  code postal parisien est du même ordre de grandeur.
- **Ne montrer que les unités qui ont de l'exposition.** Les autres restent au
  gris `--donnee-absente` — pas à la teinte la plus faible de l'échelle, qui se
  lirait « peu exposé » là où il n'y a rien.
- **Cette carte n'entre PAS au registre des dégradés** (`lib/carte/degrades.ts`).
  Ce registre gouverne l'exclusivité des choroplèthes de la carte principale ;
  la mini-carte vit dans l'overlay, sur son propre canvas, et ne peut pas
  s'empiler avec elles. L'y inscrire éteindrait le calque que l'utilisateur
  regardait derrière.
- Palette : l'échelle **séquentielle** existante (`palette-sequentielle.ts`),
  pas une nouvelle. Une seule direction, du faible au fort.

---

## 7. Ce que cet écran ne pourra pas faire

À dire dans l'interface, pas seulement ici :

- **Pas de ventilation par zone rouge / bleue / grise** — la source ne publie
  pas le zonage interne (`docs/SEVESO_PPRT.md` § 2). On sait pourtant qu'il
  existe sur **365 des 415 plans** : l'écran peut le dire, pas le cartographier.
- **Pas de population « en danger »** au sens des études de dangers. On compte
  des habitants dans un périmètre réglementaire, ce qui n'est pas la même chose
  qu'une population exposée à un aléa d'intensité donnée.
