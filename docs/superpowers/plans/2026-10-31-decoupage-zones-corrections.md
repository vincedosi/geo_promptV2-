# Découpage des zones : corrections issues de la relecture du 31/10/2026

Source : `docs/methodologie-decoupage-zones-dentsu-explore.docx` (état du produit au 31/10/2026).
Les constats viennent de la lecture du document, pas du code. Chaque ticket commence donc par une vérification dans le code cité : si le constat est faux ou déjà traité, le ticket est fermé avec une ligne d'explication, sans modification.

## Règles de travail

1. Traiter les lots dans l'ordre (1, 2, 3). Un ticket = un commit, message préfixé par l'identifiant (`A1`, `B8`...).
2. Avant toute modification d'un ticket : lire les fichiers listés, confirmer ou infirmer le constat, écrire le test qui échoue, puis corriger.
3. Ne jamais trancher un point de la section « Arbitrages » : appliquer l'option cochée. Si aucune n'est cochée, appliquer l'option marquée (recommandé) et l'indiquer dans le message de commit.
4. Toute nouvelle borne, limite ou comportement de plateforme va dans la table `plateformes_geo` (migration SQL + `lib/zones/plateformes.ts`), jamais en dur dans le code.
5. Tout refus ou ajustement automatique est annoncé à l'utilisateur avec la valeur avant/après. Aucun ajustement silencieux.
6. À la fin de chaque lot : mettre à jour le document de méthodologie (sections citées) et produire un compte rendu `docs/superpowers/plans/2026-10-31-decoupage-zones-compte-rendu.md` : tickets traités, tickets fermés sans modification (avec la raison), tests ajoutés.

## Arbitrages à trancher avant le lot 1

Cocher une option par ligne.

| Réf. | Question | Options |
|---|---|---|
| ARB-1 | Sémantique du plan par CP (§ 2.7) | [ ] Multiplicateur d'enchère (recommandé) : multiplicateur(CP) = part(CP) ÷ moyenne des parts des CP retenus, la population n'entre pas dans la formule, le poids de classe multiplie le résultat. [ ] Répartition de budget : poids = population dans la zone × poids de classe, restreint aux CP retenus. |
| ARB-2 | Mode par défaut d'un jeu de zone | [ ] Exclusif (recommandé) tant qu'une seule classe est définie. [ ] Pondéré avec poids « hors zone » = 0 par défaut. |
| ARB-3 | Unité à population totale inconnue (DROM non carroyés) | [ ] Achetable avec mention « population inconnue », même règle pour CP, département et pays (recommandé). [ ] Refusée partout, y compris en maille pays. |
| ARB-4 | Minimum de ménages à la conversion | [ ] Appliqué dès qu'une cible autre que la population totale est choisie (recommandé). [ ] Jamais appliqué, mais la part de population issue de carreaux imputés est affichée. |
| ARB-5 | Rayon minimal de la recette « rayon autour d'un point » | [ ] 250 m (recommandé). [ ] 100 m conservé, avec prorata de surface des carreaux sous 2 km². |
| ARB-6 | Dépassement du nombre d'unités d'une maille territoriale (ex. > 3 000 communes TikTok) | [ ] Découpage automatique en N groupes triés par part décroissante (recommandé). [ ] Refus, comme pour les cercles Meta. |
| ARB-7 | Choix de la maille par défaut | [ ] Par taux utile simulé sous contraintes de la plateforme (recommandé). [ ] Ordre de finesse conservé, le cercle classé selon son rayon. |

---

## Lot 1 : contradictions de logique

### A1. Plan par CP : mode pondéré sans effet du seuil
- Fichiers : `lib/zones/plan.ts` (genererPlanCp), `lib/zones/jeu.ts` (poidsDeClasse), `lib/zones/plan-jeu-zone.ts`, `plateformes_geo`.
- Constat : poids = population totale × poids de classe, classes à 1 → plan proportionnel à la population totale de chaque CP touché, retenu ou non. Le seuil ne change pas le plan ; les CP non retenus entrent dans « nombre de CP », la moyenne des multiplicateurs poussés n'est plus 1 ; le résultat est un plan uniforme par habitant.
- Attendu : appliquer ARB-1 et ARB-2. Le plan ne contient que les CP retenus. La moyenne des multiplicateurs des CP du plan vaut 1 (à l'arrondi près). Ajouter dans `plateformes_geo` les colonnes `multiplicateur_min` et `multiplicateur_max` (DV360 : 0,1 et 10, à confirmer dans la documentation, marquer « à vérifier » sinon) et borner le plan à cette plage au lieu de 0,001 / 999,999.
- Test : jeu de zone avec 3 CP (parts 90 %, 30 %, 12 %), seuil 20 % → plan à 2 CP, moyenne 1, le CP à 90 % a un multiplicateur 3 fois celui du CP à 30 % (ARB-1 option 1). Relever le seuil à 40 % change le plan.

### A2. Groupes de CP indiscernables et rattachement des carreaux
- Fichiers : `sql/269_couverture_geometrie.sql`, table `cp_groupe`, `lib/zones/plan.ts` (sql/228), `lib/zones/conversion.ts` (estRetenue).
- Constat : § 2.2 dit « chaque carreau rattaché à un CP » et « carreau sans CP → hors territoire » (contradiction de rédaction). Si un carreau n'a qu'un seul CP, les autres membres d'un groupe n'ont aucune population → part indéterminée → jamais retenus : le groupe ne peut pas être « acheté entier » par la règle du seuil.
- Attendu : le groupe devient l'unité de calcul de la maille CP : une ligne par groupe (identifiant du groupe, liste des codes membres), une seule part, un seul multiplicateur. À l'extraction, la ligne est développée en autant de codes que de membres. Documenter si la division du multiplicateur par le nombre de membres est correcte pour chaque plateforme (dépend de la façon dont la plateforme cumule les poids d'une impression) : la marquer « à vérifier » dans le registre.
- Test : zone couvrant un groupe de 3 codes → une ligne de couverture, part unique ; extraction DV360 → 3 codes avec le même multiplicateur ; somme de la population des lignes = population de la zone.

### A3. Cercle « exact » sur rayon autour d'un point
- Fichiers : `lib/zones/conversion.ts` (exactitude), `sql/155_zone_rayon.sql` (part de surface retenue).
- Constat : la zone est découpée sur le territoire français, le disque acheté ne l'est pas. En frontière terrestre la plateforme achète une population étrangère absente du bilan. La règle appliquée aux POI (perte calculée) n'est pas appliquée au point unique.
- Attendu : le cercle n'est exact que si la part de surface retenue est 100 %. Sinon : perte calculée comme pour les POI, et avertissement « disque partiellement hors de France : restreindre la campagne au pays FR ». Distinguer dans le message surface en mer et surface terrestre à l'étranger si l'information est disponible dans `sql/155`.
- Test : rayon 20 km à Strasbourg → non exact, avertissement ; rayon 5 km à Clermont-Ferrand → exact.

### A4. Unité à population totale inconnue
- Fichiers : `lib/zones/conversion.ts` (estRetenue, unitesPays), `sql/275_couverture_commune_departement.sql`, `sql/296_zone_pays.sql`.
- Constat : « jamais retenue » (§ 2.3) pour CP et département, mais achetée avec population « non renseignée » en maille pays (§ 2.6). Une zone nationale « par CP » ne peut pas donner « chaque CP du pays à 100 % » pour les CP de GP, GF, YT.
- Attendu : appliquer ARB-3 de façon identique aux mailles CP, commune, département, pays. Le bilan affiche séparément « diffusion à population inconnue » quand une telle unité est retenue.
- Test : zone nationale « France entière » en maille département → 101 lignes, dont 3 à population inconnue, traitées selon ARB-3 ; même résultat en maille CP et pays pour ces territoires.

### A5. Minimum de ménages absent de la conversion avec cible
- Fichiers : `sql/269_couverture_geometrie.sql`, `sql/292_zone_seuil_carreaux_min.sql`, `lib/zones/recette.ts` (migration des recettes anciennes), table `cibles_exposition`.
- Constat : le garde-fou des carreaux imputés (< 11 ménages) protège la construction par seuil sur carreaux, pas la conversion quand une cible (ex. ménages pauvres) est comptée. Une recette ancienne sans valeur se recalcule avec min = 0 en silence.
- Attendu : appliquer ARB-4. Migration : toute recette « seuil sur carreaux » sans valeur reçoit explicitement `min_menages = 0` et l'écran affiche la valeur. Aucun défaut implicite différent entre recette ancienne et recette nouvelle.
- Test : rayon 3 km avec cible « ménages pauvres » → le nombre de carreaux comptés diffère entre min 0 et min 11 et l'écran l'indique ; une recette migrée affiche « minimum de ménages : 0 ».

### A6. Bilan des cercles : cellule ou disque
- Fichiers : `sql/276_paver_cercles.sql`, `lib/zones/conversion-serveur.ts`, `sql/300_maille_pays.sql` (point E7).
- Constat : l'étape 4 annonce une perte calculée sur l'union des disques, le point ambigu dit que la population totale d'un cercle est celle de la cellule hexagonale. Le disque circonscrit vaut 1,21 fois l'hexagone en surface et les disques voisins se chevauchent.
- Attendu : « diffusion achetée » et « diffusion hors zone » du bilan sont calculées sur l'union dédoublonnée des disques retenus. La colonne « population totale » par cercle est celle du disque (pas de la cellule). Le bilan précise que la somme des lignes dépasse le total à cause des chevauchements. Le filtre « population minimale par cercle » s'applique à la population du disque.
- Test : zone pavée par 7 cellules → somme des populations des 7 disques > diffusion achetée du bilan ; couverte + hors zone = achetée.

### A7. Nombre de sommets et de morceaux du polygone
- Fichiers : `lib/zones/conversion.ts` (verifierLimites), `lib/zones/executer-recette.ts`, `plateformes_geo`.
- Constat : la borne de 20 000 sommets ne vaut qu'à l'import et au dessin. Un rayon autour de 10 000 POI, un seuil sur 20 000 carreaux ou une union de 20 zones produisent des multipolygones bien plus lourds, poussés tels quels en maille polygone.
- Attendu : à l'extraction en maille polygone, simplification (Douglas-Peucker, tolérance 50 m, en dessous de la résolution du carreau) puis contrôle du nombre de sommets et de morceaux contre `plateformes_geo.polygone_sommets_max` et `polygone_morceaux_max` (nouvelles colonnes, valeurs TTD « à vérifier »). Dépassement = refus avec les nombres obtenus. La perte de population induite par la simplification est recalculée et affichée si elle dépasse 0,1 %.
- Test : zone POI à 2 000 disques → polygone simplifié sous la borne, perte affichée ; zone importée à 500 sommets → inchangée.

---

## Lot 2 : bornes et règles

### B8. Rayons : recette, pavage, plateformes
- Fichiers : `lib/zones/recette-schema.ts`, `angular/.../mailles-url.ts` (RAYON_PAR_DEFAUT_M), `lib/zones/conversion.ts`.
- Constat : recette 100 m à 100 km, pavage 1 à 200 km, DV360 ≥ 1 km, Meta 1 à 80 km. Un rayon de 100 à 999 m n'est exact nulle part ; « ramené dans les bornes » modifie la recette en silence et fait perdre l'exactitude sans le dire ; un disque de 100 m est plus petit qu'un carreau.
- Attendu : appliquer ARB-5. Quand le rayon de la recette est ajusté aux bornes d'une plateforme : message « rayon ajusté de X à Y (minimum DV360), maille non exacte, perte calculée ». Tableau des défauts (§ 3.3) complété d'une ligne « rayon < 1 km ».
- Test : recette 500 m sur DV360 → rayon 1 km, message, maille non exacte.

### B9. Maille par défaut
- Fichiers : `lib/zones/conversion.ts` (FINESSE, mailleParDefaut).
- Constat : l'ordre « polygone, IRIS, CP, cercle, commune, département » classe un cercle de 10 km avant une commune. Résultats : CP proposé pour une zone fine sur DV360 (0 CP à 20 % → refus), cercles de 10 km proposés pour une liste de CP sur Meta.
- Attendu : appliquer ARB-7. Dans tous les cas, la règle de défaut tient compte de `plateformes_geo.poussee_branchee` (voir B16) et le défaut retenu est expliqué en une ligne à l'écran (« taux utile simulé 71 % contre 23 % en CP »).
- Test : anneau de 1 km sur DV360 → cercles proposés ; liste de 40 CP sur Meta → CP proposé avec mention « à vérifier », pas cercles.

### B10. Rayon par défaut 10 km
- Fichiers : `angular/.../mailles-url.ts`, `lib/zones/conversion-serveur.ts`.
- Constat : une zone plus petite qu'une cellule de 10 km (≈ 260 km²) ne retient aucune cellule à 20 % → refus au réglage par défaut.
- Attendu : rayon par défaut = rayon de la recette s'il existe, sinon R = √(surface de la zone / π) / 3, borné par la plateforme. Si les cercles retenus dépassent le plafond de la plateforme, proposer le plus petit rayon qui passe (recherche dichotomique sur 6 valeurs au plus) au lieu du seul message « augmentez le rayon ».
- Test : zone de 20 km² sur Meta → rayon proposé ≈ 0,8 km ramené à 1 km, au moins 4 cellules retenues ; zone de 30 000 km² → rayon proposé sous le plafond de 200 cercles.

### B11. Comparaison au seuil sur la part arrondie
- Fichiers : `lib/zones/conversion.ts` (appliquerSeuil, estRetenue), `sql/276_paver_cercles.sql`.
- Constat : part arrondie au dixième avant comparaison : 19,96 % passe à 20 % ; à seuil 0 %, une part de 0,02 % affichée 0,0 % est retenue.
- Attendu : comparaison sur la part non arrondie ; à seuil 0, exiger part > 0. L'affichage reste au dixième.
- Test : part 19,96 % et seuil 20 % → non retenue ; part 0,02 % et seuil 0 → retenue, part 0 → non retenue.

### B12. Un plan par plateforme
- Fichiers : `lib/zones/plan-jeu-zone.ts`, `lib/zones/extraction-jeu-zone.ts`.
- Constat : le plan est calculé au seuil le plus bas des plateformes achetant au CP ; une plateforme à seuil plus haut reçoit des CP qu'elle n'achète pas.
- Attendu : un plan par plateforme, au seuil de cette plateforme, figé avec l'extraction.
- Test : DV360 à 20 %, TTD à 10 % → deux plans, celui de DV360 ne contient que les CP retenus à 20 %.

### B13. Minimums de population : par unité et par groupe
- Fichiers : `lib/zones/plateformes.ts`, migration `plateformes_geo`, `lib/zones/conversion.ts` (verifierLimites), `sql/276`.
- Constat : « 1 000 » est un filtre dur par cellule chez DV360, un avertissement par groupe chez TikTok, rien chez Meta, non défini pour un cercle exact unique.
- Attendu : deux colonnes dans le registre, `pop_min_unite` et `pop_min_groupe`, chacune avec son comportement (`refus` ou `avertissement`). Le code lit ces colonnes, aucune valeur en dur. Le cercle exact unique passe par le même contrôle.
- Test : cercle exact de 1 km à 300 habitants sur DV360 → comportement défini par le registre, message explicite.

### B14. Dépassement du nombre d'unités d'une maille territoriale
- Fichiers : `lib/zones/conversion.ts` (verifierLimites), `lib/zones/extraction-jeu-zone.ts`.
- Constat : avertissement seul au-delà de 3 000 communes TikTok, sans préciser ce qui est extrait.
- Attendu : appliquer ARB-6. En cas de découpage, l'extraction produit N fichiers ou N blocs numérotés, triés par part décroissante, chacun sous la limite, et le bilan est donné par bloc.
- Test : 3 500 communes sur TikTok → 2 blocs (3 000 + 500) ou refus selon ARB-6.

### B15. Exactitude par composition
- Fichiers : `lib/zones/recette.ts`, `lib/zones/conversion.ts` (exactitude), `sql/256_zone_seuil_territoire.sql`, recette « capture ».
- Constat : une zone « seuil sur territoires » par CP et une « capture » calculée au CP sont des unions de CP entiers, donc exactes en CP, mais seule la recette « liste de CP » est reconnue exacte.
- Attendu : la recette conserve la liste des unités constitutives (`unites_constitutives : {maille, codes[]}`) pour seuil sur territoires, capture et liste de CP. La fonction d'exactitude se fonde sur ce champ, pas sur le type de recette. Un groupe de CP indiscernables partiellement présent dans la liste rend la maille non exacte (le groupe est acheté entier).
- Test : capture au CP de 25 codes → maille CP exacte, taux utile 100 % ; la même liste contenant un seul membre d'un groupe de 3 → non exacte, perte calculée.

### B16. Poussée branchée dans la règle de défaut
- Fichiers : `plateformes_geo` (nouvelle colonne `poussee_branchee`), `lib/zones/conversion.ts` (mailleParDefaut).
- Constat : le défaut DV360 pour un rayon est « cercles », maille dont la poussée API n'est pas branchée, alors que les CP le sont.
- Attendu : colonne `poussee_branchee` dans le registre ; le défaut l'affiche (« cercles, export manuel » contre « CP, poussée API ») et, si ARB-7 option 1, l'intègre comme critère de départage à taux utile égal (± 5 points).
- Test : rayon 5 km sur DV360 → le défaut proposé mentionne le mode de poussée.

---

## Lot 3 : registre, chiffres, documentation

### C17. Périmètre du « 63,8 M »
- Doc § 2.1, § 4.1. Écrire « France carroyée (métropole + Martinique + La Réunion) » et vérifier la cohérence avec 62 528 975 (métropole) en base.

### C18. Dérive d'arrondi incompatible avec un arrondi au plus proche
- Fichiers : `lib/zones/conversion.ts` (appliquerSeuil).
- Constat : −230 habitants sur 895 CP. Un arrondi au plus proche donne une dérive attendue de l'ordre de ±10 (σ = √(895/12)). La valeur observée indique une troncature ou un arrondi en amont (carreaux ou agrégats).
- Attendu : identifier l'origine (vérifier les `floor` / `trunc` / casts entiers dans le SQL de couverture et le TS), puis répartir au plus fort reste pour que la somme des lignes soit égale au total affiché.
- Test : sur la zone de référence (895 CP), somme des lignes = total.

### C19. « Vrais » IRIS
- Fichiers : `sql/256_zone_seuil_territoire.sql`, doc § 1.2. Définir le critère dans le code et dans le doc. Si les communes non irisées (pseudo-IRIS 0000) sont exclues, l'écran l'indique (« communes rurales non couvertes par cette recette ») et le doc l'écrit.

### C20. Intersection limitée à 2 zones
- Fichiers : `lib/zones/recette-schema.ts`. Aligner sur union et différence (2 à 20).

### C21. Différence avec une zone nationale
- Fichiers : `lib/zones/recette.ts`, `sql/296_zone_pays.sql`. Autoriser « zone nationale moins zones locales » (zone nationale en premier opérande seulement). Couverture = agrégats nationaux moins couverture des zones soustraites, sans lecture de carreau pour la partie nationale.
- Test : « France métropolitaine moins rayon 30 km autour de Lyon » → population nationale moins population du rayon, mailles pays refusée (sans objet), CP et département disponibles.

### C22. Numérotation des étapes
- Doc : lister une fois les cinq étapes produit (①..⑤) en § 1 et renommer les boîtes de la figure 1 « phases ». Le texte cite « étape ① » et « étape ③ » sans jamais les définir.

### C23. Datation
- Doc : une ligne unique en tête : « registre relevé le 14/10/2026, mailles pays le 30/10, base lue le 31/10 ; mesures Gironde du 29/10 ». Retirer « au 31 octobre » du titre du § 3.2.

### C24. Glossaire et cibles
- Doc : ajouter IRIS à « Maille » ; ajouter « Cible » ; préciser que « diffusion achetée » reste en population totale même quand la part est calculée sur une cible. Code : vérifier que c'est bien le cas dans `conversion.ts` (ResumeMaille) ; sinon corriger.

### C25. Règle de construction de la table carreau → CP / IRIS / commune
- Fichiers : script de construction de la table de correspondance (à localiser), doc § 2.2. Documenter : point testé (centre du carreau, à vérifier qu'il ne s'agit pas du coin sud-ouest encodé dans l'identifiant INSEE `CRS3035RES200mN…E…`), contours utilisés et leur millésime, gestion des carreaux dont le centre ne tombe dans aucun contour.
- Test : un carreau connu de Paris 16e est rattaché au CP 75016 et à l'arrondissement 75116, pas à 75116 / 75016 inversé par décalage de 100 m.

### C26. Surfaces nationales
- Doc : qualifier 547 779 et 636 299 km² de « surface du référentiel de contours », distincte des surfaces officielles (543 940 km² métropole).

### C27. Plateformes achetant en cercles
- Doc § 2.5 : ajouter The Trade Desk (registre : oui, à vérifier).

### C28. Registre DV360 incomplet
- `plateformes_geo` : relever et renseigner le nombre maximal de CP par liste, le nombre maximal de cercles par liste de proximité, le rayon maximal des cercles. Marquer « à vérifier » tant que non confirmé dans un compte.

### C29. Meta, catégories d'annonces spéciales
- `plateformes_geo` : remplacer la note par une borne conditionnelle (`rayon_min_categorie_speciale`), portée par le code (case à cocher « catégorie spéciale » sur le jeu de zone).

---

## Backlog (optimisations, hors lots)

- D1. Seuil optimal proposé : à partir des parts déjà calculées, courbe couverture / taux utile et seuil maximisant le taux utile sous couverture cible (80 % par défaut). Défaut de seuil par maille dans le registre.
- D2. Versionnage des zones : un recalcul crée une version, plans et jeux référencent une version ; supprime la restriction « zone référencée non recalculable ».
- D3. Recettes « liste de communes » et « liste de départements », exactes pour TikTok (exactitude par composition, B15).
- D4. Catalogue unique d'indicateurs (carreaux, cibles, territoires, score) pour mesurer la conversion sur le critère de construction.
- D5. Incertitude de discrétisation affichée : carreaux de bord × population moyenne, pour les zones sous 2 km².
- D6. Maille IRIS calculée à la demande.
- D7. Isochrone : stocker point, mode et durée dans la recette, même figée.
- D8. Option d'agrégation des arrondissements PLM en commune entière pour les plateformes qui ne les acceptent pas.

---

## Prompt de lancement

```
Lis docs/superpowers/plans/2026-10-31-decoupage-zones-corrections.md en entier.
Commence par la section « Arbitrages » : applique les options cochées, ou l'option recommandée en l'indiquant dans le commit.
Traite le lot 1 ticket par ticket (A1 à A7). Pour chaque ticket : lis les fichiers listés, confirme ou infirme le constat dans le code, écris le test d'acceptation, corrige, un commit par ticket.
Ne touche pas aux lots 2 et 3 avant d'avoir fini le lot 1 et écrit le compte rendu dans docs/superpowers/plans/2026-10-31-decoupage-zones-compte-rendu.md.
Toute borne ou limite de plateforme va dans plateformes_geo, jamais en dur. Aucun ajustement silencieux : chaque refus ou ajustement affiche avant/après.
Quand un constat est faux ou déjà traité, ferme le ticket avec une ligne d'explication, sans modifier le code.
```
