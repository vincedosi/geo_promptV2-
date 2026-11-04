# Fixtures de parité du plan initial

Produites par le TypeScript actuel (`lib/zones/plan.ts`, `plan-jeu-zone.ts`, `part-prevue.ts`) : le noyau Python (T3)
doit rendre la même `sortie` pour la même `entree`. Plan : `docs/superpowers/plans/2026-11-04-optimisation-python-architecture.md`
§ 5.1 (critères : multiplicateurs égaux au millième, `part_prevue` à 1e-12 relatif, `resume` égal clé par clé).

**Régénérer** (depuis la racine du dépôt, base locale démarrée) :

```
npx vitest run --config services/optimisation/tests/parite/vitest.config.ts
```

Le générateur (`../generer-fixtures.ts`) importe les trois fichiers de tests unitaires tels quels et remplace les trois
modules par des enveloppes qui enregistrent chaque appel de PREMIER niveau ; les assertions des tests tournent dessus et
doivent rester vertes. Deux exécutions successives rendent des fichiers identiques octet pour octet (vérifié le 04/11).
Toute modification d'une de ces fonctions TS doit être suivie d'une régénération dans le même commit.

## Format

Chaque fichier est un JSON gzip `{ format: 1, genere_par, encodage, cas: [...] }`. Un cas = un appel :

| Clé | Contenu |
|---|---|
| `id` | `<test> #<rang de l'appel dans ce test>` |
| `test` | nom vitest (`describe > it`), ou `(collecte) <fichier>:<ligne>` pour un appel fait dans le corps d'un `describe` |
| `module`, `fonction` | `plan` / `plan-jeu-zone` / `part-prevue`, nom exporté |
| `entree.args` | arguments POSITIONNELS, encodés AVANT l'appel, dans l'ordre exact où le TS les a reçus |
| `sortie` | valeur rendue, encodée aussitôt |
| `erreur` | message si l'appel a levé (aucun au 04/11) |
| `args_apres` | arguments après l'appel, seulement s'ils ont été modifiés (aucun au 04/11) |

Encodage des valeurs JS sans équivalent JSON : `Map` → `{"$map": [[clé, valeur], …]}` (ordre d'insertion) ; `Set` →
`{"$set": […]}` ; `undefined` en argument ou élément de tableau → `{"$undefined": true}` ; `Infinity`, `-Infinity`, `NaN`,
`-0` → `{"$nombre": "…"}`. Une propriété d'objet `undefined` est omise, comme `JSON.stringify` (et la base) le font.
Les entiers restent des entiers (`1`, jamais `1.0`).

## Les trois sources

### `tests-unitaires.json.gz` — 104 appels, les 75 tests des trois fichiers

| Fichier | Tests (`it` exécutés) | Tests avec appel propre | Appels |
|---|---|---|---|
| `tests/unit/zones/plan.test.ts` | 36 | 28 (+ 2 appels de collecte, lignes 49 et 83, dont dépendent les 8 autres : `mode « exclusif »` ×5, `mode « pondere »` ×3) | 35 |
| `tests/unit/zones/plan-jeu-zone.test.ts` | 26 (24 `it` + un `it.each` à 2 cas) | 26 | 42 |
| `tests/unit/zones/part-prevue.test.ts` | 13 | 13 | 27 |

Le plan annonçait « 36 + 24 + 13 = 73 cas » : `plan-jeu-zone.test.ts` exécute 26 tests (l'`it.each` en compte deux, un
`it` de plus depuis la rédaction), soit **75 tests, tous couverts**. Fonctions : `planCpDeZone` 34, `genererPlanCp` 26,
`sortiesPoids` 11, `reglageDuPlan` 8, `universDeZone` 7, `regrouperParCodePostal` 6, `poidsPrevu` 5,
`plierParCodePostal` 3 (repli d'affichage, reste TS — gardé pour mémoire), `plansParPlateforme` 2, `partsPrevues` 2.

### `zones-reference.json.gz` — 168 appels, 6 zones, 24 déclinaisons

Couverture CP lue en base (`couverture_zone`, ou `couverture_pays_jsonb` pour une zone pays), cible `ind`. Chaque
déclinaison rejoue la séquence de `planCp` + `extraireJeuZone` (`lib/zones/extraction-jeu-zone.ts`) avec les VRAIS lecteurs
serveur (`lirePoids`, `lireGroupesCp`, `lireVolumesAttendus`) : `reglageDuPlan` → `universDeZone` → `plansParPlateforme`
→ `planCpDeZone` (plan commun, seuil le plus bas) → `sortiesPoids` ×2 par plateforme (sur le plan commun, puis sur le plan
propre). DV360 au seuil 20 %, TTD au seuil 10 % (deux seuils, donc deux plans propres, B12).

| Zone (`zones[].id`) | Source en base | Lignes CP | Déclinaisons |
|---|---|---|---|
| `composite` | `custom_geo_zones` 919ca65d — « Cible composite (2 zones) », 13 001 km², 895 unités (901 lignes, dont 6 à population inconnue) | 901 | 5 |
| `strasbourg` | 50b1c705 — CIRFA Strasbourg (isochrone, 1 150 km²) | 62 | 5 |
| `paris` | 7e1442dd — CIRFA Paris Air (isochrone, 164 km²) | 48 | 5 |
| `seuil-carreaux` | 34cbe420 — « Revenu médian ≥ 27 500 € » (seuil sur carreaux, 6 408 km²) | 663 | 5 |
| `metropole` | zone pays `METRO` | 5 957 | 2 |
| `france` | zone pays `FR` (DROM compris : 118 unités en 97x, 65 à population inconnue) | 6 075 | 2 |

Déclinaisons : `exclusif-dv360`, `pondere-dv360`, `exclusif-dv360-ttd`, `pondere-dv360-ttd`,
`exclusif-dv360-liste-exacte` ; les deux zones nationales ne portent que les deux `…-dv360-ttd` (≈ 6 000 lignes par plan,
volume). La liste exacte est SYNTHÉTIQUE (aucune zone `codes_postaux` en base) : les 20 premières unités non retenues à
20 %, les 20 premières retenues, et le premier code du référentiel absent de la couverture (unité sans carreau, ARB-3).

**Écarts aux zones de Q39** (aucune des cinq zones proposées le 31/10 n'existe en base, seule la composite) : Strasbourg
« rayon de 20 km » → l'isochrone CIRFA Strasbourg ; « arrondissements de Paris » → CIRFA Paris Air, qui NE contient aucun
75xxx (les groupes parisiens, 75116 compris, sont exercés par `metropole` et `france`) ; « Gironde, ménages pauvres ≥ 40 % »
→ « Revenu médian ≥ 27 500 € », autre zone par seuil sur carreaux ; « un DROM » → `france`, qui porte Martinique carroyée
et Guadeloupe non carroyée ; `couverture_pays_jsonb` n'accepte que `METRO` et `FR`. Créer les zones exactes demanderait
d'écrire dans `custom_geo_zones` de la base partagée : non fait.

### `extractions-risque.json.gz` — 4 appels `genererPlanCp`, 9 190 lignes stockées

Les quatre extractions de la base (toutes risque, sémantique `repartition`), entrées relues comme le fait la route
`app/api/zones/jeux/[id]/extractions` : `zone_set_cp` (2 081 et 2 746 lignes, ordre total `code_postal, cluster_id`),
jeu normalisé (`normaliserJeu`), groupes `cp_groupe`. Chaque cas porte en plus `stocke` : la ligne d'extraction et ses
lignes `zone_set_extraction_cp` (multiplicateur, retenu, classe, part prévue).

| Extraction | Version | Origine | Lignes | Multiplicateurs TS ≠ stockés |
|---|---|---|---|---|
| b7c11e25 | 1 | initiale | 2 000 | **0** |
| d1dc1d1d | 2 | recalage | 2 000 | 1 997 |
| 78f6911a | 1 | initiale | 2 595 | **0** |
| c40af217 | 2 | recalage | 2 595 | 2 592 |

Les versions 1 (plan initial) sont reproduites EXACTEMENT par le TS d'aujourd'hui : ce sont les deux cas de parité. Les
versions 2 sont des RECALAGES de simulation (`lib/simulation/recalage.ts`, `/simulation/recaler`) : leurs multiplicateurs
stockés ne sont pas un plan initial et ne servent pas de critère de parité ici (la correction v2 est jugée sur
`docs/rebid-v2.md` § 7, plan § 5.2 point 4). Leur `sortie` reste celle du plan initial recalculé, comparable comme les autres.

## `bilan.json`

Les comptes ci-dessus, écrits par le générateur à chaque exécution (tests par source, zones et déclinaisons, écarts au
stocké, tailles).
