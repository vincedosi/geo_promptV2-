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
