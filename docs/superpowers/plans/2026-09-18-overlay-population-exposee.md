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
| **Synthèse** | Les paramètres du calcul (maille, date, périmètre, rayon par défaut), le total nationalyes, et les avertissements — dont « la somme des lignes ne fait pas le total » |
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

## 4. Forme : un overlay, pas une page

Règle structurelle du projet : tout passe par `/map` et ses overlays.

La population exposée est **un calcul**, donc sa place est sous **Analyse**
plutôt qu'en sixième thème du rail — les cinq thèmes forment une chaîne
mentale qu'une sixième entrée casserait.

→ *À trancher avec Vincent : outil dans le panneau Analyse, ou entrée de rail
dédiée ?*

---

## 5. Découpage du travail

### Étape 1 — La RPC d'agrégation

`population_exposee_agregee(p_maille, p_groupe, p_filtres)` :

- `p_maille` : `'carreaux'` | `'iris'`
- `p_groupe` : `'national'` | `'departement'` | `'type_risque'` | `'gravite'`
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
- Choroplèthe départementale, **inscrite au registre des dégradés**
  (`lib/carte/degrades.ts`) — sinon elle s'empile avec les huit autres
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

## 6. Questions ouvertes

1. **Outil dans Analyse, ou entrée de rail ?** (§ 4)
2. **Quel rayon par défaut pour les sites sans PPRT ?** Le panneau carte laisse
   l'utilisateur choisir ; un écran de reporting a besoin d'une valeur stable,
   sinon deux exports ne se comparent pas. Proposition : **500 m**, affiché
   dans la synthèse.
3. **Inclure les sites sans PPRT dans le total national ?** Les inclure mélange
   deux natures de chiffres ; les exclure sous-estime. Proposition : **deux
   totaux côte à côte** — réglementaire seul, et avec les indicatifs.
4. **IRIS : quelle variable de population ?** Les colonnes d'`iris` sont
   dynamiques — passer par le registre, jamais par une liste en dur.

---

## 7. Ce que cet écran ne pourra pas faire

À dire dans l'interface, pas seulement ici :

- **Pas de ventilation par zone rouge / bleue / grise** — la source ne publie
  pas le zonage interne (`docs/SEVESO_PPRT.md` § 2). On sait pourtant qu'il
  existe sur **365 des 415 plans** : l'écran peut le dire, pas le cartographier.
- **Pas de population « en danger »** au sens des études de dangers. On compte
  des habitants dans un périmètre réglementaire, ce qui n'est pas la même chose
  qu'une population exposée à un aléa d'intensité donnée.
