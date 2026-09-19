# Population exposée autour d'un site à risque — plan

> Date : 2026-09-17 · Statut : **plan à valider, rien n'est codé**
> Demande de Vincent : « c'est moi qui choisis le type de population, via les
> IRIS ou les carreaux ».
> Amont : chantiers A (points ICPE) et B (zone de danger) livrés — la zone
> métrique existe déjà (`risques_industriels_carte`, sql/175).

## 1. Ce que la demande change par rapport à ce que j'avais commencé

J'étais parti sur « la population », un seul nombre, depuis les carreaux. La
demande est autre : **deux choix appartiennent à l'utilisateur**, la SOURCE
(IRIS ou carreaux) et la VARIABLE. Ce n'est pas un réglage de plus, ça change
le cœur du calcul — parce que toutes les variables ne s'agrègent pas de la même
façon.

## 2. Ce que chaque source peut offrir — mesuré en base

| | Carreaux INSEE | IRIS |
|---|---|---|
| Mailles | 374 511 à 1 km (palier complet) | 49 448 |
| Palier 200 m | **2 298 582 lignes, dont 200 000 chargées** — import de test interrompu, inexploitable en l'état | — |
| Variables numériques | **26** | **43** |
| Nature des variables | population par tranche d'âge, ménages, logements (dont sociaux), revenu médian, surface moyenne | + CSP (cadres, employés, ouvriers), diplômes, chômage, pauvreté, part de population étrangère, indice de Gini, mobilité domicile-travail |
| Taille d'une maille | régulière, 1 km² | **très irrégulière** : un IRIS rural peut être une commune entière |

**L'arbitrage est là, et il est net** : les carreaux donnent la précision
géométrique, les IRIS donnent la richesse des variables. Sur un rayon de 500 m,
un IRIS rural peut être cent fois plus grand que la zone — le chiffre serait
une extrapolation, pas une mesure.

## 3. Le piège principal : trois familles de variables, trois règles

`classe_iris()` existe déjà en base (sql/138) et classe chaque colonne d'après
son NOM. Mesuré sur les 43 colonnes d'`iris` :

| Classe | Combien | Exemples | Règle d'agrégation |
|---|---|---|---|
| `effectif` | **16** | `population`, `pop_0_14`, `nb_menages`, `nb_csp_ouvrier`, `nb_diplome_sup` | **somme** au prorata de la surface |
| `proportion` | **26** | `taux_chomage`, `taux_pauvrete`, `part_logements_sociaux`, `rev_median`, `indice_gini` | **moyenne pondérée par la population** |
| `densite` | 1 | `densite_pop` | **recalculée** depuis les sommes |

Additionner un `taux_chomage` sur quatre IRIS donnerait 34 %. Le moyenner sans
pondérer par la population donnerait le même poids à un IRIS de 80 habitants
qu'à un IRIS de 4 000. **La règle doit venir de `classe_iris()`, jamais d'un
choix au cas par cas.**

### Conséquence sur la formulation du résultat
Ce ne sont pas deux façons de dire la même chose :

- variable **effectif** → « **12 400 habitants** vivent dans la zone », « dont
  **2 100 enfants** de moins de 18 ans »
- variable **proportion** → « la zone compte **23 % de locataires** », « un taux
  de chômage de **14 %** »

L'interface doit donc adapter sa phrase à la classe de la variable. Un « 23 »
présenté comme un effectif serait un mensonge silencieux.

### Un défaut à corriger au passage
`centroid_lat` et `centroid_lng` d'`iris` sont classées **`proportion`** par
`classe_iris()` (vérifié). Elles apparaîtraient donc dans la liste des
variables choisissables et seraient « moyennées » comme un indicateur. Elles
doivent être écartées explicitement, avec les autres colonnes techniques.

## 4. Méthode de croisement

Identique dans les deux sources, et elle réutilise la zone DÉJÀ calculée :

1. le cercle est construit sur `geography` — mètres vrais (`ST_Buffer`, déjà
   fait par sql/175 ; **une seule définition du cercle**, celle qu'on affiche) ;
2. transformé UNE fois dans la projection de la source :
   - carreaux → **3857** (`geom_3857`, index GIST) ;
   - IRIS → **4326** (`geom`) ou `geom_3857` selon l'index disponible, à
     vérifier avant de coder ;
3. intersection, puis répartition **au prorata de la surface** :
   `part = aire(intersection) / aire(maille)`.

Le ratio est calculé dans la projection de travail : la distorsion y est
identique pour l'intersection et pour la maille à une même latitude, donc le
ratio reste juste même si les surfaces absolues ne le sont pas.

**L'hypothèse, à écrire dans l'interface** : la population est supposée
uniforme à l'intérieur de la maille. Fausse au détail, raisonnable en agrégat —
et d'autant plus fausse que la maille est grande, donc bien plus sur IRIS que
sur les carreaux.

### Option à trancher pour les IRIS
Le prorata de surface sur un IRIS rural géant est très approximatif. Deux
alternatives, à choisir :
- **prorata de surface** (cohérent avec les carreaux, extrapolation assumée) ;
- **tout ou rien sur le centroïde** : on retient l'IRIS si son centroïde tombe
  dans la zone. Plus honnête sur le principe (« cet IRIS est concerné »), mais
  rend un profil de quartier, pas une population exposée.

Ma recommandation : **prorata de surface**, avec un indicateur de fiabilité qui
dit quand la zone est plus petite que la maille — même règle que pour les
carreaux, donc un seul modèle mental.

## 5. Ce qu'il faut construire

| # | Quoi | Où |
|---|---|---|
| 1 | Catalogue des variables choisissables, par source, avec leur classe | RPC `variables_population_exposee()` — lue depuis `information_schema` + `classe_iris()`, **jamais une liste en dur** (règle du projet) |
| 2 | Le calcul | RPC `population_exposee_site(lon, lat, rayon_m, source, variable)` — rend la valeur, la classe, le palier, le nombre de mailles et la fiabilité |
| 3 | La route | `GET /api/map/risques-industriels/population` (site + rayon + source + variable) |
| 4 | Le choix dans l'UI | deux sélecteurs dans la section « Zones à risque industriel » : source (carreaux / IRIS) puis variable (liste dépendante de la source) |
| 5 | L'affichage | dans la popup du site, **phrase adaptée à la classe** de la variable |
| 6 | Tests | la règle d'agrégation par classe (table de vérité), le refus des colonnes techniques, l'invariance du ratio, et un contrôle contre une somme SQL écrite à part |

## 6. Bornes d'I/O — non négociables

- **Un site à la fois, au clic.** Un `&&` sur index GIST puis une intersection
  sur quelques mailles : indolore.
- **Le calcul pour les 1 327 Seveso d'un coup est un AUTRE objet** : traitement
  par lots, résultat **stocké**, avec progression — la règle des imports. Une
  intersection live sur 1 327 sites × 374 511 mailles serait l'incident du
  28/03 en pire. À ne faire que si tu veux un classement des sites par
  population exposée.
- **Le palier et la variable doivent être STOCKÉS avec tout résultat persisté.**
  Sans ça, deux calculs à six mois d'écart donneront deux nombres différents
  sans qu'on sache lequel croire.

## 7. Ce que je te demande de trancher

1. **La source par défaut** : carreaux (précision géométrique) ou IRIS
   (richesse des variables) ? Ma recommandation : **carreaux au 1 km par
   défaut**, IRIS en second choix explicite, parce qu'une zone de 500 m sur un
   IRIS rural n'a pas de sens.
2. **La variable par défaut** : `population_totale` côté carreaux ? Et
   proposes-tu une liste courte (population, enfants, seniors, ménages,
   logements sociaux) ou les 43 variables IRIS en entier ?
3. **Les IRIS : prorata de surface ou tout-ou-rien sur le centroïde ?**
4. **Le classement des sites par population exposée** — tu le veux ? C'est lui
   qui impose le traitement par lots et le stockage.
5. **Le palier 200 m** : faut-il finir le rapatriement des 2,1 M carreaux
   manquants ? C'est ce qui rendrait un rayon de 300-500 m réellement mesurable
   au lieu d'un ordre de grandeur.

## 8. Ce qui est déjà écrit et attend cette validation

`sql/176_population_exposee_site.sql` existe sur le disque : il fait le calcul
décrit au §4, mais **sur les carreaux uniquement et sur la population totale**
— donc sans les deux choix que tu demandes. Il n'est **pas appliqué en base ni
commité**. Selon tes réponses, il devient la base du point 2 du §5 ou il est
réécrit.
