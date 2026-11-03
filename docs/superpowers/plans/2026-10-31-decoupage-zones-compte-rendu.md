# Corrections du découpage des zones : compte rendu du lot 1

Plan : `2026-10-31-decoupage-zones-corrections.md`. Branche `feat/carte-finitions`, non poussée.
Arbitrages appliqués : Q1 à Q7 = A (réponses de Vincent du 31/10, avec conditions) ; Q8 à Q41 = recommandations, provisoires.

## Tickets livrés

| Ticket | Objet | Commits | Migration | Ce qui change |
|---|---|---|---|---|
| B11 | Seuil comparé à la part non arrondie | `217d5d99..c08f786d` | sql/303 | Colonne `part_brute` ; à seuil 0, part > 0 exigée |
| A2 | Groupes de CP indiscernables | `c08f786d..8fc63d11` | sql/304 | Le groupe est une ligne (`code` + `membres`), développé en codes à l'extraction |
| A1 | Plan par CP (ARB-1) | `8fc63d11..85b9d710` | sql/305 | Multiplicateur sur les CP retenus, séquence E4 (moyenne 1, écrêtage à la plage du mécanisme, sans renormalisation) ; registre `plateformes_poids` ; DV360 0,1 à 10 « à vérifier » |
| A8 | Part prévue du suivi | `85b9d710..585970fe` | sql/306 | Part prévue = part × volume × classe ÷ Σ, indépendante du multiplicateur ; lecteur unique `HORS_ZONE` |
| A3 | Cercle « exact » | `585970fe..dbd12d77` | sql/307 | Exact seulement si 100 % de la surface est retenue ; sinon perte et avertissement |
| A4 | Population inconnue (ARB-3) | `dbd12d77..4187a003`, `e932dec2` | sql/308, 309 | Ligne « diffusion à population inconnue » à part ; unité retenue si ≥ 95 % de sa surface est dans la zone (réglage `reglages_conversion`) |
| A5 | Minimum de ménages (ARB-4) | `4187a003..30c12aab` | sql/310 | 11 ménages dès qu'une cible ≠ population totale, numérateur et dénominateur ; affiché en ⑤ |
| A6 | Cercles : disque, pas cellule | `e932dec2..e8ae99dc` | sql/311 | Population, part et seuil d'un cercle = son disque ; note de chevauchement ; plafond de coût 240 000 km² (surface du disque) |
| A7 | Sommets et morceaux du polygone | `e8ae99dc..d3439541` | sql/312, 313 | Simplification par paliers 5/10/25/50 m (aucune si déjà sous les bornes) ; refus chiffré ; bilan non exact avec perte et gain |

Aucun ticket fermé sans changement.

## Tests ajoutés (intégration)

`seuil-part-non-arrondie`, `unite-groupe-cp`, `part-prevue`, `population-inconnue`, `minimum-menages-conversion`, `cercle-population-disque`, `polygone-sommets-morceaux`, plus des cas dans `paver-cercles` et `fiche-et-groupes`. Unitaires : 3 121 verts. Angular : `tsc` et specs ciblées verts.

Rouges connus hors lot : `fichier-extraction` et `activation-extraction` (jeu 66061937 retiré, Excel n° 49).

## Décisions du chef de projet (à relire)

- A4 : tolérance d'inclusion à 0,95, en réglage de base.
- A6 : part et seuil passés au disque avec la population (sinon part plafonnée à ≈ 83 %).
- A6 : plafond de coût relevé de 200 000 à 240 000 km² ; mesure à froid partielle : Occitanie 40 km en 8,2 s, ARA en 5,8 s, aucun fichier temporaire.
- A7 : paliers de tolérance plutôt que 50 m fixes.
- Le seuil du module risque (`appliquer_seuil_zone_set`) garde la part arrondie : hors ①→⑤, dette notée.

## Passation à l'équipe dentsu

- **⑥ Plan de campagne et suivi `in_target`** : les impressions prévues par CP comptent encore un groupe de CP n fois. À reprendre avec le lecteur unique `lireHorsZone` et la part prévue d'A8.
- **⑦ Activation** : l'option « un cercle + restriction au pays FR » conseillée par A3 se règle à l'activation, pas dans ⑤.
- **⑧ Live** : afficher la ligne « population inconnue » (A4) dans le suivi.
- **Valeurs à relever dans un compte** : plage du multiplicateur DV360 (0,1 à 10) ; bornes de polygone TTD (20 000 sommets, 2 000 morceaux, valeurs de test sans source) ; registre DV360 (C28).

## Mineurs reportés à la relecture finale

Listés ticket par ticket dans le registre de suivi (`.superpowers/sdd/…/progress.md`, lignes « minor (deferred) »). Les plus visibles : « 11 » rangé à deux endroits ; ④ (couverture par rayon) ne filtre pas encore les 11 ménages ; commentaire SQL de sql/311 resté à 200 000 km² ; commentaires de ⑥ devenus faux.

## Questions pour Vincent

1. **Mécanisme TTD** : `budget_ligne` ou `multiplicateur` ? À trancher avant Q33.
2. **Volume HORS_ZONE** : en mode national pondéré sur Toulouse, 99,2 % du volume part hors zone. Garder, ou plafonner ?
3. **Contours DROM (A4)** : à 0,95, seules 18 communes sur 32 sont retenues en 971, 21/22 en 973 et 8/17 en 976 (CP : 18/32, 21/22, 6/11), parce que les contours viennent de sources différentes. Baisser le réglage, ou passer à des contours de même source ?
4. **Polygone simplifié (A7)** : un disque de 500 m perd ≈ 8 % sous la borne de 20 000 sommets, quel que soit le palier. Faut-il une simplification qui ne rétrécit pas la zone (≈ +4 % achetés hors zone) et/ou une confirmation au-delà de 5 % de perte ?

---

# Lot 2 : bornes et règles

Commits `0bce6d5e..5c8f9697`, 16 commits, 9 migrations (sql/314 à sql/322). B11 est passé au lot 1.
Arbitrages appliqués : ARB-5, ARB-6, ARB-7 = A ; décision de Vincent du 02/11 sur les rayons < 250 m.

## Tickets livrés

| Ticket | Objet | Commits | Migration | Ce qui change |
|---|---|---|---|---|
| B8 | Rayons | `bb637bd2`, `7d767704`, `c8659774` | sql/314 | Recette point de 250 m à 100 km (0 recette < 250 m en base). Rayon ajusté aux bornes d'une plateforme : annoncé (avant/après), maille non exacte. Rayon < 250 m (point, POI, combinaison à toute profondeur) : refusé à l'activation (jeu 400, extraction et export DSP 422), estimatif en analyse |
| B9 | Maille par défaut (ARB-7) | `0a1deb78` | sql/315 | Couverture cible 80 %, puis taux utile maximal ; départage à ± 5 pts ; défaut dit en une ligne avec les deux chiffres ; défaut provisoire tant que la simulation manque |
| B10 | Rayon par défaut | `a4ac974c`, `5974c303` | sql/316 | R = √(S/π)/3 au pas de 500 m, borné par la plateforme (`surface_km2` générée). Trop de cercles : plus petit rayon proposé (6 essais, 1 jeton de quota par essai, budget 40 s) |
| B12 | Un plan par plateforme | `85a3b5e0`, `2d15d244` | sql/317 | Plan propre par plateforme dans `zone_set_extraction_cp_plateforme` ; plan commun gardé pour ⑥/⑦ ; avertissements de poids sur le plan commun. 6 000 codes : 72,6 s → 1,7 s |
| B13 | Minimums de population | `8dab242e`, `8e781a21` | sql/318 | `pop_min_unite` / `pop_min_groupe` avec comportement `refus` ou `avertissement` au registre ; cercle exact unique au même contrôle ; population inconnue = « non vérifiable », jamais un refus |
| B14 | Dépassement d'unités (ARB-6) | `6d1f1cee`, `fe8706ee` | sql/319 | Blocs numérotés par part décroissante sous `max_unites` (3 500 communes → 3 000 + 500) ; bilan et minimum de groupe par bloc ; fichier `?bloc=N` (422 sans bloc) |
| B15 | Exactitude par composition | `e2d900bf`, `0f70d64a` | sql/320, 321 | Colonne `custom_geo_zones.unites_constitutives` (hors JSON recette) ; exactitude lue sur les unités ; groupe partiel → non exacte (25 → 27 codes) ; capture reconstruite par le serveur depuis ses CP |
| B16 | Poussée dans le défaut | `30eb3ebd`, `5c8f9697` | sql/322 | `plateformes_geo.poussee_branchee` (DV360 / CP seul à vrai) ; mode dit à l'écran (poussée API, ciblage par API, export manuel) ; zone nationale au pays d'office |

Aucun ticket fermé sans modification. B14 et B16, classés « dentsu » le 31/10, ont été traités pour leur part logique (découpage, règle de défaut) ; la poussée reste à dentsu.

## Tests ajoutés

Unitaires : `conversion-defaut` (B9, B16), `rayon-propose`, `conversion-population`, `decoupage-blocs`, `exactitude-composition`, `activation-serveur`, `export-zone-activation`, `fichier-extraction-blocs`. Intégration : `maille-defaut-reglages`, `rayon-defaut-surface`, `unites-constitutives`, `poussee-branchee`. Angular : `mes-zones-activation.component.spec`, cas ajoutés dans `bilan.spec`. Cas ajoutés dans `extraction-jeu-zone`, `plan-jeu-zone`, `jeu-zone-extraction`, `plateformes-geo`, `paver-cercles`, `conversion-paritaire`.

Dernière passe (B16 tour 1) : `tsc` 0 ; unitaires 3 274/3 274 ; intégration 68/68 sur 5 fichiers ; Angular carte 1 898/1 898. Rouge connu hors lot : `activation-extraction` (jeu 66061937 absent de la base, Excel n° 49).

## Décisions du chef de projet (à relire)

- B8 : une combinaison qui contient une zone < 250 m, à toute profondeur, est refusée à l'activation.
- B8 : un refus < 250 m consomme un jeton de quota.
- B9 : « sûre avant à vérifier » est le 1er critère de départage, pas un filtre (sinon le CP Meta, à vérifier, ne serait jamais proposé).
- B9 : l'enregistrement d'un jeu n'est pas bloqué pendant le défaut provisoire.
- B10 : chaque essai de pavage prend un jeton de quota ; arrêt sur budget de temps, dit à l'écran.
- B13 : population inconnue face à un minimum = avertissement, même si le registre dit `refus`.
- B13 : DV360, cercle exact unique sous 1 000 habitants : refus, comportement « à vérifier ».
- B14 : un bloc est un groupe pour le minimum de population ; le fichier de ⑤ se télécharge par bloc.
- B15 : `unites_constitutives` en colonne dédiée (sql/321), parce que d'autres branches relisent `recette` en `.strict()`.
- B15 : la capture reconstruit forme et unités côté serveur ; un code inconnu donne 400.
- B16 : la poussée est le 2e critère, à taux utile égal (± 5 pts) ; sans simulation : sûre, exacte, poussée, finesse.

## Passation à l'équipe dentsu

- **⑥ / ⑦, plan par plateforme (B12)** : lire `zone_set_extraction_cp_plateforme` filtré sur la plateforme poussée. Sinon DV360 (20 %) reçoit les CP du seuil le plus bas (TTD à 10 %). Lecteurs à reprendre : `lireCpExtraction`, route `extractions/[version]/export`, `lib/simulation/serveur.ts`, `simulation/recaler`.
- **⑥ / ⑦, blocs (B14)** : ⑥ (`panneau-activation`) et ⑦ montent `mg-fichiers-extraction` sans `blocsFichier` → 422 sur une extraction découpée. Passer `decoupage.blocs` du résumé figé. La poussée doit filtrer `zone_set_extraction_unites.bloc`. L'avertissement recalculé de ⑦ (`cartes.ts`) ne porte pas `n`.
- **Rayon < 250 m (B8)** : `dv360/zones/push` et la chaîne ⑥/⑦ n'ont pas la garde.
- **CP non découpé (B14)** : si une plateforme a un plafond de CP atteignable, découper le plan CP en codes.
- **À confirmer dans un compte** : DV360, refus d'un cercle exact unique sous 1 000 habitants ; `poussee_branchee` (seul DV360 / CP est à vrai).

## Dettes parquées pour la fin de lot

- `part_retenue` (sql/307) dans le JSON recette : même défaut `.strict()` latent que celui corrigé par sql/321.
- `lib/zones/extraction-jeu-zone.ts` : 569 lignes (493 avant B12) ; extraire `controler()` (M-6 de B13). Le test de taille ne couvre que `angular/src`.
- `sql/318` : 407 lignes. `mes-zones.component.ts` : 400 lignes ; `jeu-zones.service.ts` : 399.
- Rejouer sql/320 sans sql/321 remet l'ancien trigger (écrit en tête de 320).
- « 200 m » du carreau écrit en texte dans les messages < 250 m.
- `GET /api/zones/[id]/cercles` sans garde < 250 m (lecture seule).
- Marqueur `rayon_sous_minimum` (sql/314) lu par aucun code ; date de marquage en dur.
- `choisirDefaut` ignore le départage de l'appelant en attente (à documenter).
- Un rayon DV360 déclenche une lecture de couverture CP en plus (B16) ; une zone dessinée, deux lectures en plus (B9).
- Doublure de route qui ignore les colonnes du `select` (M-A de B14).
- Justification « impossible sans groupe divisé » fausse sous un seuil de 10 % (B12, code correct).

## Document de méthodologie

`C:\GENESIS\methodologie-decoupage-zones-dentsu-explore.docx` (hors dépôt), copie avant modification : `methodologie-decoupage-zones-dentsu-explore.avant-lot2.docx`. Sections mises à jour : § 1.2 (bornes des rayons), § 2.4 (exactitude), § 2.5 (minimums, rayon par défaut, rayon proposé), § 2.7 (plan par plateforme), § 3.2 (comportement des limites), § 3.3 (règle de défaut, tableau, ligne « rayon < 1 km »), § 3.4 (refus, avertissements, découpage), § 4.3 (rayon < 250 m). Les changements du lot 1 n'y sont pas portés (§ 2.3 part arrondie, § 2.5 cellule et non disque, § 2.7 mode pondéré, § 3.4 sommets, § 4).

## Questions pour Vincent

1. **Méthodologie, lot 1** : porter les changements du lot 1 dans le Word maintenant, ou au lot 3 avec la rédaction (C22 à C24) ?
2. **Plan commun** : le retirer quand ⑥/⑦ liront le plan par plateforme ? Le refus d'une règle de groupe divergente entre plateformes tomberait avec lui.
3. **Charge** : garder les lectures de simulation ajoutées par B9 et B16 (2 à 3 lectures par zone ouverte, une à la fois) ?
4. Les 4 questions du lot 1 restent ouvertes (mécanisme TTD, volume HORS_ZONE, contours DROM, polygone simplifié).

---

# Lot 3 : rédaction

Tickets de rédaction seule : C17, C22, C23, C26, C27, plus le report dans le Word des comportements du lot 1 (question 1 du lot 2). Aucun fichier de `lib/`, `app/`, `sql/` ou `angular/` modifié. Tickets de code du lot 3 (C18 à C21, C24, C25, C28, C29) non traités ici.

Document : `C:\GENESIS\methodologie-decoupage-zones-dentsu-explore.docx` (hors dépôt). Copie avant modification : `methodologie-decoupage-zones-dentsu-explore.avant-lot3.docx`. Validation XSD passée (426 → 429 paragraphes), rendu PDF relu.

## Report du lot 1

| Ticket | Sections du Word |
|---|---|
| B11 | Essentiel ; § 2.3 (part comparée sans arrondi, part > 0 à seuil 0) ; § 2.5 |
| A2 | § 2.4 (le groupe est l'unité de la maille CP) ; § 2.7 (même multiplicateur pour les membres, plus de division) |
| A1 | § 2.7 : formules brut / normalisation / écrêtage, mécanismes de `plateformes_poids`, ligne HORS_ZONE, mode exclusif par défaut ; encadré « point ambigu » remplacé par « Mode du plan » |
| A8 | § 2.7 : part prévue découplée du multiplicateur (66,7 % / 33,3 % sur l'exemple) |
| A3 | § 2.4 (exactitude du cercle) ; § 2.5 encadré « Disque en frontière » (Strasbourg 20 km, Clermont-Ferrand 5 km) |
| A4 | § 2.3 (unité à population inconnue achetable, tolérance 0,95, ligne à part au bilan) ; § 2.6 (101 départements dont 3 inconnus ; 6 074 unités CP dont 65 inconnues) ; § 4.1 |
| A5 | § 1.3 (encadré « À la conversion ») ; § 2.3 ; § 4.1 |
| A6 | § 2.5 (population et minimum sur le disque, union dédoublonnée, chevauchement mesuré CIRFA 5 km, plafond 240 000 km²) ; § 4.2 |
| A7 | § 2.4 (polygone exact sauf simplifié) ; § 3.2 (bornes TTD 20 000 / 2 000, valeurs de test) ; § 3.4 (contrôle, paliers 5/10/25/50 m, refus, perte et gain) ; § 4.2 |
| — | § 4.4 : les trois points ambigus levés remplacés par une ligne « Points levés » |

Notes de bas de page mises à jour : 14, 18, 21, 28, 30, 35, 36, 37, 44.

## Tickets

| Ticket | Fait | Valeurs mesurées (base locale, lecture seule, 03/11) |
|---|---|---|
| C17 | § 2.1 et § 4.1 : « 63,8 M » = France carroyée (métropole + Martinique + La Réunion) ; écart avec la zone « France métropolitaine » expliqué (§ 2.1) | `unite_population_totale` (département) : 98 départements, 2 324 577 carreaux, **63 783 569** hab. ; métropole 62 592 659, 972 : 306 745, 974 : 884 165. `cp_population_totale` : 5 956 CP de métropole, **62 528 975** (= `couverture_pays_jsonb('METRO','ind','forme')`), 53 CP d'outre-mer 1 182 806 |
| C22 | § 1 : les cinq étapes ① Périmètre, ② Données, ③ Zones, ④ Analyse, ⑤ Jeu de zones (libellés de `LIBELLE_ETAPE_CARTE`), ⑥-⑧ hors champ ; figure 1 redessinée en « Phase 1 » à « Phase 5 », légende refaite | — |
| C23 | Ligne de datation unique en tête ; « au 31 octobre 2026 » retiré du titre du § 3.2 et du sommaire | Registre 14/10, pays 30/10, `plateformes_poids` 31/10 |
| C26 | § 1.2 : 547 779 et 636 299 km² qualifiés « surface du référentiel de contours », distincte des 543 940 km² officiels | — |
| C27 | § 2.5 : The Trade Desk ajouté aux plateformes en cercles, « à vérifier » | `plateformes_geo` ttd / cercle : natif, disponible, `a_verifier` = vrai, `limites` = {} (aucun rayon relevé) |

## Écarts trouvés

- **C17, constat du fil d'Ariane infirmé** : « 63,8 M est inexact » venait d'une somme par CP (63 711 780). La somme par département, sur tous les carreaux, donne 63 783 569 : 63,8 M est juste pour la France carroyée.
- **Deux totaux métropole** : 62 592 659 par département, 62 528 975 par CP. Écart de 63 684 habitants (0,1 %) : les carreaux de métropole qu'aucun contour de CP ne contient. Non vérifié carreau par carreau (balayage complet de `carreau_couverture`, pas d'index sur `code_postal`).
- **Écart DROM** : 1 190 910 par département, 1 182 806 par CP (8 104 hab.).
- **Mineur A5 (lot 1) écrit dans le Word** : la couverture par rayon de ④ n'applique pas encore le minimum de 11 ménages.
- **Laissé tel quel** (tickets de code pas encore faits) : § 4.1 arrondis (C18, −230 hab. sur 895 CP) ; § 1.2 intersection limitée à 2 zones (C20) ; glossaire (C24) ; note Meta catégorie spéciale (C29).

---

# Lot 3 : code

Commits `a6ed39ff..52ac8dc3` : 13 commits, 10 migrations (sql/323 à sql/332). C17, C22, C23, C26 et C27 sont dans « Lot 3 : rédaction », ci-dessus.

## Tickets livrés

| Ticket | Objet | Commits | Migration | Avant → après |
|---|---|---|---|---|
| C18 | Arrondi au plus fort reste | `a6ed39ff`, `f35f175a` | sql/323, 324 | Pas de troncature : les carreaux portent des demi-habitants, 461 des 895 CP somment en ,5 et `round()` les montait tous. Composite : −230 → 0 au CP, +315 → 0 à la commune. Zone nationale au CP : −1 504 → 0 (FR), −1 489 → 0 (METRO) ; département METRO +24 → 0. Coût FR au CP : 5 574 → 5 703 accès |
| C19 | Vrais IRIS de « Par seuil » | `a6b56452` | commentaire de sql/256 | Critère écrit : `is_true_iris` = `type_iris <> 'Z'` (sql/075). Exclues : 33 044 communes non découpées, 27 316 564 hab. (40,3 %), alors que 12 des 15 indicateurs IRIS y ont une valeur. Mention affichée en maille IRIS. Remplacé par D30 (lot 4) |
| C20 | Intersection de 2 à 20 zones | `d2c9004f`, `5800f938` | sql/325 | `zone_intersection` calculait A ∩ (B ∪ C) ; `zone_intersection_toutes` calcule A ∩ B ∩ C. 20 zones de 23 073 sommets : 14,8 s → 0,73-0,80 s (2 000-2 400 buffers). Vide : 409 `intersection_vide`. 0 combinaison en base, aucun sens changé |
| C21 | Zone nationale moins zones locales | `84a04aa3`, `01e80ffa` | sql/326 | Pays admis en 1re zone d'une différence. Couverture = agrégats nationaux − union des zones retirées, aucun carreau national lu. Lyon 30 km : 62 528 975 − 1 903 232 = 60 625 743 (avant C25). Au CP : 159 ms, 5 922 accès. Export et détail : 422 `zone_nationale_moins` |
| C24 | Diffusion achetée en population totale | `99ca145c`, `48626db4` | sql/327, 330 | Constat vrai : `achetee` sommait la cible. Ajout de `diffusion_population_totale` et de la ligne « Diffusion achetée, population totale » en ⑤. Minimums de plateforme comparés à la population totale : fin du faux refus DV360 (cercle de 3 000 hab. dont 250 dans la cible, 422) |
| C25 | Carreau → IRIS ⊂ commune ⊂ département | `52ac8dc3` | sql/332 | Point testé = centre du carreau, sans décalage de 100 m. Commune ≠ IRIS[0:5] : 54 300 carreaux (803 132 hab., 2,34 %) → 0. Département faux : 2 615 (32 859 hab.) → 0. Sans CP : 3 926 (71 788 hab.) → 0, CP le plus proche à 62 m en médiane, 4 289 m au plus. 16 CP à cheval au département majoritaire. METRO au CP : 62 528 975 → 62 592 659, 5 956 → 5 957 CP. National : 63 783 569 au CP comme au département. Construction : 24 lots, 46 s, 55 830 lignes ; jumeaux 106 s |
| C28 | Registre DV360 | `48c3cc22` | sql/328 | Aucune valeur sourcée. `max_unites` (CP, cercle) et `rayon_max_m` (cercle) « à vérifier », sans valeur ; ⑤ affiche « non relevé ». CP et cercle DV360 ne sont plus « sûrs ». Défaut mesuré inchangé : rayon → CP, dessin → CP, national → pays |
| C29 | Meta, catégorie spéciale | `91f884be`, `1e970d8e` | sql/329, 331 | `rayon_min_categorie_speciale` = 15 000 m, « à vérifier » (source : note du 24/10). Case « Catégorie d'annonces spéciale » du jeu (`zone_sets.categorie_speciale`). Rayon minimal = le plus grand des deux. Hors bornes : 400/422 chiffré. Un PATCH de la case revérifie les choix |

Aucun ticket fermé sans modification.

## Décisions du chef de projet (à relire)

- **C18** : la zone nationale corrigée dans C18 (sql/324) ; les carreaux sans CP renvoyés à C25 ; `paver_cercles` garde `round()` ligne à ligne. Si faux : −71 813 « manqués » au département jusqu'à C25 (résorbés depuis) ; dérive d'arrondi possible sur les cercles.
- **C21** : export et détail d'une zone nationale moins refusés (422, renvoi à ⑤), plutôt que de lire les codes nationaux. Si faux : un export CP direct à ajouter.
- **C24** : minimums de plateforme sur la population totale, car la plateforme diffuse à tous. Si faux : un avertissement de moins sur une cible étroite.
- **C29** : borne Meta de 15 000 m « à vérifier » (une note, pas un relevé) ; aucune règle sur les CP Meta en catégorie spéciale. Si faux : rayons Meta refusés ou admis à tort ; CP proposés alors qu'interdits.
- **C25** : colonnes `_e7` nullables sur les seuls carreaux qui changent, plutôt qu'une réécriture de `carreau_couverture`, lue par 8 autres branches. Si faux : règle en double jusqu'au merge.
- **C25** : les 11 lecteurs partagés du découpage lisent la vue et les jumeaux. Si faux : les tests d'intégration des autres branches qui attendent 62 528 975 ou 5 956 restent rouges jusqu'au merge.

## Tests ajoutés

Intégration, nouveaux : `arrondi-plus-fort-reste`, `zone-pays-moins`, `diffusion-population-totale`, `minimum-population-totale`, `carreau-couverture-e7`. Angular, nouveau : `parametres-a-verifier.spec`.

Cas ajoutés en intégration : `zone-seuil-territoire`, `zones-recette`, `bataille-v2-zone`, `plateformes-geo`, `analyse-finitions`, `population-inconnue`, `unite-groupe-cp`, `couverture-zone-cache`, `jeu-zone-extraction`, `couverture-commune-departement`, `minimum-menages-conversion`. Unitaires : `conversion`, `conversion-population`, `recette`, `recette-schema`, `executer-recette`, `recette-paritaire`, `extraction-jeu-zone`, `zones-jeux-zone`, `zone-pays-codes-routes`. Angular : `recette-seuil-territoire`, `operations-zones` (logique et composant), `couverture`, `colonne-plateforme`, `bilan`, `enregistrer-jeu`, `panneau-jeu`.

Dernière passe (C25) : `tsc` 0 ; unitaires 3 303/3 303 ; 12 fichiers d'intégration verts, lancés un par un (la suite complète est tuée par manque de mémoire). Rouge connu hors lot : `activation-extraction` (jeu 66061937 absent, Excel n° 49). Instable connu : `export-source-borne`, vert seul.

## Dettes à fusionner au merge

- **C25** : reconstruire `carreau_couverture` et ses dénominateurs avec la règle E7, puis retirer les colonnes `code_commune_e7`, `code_departement_e7`, `code_postal_e7`, `distance_cp_e7_m`, la vue `carreau_couverture_e7`, les jumeaux `unite_population_totale_e7`, `cp_population_totale_e7`, `denominateur_menages_min_e7`, le journal `carreau_couverture_e7_lots` et `base_couverture_e7_le`. `carreau_risque_distance.code_postal` (module risque) garde l'ancien rattachement.
- **B15** : `custom_geo_zones.unites_constitutives` (sql/321) à refusionner dans le JSON `recette` quand plus aucune branche ne relit `recette` en `.strict()`.
- **Attendus des autres branches** : `wip/A1-plan-cp` attend 5 956 CP et 62 528 975 hab. (`analyse-finitions`) et `n_cp` = 5 956 (`jeu-zone-extraction`). Aucune autre branche locale n'a ces attendus en intégration (`git grep`, 03/11). Tout test qui lit la population METRO au CP sur la base partagée doit passer à 62 592 659 et 5 957.

## Mineurs parqués

- C18 : `paver_cercles` arrondit ligne à ligne (rien de visible) ; l'empreinte de `population-inconnue` échoue sur une base restée à l'ancienne sql/323.
- C19 : `CRITERE_VRAIS_IRIS` est documentaire, aucun code ne le lit ; « communes rurales » est le libellé du plan, le vrai critère est « non découpées en IRIS ».
- C20 : une différence vide garde `forme_vide` (message discutable).
- C21 : cercle, commune et IRIS non grisés en ⑤ (refus serveur seulement) ; plafond de 400 001 carreaux dans `compter_zone_pays` ; le repli du plan média n'affiche pas le message 422 ; texte battle-v2 approximatif ; le score d'une zone nationale moins répond `zone_trop_vaste`.
- C24 : une zone pays à cible ≠ ind relance `couverture_pays_jsonb('ind')`, second calcul à mesurer ; `pop_ind` de `paver_cercles` sans filtre de ménages (documenté) ; minimum de groupe des cercles et unité de la maille pays encore comparés à la cible (aucune plateforme concernée) ; le polygone n'a pas `diffusion_population_totale`.
- C25 : `couverture_rayon_poi` (②) filtre encore le département brut (2 615 carreaux, déclaré dans sql/332) ; refus `_perime` sans cause lisible ; commentaire « 266 » au lieu de « 268 » communes.

## Passation à l'équipe dentsu

- **DV360 (C28)** : relever dans un compte le nombre maximal de CP par liste, de cercles par liste de proximité et le rayon maximal. Rien n'est posé ; ⑤ affiche « non relevé ». `MAX_GEO_IDS_PER_PUSH` (2 000) est un garde-fou du produit, pas une limite DV360.
- **Meta (C29)** : confirmer le rayon minimal de 15 000 m en catégorie d'annonces spéciale, et dire si les CP y sont achetables. La maille CP reste ouverte (Vincent, 03/11).
- Les valeurs de plateforme non sourcées restent « à vérifier ». dentsu les confirme ; la question n'est plus posée à Vincent (03/11).

## Document de méthodologie

`C:\GENESIS\methodologie-decoupage-zones-dentsu-explore.docx` (hors dépôt). Copie avant modification : `methodologie-decoupage-zones-dentsu-explore.avant-lot3-code.docx`. Validation XSD passée (429 → 435 paragraphes), rendu PDF par Word relu (19 pages).

| Ticket | Sections du Word |
|---|---|
| C19 | § 1.2, ligne « Seuil sur territoires » : règle actuelle (33 044 communes, 27 316 564 hab., 40,3 %), remplacée par D30 |
| C20 | § 1.2, ligne « Combinaison » : intersection de 2 à 20 zones, « dans toutes les zones », vide refusée |
| C21 | § 1.2, ligne « Combinaison » ; § 2.6, puce « Zone nationale moins zones locales » |
| C25 | § 2.2 : texte de rattachement ; puce « carreau sans IRIS » (plus de carreau sans CP) |
| C24 | Glossaire : « Maille » réécrite, « Cible » et « Diffusion achetée » ajoutées, minimums sur la population totale |
| C18 | § 4.1 « Arrondis » : plus fort reste, écart nul ; note 45 |
| Totaux | § 1.4, § 2.1 (et sa note), § 4.1 : 62 592 659 au CP, 63 783 569 au national |
| C28, C29 | § 3.2 : DV360 CP et cercles « à vérifier », bornes « non relevées » ; Meta cercles ≥ 15 km en catégorie spéciale. § 3.5 : puce Meta réécrite, puce DV360 ajoutée |

Six notes de bas de page ajoutées (sources sql/075, 256, 325, 326, 328, 329, 331, 332).

### Écarts trouvés

- **§ 2.6, CP de la France entière** : « 6 074 unités CP, dont 65 inconnues » date d'avant C25. Le CP 29259 a reçu son premier carreau ; le compte n'est pas remesuré.
- **Ligne de datation et « L'essentiel »** : elles disent encore « lots 1 et 2 » et ne citent pas DV360 parmi les capacités non confirmées. Non modifiées (consigne : rien d'autre).
- **Lyon 30 km (C21)** : 60 625 743 est le chiffre d'avant C25 ; non repris dans le Word.
