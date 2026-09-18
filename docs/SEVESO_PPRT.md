# Risque industriel et population exposée

> État au **2026-09-18**. Toutes les valeurs de ce document sont des mesures,
> avec la date à laquelle elles ont été prises. Un taux de couverture sans date
> ne veut rien dire : ces référentiels bougent.

Ce document répond à une seule question, celle qu'un média planner posera en
réunion client : **d'où vient ce chiffre, et qu'est-ce qu'il vaut ?**

---

## 1. Les trois jeux de données

| Jeu | Table | Volume | Source | Nature |
|---|---|---|---|---|
| Installations classées | `poi_france` (`categorie = 'risque_industriel'`) | 96 427 en prod · 99 152 en local | API Géorisques `installations_classees` | référentiel **vivant** |
| Périmètres PPRT | `pprt_perimetres` | 664 assiettes · 609 générateurs | Géoplateforme IGN, WFS `wfs_sup:assiette_sup_s` filtre `suptype='pm3'` | servitudes **opposables** |
| Population exposée | `seveso_exposition` | à la demande | calcul PostGIS sur `carreaux_filosofi` | **dérivé** |

**Prod et local ne portent pas exactement le même nombre d'ICPE** (96 427 vs
99 152). Ce n'est pas une perte : la pagination de l'API Géorisques n'est pas
stable, deux imports successifs rendent des ensembles qui diffèrent d'environ
5 %. Chacune des deux bases a un instantané valide du même référentiel.

---

## 2. Ce que l'État définit, et ce qu'il publie

L'État **ne publie aucun « rayon de risque » par site**. Il produit une
cascade, et une seule de ses marches est exploitable en géométrie nationale :

| Niveau | Défini par | Publié en vecteur national ? |
|---|---|---|
| **Zones d'effets** (seuils SEI / SEL / SELS) | Étude de dangers — [arrêté du 29/09/2005](https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000021247739/), [arrêté du 22/10/2004](https://aida.ineris.fr/reglementation/arrete-221004-relatif-valeurs-reference-seuils-deffets-phenomenes-accidentels) | ❌ jamais |
| **Aléa PPRT** (TF+, TF, F+, F, M+, M, Fai) | Croisement intensité × probabilité × cinétique | ❌ épars, un jeu par DDT |
| **Zonage réglementaire** (G, R, r, B, b) | Arrêté préfectoral | ❌ WMS seulement (image) |
| **Enveloppe / périmètre** | Servitude PM3 | ✅ **oui — c'est ce qu'on utilise** |

### Pourquoi le zonage rouge/bleu/gris n'est pas là

Vérifié piste par piste le 2026-09-18, et il faut le savoir avant de le
rechercher une deuxième fois :

- la couche Géorisques `PPRT_ZONE_RISQIND` existe **en WMS seulement** — absente
  du WFS (`TYPENAME doesn't exist`), donc affichable mais pas calculable ;
- la page de téléchargement national de Géorisques répond **403**, pour un
  navigateur automatisé comme pour un humain ;
- le motif d'URL historique `files.georisques.fr/ppr/pprx_<dept>.zip` est
  **mort** — 404 sur toutes ses variantes ;
- le jeu national de data.gouv (BRGM) n'a **qu'une ressource WMS**, dont le nom
  interne est `SUPGPU` : elle dérive de la **même source GPU** que nos 664
  périmètres ;
- les WFS des DREAL sur GeoIDE publient `PM3_ASSIETTE_SUP_S`, c'est-à-dire
  **l'enveloppe qu'on a déjà** ;
- le nom normalisé CNIG `N_ZONE_REG_PPRT` ne rend **aucun résultat** sur
  data.gouv.

Le jour où cette donnée devient accessible, elle s'ajoute comme des **paliers
supplémentaires** dans `seveso_exposition`, sans rien changer au modèle.

---

## 3. Qui a un périmètre, et qui n'en a pas

**Le PPRT ne s'applique qu'au Seveso seuil haut.** Ce n'est pas une lacune de
données, c'est le droit. Mesures du 2026-09-18 sur la base locale (1 327 Seveso) :

| | Seuil haut (717) | Seuil bas (610) |
|---|---|---|
| Périmètre PPRT à moins de 500 m | **567 — 79 %** | 120 — 20 % |
| À plus de 2 km de tout PPRT | 117 — 16 % | **435 — 71 %** |

D'où les quatre statuts que la base calcule (`statut_zone`, sql/179) et que
l'interface affiche **sans les confondre** :

| Statut | Sens |
|---|---|
| `pprt` | périmètre réglementaire présent |
| `sans_pprt` | seuil haut **sans** plan publié — une donnée qui **manque** (137 sites) |
| `non_soumis` | seuil bas — une zone qui **n'existe pas en droit** |
| `non_concerne` | installation non Seveso |

Réunir `sans_pprt` et `non_soumis` sous un « aucune zone » unique ferait passer
une règle de droit pour un oubli d'import. C'est pour cela qu'ils sont séparés.

---

## 4. Comment la population est calculée

**RPC : `population_exposee_site(p_site_id)` (sql/180).**

### Deux modes

| Mode | Zone | `indicatif` |
|---|---|---|
| `pprt` | la **servitude publiée par l'État** | `false` |
| `buffer` | rayons **500 / 1 000 / 2 000 m choisis par nous** | **`true`** |

Le basculement suit exactement la règle de `risques_industriels_carte`
(sql/179) : périmètre le plus proche **à 500 m**, et non inclusion stricte. Les
coordonnées AIOT de Géorisques pointent parfois l'entrée du site ou le
centroïde communal ; l'inclusion stricte perdait **71 Seveso seuil haut** dont
le PPRT est à 200 m (496 → 567 sur 717). Une seule définition du rattachement,
pas une pour la carte et une pour le calcul.

### La méthode

Population répartie au **prorata de surface** : un carreau INSEE de 200 m dont
30 % tombe dans la zone contribue 30 % de ses habitants. C'est l'hypothèse
d'une population uniforme à l'intérieur du carreau — fausse au détail,
raisonnable en agrégat, et la seule possible sans palier plus fin.

### Les pièges, pour qui reprendra ce code

- **Le buffer est construit sur `geography`**, pas en 3857. À la latitude de
  Marseille, un mètre de 3857 vaut environ 0,73 m réel : un rayon « 500 m »
  construit en 3857 en couvrirait 685. C'est exactement le cercle affiché à
  l'écran — une seule définition, pas une pour la carte et une pour le calcul.
- **L'intersection, elle, se fait en 3857**, parce que c'est là que vit l'index
  GIST (`idx_carreaux_filosofi_geom_3857`). La zone est transformée **une
  fois**, au lieu de reprojeter 2,3 M de carreaux.
- **La population est dans `metadata->>'ind'`**. La colonne `ind` existe mais
  est **NULL sur les 2 298 582 lignes** : la lire rendrait **zéro partout, sans
  la moindre erreur**.
- **`carreaux_filosofi` ne couvre que les carreaux HABITÉS.** Un périmètre sans
  carreau n'est pas une donnée manquante, c'est une zone sans habitant —
  250 des 664 périmètres sont dans ce cas (emprises industrielles, portuaires).
- **La couronne se déduit des cumuls DÉJÀ ARRONDIS.** Sinon la somme des
  couronnes ne retombe pas sur le cumul : mesuré avant correctif,
  2 + 29 + 2 096 = 2 127 pour un cumul affiché à 2 126. Un tableau qui ne
  s'additionne pas fait douter le lecteur, pas le logiciel.

---

## 5. Les chiffres

Mesurés en production le 2026-09-18, sur les 664 périmètres :

- **173 819 habitants** vivent dans un périmètre PPRT
- **414** périmètres sur 664 ont au moins un habitant
- moyenne **262** habitants par périmètre

| Périmètre | Département | Habitants | Densité |
|---|---|---|---|
| Petit et Grand Quevilly (zone industrielle et portuaire) | Seine-Maritime | 36 084 | 1 318 hab/km² |
| Vallée de la Chimie | Rhône | 20 396 | 919 hab/km² |
| PPRT Fos-Est | Bouches-du-Rhône | 8 918 | 379 hab/km² |

### Coût

| Opération | Mesure |
|---|---|
| Un périmètre (Berre, 10,75 km²) | 299 ms · `shared hit=1367 read=242` · Index Scan |
| Les 664 périmètres d'un coup | 5 656 carreaux croisés |
| Route, premier appel (calcul) | 449 ms |
| Route, appels suivants (cache) | 103 ms |

**Le cache est alimenté à la demande, jamais en masse.** Pré-calculer les
96 427 sites coûterait autant d'intersections sur une table de 2,3 M lignes —
la famille exacte de l'incident du 28/03 (`CLAUDE.md`, « Incidents »).

---

## 5 bis. Les référentiels qui mentent — trouvé à l'audit du 18/09

Ce module a subi **deux audits**. Ils ont donné **cinq défauts, tous de la même
famille : une colonne qui existe et ment.** Aucun ne levait d'erreur, aucun ne
se voyait à la relecture — chacun rendait un chiffre plausible ou un écran vide.

| Colonne | Ce qu'elle promet | Ce qu'elle vaut |
|---|---|---|
| `carreaux_filosofi.ind` | la population du carreau | **NULL sur 2 298 582 lignes** |
| `carreaux_filosofi.geom_centroid` | le centroïde | **NULL sur 2 298 582 lignes** |
| `ref_codes_postaux.pop_total` | la population du CP | **110,5 %** de la France réelle |
| `ref_codes_postaux.surface_km2` | la surface du CP | **109,3 %** du territoire |
| `carreaux_cp_population.pop_total` | idem | le même 110,5 % — c'en est la source |

Les deux derniers surcomptent pour la **même raison que le calcul lui-même
devait éviter** : un carreau à cheval sur deux codes postaux est compté dans
les deux. Le double comptage était dans le dénominateur.

Et 169 codes postaux sur 6 187 ont `pop_total` à NULL, dont la **totalité** de
ceux de Paris, La Réunion, la Guadeloupe, la Martinique et la Guyane — comme
`sum()` ignore les NULL, ces départements recevaient un dénominateur amputé
sans que rien ne le signale.

### Ce sur quoi on s'appuie désormais

**`iris_agg_departement`** : 67 760 552 habitants, soit **100,0 % du chiffre
INSEE**, et 638 019 km² (+0,8 %).

**Au palier code postal, aucune source fiable n'existe** : part et densité y
sont rendues nulles, et l'écran bascule sur l'effectif en le disant.

### Le filet qui empêche la rechute

Deux suites de tests, parce que les deux familles de régression ne se voient
pas au même endroit :

- `tests/unit/risques/exposition-sql.test.ts` — **12 verrous structurels**, sans
  base. Ils lisent le SQL et refusent qu'on relise `ind`, `geom_centroid` ou le
  dénominateur de La Poste. Vérifié : chacun **attrape** le bug historique
  correspondant quand on le rejoue sur l'ancienne migration.
- `tests/integration/exposition-invariants.test.ts` — **12 invariants sur la
  base** : somme des lignes = total, région = département, aucun carreau perdu,
  aucune part > 100 %, dédoublonnage des natures de zone, un périmètre ne peut
  que réduire, une cible inconnue est refusée. Plus une sentinelle : **si `ind`
  se remplit un jour, le test rougit** — ce n'est pas un bug, c'est une
  invitation à simplifier.

---

## 6. Limites à dire au client

1. **Pas de découpage rouge/bleu/gris.** On donne la population du périmètre
   entier, pas celle de la zone d'interdiction stricte. La source ne le publie
   pas (§ 2).
2. **Les Seveso seuil bas n'ont presque jamais de périmètre** — 20 % seulement.
   Pour eux, le chiffre repose sur un rayon que nous avons choisi, et
   `indicatif` vaut `true`.
3. **137 Seveso seuil haut n'ont aucun PPRT publié.** Plan prescrit mais non
   approuvé, ou servitude non déposée au Géoportail. C'est un vrai manque.
4. **L'uniformité dans le carreau est une hypothèse.** À 200 m elle est
   raisonnable ; sur un périmètre de moins d'un hectare elle ne l'est plus.
5. **Le millésime des carreaux est 2021** (Filosofi), celui des périmètres va
   de 2016 à 2026 selon le document. Les deux ne datent pas du même jour.
6. **Aucune « part de la population » au code postal.** Le seul référentiel de
   population disponible à cette maille surcompte de 10,5 % (§ 5 bis). À ce
   palier, l'écran ne donne que des effectifs — on préfère une colonne vide à
   un pourcentage faux.
7. **Le détail par code postal sur la France entière n'est pas calculable** en
   temps interactif : il faut choisir une région ou un département.

---

## 7. Où c'est écrit

| Objet | Fichier |
|---|---|
| Import des périmètres PPRT | `sql/177` · `app/api/admin/import-pprt/` · `lib/import/pprt/normalisation.ts` |
| Import des sites ICPE | `sql/173`, `sql/174` · `app/api/admin/import-georisques/` · `lib/import/georisques/` |
| Rattachement site ↔ PPRT | `sql/179` (`risques_industriels_carte`) |
| Calcul de population | `sql/180` (`population_exposee_site`) |
| Registre des données | `sql/181` (`data_registry`, catégorie `risque`) |
| Convention plein / tireté | `lib/carte/nature-zone.ts` |
| Couches carte | `app/map/_components/RisqueIndustrielLayer.tsx` · `PprtLayer.tsx` |
| Route d'exposition | `app/api/risques/[siteId]/exposition/` |
| Audit de départ | `docs/AUDIT_SEVESO_PPRT.md` |
