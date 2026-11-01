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
