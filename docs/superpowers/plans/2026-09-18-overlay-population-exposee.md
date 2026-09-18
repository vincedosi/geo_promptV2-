# Plan — Overlay « Population exposée »

> Rédigé le 2026-09-18, à la demande de Vincent, **après** les points 1 à 4 du
> chantier risque (doc + registre, build + advisors, `pprt_documents`, batch).
> Pas encore commencé.

## Ce qui est demandé

Un écran dédié qui récapitule la population exposée au risque industriel, avec :

- le **choix de la maille de population** : carreaux INSEE 200 m **ou** IRIS ;
- une ventilation **par type de risque** ;
- une ventilation **par département**.

## Forme : un overlay, pas une page

Règle structurelle du projet : tout passe par `/map` et ses overlays, le back
office reste dans Réglages. Cet écran est un outil de média planner, donc un
**overlay plein écran** ouvert depuis le rail — comme l'overlay MAGELIAN.

Une entrée du rail n'est pas gratuite : les cinq thèmes actuels forment une
chaîne mentale (« où je regarde » → « ce que je vois » → « ce que je calcule »
→ « ce que je fabrique » → « ce que j'active »). La population exposée est **un
calcul**, donc elle a sa place sous **Analyse** plutôt qu'en sixième thème.
→ *À confirmer avec Vincent : entrée de rail dédiée, ou outil dans Analyse ?*

---

## ⚠ Le piège qui décide de tout : le double comptage

Deux sites Seveso voisins ont des zones qui **se recouvrent**. Additionner leurs
populations exposées compte **deux fois les mêmes habitants**.

Sur la campagne de mesures du 2026-09-18, la somme des 664 périmètres donne
173 819 habitants — mais c'est une somme de périmètres, pas un nombre de
personnes. Dès qu'on agrège « par département » ou « par type de risque », le
chiffre affiché devient faux s'il est obtenu par addition.

**La seule méthode juste : unir les zones AVANT de compter.**

```sql
-- FAUX : compte deux fois les habitants des zones qui se recouvrent
select dept, sum(pop_exposee) from seveso_exposition ...

-- JUSTE : une seule géométrie par groupe, puis un seul comptage
select dept, population_dans(ST_Union(zone)) from ...
```

Conséquence directe : **`seveso_exposition` ne peut pas servir à cet écran.**
C'est un cache PAR SITE ; l'agrégat demande un autre calcul. Il faut une
seconde RPC, et ne pas céder à la tentation de sommer le cache existant.

Corollaire qui déroute : **la somme des départements ne fera pas le total
national**, et la somme des types de risque non plus — un site peut porter
plusieurs natures de risque. L'écran doit le dire, sinon le lecteur croira à
une erreur.

---

## Maille de population : carreaux ou IRIS

| | Carreaux 200 m | IRIS |
|---|---|---|
| Table | `carreaux_filosofi` (2,3 M) | `iris` (49 448) |
| Taille typique | 0,04 km² | ~ 2 000 habitants, surface très variable |
| Face à un PPRT (0,94 km² en moyenne) | ~ 23 carreaux — découpage fin | souvent **1 seul IRIS, bien plus grand que la zone** |
| Prorata de surface | hypothèse raisonnable | **hypothèse fragile** : un IRIS rural fait des dizaines de km² |
| Couverture | carreaux **habités** uniquement | tout le territoire |

**L'IRIS n'est pas un raffinement du carreau, c'est un autre compromis.** Il
apporte les variables socio-démo (âge, revenus, logement) que les carreaux
n'ont qu'en partie ; il coûte une imprécision forte sur les petites zones.

→ L'écran doit afficher la maille retenue **à côté du chiffre**, pas dans un
réglage qu'on oublie. Deux mailles donneront deux nombres différents pour la
même question, et c'est normal.

---

## Découpage du travail

### Étape 1 — La RPC d'agrégation (le cœur)

`population_exposee_agregee(p_maille, p_groupe, p_filtres)` :

- `p_maille` : `'carreaux'` | `'iris'`
- `p_groupe` : `'departement'` | `'type_risque'` | `'gravite'` | `'national'`
- `p_filtres` : gravités, types de risque, mode (`pprt` / `buffer` / les deux)

Elle **unit les zones par groupe** (`ST_Union`), puis compte une fois. Retour
`jsonb` — jamais `RETURNS TABLE` : 101 départements tient, mais le jour où
quelqu'un groupe par commune, PostgREST tronquerait à 5 000 sans rien dire.

**À mesurer avant d'écrire la suite** : `ST_Union` sur les zones d'un
département, puis intersection avec 2,3 M carreaux. C'est l'opération la plus
lourde de tout le chantier risque. Si elle dépasse quelques secondes, elle
devient un pré-calcul nocturne et non un appel interactif.

### Étape 2 — Le cache d'agrégats

Table `exposition_agregats` (maille, groupe, clé, population, n_sites,
surface_km2, calculé_le). Rafraîchie par lots, **jamais à la volée sur les
96 427 sites** — c'est la famille de l'incident du 28/03.

### Étape 3 — La route

`GET /api/risques/exposition/agregats?maille=&groupe=&...` — lit le cache,
`requireAuth`, `no-store`.

### Étape 4 — L'overlay

- Un sélecteur de maille (carreaux / IRIS) **visible en permanence**
- Un tableau trié par population décroissante, avec la part du total
- Une carte choroplèthe par département, sur le registre des dégradés existant
  (`lib/carte/degrades.ts`) — sinon elle s'empilera avec les huit autres
- Le drapeau `indicatif` agrégé : *« 4 des 12 sites de ce département n'ont pas
  de périmètre publié — leur part repose sur un rayon choisi »*
- Un export CSV (c'est un écran de reporting)

### Étape 5 — Vérification

- La somme des départements **ne doit pas** égaler le national (et l'écran
  doit l'expliquer) ; vérifier que l'écart correspond bien aux recouvrements
- Comparer les deux mailles sur dix zones : un écart de 20-30 % est attendu,
  un facteur 3 signale une erreur
- `EXPLAIN ANALYZE` sur l'agrégat le plus lourd

---

## Questions ouvertes

1. **Entrée de rail dédiée, ou outil dans Analyse ?** (voir plus haut)
2. **Que fait-on des sites sans périmètre dans un agrégat national ?** Les
   inclure avec leur rayon indicatif mélange deux natures de chiffres ; les
   exclure sous-estime l'exposition réelle. Ma préférence : les inclure, et
   afficher les deux totaux côte à côte (réglementaire seul / avec indicatifs).
3. **Quel rayon par défaut pour les sites sans PPRT dans cet écran ?** Le
   panneau carte laisse l'utilisateur choisir ; un écran de reporting a besoin
   d'une valeur stable, sinon deux exports ne se comparent pas.
4. **IRIS : quelle variable de population ?** `iris.population` ou une des
   colonnes socio-démo ? Les colonnes d'`iris` sont dynamiques — il faudra
   passer par le registre, jamais par une liste en dur.

---

## Ce que cet écran ne pourra pas faire

Le rappeler dans l'interface, pas seulement ici :

- **Pas de ventilation par zone rouge / bleue / grise** — la source ne publie
  pas le zonage interne (voir `docs/SEVESO_PPRT.md` § 2).
- **Pas de population « en danger »** au sens des études de dangers. On compte
  des habitants dans un périmètre réglementaire, ce qui n'est pas la même chose
  qu'une population exposée à un aléa d'intensité donnée.
