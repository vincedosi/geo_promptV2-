# Écran unifié « Population à risque industriel » — audit avant refonte

> Phase 0 du brief `docs/PROMPT.md`. Écrit le 2026-09-20.
> **Aucune ligne de code applicatif n'a été modifiée pour produire ce document.**
> Tous les chiffres cités sont mesurés sur le stack local, jamais estimés.

---

## Deux corrections au brief, avant tout le reste

Le brief porte deux consignes que `CLAUDE.md` contredit. `CLAUDE.md` prime, et
les ignorer aurait des conséquences réelles — ce n'est pas un point de forme.

**1. « Migrations via le MCP Supabase ».** Le MCP Supabase parle au projet
hébergé `vkkdbygwbrxyogqosten`, **en cours d'abandon depuis le 2026-09-19**. Il
n'y a plus de production en ligne, plus de déploiement Vercel actif, et la clé
`service_role` de ce projet reste à révoquer. La voie normale est `psql` dans le
conteneur `supabase_db_genesis_app`. Une migration passée par le MCP irait dans
une base que personne ne lit, et laisserait le local — le seul environnement
réel — sans elle.

**2. « compute Nano ».** Le compute mesuré est **Micro** (`shared_buffers`
256 Mo, `effective_cache_size` 768 Mo). Cela ne relâche **aucune** des règles
d'I/O : les trois incidents d'épuisement ont bien eu lieu, et le plafond qui a
lâché était peut-être le débit aléatoire. On continue de coder comme si la marge
était étroite. Ce qui change : ne plus citer « 250 IOPS / 5 MB/s » comme un fait.

Une troisième remarque, mineure : « getSession côté API, jamais getUser » est
déjà respecté par les douze routes du module (`requireAuth` / `requireAdmin`).

---

## 1. Où vit l'état, et pourquoi Territoires a une réglette locale

### Ce qui est déjà partagé

Contrairement à ce que le brief suppose, **un état unique existe déjà** et il
est **déjà sérialisé dans l'URL** : `EtatRisque` (`lib/risques/etat-url.ts`,
238 lignes). Il porte `cible`, `maille`, `chemin`, `natures`, `modes`,
`gravites`, `profil`, `onglet`, `jeu`, `atelier`. La lecture ne lève jamais —
l'URL vient de l'extérieur — et les valeurs par défaut ne s'écrivent pas, pour
qu'un lien partagé reste lisible.

La barre de contrôle est **déjà commune** aux trois onglets, et le filtre par
nature de risque y a été branché sur les trois le 2026-09-20 même (sql/218-220).

### Ce qui ne l'est pas

Trois `useState` locaux d'`AnalysePopulationOverlay.tsx` échappent à cet état :

| État local | Ligne | Ce qu'il pilote |
|---|---|---|
| `rayon` / `rayonSaisi` | 287, 357 | **Un rayon unique en mètres**, propre à Territoires |
| `forcerRayon` | 343 | Impose le cercle même aux sites qui ont un PPRT |
| `mailleChoisie` | 283 | La maille de Territoires |

C'est `rayonSaisi` qui produit le bloc « Propre à Territoires » (ligne 1155) et
la contradiction que le brief signale.

### La cause n'est PAS un oubli de câblage

C'est le point le plus important de cet audit, et il change le plan.

**Les deux écrans tournent sur deux moteurs différents, et celui de Territoires
ne PEUT PAS honorer le rayon du profil.**

| | Rayons / Zones | Territoires |
|---|---|---|
| RPC | `population_par_classe` (sql/204) | `population_exposee_agregee` (sql/185) |
| Source | `carreau_risque_distance`, **pré-calculée** | `carreaux_filosofi` (2,3 M) **croisée en direct** |
| Géométrie au calcul | aucune | `ST_Buffer` + intersection par carreau |
| Coût national | 2,8 s | 3 s à 88 s selon le nombre de sites |
| **Rayon maximal national** | **aucun** | **1 179 m** |

Mesure directe du 2026-09-20, `population_exposee_agregee` sur la France
entière, Seveso haut + bas, rayon 5 000 m demandé :

    {"error": "zone_trop_vaste", "km2": 98882, "max_km2": 5500,
     "n_sites": 1259, "rayon_m": 5000, "calculable": false, "rayon_max_m": 1179}

Le garde-fou de surface (sql/192) existe pour une bonne raison : le coût suit
les carreaux intersectés, et « 20 km autour de chaque site » partait pour
plusieurs minutes — la famille exacte de l'incident du 28/03. Il n'est pas
question de le desserrer.

**Conséquence : synchroniser les deux réglettes ne suffirait pas.** Poser 5 km
sur Territoires lui ferait rendre un refus, pas un chiffre. La seule sortie est
de mettre Territoires sur le **même moteur** que le tableau des bandes.

### Les chiffres de la contradiction, mesurés

| Écran | Profil affiché | Total |
|---|---|---|
| Territoires, réglette locale à 500 m | « Haut 5 km / Bas 5 km » | **390 112** |
| Tableau des bandes, profil réel | idem | **24 406 618** |

Le brief cite 217 946 et 24 406 618 ; le premier dépend des filtres actifs au
moment de la capture, le second est reproduit à l'identique. L'écart de deux
ordres de grandeur, lui, est structurel.

---

## 2. D'où viennent les chiffres de la courbe, et peut-on la rendre exclusive

### D'où elle vient aujourd'hui

`/api/risques/exposition/rayon` lit `couverture_rayon_risque` (sql/198), une
table pré-agrégée au grain **(département × gravité × nature × palier de
100 m)**, avec les 24 cibles en jsonb. Elle ne calcule rien : d'où une réponse
en millisecondes là où `/agregats` paie des secondes.

### Pourquoi elle contredit le tableau

Elle sert une distribution **marginale**. Chaque courbe est exacte isolément, et
leur somme ne veut rien dire : un carreau proche d'un seuil haut *et* d'un seuil
bas compte dans les deux. Les lignes `gravite='*'` viennent du **minimum par
carreau** et non de l'addition des autres — ce qui est correct, et invisible.

Le tableau des bandes, lui, applique l'affectation **exclusive** :
`classe_carreau_risque` (sql/204) donne à chaque carreau **un** niveau et **une**
bande, seuil haut primant sur seuil bas, puis PPRT, puis anneau.

Les deux répondent à deux questions différentes. La note de bas de page le dit ;
le brief a raison de vouloir supprimer la dualité plutôt que la documenter.

### Oui, on peut — par un histogramme 2D, et sans recalcul lourd

`carreau_risque_distance` porte `d_haut_m` **et** `d_bas_m` **sur la même
ligne** : c'est exactement ce qu'il faut. Une courbe exclusive au rayon *r* se
définit alors par simple sommation :

- `haut(r)` = population des carreaux où `d_haut <= r`
- `bas(r)` exclusif = population des carreaux où `d_bas <= r` **et** `d_haut > r`

Les deux dépendent de *r* des deux côtés, donc on pré-agrège en **deux**
dimensions : une population par `(bucket(d_haut), bucket(d_bas))` de 100 m.
N'importe quel rayon se lit ensuite par une somme sur ce tableau.

**Mesure du 2026-09-20 :**

| | Valeur |
|---|---|
| Cellules, France entière | **10 011** |
| Cellules avec le département en clé (permet de filtrer un territoire) | **198 752** |
| Construction complète (jointure aux carreaux, lecture de `metadata->>'ind'`) | **4,6 s** |
| Source dont elle dérive | 883 451 lignes |

198 752 lignes contre 883 451 : la table est **quatre fois plus petite que sa
source**, se construit en une passe de 4,6 s, et se lit ensuite sans aucune
géométrie. C'est le même patron que `couverture_rayon_risque`, avec une
dimension de plus et la propriété qui manquait : **l'additivité**.

Deux points à ne pas perdre en chemin :

- **Le PPRT n'est pas une distance.** `pprt_niveau` doit entrer dans la clé de
  l'histogramme, sans quoi la classe « Périmètre PPRT » ne serait pas séparable
  et `inclurePPRT` n'aurait plus d'effet sur la courbe.
- **Les natures restent marginales.** La bascule secondaire demandée par le
  brief continue de lire `couverture_rayon_risque`, avec sa note. C'est
  cohérent : une nature n'est pas un niveau, elle ne s'ordonne pas, et il n'y a
  pas d'affectation exclusive à en tirer.

---

## 3. Les jeux de zones : ce qui existe et se réutilise tel quel

Tout le chantier « jeu de zones » est livré (2026-09-20) et **rien n'est à
refaire**. Le panneau ④ du brief décrit très exactement ce qui tourne.

| Objet | État |
|---|---|
| `zone_sets` | table, avec `poids` par classe, `mode_plan`, `seuil_couverture_cp`, `brouillon` |
| `zone_set_geoms` | géométrie figée des classes, **copiée** du cache et non référencée |
| `zone_set_cp` | codes postaux, classe dominante, `part_en_zone`, `retenu` |
| `construire_zone_set` | enveloppe + gardes ; 21,3 s pour 7 classes et 1 942 CP |
| `appliquer_seuil_zone_set` | rejoue le seuil **sans reconstruire** : 22 à 65 ms |
| `purger_brouillons_zone_set` | ménage des brouillons d'atelier |
| `GET/POST /api/zones/jeux` | liste et création |
| `GET/PATCH/DELETE /api/zones/jeux/[id]` | détail, réglage, suppression |
| `GET /api/zones/jeux/[id]/export` | classeur Excel 5 feuilles, **dont « Sites et rayons »** |
| `POST /api/zones/jeux/[id]/rattacher` | donne le jeu comme plan à une campagne |
| `components/risques/OngletZones.tsx` | 840 lignes, l'atelier complet |
| `components/risques/use-jeux-zones.ts` | liste, création, suppression |

Le brief demande en ④ « Exports : Excel (classes, CP retenus, poids) et fichier
points + rayons » : **les deux existent déjà, dans le même classeur**, et le
classeur porte un onglet « Méthode et limites » qui dit pourquoi les deux
feuilles ne doivent **pas** être poussées ensemble (on diffuserait deux fois sur
le même territoire).

Le curseur de rétention à 20 % existe, et son effet est mesuré : seuil 20 % →
1 113 CP et 75,9 % d'utile ; seuil 35 % → 939 CP et 88,4 %.

**Ce qui manque au regard du brief :** le multiplicateur d'enchère est déjà
éditable (`poids`, 0 à 5), mais la **duplication** d'un jeu n'existe pas.

---

## 4. Comment les tuiles et la couche des sites sont branchées

Le câblage est récent (2026-09-20) et sain. Il est **réutilisable tel quel** ;
c'est la meilleure nouvelle de cet audit pour la phase 3.

    CarteZones.tsx
      POST /api/risques/zones/preparer  -> construire_zones_risque (idempotent,
                                           1 326 ms, 7 classes, France entière)
      source MVT /api/tiles/zones-risque/{z}/{x}/{y}?profil=...&natures=...
                                        -> zones_risque_tuile (sql/205), gzip
      GET /api/map/risques-industriels?bbox=&gravites=&natures= -> GeoJSON sites

- **La clé de cache est composée par une seule fonction**, `codeZonesRisque`
  (`lib/risques/code-profil.ts`), appelée par les trois consommateurs — le
  composant, la route de préparation, la route de tuiles. C'est ce qui empêche
  la couche de demander des tuiles sous une clé que rien n'a construite.
- **Les sites n'ont pas de tuile et n'en ont pas besoin** : on en affiche
  quelques centaines à la fois, jamais les 99 152. Le brief demande en z < 7 des
  points proportionnels à la population couverte par site — **cette donnée
  n'existe pas par site** à l'échelle nationale (`seveso_exposition` est un cache
  alimenté à la demande, site par site ; le pré-calculer pour les 96 427 sites
  serait l'incident du 28/03 rejoué). À trancher en phase 3.
- `ZONES_RISQUE_ZOOM_PLANCHER` : sous ce zoom MapLibre ne demande **aucune**
  tuile et n'émet aucune erreur — c'est ce qui a rendu la couche IRIS muette
  pendant des mois. Déclaré une seule fois, dans `lib/version.ts`.
- **MapLibre ne résout pas `var()` dans `paint`.** `addLayer` lève, la couche
  n'est jamais ajoutée, et les compteurs voisins continuent d'afficher des
  chiffres justes pour des points absents. D'où le couple `COULEUR_NIVEAU` (hex,
  pour MapLibre) / `COULEUR_NIVEAU_CSS` (jetons, pour le DOM) dans
  `lib/carte/palette-risques.ts`.

---

## 5. Plan de fichiers, migrations, code à supprimer

### Migrations (local, `psql` dans le conteneur)

| | Objet | Pourquoi |
|---|---|---|
| sql/221 | `population_par_classe` gagne les mailles **`region`** et **`code_postal`** | C'est ce qui permet à Territoires de quitter son moteur. `code_postal` est déjà une colonne de `carreau_risque_distance` ; `region` se joint par `ref_departements` (101 lignes, 2,2 ms) |
| sql/222 | `carreau_risque_histo` + sa construction + `lire_courbe_exclusive()` | L'histogramme 2D de la question 2. 198 752 lignes, construction 4,6 s |
| sql/223 | `dupliquer_zone_set(uuid, text)` | Le seul manque du panneau ④ |

Aucune ne touche un fichier protégé, aucune ne scanne `carreaux_filosofi` à la
lecture, et seule sql/222 la lit — une fois, à la construction.

### Fichiers

| Action | Fichier |
|---|---|
| Créer | `lib/risques/etape.ts` — les quatre étapes, leurs libellés, leur ordre |
| Créer | `components/risques/FilArianeRisque.tsx` |
| Créer | `components/risques/CarteRisque.tsx` — **une** instance MapLibre, jamais démontée |
| Créer | `components/risques/PanneauSites.tsx` (①) |
| Créer | `components/risques/PanneauRayon.tsx` (②) |
| Créer | `components/risques/use-courbe-exclusive.ts` |
| Modifier | `lib/risques/etat-url.ts` — `etape` remplace `onglet`, `region`/`cp` s'ajoutent aux mailles |
| Modifier | `components/risques/AnalysePopulationOverlay.tsx` — **1 606 → ~400 lignes** |
| Modifier | `components/risques/TableauBandes.tsx` — sert ③ |
| Réutiliser tel quel | `OngletZones.tsx` (④), `use-jeux-zones.ts`, `CarteZones.tsx` (fondu dans `CarteRisque`) |

### Code à supprimer

- Le bloc « Propre à Territoires » (`AnalysePopulationOverlay.tsx:1155-1290`) et
  les trois `useState` qu'il pilote.
- `components/risques/OngletRayons.tsx` (196 l.) et
  `components/risques/OngletRayonInfluence.tsx` (396 l.), absorbés par ②.
- `components/risques/CarteMiniFrance.tsx` (488 l.) — une carte permanente rend
  la mini-carte sans objet.
- `components/risques/BoutonVoirCarte.tsx` (108 l.) — même raison.

### Ce qui NE doit PAS être supprimé, et il faut le dire

- ⚠ **Correction apportée pendant la phase 1.** Ce paragraphe affirmait que
  `/api/risques/exposition/agregats` devait rester « parce que
  `/api/risques/exposition/export` l'appelle aussi ». **C'est faux**, et la
  vérification est immédiate : un `grep` sur tout le dépôt montre que ces
  **deux** routes n'ont qu'un seul appelant chacune, le bloc Territoires
  d'`AnalysePopulationOverlay.tsx` que cette refonte remplace. L'export qui
  compte vraiment est `/api/risques/profil/export`, appelé par
  `BoutonExportProfil.tsx`, et il est **déjà** bâti sur le profil — il porte
  même un onglet « Territoires ».

  Les deux routes deviennent donc orphelines. Elles ne sont **pas** supprimées
  dans la phase qui les orpheline : `population_exposee_agregee` reste le seul
  chemin qui sache imposer un cercle à TOUS les sites (`forcer_rayon`), et les
  retirer dans le même geste que la bascule mélangerait deux décisions. La
  suppression revient à la phase 5, avec la preuve de `npm run catalogue`, comme
  le brief le prévoit.
- **`couverture_rayon_risque` et `/api/risques/exposition/rayon` restent** :
  c'est la bascule « par nature » du panneau ②, que le brief conserve.
- **Les mesures de `lib/risques/methode.ts` restent** : l'outre-mer non
  calculable, la colonne « sites » qui ne s'additionne pas, l'absence de
  dénominateur au code postal. Le brief demande explicitement de les garder.

### Ordre d'exécution

1. **sql/221** puis bascule de Territoires sur `population_par_classe`. *C'est
   la phase qui supprime la contradiction* — elle vaut d'être faite en premier,
   avant toute refonte visuelle.
2. **sql/222** et la courbe exclusive du panneau ②.
3. Fil d'Ariane, carte permanente, découpe du monolithe.
4. sql/223, finitions, suppression du code mort, `npm run catalogue`.

---

## ⚠ Défaut trouvé en chemin, hors périmètre de ce brief

**L'attribution d'un carreau à « son » code postal n'est pas déterministe, et
deux fonctions du projet qui l'écrivent à l'identique ne s'accordent pas.**

La règle est « un carreau, un code postal : celui dont le centroïde est le plus
proche parmi les contours qui le contiennent » (sql/206 pour
`carreau_risque_distance.code_postal`, sql/207 pour `cp_population_totale`).
Les deux implémentations sont littéralement les mêmes.

Ce n'est pas un ordre total. Mesuré le 2026-09-20 :

- **71 groupes de contours identiques, 181 codes postaux concernés** dans
  `ref_codes_postaux` — plusieurs codes couvrent exactement le même polygone
  (Dunkerque : 59140, 59240, 59430 et 59640 le partagent).
- Sur un carreau de ce secteur, les quatre contours le contiennent **à la même
  distance exacte** (0,0218). `distinct on` choisit alors arbitrairement.
- Conséquence : **81 codes postaux sur 3 933** ont, dans `cp_population_totale`,
  **moins de carreaux que `carreau_risque_distance` ne leur en attribue** —
  logiquement impossible, l'une couvrant tous les carreaux et l'autre un
  sous-ensemble. Pire écart : 295 carreaux.
- 59640 : 6 carreaux et 975 habitants au dénominateur, 72 carreaux au
  pré-calcul, 121 en recomptant à la main.

**Ce que cela touche** : `zone_set_cp.part_en_zone`, donc `retenu`, donc
`taux_utile` — le chiffre phare des jeux de zones. Sur le jeu enregistré
existant (1 942 codes postaux), **zéro ligne ne dépasse 100 %** : l'effet est
borné aujourd'hui, mais il n'est pas nul et il n'est pas reproductible.

**Pourquoi ce n'est PAS corrigé ici.** Ajouter un départage déterministe
(`order by …, r.code_postal`) rendrait les deux fonctions cohérentes en trois
lignes. Mais cela donnerait TOUS les carreaux du contour partagé au plus petit
code postal, et zéro aux trois autres — or un DSP qui cible au code postal a
besoin des quatre pour couvrir les mêmes adresses. **La bonne réponse est un
arbitrage produit**, pas un `order by`, et elle change le plan média.

En attendant, l'écran ne propose ni part ni densité au code postal — décision
prise pour d'autres raisons plus haut, et que ce défaut confirme.

---

## Ce que cet audit n'a pas tranché

- **Les points proportionnels à z < 7** (brief, phase 3) supposent une
  population couverte **par site** que rien ne calcule à l'échelle nationale.
  Trois sorties : dimensionner par un proxy déjà en base (le rayon, donc la
  surface), ne pas dimensionner, ou construire un quatrième pré-calcul. La
  première est gratuite et honnête si la légende le dit.
- **La maille `commune` sur la grande carte** : 34 921 polygones. L'écran actuel
  refuse déjà la mini-carte à cette maille et le dit, plutôt que d'afficher un
  chargement sans fin. La même règle devra valoir ici.
