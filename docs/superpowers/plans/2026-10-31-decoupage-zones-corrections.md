# Découpage des zones : corrections issues de la relecture du 31/10/2026

Source : `docs/methodologie-decoupage-zones-dentsu-explore.docx` (état du produit au 31/10/2026).
Les constats viennent de la lecture du document, pas du code. Chaque ticket commence donc par une vérification dans le code cité : si le constat est faux ou déjà traité, le ticket est fermé avec une ligne d'explication, sans modification.

## Règles de travail

1. Traiter les lots dans l'ordre (1, 2, 3). Un ticket = un commit, message préfixé par l'identifiant (`A1`, `B8`...).
2. Avant toute modification d'un ticket : lire les fichiers listés, confirmer ou infirmer le constat, écrire le test qui échoue, puis corriger.
3. Ne jamais trancher un point de la section « Arbitrages » : appliquer l'option cochée. Si aucune n'est cochée, appliquer l'option marquée (recommandé) et l'indiquer dans le message de commit.
4. Toute nouvelle borne, limite ou comportement de plateforme va dans la table `plateformes_geo` (migration SQL + `lib/zones/plateformes.ts`), ou dans `plateformes_poids` pour ce qui relève du mécanisme de poids (amendement E2, voir A1), jamais en dur dans le code. La mention « à vérifier » se porte **par paramètre** (drapeau par paramètre, ou liste des paramètres à vérifier dans la ligne), affichée à côté de la valeur concernée, et non par ligne (amendement E9 : la ligne DV360 / CP porte « à vérifier : non » alors que sa plage 0,1 à 10 n'est pas confirmée ; un drapeau par ligne ne sait pas dire quel paramètre est incertain). Fichiers : `lib/zones/plateformes.ts`, migration `plateformes_geo`.
5. Tout refus ou ajustement automatique est annoncé à l'utilisateur avec la valeur avant/après. Aucun ajustement silencieux.
6. À la fin de chaque lot : mettre à jour le document de méthodologie (sections citées) et produire un compte rendu `docs/superpowers/plans/2026-10-31-decoupage-zones-compte-rendu.md` : tickets traités, tickets fermés sans modification (avec la raison), tests ajoutés.
7. A1 mis à l'abri (amendement E6 (1), **fait le 31/10**) : le travail en cours de A1 (21 fichiers et la migration `sql/302` de bornes de multiplicateur) est commité en WIP sur la branche `wip/A1-plan-cp` (commits `3d487d55`, A1 gelé, ARB-1 rouvert, non vérifié, et `e5038093`, script de rollback local de `sql/302`). Le rollback local de `sql/302` est appliqué et la branche de travail est revenue à son état commité, propre. T6 (Q22) et les zones de référence (Q39) se font sur cet état commité, A1 mis de côté. A1 reprend depuis `wip/A1-plan-cp` après la réponse à Q1.
8. Ordre du lot 1 (amendement E6 (2)) : **B11, A2, A1, A8, puis le reste** (A3 à A7). B11 passe en tête parce qu'il change toutes les listes retenues, donc tous les chiffres de référence ; A2 passe avant A1 parce qu'il change l'unité CP (le groupe), dont A1 dépend (à défaut, A1 est écrit sur une abstraction « unité CP » que A2 remplit par le groupe) ; A8 (part prévue, E5) suit A1.
9. Zones de référence (Q39, amendement E6 (3)) : les chiffres attendus sont versionnés **par ticket**. Le commit d'un ticket qui change un chiffre attendu met à jour le fichier d'attendus, avec la raison en une ligne. Sans cela le filet de non-régression casse dès B11.

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
| ARB-7 | Choix de la maille par défaut | [ ] Taux utile simulé maximal sous couverture ≥ 80 % (paramètre partagé avec le seuil optimal D1), sous contraintes de la plateforme (recommandé) : parmi les mailles natives et disponibles dont la couverture simulée atteint la couverture cible, celle de taux utile maximal ; si aucune n'atteint la cible, celle de couverture maximale. Le taux utile seul est un critère dégénéré (il favorise la maille qui retient le moins : un CP unique à 95 % couvrant 10 % de la zone battrait des cercles à 70 % couvrant 90 %). [ ] Ordre de finesse conservé, le cercle classé selon son rayon. |

---

## Lot 1 : contradictions de logique

### B11. Comparaison au seuil sur la part arrondie (déplacé en tête du lot 1, amendement E6)
- Fichiers : `lib/zones/conversion.ts` (appliquerSeuil, estRetenue), `sql/276_paver_cercles.sql`.
- Constat : part arrondie au dixième avant comparaison : 19,96 % passe à 20 % ; à seuil 0 %, une part de 0,02 % affichée 0,0 % est retenue.
- Attendu : comparaison sur la part non arrondie ; à seuil 0, exiger part > 0. L'affichage reste au dixième.
- Test : part 19,96 % et seuil 20 % → non retenue ; part 0,02 % et seuil 0 → retenue, part 0 → non retenue.

### A2. Groupes de CP indiscernables et rattachement des carreaux
- Fichiers : `sql/269_couverture_geometrie.sql`, table `cp_groupe`, `lib/zones/plan.ts` (sql/228), `lib/zones/conversion.ts` (estRetenue).
- Constat : § 2.2 dit « chaque carreau rattaché à un CP » et « carreau sans CP → hors territoire » (contradiction de rédaction). Si un carreau n'a qu'un seul CP, les autres membres d'un groupe n'ont aucune population → part indéterminée → jamais retenus : le groupe ne peut pas être « acheté entier » par la règle du seuil.
- Attendu : le groupe devient l'unité de calcul de la maille CP : une ligne par groupe (identifiant du groupe, liste des codes membres), une seule part, un seul multiplicateur. À l'extraction, la ligne est développée en autant de codes que de membres. Documenter si la division du multiplicateur par le nombre de membres est correcte pour chaque plateforme (dépend de la façon dont la plateforme cumule les poids d'une impression) : la marquer « à vérifier » dans le registre.
- Test : zone couvrant un groupe de 3 codes → une ligne de couverture, part unique ; extraction DV360 → 3 codes avec le même multiplicateur ; somme de la population des lignes = population de la zone.

### A1. Plan par CP : mode pondéré sans effet du seuil
- État (amendement E6 (1)) : travail en cours mis de côté sur `wip/A1-plan-cp` (`3d487d55`, `e5038093`), rollback local de `sql/302` appliqué ; reprise après la réponse à Q1, sur l'unité CP livrée par A2 (règle de travail 7 et 8).
- Fichiers : `lib/zones/plan.ts` (genererPlanCp), `lib/zones/jeu.ts` (poidsDeClasse), `lib/zones/plan-jeu-zone.ts`, `plateformes_geo`.
- Constat : poids = population totale × poids de classe, classes à 1 → plan proportionnel à la population totale de chaque CP touché, retenu ou non. Le seuil ne change pas le plan ; les CP non retenus entrent dans « nombre de CP », la moyenne des multiplicateurs poussés n'est plus 1 ; le résultat est un plan uniforme par habitant.
- Attendu : appliquer ARB-1 et ARB-2. Le plan ne contient que les CP retenus. Ordre des opérations (amendement E4), une seule séquence, identique dans A1 et dans le noyau (`docs/rebid-v2.md` § 2.4) : (1) brut = part × poids de classe sur les CP retenus ; (2) normalisation à moyenne arithmétique non pondérée 1 ; (3) écrêtage à la plage du mécanisme ; (4) pas de renormalisation après écrêtage. La moyenne vaut donc 1 **avant** écrêtage (à l'arrondi près), pas après. Le bilan affiche la moyenne obtenue après écrêtage et le nombre de CP écrêtés. La convention « non pondérée » est un paramètre explicite (voir Q32), car elle fixe la dérive du coût moyen après correction. Borner le plan à la plage du **mécanisme de poids** de la plateforme au lieu de 0,001 / 999,999 (amendement E2) : le registre est indexé (plateforme, maille), mais les poids transitent par des mécanismes différents (multiplicateur géographique DV360, 0,1 à 10, non confirmé ; script de custom bidding DV360, scores par paliers, au plus 2 000 CP par envoi ; paliers Meta et TikTok, non gérés ; répartition de budget par ligne, TTD ? ; aucun poids). Créer une table `plateformes_poids` (ou un bloc de colonnes du registre) : plateforme, maille, mécanisme {multiplicateur, script, budget_ligne, aucun}, valeur_min, valeur_max, pas, nb_max_entrees, nb_paliers_max, branché, à_vérifier. A1, le noyau (Q33) et la quantification (Q36) lisent cette table. Multiplicateur et paliers sont deux sorties du même plan, pas deux plans. DV360 / multiplicateur : 0,1 et 10, à confirmer dans la documentation, marqués « à vérifier » sinon, **sur ces deux paramètres** (valeur_min, valeur_max) et non sur la ligne (amendement E9 : `à_vérifier` est une liste de paramètres, affichée à côté de chaque valeur).
- CP hors zone (amendement E3) : « seuls les CP retenus entrent au plan » s'entend des CP réels. Le plan porte en plus une ligne pseudo-CP `HORS_ZONE` (poids 0 en mode strict, plancher en mode national), avec un drapeau de mode {strict, national} figé à l'extraction. Sa part prévue se calcule comme les autres (E5, ticket A8), avec pour volume attendu la somme des populations totales des CP non retenus du référentiel. Le noyau la traite comme un CP sans département (elle suit sa propre correction). Toute impression livrée sur un CP absent du plan lui est imputée. Une seule définition du plan, partagée avec `docs/rebid-v2.md`.
- Test : jeu de zone avec 3 CP (parts 90 %, 30 %, 12 %), seuil 20 % → plan à 2 CP, moyenne 1, le CP à 90 % a un multiplicateur 3 fois celui du CP à 30 % (ARB-1 option 1). Relever le seuil à 40 % change le plan. Plan de 6 000 CP en mécanisme script → découpé ou agrégé selon nb_max_entrees = 2 000, avec message ; en mécanisme multiplicateur → bornes 0,1 / 10 (E2). Mode strict → `HORS_ZONE` poids 0 et sa part observée affichée comme taux de fuite ; mode national → poids plancher (E3). Seuil 0 %, parts de 0,1 % à 100 % → écrêtage DV360 déclenché, compteur affiché, moyenne avant écrêtage = 1 (E4).

### A8. Part prévue du suivi découplée du multiplicateur (nouveau ticket, amendement E5)
- Fichiers : `sql/107`, `sql/113` (`planned_share = bid_multiplier / Σ bid_multiplier`), `lib/zones/plan.ts`.
- Constat : le suivi calcule la part prévue d'un CP comme multiplicateur ÷ somme des multiplicateurs. Avec ARB-1 (multiplicateur d'enchère, sans population), ce n'est plus une part d'impressions. Or avec Q1 = A et Q9 = A, part prévue = multiplicateur × population totale ÷ Σ = (part × population totale) ÷ Σ = population dans la zone ÷ Σ population dans la zone (× poids de classe) : la normalisation du multiplicateur disparaît du calcul. C'est la part de population en zone, la quantité que l'ancien mode exclusif produisait déjà.
- Attendu : écrire la part prévue directement ainsi en V1, avec le « volume attendu » comme point d'extension : part prévue(cp) = part(cp) × volume(cp) × classe(cp) ÷ Σ, volume = population totale en V1 (Q9 A), `HORS_ZONE` comprise (E3). Dans `sql/107` et `sql/113`, `bid_multiplier / Σ` est remplacé par cette formule. Multiplicateur et part prévue sont découplés : A1 (le multiplicateur) n'est plus bloqué par Q8, seulement par Q1.
- Test : les trois CP de l'exemple (parts 90 / 30 / 12 %, seuil 20 %) → parts prévues 18 000 ÷ 27 000 = 66,7 % et 9 000 ÷ 27 000 = 33,3 %, inchangées si les multiplicateurs sont écrêtés.

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
- Attendu : appliquer ARB-7, critère en deux temps (amendement E1). Parmi les mailles natives et disponibles dont la couverture simulée atteint la couverture cible (80 % par défaut, paramètre partagé avec le seuil optimal D1 / Q40), retenir celle de taux utile maximal ; si aucune n'atteint la cible, celle de couverture maximale. Départage B16 à ± 5 points de taux utile. Dans tous les cas, la règle de défaut tient compte de `plateformes_geo.poussee_branchee` (voir B16) et le défaut retenu est expliqué en une ligne à l'écran, avec les deux chiffres (« couverture 91 %, taux utile 71 %, contre 10 % / 95 % en CP »).
- « À vérifier » par paramètre (amendement E9) : la règle « sûre avant à vérifier » ne regarde que les paramètres qui conditionnent la maille (achetable, bornes de rayon, plafond d'unités), pas la plage de poids. Une ligne dont seule la plage de poids est à vérifier (DV360 / CP) reste une maille sûre.
- Test : anneau de 1 km sur DV360 → cercles proposés ; liste de 40 CP sur Meta → CP proposé avec mention « à vérifier », pas cercles ; zone où la maille CP retient un CP à 95 % couvrant 10 %, et où les cercles couvrent 90 % à 70 % → cercles proposés (E1).

### B10. Rayon par défaut 10 km
- Fichiers : `angular/.../mailles-url.ts`, `lib/zones/conversion-serveur.ts`.
- Constat : une zone plus petite qu'une cellule de 10 km (≈ 260 km²) ne retient aucune cellule à 20 % → refus au réglage par défaut.
- Attendu : rayon par défaut = rayon de la recette s'il existe, sinon R = √(surface de la zone / π) / 3, borné par la plateforme. Si les cercles retenus dépassent le plafond de la plateforme, proposer le plus petit rayon qui passe (recherche dichotomique sur 6 valeurs au plus) au lieu du seul message « augmentez le rayon ».
- Test : zone de 20 km² sur Meta → rayon proposé ≈ 0,8 km ramené à 1 km, au moins 4 cellules retenues ; zone de 30 000 km² → rayon proposé sous le plafond de 200 cercles.

### B11. Déplacé en tête du lot 1 (amendement E6)
- Voir lot 1 : B11 change toutes les listes retenues, donc tous les chiffres de référence ; il passe avant A2, A1 et A8.

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
- Attendu : colonne `poussee_branchee` dans le registre ; pour une maille qui porte des poids, la poussée dépend aussi du mécanisme (colonne `branché` de `plateformes_poids`, amendement E2) ; le défaut l'affiche (« cercles, export manuel » contre « CP, poussée API ») et, si ARB-7 option 1, l'intègre comme critère de départage à taux utile égal (± 5 points).
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
- Cohérence hiérarchique (amendement E7). Constat : CP et IRIS sont attribués par test spatial (centroïde), la commune par « premier code de l'attribut communal INSEE du carreau » (liste `lcog_geo`, ordre non garanti), l'IRIS en recouvrement par « plus petit code ». Rien ne garantit IRIS ⊂ commune ⊂ département pour un même carreau : un carreau peut porter l'IRIS 331850101 et la commune 33200. Les mailles commune (TikTok), IRIS et département deviennent incohérentes entre elles, et avec le rattachement département des CP qu'utilise le noyau. Attendu : dériver la commune de l'IRIS attribué (cinq premiers caractères, arrondissements PLM compris) et le département de la commune ; garder l'attribut INSEE comme contrôle. Invariant testé sur les 2 324 577 carreaux : commune = IRIS[0:5] et département = f(commune), avec un rapport des écarts entre commune dérivée et attribut INSEE (quelques % en bordure sont attendus). Documenter aussi la règle de rattachement département d'un CP à cheval sur deux départements (proposition : département majoritaire en population du CP), car le noyau l'utilise.
- Test : un carreau connu de Paris 16e est rattaché au CP 75016 et à l'arrondissement 75116, pas à 75116 / 75016 inversé par décalage de 100 m. Zéro carreau violant l'invariant après reconstruction ; CP 75016 → département 75 ; un CP à cheval connu → département majoritaire (E7).

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
Traite le lot 1 ticket par ticket, dans l'ordre B11, A2, A1, A8, puis A3 à A7 (amendement E6). A1 reprend depuis la branche wip/A1-plan-cp, après la réponse à Q1. Chaque ticket qui change un chiffre attendu des zones de référence met à jour le fichier d'attendus dans son commit, raison en une ligne. Pour chaque ticket : lis les fichiers listés, confirme ou infirme le constat dans le code, écris le test d'acceptation, corrige, un commit par ticket.
Ne touche pas aux lots 2 et 3 avant d'avoir fini le lot 1 et écrit le compte rendu dans docs/superpowers/plans/2026-10-31-decoupage-zones-compte-rendu.md.
Toute borne ou limite de plateforme va dans plateformes_geo, jamais en dur. Aucun ajustement silencieux : chaque refus ou ajustement affiche avant/après.
Quand un constat est faux ou déjà traité, ferme le ticket avec une ligne d'explication, sans modifier le code.
```
