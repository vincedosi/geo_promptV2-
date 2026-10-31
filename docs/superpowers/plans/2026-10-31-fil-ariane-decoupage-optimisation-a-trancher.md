# dentsu.explore, fil d'Ariane de la carte (① à ⑤) et noyau d'optimisation : relecture et décisions à trancher

Document de relecture, rédigé le 31/10/2026 pour un relecteur qui n'a pas accès au code. Il est autoportant : chaque chiffre vient du code, de la base locale ou des documents de conception du produit, lus le 31/10/2026. Quand un point n'a pas pu être vérifié, il est écrit comme tel. Les noms de fichiers sont donnés en note, pour l'équipe qui appliquera les décisions ; le relecteur n'en a pas besoin.

Mode d'emploi pour le relecteur : lire la synthèse (§ 0), parcourir les étapes (§ 1 et § 2), puis répondre aux questions fermées du § 5, une ligne par question (« Q7 : B », par exemple). Chaque question indique la recommandation de l'équipe ; elle est marquée « (recommandation de l'équipe) » et ne vaut pas décision.

---

## 0. Synthèse

### 0.1 Le produit en une phrase

dentsu.explore est un logiciel SaaS de géomarketing pour l'affichage extérieur et l'affichage numérique (OOH/DOOH) et pour l'achat programmatique géolocalisé. L'utilisateur choisit un territoire, regarde des données (population INSEE au carreau de 200 m, IRIS, codes postaux, points d'intérêt), fabrique une zone, l'analyse, puis la traduit en unités qu'une plateforme d'achat sait cibler (codes postaux, communes, départements, cercles, pays, polygone). Une boucle quotidienne doit ensuite corriger les poids par code postal pour que les impressions livrées suivent le plan.

### 0.2 Le périmètre, sans ambiguïté

**Ce que l'équipe produit livre, et qui doit être impeccable :**

1. Le fil d'Ariane de la carte : ① Périmètre → ② Données → ③ Zones → ④ Analyse → ⑤ Jeu de zones. L'étape ⑤ est le découpage : la conversion d'une zone en codes postaux (CP), IRIS, communes, départements, pays ou cercles, avec la perte chiffrée.
2. Le noyau de l'algorithme d'optimisation : les poids (multiplicateurs) par CP, la correction amortie, les cycles. C'est un module pur : il reçoit des nombres et rend des nombres, sans aucun appel à une plateforme d'achat (DSP).
3. Le registre des règles de plateforme (table `plateformes_geo`) : les règles de chaque plateforme y sont des **paramètres** (mailles admises, plafonds, bornes de rayon, mention « à vérifier »), jamais du code. Le code qui lit ce registre est à nous ; les valeurs, quand elles exigent un vrai compte, sont relevées par l'équipe dentsu.

**Ce que l'équipe dentsu (développeurs et chef de projet) fait :**

1. Les adaptateurs par DSP : poussée vers The Trade Desk (TTD), DV360, Meta, TikTok, et lecture de leurs rapports de livraison.
2. ⑥ Plan côté campagne (budget, CPM, impressions prévues), ⑦ Activation (fichiers et poussées), ⑧ Live (suivi en vol).
3. La vérification des capacités des plateformes dans de vrais comptes, dont le résultat devient une mise à jour du registre, sans livraison de code.

### 0.3 État de chaque étape au 31/10/2026

| Étape | État | En une ligne |
|---|---|---|
| ① Périmètre | **Prêt** | Livré ; le périmètre borne tous les calculs lourds. Un écart avec l'ancienne interface React est assumé. |
| ② Données | **Prêt** | Livré avec le catalogue, les indicateurs privés à un espace et les groupes d'espaces (lot du 28/10, preuve faite). |
| ③ Zones | **Prêt, à corriger** | Livré (finitions du 29/10, preuve faite). Six tickets du plan de corrections le touchent (A5, B8, B15, C19, C20, C21 ; B8 porte ARB-5, rayon minimal de la recette, amendement E10). |
| ④ Analyse | **Prêt** | Livré (finitions du 30/10, preuve faite). Quatre résidus mineurs à trancher. |
| ⑤ Jeu de zones | **À corriger et à trancher** | Livré pour l'essentiel, finitions T0 à T5 faites, revue finale et preuve navigateur (T6) **non faites**. C'est l'étape que touche presque tout le plan de corrections ; le ticket A1, commencé, est mis de côté sur la branche `wip/A1-plan-cp` (amendement E6, 31/10), non vérifié. |
| Noyau d'optimisation | **À construire et à trancher** | **N'existe pas encore comme module.** La spécification v2 est écrite (29/10) ; deux formules concurrentes vivent dans le code (rebid plafonné, recalage amorti). |

### 0.4 Les décisions les plus lourdes

1. **La sémantique du plan par CP (ARB-1) et ses conséquences sur le suivi et le noyau.** Le plan de corrections fixe provisoirement le plan à un « multiplicateur d'enchère » : multiplicateur(CP) = part de couverture du CP ÷ moyenne des parts des CP retenus. Or le suivi calcule toujours la « part prévue » d'un CP comme multiplicateur ÷ somme des multiplicateurs. Avec un multiplicateur d'enchère, ce rapport n'est plus une part d'impressions : un CP de 500 habitants couvert à 100 % « devrait » recevoir plus d'impressions qu'un CP de 50 000 habitants couvert à 50 %. Il faut séparer le multiplicateur envoyé à la plateforme et la part d'impressions prévue (Q8, Q9).
2. **La construction du noyau** selon la spécification v2 (cible = reste à livrer, fenêtre glissante de 7 jours, correction département puis CP avec rétrécissement, une seule formule), et le sort des deux formules actuelles (Q30 à Q36).
3. **La règle de la maille par défaut (ARB-7)** : garder un ordre de finesse fixe ou choisir la maille au taux utile simulé (Q7, Q19).
4. **Les DROM non carroyés (ARB-3)** : acheter avec la mention « population inconnue » ou refuser (Q3).
5. **La calibration du taux utile sur les impressions livrées** plutôt que sur la population résidente : la seule campagne réelle en base montre que les impressions sont loin d'être proportionnelles à la population (§ 4.1, Q38).

---

## 1. Les étapes ① à ⑤, reprises de zéro

Vocabulaire commun à toutes les étapes :

- **Carreau** : maille INSEE Filosofi de 200 m × 200 m, millésime 2021 (ménages fiscaux). Population carroyée, pas population légale.
- **Zone** : une forme géographique unique (éventuellement en plusieurs morceaux) qui garde la **recette** qui l'a produite.
- **Part** d'une unité (CP, commune…) : population de l'unité dans la zone ÷ population totale de l'unité, en %.
- **Seuil** : part minimale pour qu'une unité soit achetée.
- **Taux utile** : part de la diffusion achetée qui tombe dans la zone.
- **Espace** : l'organisation cliente (cinq en base locale : Bercy, BMW GROUP, DRHAT, GENESIS (Global), Marine nationale). Chaque donnée privée appartient à un espace.

Chiffres de référence vérifiés en base le 31/10 :

- Population carroyée totale, sommée par CP : **63 711 780** habitants sur 6 009 CP, dont **62 528 975** en métropole et **1 182 806** dans les CP d'outre-mer. Seules la Martinique et La Réunion sont carroyées (Filosofi 2021) ; Guadeloupe, Guyane et Mayotte ne le sont pas.
- Carreaux rattachés : **2 324 577** dans la table de correspondance carreau → CP / IRIS / commune / département.
- Groupes de CP indiscernables (même contour dans le référentiel) : **71 groupes, 181 codes, jusqu'à 6 codes par groupe**.
- 48 872 IRIS, 34 918 communes (chiffres des messages de refus du produit).
- **Univers de CP** (amendement E10), nommés une fois et chacun à son usage : **référentiel, 6 187 CP** (score composite, noyau d'optimisation) ; **peuplés, 6 009 CP** (plan par CP) ; **métropole peuplés, 5 956 CP** (couverture d'une zone nationale métropolitaine) ; **livrés Adform, 6 030 CP** (seule campagne réelle, § 4.1).

### 1.1 ① Périmètre (« où je regarde »)

**À quoi elle sert.** Fixer l'emprise de travail. Elle cadre la carte et, surtout, **borne tous les calculs lourds** des étapes ③ et ④ : sans périmètre, aucun calcul d'analyse ne part. C'est un garde-fou de charge de la base, né de trois incidents passés où des requêtes sur toute la France ont saturé les entrées-sorties et rendu l'application indisponible pendant des heures.

**Entrées.** Aucune (première étape). Les référentiels régions, départements, communes, CP et les zones enregistrées de l'espace.

**Ce que fait l'utilisateur.** Choisir « France métropolitaine » ou « France + DROM », ou des régions, des départements, une commune, un CP (recherche), ou « Partir d'une zone enregistrée ». La carte cadre le périmètre et assombrit le reste.

**Règles exactes.**

- Le périmètre est un filtre actif d'un des six types : région, département, commune, CP, zone, France. « France » porte un code : `metro` (métropole) ou `france` (France entière, outre-mer compris).
- Un calcul d'analyse est autorisé si un filtre est posé ou si une zone est sélectionnée. Sinon, message : « Choisissez un périmètre (filtre ou zone) avant de lancer un calcul ».
- Sur la France entière, seul le score composite est admis (mesuré à 159 ms sur 6 187 CP le 15/09). Sur la métropole, sont admis le score composite et la bataille d'isochrones V2 (bornée par sa capacité). Le clustering est refusé sur ces périmètres nationaux, avec un message qui nomme l'outil.
- Les recettes coûteuses de ③ (rayon autour de tous les POI d'un type, seuils sur carreaux ou sur territoires) refusent la France entière. Sur la métropole, seul le rayon autour de POI se lance ; les deux seuils sont annoncés « bientôt, en calcul de fond ».
- Emprise maximale de la métropole pour une requête cartographique : longitude −5,5 à 9,8, latitude 41,2 à 51,2.

**Sortie transmise.** Le filtre actif (type, code, libellé). Il sert de garde à ③ et ④ et il est enregistré dans la recette des zones qui en dépendent, pour qu'un recalcul donne la même forme.

**État actuel.** Livré. Le 26/10, les pastilles « France Metro » / « France + DROM » ne bornaient rien (elles n'écrivaient qu'un réglage d'affichage) ; corrigé : elles posent désormais un vrai filtre. Écart assumé : l'ancienne interface React n'a pas reçu ce correctif (elle est gelée et doit être retirée).

**Questions à trancher.** Aucune qui bloque. Une seule question de cohérence : les « calculs de fond » qui ouvriraient les seuils à la métropole sont repoussés après ⑧ (Q37).

> Notes : `lib/carte/garde-perimetre.ts`, `angular/.../logique/perimetre-national.ts`, `lib/zones/recette.ts` (`TYPES_PERIMETRE`).

### 1.2 ② Données (« ce que je vois »)

**À quoi elle sert.** Afficher et régler les jeux de données sur la carte, et connaître leur provenance. ② ne fabrique rien : elle prépare le regard et fournit les catégories de POI et les indicateurs que les recettes de ③ utiliseront.

**Entrées.** Le périmètre de ① ; les droits de l'espace actif.

**Ce que fait l'utilisateur.** Allumer ou éteindre un calque, le régler (indicateur, palette, opacité, relief), chercher un jeu par nom, ouvrir sa fiche.

**Règles exactes.**

- Deux blocs : « Données de l'espace » (POI importés, indicateurs privés, zones, campagnes de l'espace) puis « Données communes », ouvertes sur une **sélection recommandée** propre à l'espace, le reste dans un repli « Plus de données communes (n) ».
- Huit référentiels communs : IRIS, carreaux, indicateurs par CP, transport, flux routier (TMJA), sites à risque industriel et PPRT, santé, météo. Panneaux OOH et radio sont dans un bouton « Autres », hors du fil, non numéroté : on ne fabrique pas de zone avec eux.
- Droits : un espace voit le socle commun, ses propres sources et celles qu'on lui partage. Un **indicateur** peut devenir privé à un espace, avec les mêmes règles et les mêmes gestes d'administration qu'un jeu importé. Un indicateur refusé répond comme un indicateur inconnu (même statut, même message), pour ne pas révéler qu'il existe. Le super administrateur, sur la carte, voit comme l'espace choisi.
- Fiche d'un jeu : propriétaire, niveau, effectif (compteur stocké, jamais un comptage en direct sur les 390 000 POI), date.
- Groupes d'espaces : un simple nom qui range la liste d'administration en dossiers ; il ne porte **aucun** droit.

**Sortie transmise.** La liste des calques affichés et leurs réglages ; indirectement, les catégories de POI et les indicateurs disponibles pour les recettes de ③ (filtrés par les droits).

**État actuel.** Livré et prouvé au navigateur (lot « catalogue et groupes », 28/10 ; preuves D1 à D3 corrigées). L'abstention 2022 a servi de premier indicateur privé (6 186 CP).

**Questions à trancher.** Aucune.

> Notes : plan `docs/superpowers/plans/2026-10-28-carte-en-parcours-catalogue-groupes.md` ; `lib/auth/perimetre-donnees.ts`.

### 1.3 ③ Zones (« ce que je fabrique »)

**À quoi elle sert.** Transformer toute sélection en **une seule zone**, nommée, enregistrée, qui garde sa recette pour pouvoir être recalculée. La forme exacte est la vérité : ③ ne convertit jamais en CP de son propre chef (c'est le rôle de ⑤).

**Entrées.** Le périmètre de ① ; les catégories de POI et indicateurs visibles (②) ; les zones déjà enregistrées.

**Ce que fait l'utilisateur.** Choisir une famille (« Autour des POI », « Par seuil », « À la main », « Combinaisons », « Capture »), régler la recette, voir l'aperçu (la carte recadre si la forme n'est pas visible), enregistrer. Dans « Mes zones » : recalculer, dupliquer, combiner.

**Règles exactes : les recettes et leurs bornes.**

| Recette | Ce qu'elle produit | Bornes | Recalculable |
|---|---|---|---|
| Rayon autour d'un point | Disque calculé sur la sphère, découpé sur le territoire français (mer et étranger retirés) ; la part de surface retenue est affichée (mesure : Marseille, 20 km → 60,5 %) | 100 m à 100 km | oui |
| Rayon autour des POI d'une catégorie | Union des disques, découpée par le périmètre de ① (obligatoire) | 100 m à 50 km ; au plus 10 000 POI | oui |
| Seuil sur carreaux | Union des carreaux entiers dont l'indicateur dépasse (ou reste sous) le seuil | 13 indicateurs ; périmètre au plus un département (≤ 12 000 km²) ; minimum de ménages par carreau 11 par défaut (0 à 1 000) ; au plus 20 000 carreaux | oui |
| Seuil sur territoires | Union des IRIS ou des CP dont l'indicateur passe le seuil | périmètre au plus une région (≤ 100 000 km²) ; « vrais » IRIS seulement ; au plus 5 000 territoires | oui |
| Liste de codes postaux | Union des contours | 1 à 3 000 codes à 5 chiffres | oui |
| Dessin, import GeoJSON / KML, isochrone | La forme fournie, réparée, découpée sur la France | au plus 20 000 sommets | non (figée) |
| Capture (dont score composite) | La forme affichée ; le score garde ses indicateurs et poids pour mémoire | au plus 6 indicateurs, calcul au CP, seuil de score 0 à 100 | non |
| Combinaison | Union, intersection, différence de zones existantes | union 2 à 20 ; **intersection exactement 2** ; différence 2 à 20 (la première moins les suivantes) ; une zone nationale ne se combine pas | non |
| Zone nationale | « France métropolitaine » (547 779 km²) ou « France entière » (636 299 km²), union des régions | aucune | non ; chiffrée sans lire un carreau |

Autres règles :

- Une zone utilisée par un plan, un jeu de zones ou une autre zone **ne se recalcule pas** (sa forme changerait sous ce qui l'achète). « Dupliquer » en fait une nouvelle : recette recalculable → recalculée à neuf ; forme figée → copie.
- Minimum de ménages (secret statistique INSEE : en dessous de 11 ménages, les valeurs d'un carreau sont imputées) : une nouvelle recette « seuil sur carreaux » porte 11 ; une recette d'avant ce réglage, sans valeur, se recalcule avec 0. Mesure en Gironde : 39 918 carreaux sur 54 495 ont moins de 11 ménages ; « ménages pauvres ≥ 40 % » donne 732 carreaux sans minimum, 191 avec un minimum de 11.
- Codes de région et de département normalisés à l'entrée (« 2a » devient « 2A »).
- 93 zones CIRFA de la Marine nationale, orphelines depuis avril, ont été rangées dans « Mes zones » de cet espace comme formes figées.

**Sortie transmise.** Une zone : identifiant, forme, recette, périmètre enregistré, version (date).

**État actuel.** Livré et prouvé (finitions du 29/10). Défauts connus, tous dans le plan de corrections (§ 3) : minimum de ménages absent de la conversion (A5), exactitude d'une zone composée de CP entiers non reconnue (B15), définition des « vrais » IRIS (C19), intersection limitée à deux zones (C20), différence avec une zone nationale impossible (C21). Le contraste du texte teal en thème clair (≈ 1,8:1) est renvoyé à une décision de design globale.

**Questions à trancher.** Q4 (ARB-4), Q5 (ARB-5), Q24, Q25.

> Notes : `lib/zones/recette.ts`, `lib/zones/recette-schema.ts`, `lib/zones/executer-recette.ts` ; plan `2026-10-29-carte-en-parcours-zones.md`.

### 1.4 ④ Analyse (« ce que je calcule »)

**À quoi elle sert.** Chiffrer et comparer, sur la zone analysée ou sur le périmètre, avant de décider ce qu'on achète.

**Entrées.** La zone analysée (de ③) ou le périmètre (①) ; les calques de ②.

**Ce que fait l'utilisateur.** Choisir une analyse, la lancer, la voir peinte sur la carte, l'enregistrer.

**Règles exactes : les analyses disponibles.**

- **Couverture d'une zone** : population et cible, sur la forme telle quelle, ou découpée par CP ou par IRIS. Une zone nationale se découpe par CP ou par département ; par IRIS ou commune, elle est refusée en une phrase. Mesures : zone composite de 13 001 km² (23 073 sommets) → 895 CP en 0,48 s à chaud, 5,18 s à froid pour la forme ; métropole → 5 956 CP en 317 ms, 62 528 975 habitants.
- **Couverture par rayon autour d'un type de POI** : rayon 100 m à 10 km ; périmètre département, commune, CP ou zone ≤ 12 000 km² ; région refusée.
- **Score composite** : jusqu'à 6 indicateurs pondérés, sur les CP de la couverture de la zone (une seule règle « CP d'une zone » partagée par ③, ④ et le score, depuis le 30/10 ; avant, le score prenait 459 CP là où la couverture en prenait 895 sur la même zone).
- **Bataille d'isochrones V2** sur les POI de la catégorie situés dans la zone.
- **Typologies des POI de la zone** : lecture des modèles déjà calculés, ouverte à tous ; le calcul reste au super administrateur. La « population cumulée » est une somme qui compte plusieurs fois les recouvrements, et l'écran le dit.
- **Corrélation** campagne × indicateur : reste en ④ jusqu'à la livraison de ⑧, où elle déménage.
- Retirés : croisements radio/trafic (26/10), bataille V1 (27/10), Voronoï (supprimé partout le 30/10).

**Sortie transmise.** La zone analysée et les analyses peintes. Aucune conversion achetable : ④ informe, ⑤ décide.

**État actuel.** Livré et prouvé (finitions du 30/10). Résidus non traités : libellés de typologie sans accents (à corriger dans le script de calcul) ; un lien partagé de zone affiche encore « Script bidding DV360 » ; le journal de la bataille reste affiché après un changement de zone ; les boutons de la bataille sont en capitales comme dans React, contre la règle de casse du produit ; une migration de retrait (`croisements_zone`) reste à appliquer à la fusion.

**Questions à trancher.** Q26, Q27, Q28.

> Notes : plan `2026-10-30-carte-en-parcours-analyse.md`, section « Suites ».

### 1.5 ⑤ Jeu de zones (le découpage)

**À quoi elle sert.** Figer ce qui sera acheté. L'utilisateur choisit, **plateforme par plateforme**, la maille d'achat ; l'écran montre ce que la plateforme accepte, un lien vers sa documentation officielle, et ce que la maille choisie fait perdre (diffusion hors zone, habitants manqués). Le résultat est une **extraction** immuable, transmise à ⑥ et ⑦.

**Entrées.** Une zone enregistrée (de ③), une cible (population totale par défaut, ou l'une des 24 cibles : tranches d'âge, types de logement, types de ménage), le registre des plateformes.

**Ce que fait l'utilisateur.** Pour chaque plateforme (DV360, Meta, TikTok, The Trade Desk) : choisir la maille, le seuil (défaut 20 %, réglable de 0 à 100 %), le rayon des cercles le cas échéant ; lire le bilan ; enregistrer le jeu ; extraire une version.

**Règles exactes.**

*Attribution de la population.* Un carreau compte entier dans la zone quand son centre est dans la zone (pas de prorata de surface). Le centre est le centroïde géométrique du carreau. Chaque carreau est rattaché une fois pour toutes à un CP (code canonique pour les groupes indiscernables), un IRIS (en cas de recouvrement, le plus petit code), une commune (premier code de l'attribut communal INSEE du carreau) et un département. Le dénominateur d'une unité est compté par la même règle sur les mêmes carreaux : une part ne peut donc pas dépasser 100 %, et une part supérieure à 100 % est une erreur bloquante. Un carreau sans CP (ou sans IRIS) reste dans la population de la zone et apparaît en « hors territoire ».

*Formules.*

```
part (%)           = 100 × population de l'unité DANS la zone ÷ population TOTALE de l'unité
                     (arrondie au dixième, par la base, AVANT la comparaison, voir ticket B11)
unité retenue      ⇔ part ≥ seuil   (borne incluse ; une part inconnue n'est jamais retenue)
population couverte = Σ population dans la zone des unités retenues
diffusion achetée   = Σ population totale des unités retenues
population manquée  = population de la zone − couverte
diffusion hors zone = achetée − couverte
taux utile (%)      = 100 × couverte ÷ achetée, au dixième ; « non défini » si rien n'est acheté
```

Exemple fictif, seuil 20 % : CP A (18 000 dans la zone sur 20 000, part 90 %), CP B (9 000 sur 30 000, 30 %), CP C (3 000 sur 25 000, 12 %). Couverte 27 000, achetée 50 000, manquée 3 000, hors zone 23 000, taux utile 54,0 %. À 40 %, le CP B sort : taux utile 90 %, mais 12 000 habitants manqués.

*Mailles.*

| Maille | Calcul | Particularités |
|---|---|---|
| CP | règle ci-dessus | les groupes indiscernables sont achetés entiers |
| IRIS | règle ci-dessus | calculé, acheté par aucune plateforme |
| Commune | règle ci-dessus | Paris, Lyon, Marseille sortent en arrondissements |
| Département | règle ci-dessus | aucune |
| Cercles | pavage hexagonal ; chaque cellule retenue devient le cercle circonscrit | rayon réglable ; bornes de sécurité : zone ≤ 100 000 km², rayon 1 à 200 km, au plus 5 000 cellules candidates ; une cellule est retenue si part ≥ seuil **et** population totale ≥ minimum de la plateforme (1 000 chez DV360) ; refus au-delà du maximum de la plateforme (200 chez Meta) |
| Pays | zone nationale seulement | « France métropolitaine » → FR ; « France entière » → FR + GP, MQ, GF, RE, YT ; population `null` (jamais 0) pour un DROM non carroyé |
| Polygone | la forme telle quelle | toujours exacte |

Bornes de la couverture : zone de plus de 100 000 km² ou de plus de 400 000 carreaux habités refusée, sauf zone nationale.

*Maille exacte* (taux utile 100 %, sans seuil) : le polygone ; le CP pour une recette « liste de CP » ; le cercle pour un rayon autour d'un point si la plateforme admet ce rayon et si le rayon choisi est celui de la recette ; le pays pour une zone nationale.

*Registre des plateformes, relevé en base le 31/10 (17 lignes).*

| Plateforme | Maille | Achetable | Limites | À vérifier |
|---|---|---|---|---|
| DV360 | CP | oui | plage de multiplicateur 0,1 à 10, **non confirmée** (ajoutée par le ticket A1 en cours) | non *(amendement E9 : la plage est à vérifier ; la mention passe par paramètre)* |
| DV360 | cercle | oui | rayon ≥ 1 km ; ≥ 1 000 habitants par cercle | non |
| DV360 | pays | oui | aucune | DROM |
| DV360 | polygone | non | sans objet | non |
| Meta | cercle | oui | ≤ 200 cercles ; rayon 1 à 80 km | non |
| Meta | CP | oui | ≤ 50 000 CP | **oui** |
| Meta | pays | oui | aucune | DROM |
| Meta | polygone | non | sans objet | non |
| TikTok | département | oui | ≤ 3 000 lieux ; ≥ 1 000 personnes par groupe | non |
| TikTok | commune | oui | ≤ 3 000 lieux ; ≥ 1 000 personnes par groupe | **oui** |
| TikTok | cercle | non | sans objet | **oui** |
| TikTok | CP | non | sans objet | non |
| TikTok | pays | oui | aucune | DROM |
| TTD | polygone, cercle, CP, pays | oui | aucune limite relevée | **oui (les quatre)** |

*Maille par défaut* (règle actuelle) : parmi les mailles natives et disponibles, hors mailles sans objet pour la zone, d'abord une maille sûre avant une maille « à vérifier », puis une maille exacte avant une maille calculée, puis la plus fine dans l'ordre polygone, IRIS, CP, cercle, commune, département (le pays en tête pour une zone nationale, en dernier sinon). Rayon des cercles par défaut : celui de la recette, sinon 10 km.

*Avertir ou refuser.* Refus : maille absente ; rayon hors bornes ; cercles au-delà du maximum ; aucune unité retenue. Avertissement seulement : nombre d'unités au-delà du maximum d'une maille territoriale (ex. plus de 3 000 communes chez TikTok) ; diffusion achetée sous le minimum par groupe (TikTok : 1 000 personnes). Le nombre maximal de sommets d'un polygone n'est vérifié nulle part.

*Plan par CP, tel que le code commité le calcule.* Calculé au seuil le plus bas des plateformes qui achètent au CP.

```
mode exclusif : poids(CP) = population dans la zone × poids de classe si CP retenu, sinon 0
mode pondéré  : poids(CP) = population totale du CP × poids de classe       (mode par défaut)
part(CP)      = poids(CP) ÷ Σ poids ;  multiplicateur = part × nombre de CP
arrondi au millième, plancher 0,001 pour une part non nulle, plafond 999,999 ;
groupe indiscernable : multiplicateur divisé par le nombre de membres
```

Défaut connu (ticket A1) : un jeu de zone n'a qu'une classe « zone » et une classe « hors zone », toutes deux à 1. En mode pondéré, le plan est donc proportionnel à la population totale de **chaque CP touché, retenu ou non** : le seuil ne change pas la répartition.

*Plan par CP, tel que le ticket A1 en cours le calcule (ARB-1, non commité).* Seuls les CP retenus entrent au plan ; multiplicateur(CP) = part(CP) ÷ moyenne des parts des CP retenus × poids de classe ; la population n'entre pas dans la formule ; chaque multiplicateur est ramené à la plage de la plateforme, et chaque borne franchie est annoncée (avant / après). Mode par défaut d'un jeu de zone : exclusif (ARB-2).

**Sortie transmise.** Une extraction immuable : par plateforme, la maille, les unités (codes, populations, retenu ou non), le bilan, et le plan par CP s'il existe. Modifier le registre ensuite ne change pas une extraction déjà produite.

**État actuel.** Convertisseur livré le 25/10 ; finitions T0 à T5 faites (maille pays, extraction nationale, fichier « pays » pour ⑦, cible et mode dans l'adresse, chiffres du refus des cercles). **Restent : la revue finale et la preuve navigateur (T6), puis les 29 tickets du plan de corrections**, dont A1 commencé (21 fichiers modifiés et une migration de bornes de multiplicateur, non vérifiés par les tests), mis de côté le 31/10 sur la branche `wip/A1-plan-cp` avec un script de rollback de la migration, rollback local appliqué (amendement E6).

**Questions à trancher.** Q1 à Q7 (arbitrages), Q8 à Q23.

> Notes : `lib/zones/conversion.ts`, `plan.ts`, `plan-jeu-zone.ts`, `extraction-jeu-zone.ts`, `plateformes.ts` ; SQL `sql/266`, `269`, `275`, `276`, `296`, `300`, `302` ; méthodologie `C:\GENESIS\methodologie-decoupage-zones-dentsu-explore.docx`.

---

## 2. Le noyau d'optimisation

**À quoi il sert.** Une campagne programmatique laissée seule dépense là où les impressions sont les moins chères, pas forcément là où est la cible. Le noyau donne à chaque CP un poids, puis, chaque jour, compare ce qui a été livré à ce qui était prévu et ajuste les poids pour rattraper l'écart. Il ne parle à aucune plateforme : les adaptateurs de l'équipe dentsu lui apportent les livraisons et emportent les poids.

**La boucle en huit étapes** (document « L'algorithme d'optimisation des impressions », version du 26/10) : ① poids de chaque CP ; ② part du plan ; ③ impressions prévues ; ④ impressions livrées ; ⑤ rythme attendu ; ⑥ mesure de l'écart ; ⑦ correction des poids ; ⑧ renvoi à la plateforme. Les étapes 1 à 3 tournent une fois au lancement, 4 à 8 chaque jour. Le noyau couvre les calculs des étapes 1, 2, 6 et 7 et la quantification de l'étape 8 ; l'arrivée des données (4) et l'envoi (8) sont aux adaptateurs.

**Entrées.** Le plan figé de l'extraction (poids et part par CP, rattachement département) ; la durée de la campagne et les jours écoulés ; les impressions prévues ; par CP, les impressions livrées cumulées et sur une fenêtre récente.

**Règles exactes : ce qui existe dans le code aujourd'hui (deux formules concurrentes).**

1. *Rebid plafonné* (suivi de campagne) : facteur = borner(part prévue ÷ max(part livrée ; 0,001) ; 0,5 ; 1,5) ; poids × facteur ; renormalisation à 100 par zone.
2. *Recalage amorti* (simulateur du module risque) : correction(zone) = borner(plan ÷ observé ; 1/3 ; 3) ^ 0,8 ; × 0,6 si la part du CP dans la zone est sous 20 % ; recentrage sur une moyenne de 1 ; bornes 0,001 et 999,999.

Les deux ne donnent pas les mêmes poids. Exemple de la campagne de démonstration sur quatre départements : facteurs 1,209 / 1,159 / 0,618 / 0,587 avec la première, 1,164 / 1,125 / 0,680 / 0,653 avec la seconde.

**Règles exactes : la spécification v2 (29/10), à implémenter.** Notations pour une campagne, une plateforme, au jour J :

```
N = jours de campagne ; j = jours écoulés (borné à [1, N]) ; R = N − j (si R = 0 : pas de correction)
prevu(z)      = part_plan(z) × impressions prévues totales
reste(z)      = max(0, prevu(z) − livré_cumulé(z))
cible_part(z) = (reste(z) / R) ÷ Σ (reste / R)
F             = min(7, j) ; pas de correction si F < 3
obs_part(z)   = livré sur les F derniers jours (z) ÷ Σ
ratio(z)      = cible_part(z) ÷ max(obs_part(z) ; 1e-6)

département : corr_dep(d) = borner(ratio(d) ; 1/3 ; 3) ^ α          α = 0,8
CP          : corr_brut(cp) = borner(ratio(cp) ; 1/3 ; 3) ^ α
              λ(cp) = n(cp) ÷ (n(cp) + k)    n = impressions du CP sur la fenêtre, k = 200
              corr(cp) = corr_dep(dép(cp)) ^ (1 − λ) × corr_brut(cp) ^ λ
poids'(cp)  = borner(poids(cp) × corr(cp) ; 0,001 ; 999,999), puis ÷ moyenne (moyenne = 1)
```

Si la somme des cibles journalières vaut 0 : pas de correction, alerte « plan atteint ». Un CP du plan jamais servi existe dans le calcul avec une part observée nulle, donc suit la correction de son département.

Invariants à tester : poids inchangés si la livraison suit le plan (à 1e-9) ; moyenne des poids = 1 ; corr(cp) dans [0,415 ; 2,408] ; un CP sans impression sur la fenêtre suit son département ; en réponse proportionnelle simulée, l'erreur logarithmique est multipliée par au plus 0,25 par itération, ce qui ne vaut que pour λ ≈ 1, c'est-à-dire pour les CP bien servis (amendement E10) ; pas de dérive de la cible ; le coefficient 0,6 n'apparaît plus dans la correction.

Quantification pour le script de custom bidding (paliers par valeur de poids, moyenne 1) : ≥ 2,0 ; 1,4 à 2,0 ; 0,8 à 1,4 ; 0,5 à 0,8 ; 0 à 0,5. Score d'un palier = médiane des poids du palier, à deux décimales. Hors zone : 0 en zones strictes, 0,8 × poids minimal en mode national. Au plus 2 000 CP par envoi.

Corrections annexes prévues par la spécification : unité des parts (fractions, pas pourcentages) ; CP du plan jamais servis présents dans les tableaux de suivi ; « jours livrés » comptés sur la dernière date réellement disponible ; univers des CP pris dans le référentiel complet ; seuils (0,85 / 1,15 / 1,25 / 70 % / 5 % / ±20 %, α, k, bornes des paliers) rendus réglables par campagne.

Critères d'acceptation : sur la campagne de démonstration au 30/04, corrections départementales dans l'ordre 13 > 59 > 1 > 75 ≈ 29 ; simulateur proportionnel < 0,5 point d'écart moyen après 3 itérations, simulateur saturant < 1 point après 5, sans oscillation ; 20 itérations conformes → poids stables à 1e-6.

**Sortie.** Les nouveaux poids par CP, les corrections par département et par CP, les parts cible et observée, la fenêtre utilisée, un statut (« ok », « pas de correction », « plan atteint ») et, pour le script, les paliers. Le stockage des cycles (une table d'historique des cycles a été validée le 26/10 dans l'architecture) n'existe pas encore en base.

**État actuel.**

- Le module noyau **n'existe pas** : aucun dossier, aucune table de cycles, aucune table de réglages par campagne. La spécification v2 n'est pas dans la branche de travail de la carte (elle est dans la branche d'intégration).
- Les deux formules actuelles sont testées et vivantes dans des modules différents ; aucune ne gère la fenêtre glissante ni la hiérarchie département → CP.
- Le coefficient de dilution 0,6 que la spécification déplace dans le plan (« ×0,6 si la part du CP dans la zone est sous 20 % ») n'y est pas implémenté.

**Tensions avec le ticket A1 (à trancher avant de coder le noyau).**

1. *Part prévue.* Le suivi calcule la part prévue d'un CP comme multiplicateur ÷ somme des multiplicateurs. Avec l'ancienne sémantique (multiplicateur = part × nombre de CP), c'était bien une part d'impressions. Avec ARB-1 (multiplicateur d'enchère, sans population), ce n'en est plus une. Le modèle même de la correction suppose que la part livrée est proportionnelle au poids **multiplié par une « facilité » propre au CP** ; il faut donc une part prévue d'impressions distincte, par exemple multiplicateur × volume attendu du CP (population totale, ou impressions observées) ÷ somme (Q8, Q9).
2. *Dilution.* Avec ARB-1, seuls les CP retenus (part ≥ seuil, 20 % par défaut) entrent au plan ; la règle « ×0,6 si part < 20 % » ne s'appliquerait plus jamais au seuil par défaut. Elle est soit redondante, soit à réserver aux seuils inférieurs à 20 % (Q34).
3. *Bornes.* La spécification borne les poids à 0,001 / 999,999 ; le registre porte désormais une plage par plateforme (0,1 à 10 pour DV360, non confirmée). Le noyau doit lire la plage du registre (Q33).

**Questions à trancher.** Q8, Q9, Q30 à Q36.

> Notes : spécification `docs/rebid-v2.md` (commit `5472d941`, branche `feat/angular-lot0`) ; formules actuelles `lib/pacing/rebid.ts`, `lib/simulation/recalage.ts` (paramètres par défaut dans `lib/simulation/generateur.ts` : amortissement 0,8, seuil de dilution 20, baisse 0,6) ; part prévue du suivi `sql/107` et `sql/113` (`planned_share = bid_multiplier / Σ bid_multiplier`) ; document `C:\GENESIS\algorithme-optimisation-impressions-dentsu-explore.docx`.

---

## 3. Les 29 corrections en cours (relecture du 31/10)

Source : plan de corrections du découpage des zones, issu de la relecture de la méthodologie. Trois lots, à traiter dans l'ordre ; un ticket = un commit ; chaque ticket commence par vérifier le constat dans le code, et se ferme sans modification s'il est faux. Règles transverses : toute borne de plateforme va dans le registre, jamais en dur ; tout refus ou ajustement automatique est annoncé avec la valeur avant / après.

### 3.1 Les arbitrages ARB-1 à ARB-7

**Ils sont provisoirement fixés à l'option recommandée par le plan et doivent être confirmés** (questions Q1 à Q7). Le ticket A1 en cours applique déjà ARB-1 et ARB-2.

| Réf. | Question | Option appliquée provisoirement | Autre option |
|---|---|---|---|
| ARB-1 | Sémantique du plan par CP | Multiplicateur d'enchère : part(CP) ÷ moyenne des parts des retenus × poids de classe | Répartition de budget : population dans la zone × poids de classe, restreinte aux retenus |
| ARB-2 | Mode par défaut d'un jeu de zone | Exclusif tant qu'une seule classe est définie | Pondéré, poids « hors zone » = 0 par défaut |
| ARB-3 | Unité à population inconnue (DROM non carroyés) | Achetable avec la mention « population inconnue », même règle pour CP, département, pays | Refusée partout, y compris au pays |
| ARB-4 | Minimum de ménages à la conversion | Appliqué dès qu'une cible autre que la population totale est choisie | Jamais appliqué, part de population imputée affichée |
| ARB-5 | Rayon minimal de la recette « rayon autour d'un point » | 250 m | 100 m conservé, prorata de surface des carreaux sous 2 km² |
| ARB-6 | Dépassement du nombre d'unités d'une maille territoriale | Découpage automatique en N groupes triés par part décroissante | Refus |
| ARB-7 | Maille par défaut | Taux utile simulé maximal sous couverture ≥ 80 % (sinon couverture maximale), sous contraintes de la plateforme (amendement E1) | Ordre de finesse conservé, cercle classé selon son rayon |

### 3.2 Répartition vérifiée ticket par ticket

Le tri initial donnait à l'équipe dentsu A7, B14, B16, C27, C28, C29. Vérification faite, **seul C28 est purement une affaire de compte de plateforme**. Les cinq autres portent du code de ⑤ ou du registre, qui est à nous ; seule la **valeur** à confirmer dans un compte revient à dentsu. Ils sont reclassés « nous », avec une sous-tâche dentsu. Inversement, deux tickets « nous » portent une sous-tâche de vérification dentsu (A1, A2).

**Lot 1 : contradictions de logique**

| Ticket | Objet | Résumé du constat et de l'attendu | Porteur | État |
|---|---|---|---|---|
| A1 | Plan par CP : le seuil sans effet en mode pondéré | Plan restreint aux CP retenus, moyenne des multiplicateurs = 1, plage de multiplicateur par plateforme dans le registre (DV360 0,1 à 10, « à vérifier ») | Nous ; **valeur DV360 à confirmer : dentsu** | **Mis de côté sur `wip/A1-plan-cp` (E6), reprise après Q1** |
| A8 | Part prévue du suivi (nouveau, amendement E5) | Part prévue = part × volume attendu × classe ÷ Σ (en V1 la part de population en zone), découplée du multiplicateur ; remplace `bid_multiplier / Σ` dans le suivi | Nous | À faire, après A1 |
| A2 | Groupes de CP indiscernables | Le groupe devient l'unité de calcul (une ligne, une part, un multiplicateur), développé en codes à l'extraction | Nous ; **cumul des poids par plateforme à confirmer : dentsu** | À faire |
| A3 | Cercle « exact » d'un rayon en frontière | Exact seulement si 100 % de la surface est retenue ; sinon perte calculée et avertissement « restreindre la campagne au pays FR » | Nous | À faire |
| A4 | Unité à population inconnue | Même règle (ARB-3) pour CP, commune, département, pays ; « diffusion à population inconnue » au bilan | Nous | À faire |
| A5 | Minimum de ménages absent de la conversion | ARB-4 ; toute recette ancienne reçoit explicitement 0, affiché | Nous | À faire |
| A6 | Bilan des cercles : cellule ou disque | Bilan sur l'union dédoublonnée des disques ; population par cercle = celle du disque (le disque circonscrit vaut 1,21 fois l'hexagone) | Nous | À faire |
| A7 | Sommets et morceaux du polygone | Simplification à l'extraction (tolérance 50 m), contrôle contre le registre, refus chiffré, perte affichée au-delà de 0,1 % | **Nous (reclassé)** ; valeurs TTD à relever : dentsu | À faire |

**Lot 2 : bornes et règles**

| Ticket | Objet | Résumé | Porteur | État |
|---|---|---|---|---|
| B8 | Rayons : recette, pavage, plateformes | ARB-5 ; tout rayon ajusté aux bornes d'une plateforme est annoncé (« rayon ajusté de X à Y, maille non exacte ») | Nous | À faire |
| B9 | Maille par défaut | ARB-7 (critère en deux temps, E1) ; défaut expliqué en une ligne avec les deux chiffres (« couverture 91 %, taux utile 71 %, contre 10 % / 95 % en CP ») | Nous | À faire |
| B10 | Rayon par défaut 10 km | R = √(surface / π) / 3, borné par la plateforme ; si trop de cercles, proposer le plus petit rayon qui passe (6 essais au plus) | Nous | À faire |
| B11 | Comparaison au seuil sur la part arrondie | Comparer la part non arrondie ; à seuil 0, exiger part > 0. **Constat confirmé** : la base arrondit la part au dixième avant que le code ne la compare | Nous | À faire |
| B12 | Un plan par plateforme | Chaque plateforme au CP reçoit un plan à son propre seuil | Nous | À faire |
| B13 | Minimums de population par unité et par groupe | Deux paramètres de registre, chacun avec son comportement (refus ou avertissement) ; le cercle exact unique passe par le même contrôle | Nous | À faire |
| B14 | Dépassement du nombre d'unités | ARB-6 ; blocs numérotés à l'extraction, bilan par bloc | **Nous (reclassé)** : la mise en fichiers de ⑦ suit, côté dentsu | À faire |
| B15 | Exactitude par composition | La recette garde ses unités constitutives ; l'exactitude se fonde sur elles, pas sur le type de recette | Nous | À faire |
| B16 | Poussée branchée dans la règle de défaut | Paramètre « poussée branchée » dans le registre, affiché et utilisé comme départage à ±5 points de taux utile | **Nous (reclassé)** ; la valeur suit l'état des adaptateurs : dentsu | À faire |

**Lot 3 : registre, chiffres, documentation**

| Ticket | Objet | Résumé | Porteur |
|---|---|---|---|
| C17 | Périmètre du « 63,8 M » | **Constat chiffré** : la somme par CP vaut 63 711 780, soit 63,7 M (62 528 975 en métropole + 1 182 806 outre-mer carroyé) ; « 63,8 M » est inexact | Nous |
| C18 | Dérive d'arrondi (−230 habitants sur 895 CP) | Trouver la troncature, répartir au plus fort reste | Nous |
| C19 | « Vrais » IRIS | Définir le critère, dire si les communes non irisées sont exclues | Nous |
| C20 | Intersection limitée à 2 zones | Aligner sur 2 à 20 | Nous |
| C21 | Différence avec une zone nationale | Autoriser « zone nationale moins zones locales » | Nous |
| C22 | Numérotation des étapes dans la méthodologie | Définir ① à ⑤ une fois | Nous |
| C23 | Datation | Une ligne unique de dates en tête | Nous |
| C24 | Glossaire et cibles | Ajouter IRIS, « Cible » ; la diffusion achetée reste en population totale ; vérifier le code | Nous |
| C25 | Règle carreau → CP / IRIS / commune | **Constat partiel** : le point testé est le centroïde géométrique du carreau (pas le coin de l'identifiant INSEE) ; la commune vient d'un attribut INSEE du carreau, pas d'un test spatial ; millésime des contours à documenter | Nous |
| C26 | Surfaces nationales | Qualifier 547 779 et 636 299 km² de « surface du référentiel de contours » | Nous |
| C27 | TTD parmi les plateformes à cercles | Correction de la méthodologie (le registre dit déjà oui, « à vérifier ») | **Nous (reclassé)** |
| C28 | Registre DV360 incomplet | Relever dans un compte : CP maximum par liste, cercles maximum, rayon maximum | **dentsu** |
| C29 | Meta, catégories d'annonces spéciales | Borne conditionnelle de rayon (≥ 15 km en Europe) et case « catégorie spéciale » sur le jeu | **Nous (reclassé)** ; la valeur à confirmer : dentsu |

**Bilan de la répartition.** Nous : 28 tickets (dont 6 avec une valeur à confirmer par dentsu : A1, A2, A7, B16, C29, et B14 dont les fichiers de ⑦ suivent). Dentsu seul : C28.

**Backlog hors lots (rappel)** : D1 seuil optimal proposé ; D2 versionnage des zones ; D3 recettes « liste de communes » et « liste de départements » ; D4 catalogue unique d'indicateurs ; D5 incertitude de discrétisation sous 2 km² ; D6 IRIS calculé à la demande ; D7 isochrone recalculable ; D8 agrégation des arrondissements de Paris, Lyon et Marseille en commune entière.

> Notes : `C:\GENESIS\2026-10-31-decoupage-zones-corrections.md` (copie dans `docs/superpowers/plans/`).

---

## 4. Propositions complémentaires à trancher

### 4.1 (a) Calibrer le taux utile sur les impressions livrées plutôt que sur la population résidente

**Problème.** Le taux utile suppose que les impressions servies dans un CP se répartissent comme sa population résidente. Si un CP reçoit beaucoup plus (ou beaucoup moins) d'impressions que sa population ne le laisse attendre, le taux utile affiché et le plan sont faussés.

**Constat en base locale, 31/10 (lecture seule).**

- La table des livraisons compte **1 038 459 lignes** (394 Mo) réparties sur **5 campagnes** seulement. Quatre sont synthétiques : « Démo pilotage, élections » (306 150 lignes, démonstration), deux simulations Seveso (217 823 et 167 977 lignes), « [DEMO] Risque industriel » (174 780 lignes). Elles ne peuvent pas servir à calibrer.
- **Une seule campagne réelle** : « Démo : campagne nationale (données réelles) », importée d'Adform le 14/04/2026, **171 729 lignes**. Elle a des limites fortes :
  - **aucune date** sur aucune ligne : aucune période connue, aucune série quotidienne ;
  - la colonne « impressions » est vide ; seul le compteur « tracked ads » est rempli (70 844 538 au total). L'équivalence avec des impressions n'est pas vérifiée ;
  - aucune dépense renseignée ;
  - 7 médias : Criteo 21,1 M, Amnet 17,5 M, Adot 15,1 M, Azerion 6,7 M, Enovate 6,4 M, TikTok 3,9 M, Meta 0 ;
  - campagne nationale, sans zone : elle ne dit rien d'une zone fine.
- Sur la France : **66 027 585** « tracked ads » sur **6 030 CP** ; 5 940 CP rapprochés de la population carroyée, 89 CP livrés sans population connue, 69 CP peuplés sans aucune livraison.
- Comparaison part d'impressions / part de population par CP (5 940 CP) :
  - corrélation linéaire 0,397 ; corrélation des logarithmes 0,792 ;
  - rapport médian 0,48 ; 10e centile 0,24 ; 90e centile 2,09 ;
  - **37,3 %** des CP seulement sont à moins d'un facteur 2 de leur part de population ; 9,8 % à ±25 % ;
  - le 1 % des CP les plus livrés reçoit 26,9 % des impressions pour 6,8 % de la population ; les 10 % les plus livrés reçoivent 64,6 % pour 35,5 % ;
  - le CP 75001 reçoit 3,46 % des impressions pour 14 421 habitants : très probablement un artefact de géolocalisation (adresse IP rattachée au CP par défaut d'une ville). Les CP suivants (34000, 13001, 66000, 13008) vont dans le même sens. Ce point est une hypothèse, non vérifiée.

**Lecture.** La livraison réelle est fortement concentrée sur les centres urbains et sur des CP par défaut. Le taux utile fondé sur la population résidente porte donc un biais de sens inconnu, d'amplitude probablement forte (rapport médian 0,48 ; 37 % des CP à moins d'un facteur 2) : le sens dépend de la corrélation entre part et inventaire à l'intérieur de l'ensemble retenu, que les données citées ne mesurent pas. ~~Le taux utile fondé sur la population résidente est donc une approximation optimiste pour les zones périurbaines et rurales.~~ *(Amendement E10.)* Mais la seule donnée disponible ne permet pas de calibrer proprement : une campagne, sans date, sans zone, avec des artefacts de géolocalisation.

**Options.**

- A. Garder la population résidente comme référence en V1, et écrire la limite dans l'écran et la méthodologie. Coût S. Risque : taux utile surestimé hors des villes.
- B. Calibrer dès maintenant un « indice d'inventaire par CP » sur cette seule campagne (part d'impressions ÷ part de population, lissé vers 1, artefacts écrêtés), et l'utiliser comme pondération du taux utile. Coût M. Risque élevé : un seul échantillon, sans période, mélange de médias ; l'indice figerait les artefacts.
- C. Préparer dès maintenant le calcul pour qu'il accepte un « volume attendu par CP » paramétrable (population par défaut), et ne le calibrer qu'avec des livraisons datées par CP venant des adaptateurs dentsu (plusieurs campagnes, au moins plusieurs semaines). Coût S pour la préparation, M pour la calibration plus tard. Risque faible.

Formule de la variante pondérée, si elle est retenue : taux utile = Σ sur les CP retenus de (part de couverture × volume attendu du CP) ÷ Σ volume attendu des CP retenus. Elle suppose encore qu'à l'intérieur d'un CP les impressions se répartissent comme la population.

**Recommandation de l'équipe :** C, avec A pour l'affichage en V1 ; B seulement comme essai interne. Le même « volume attendu par CP » sert la part prévue du noyau (Q9) : une seule notion pour les deux.

### 4.2 (b) Un jeu de zones de référence chiffrées en test de non-régression

**Problème.** Les règles de ⑤ vont changer (29 tickets). Sans zones de référence aux chiffres figés, une régression passe inaperçue : les tests actuels utilisent surtout des données qu'ils créent eux-mêmes.

**Proposition.** Cinq zones de référence, chacune avec ses chiffres attendus (population, unités retenues, taux utile, pour chaque maille et chaque plateforme), relus à chaque modification :

| Zone | Ce qu'elle verrouille | Chiffres déjà connus |
|---|---|---|
| Gironde (seuil sur carreaux, « ménages pauvres ≥ 40 % ») | minimum de ménages, seuils, maille CP | 54 495 carreaux, dont 39 918 sous 11 ménages ; 732 carreaux sans minimum, 191 avec 11 |
| Rayon de 20 km autour de Strasbourg | frontière terrestre, cercle non exact (A3) | à mesurer |
| Arrondissements de Paris | groupes de CP indiscernables, PLM, rattachement 75016 / 75116 (C25) | à mesurer |
| Un DROM (Martinique carroyée, et Guadeloupe non carroyée) | population inconnue (ARB-3, A4) | Martinique 306 745 hab., La Réunion 884 165 ; Guadeloupe, Guyane, Mayotte sans population |
| France métropolitaine | zone nationale, maille pays, CP, département | 62 528 975 hab. ; 5 956 CP ; 96 départements |

La zone composite de 13 001 km² (895 CP, dérive d'arrondi de −230 habitants) est un sixième candidat naturel pour C18.

**Options.** A. Ne rien ajouter. B. Les cinq zones, chiffres figés en test d'intégration sur la base locale. C. B plus la zone composite.

**Coût.** S à M (les zones se créent par recette ; les chiffres se relèvent une fois puis se figent). **Risque.** Chiffres à refiger quand les données INSEE changent de millésime ; c'est voulu.

**Recommandation de l'équipe :** C, construite avant le lot 1 pour servir de filet aux tickets, sur l'état commité de la branche de travail, A1 mis de côté (amendement E6).

**Attendus versionnés par ticket (amendement E6 (3)).** Les chiffres attendus des zones de référence sont versionnés par ticket : le commit d'un ticket qui change un chiffre attendu met à jour le fichier d'attendus, avec la raison en une ligne. Sans cela, le filet de non-régression casse dès B11, premier ticket du lot 1 (ordre du lot 1 : B11, A2, A1, A8, puis le reste), qui change toutes les listes retenues.

### 4.3 (c) Un seuil optimal proposé

**Problème.** Le seuil de 20 % est arbitraire. Un seuil bas couvre mieux la zone mais achète davantage hors zone ; un seuil haut fait l'inverse et vide le plan dans les zones rurales. Mesure connue : taux utile 75,9 % à 20 %, 88,4 % à 35 % (document d'algorithme, zone de démonstration).

**Proposition (backlog D1).** À partir des parts déjà calculées, tracer la courbe couverture / taux utile en fonction du seuil, et proposer le seuil qui maximise le taux utile sous une couverture cible (80 % de la population de la zone par défaut). Le calcul est local à l'écran : les parts sont déjà là, aucune lecture de base en plus.

**Options.**

- A. Ne rien proposer (seuil fixe à 20 %).
- B. Afficher la courbe seulement, sans proposition.
- C. Courbe + seuil proposé à 80 % de couverture, l'utilisateur garde la main ; défaut de seuil par maille dans le registre.
- D. Appliquer automatiquement le seuil optimal.

**Coût.** B : S. C : S à M. D : M. **Risque.** D contredit la règle « aucun ajustement silencieux » ; C reste explicite. Pour les cercles, la courbe demande un recalcul par seuil (la rétention des cellules dépend aussi du minimum de population).

**Recommandation de l'équipe :** C, après le lot 2 (elle dépend de B11 et B12).

### 4.4 (d) Population présente plutôt que résidente pour l'OOH (après la V1)

**Problème.** Un panneau d'affichage est vu par les gens qui passent, pas seulement par ceux qui habitent là. La population résidente sous-estime les zones d'emploi et de commerce, et surestime les zones dortoirs en journée.

**Proposition.** Construire une population « présente » de jour à partir des flux domicile-travail de l'INSEE (fichier des mobilités professionnelles), au niveau commune, puis la descendre au carreau au prorata d'un indicateur à définir. Aucune mesure n'a été faite dans le cadre de ce document ; les volumes et la faisabilité au carreau sont **à vérifier**.

**Options.** A. Ne rien faire. B. Étude de faisabilité seule (données, granularité, méthode de descente). C. Cible « population présente de jour » ajoutée aux 24 cibles existantes.

**Coût.** B : S. C : L. **Risque.** Méthode de descente de la commune au carreau discutable ; double source de vérité si mal isolée.

**Recommandation de l'équipe :** B après la V1, C seulement si un client OOH le demande.

---

## 5. Questions à trancher

Répondre ligne à ligne, par la lettre de l'option. « (R) » marque la recommandation de l'équipe.

**Réponses de Vincent (31/10/2026) : Q1 à Q7 = A, avec conditions.**
- Q1 (ARB-1) : A, avec la séquence E4 (brut = part × classe sur les CP retenus, normalisation à moyenne arithmétique non pondérée 1, écrêtage à la plage du mécanisme, pas de renormalisation) et le ticket A8 pour la part prévue. La plage DV360 0,1 à 10 reste « à vérifier » tant que dentsu ne l'a pas confirmée dans un compte.
- Q2 (ARB-2) : A.
- Q3 (ARB-3) : A, avec la ligne « diffusion à population inconnue » séparée dans le bilan (A4).
- Q4 (ARB-4) : A. Q5 (ARB-5) : A. Q6 (ARB-6) : A.
- Q7 (ARB-7) : A, avec les deux chiffres (couverture, taux utile) affichés dans la ligne d'explication.

**Arbitrages du plan de corrections (provisoirement appliqués, à confirmer)**

- **Q1 : ARB-1, sémantique du plan par CP.** A. Multiplicateur d'enchère (part ÷ moyenne des parts des retenus × poids de classe) (R). B. Répartition de budget (population dans la zone × poids de classe, restreinte aux retenus).
- **Q2 : ARB-2, mode par défaut d'un jeu de zone.** A. Exclusif tant qu'une seule classe existe (R). B. Pondéré avec « hors zone » à 0.
- **Q3 : ARB-3, unité à population inconnue.** A. Achetable avec « population inconnue », même règle pour toutes les mailles (R). B. Refusée partout.
- **Q4 : ARB-4, minimum de ménages à la conversion.** A. Appliqué dès qu'une cible autre que la population totale est choisie (R). B. Jamais appliqué, part imputée affichée.
- **Q5 : ARB-5, rayon minimal autour d'un point.** A. 250 m (R). B. 100 m avec prorata de surface sous 2 km².
- **Q6 : ARB-6, dépassement du nombre d'unités d'une maille territoriale.** A. Découpage en N blocs par part décroissante (R). B. Refus.
- **Q7 : ARB-7, maille par défaut.** A. Taux utile simulé maximal sous couverture ≥ 80 % (paramètre partagé avec le seuil optimal) (R) ~~A. Taux utile simulé sous contraintes de la plateforme (R).~~ B. Ordre de finesse conservé. *(Amendement E1 : le taux utile seul favorise la maille qui retient le moins ; si aucune maille n'atteint la couverture cible, celle de couverture maximale ; départage B16 à ± 5 points.)*

**Plan par CP et lien avec le noyau**

- **Q8 : Si Q1 = A, que vaut la « part prévue » d'un CP dans le suivi ?** A. Part prévue = part × volume attendu × classe ÷ Σ, soit en V1 la part de population en zone, indépendante du multiplicateur (R) ~~A. Une part d'impressions distincte : multiplicateur × volume attendu du CP ÷ somme (R).~~ B. Multiplicateur ÷ somme des multiplicateurs (comportement actuel, faux avec un multiplicateur d'enchère). ~~C. Revenir à Q1 = B pour garder une seule notion.~~ *(Amendement E5 : option C supprimée, plus nécessaire ; la correction de la part prévue devient le ticket A8, lot 1, et A1 n'est plus bloqué par Q8, seulement par Q1.)*
- **Q9 : Volume attendu d'un CP (pour Q8 et § 4.1).** A. Population totale carroyée du CP en V1, remplaçable plus tard par un volume observé (R). B. Population dans la zone. C. Impressions observées dès maintenant. *(Amendement E5 : question inchangée ; elle fixe le « volume attendu » de la formule de Q8 A.)*
- **Q10 : Arrêter ou poursuivre le ticket A1 en cours avant la réponse à Q1 et Q8 ?** A. Commit WIP sur branche dédiée, reprise après la réponse à Q1 (R) ~~A. Le geler jusqu'aux réponses, puis le reprendre (R).~~ *(Amendement E6 : l'option A est **déjà appliquée** le 31/10 : A1 est commité en WIP sur la branche `wip/A1-plan-cp` (commits `3d487d55` et `e5038093`, ce dernier portant le script de rollback local de `sql/302`), le rollback local de `sql/302` est appliqué et la branche de travail est revenue à son état commité, propre. Depuis E5, A1 ne dépend plus que de Q1.)* B. Le terminer tel quel. C. L'abandonner.
- **Q11 : Plage du mécanisme de poids DV360 « multiplicateur » (0,1 à 10, non confirmée).** ~~Q11 : Plage de multiplicateur DV360 (0,1 à 10, non confirmée).~~ A. La garder marquée « à vérifier » dans le registre du mécanisme et la faire confirmer par dentsu (R) ~~A. La garder marquée « à vérifier » et la faire confirmer par dentsu (R).~~ B. Revenir aux bornes techniques 0,001 / 999,999 jusqu'à confirmation. *(Amendement E2 : la plage appartient au mécanisme de poids, pas à la plateforme.)*
- **Q12 : Groupes de CP indiscernables (A2) : diviser le multiplicateur par le nombre de membres ?** A. Oui par défaut, avec un paramètre par plateforme « division » ou « même valeur », à confirmer dans un compte (R). B. Même valeur pour tous les membres partout. C. Division partout, sans paramètre.

**Découpage (⑤)**

- **Q13 : Comparaison au seuil (B11).** A. Part non arrondie ; à seuil 0, part > 0 exigée (R). B. Garder la comparaison sur la part arrondie.
- **Q14 : Un plan par plateforme (B12).** A. Oui, chaque plateforme à son propre seuil (R). B. Un plan unique au seuil le plus bas.
- **Q15 : Population d'un cercle (A6).** A. Celle du disque, bilan sur l'union dédoublonnée (R). B. Celle de la cellule, en le disant.
- **Q16 : Cercle d'un rayon en frontière (A3).** A. Non exact si moins de 100 % de la surface est retenue, perte et avertissement (R). B. Exact quand même, avertissement seul.
- **Q17 : Polygone lourd (A7).** A. Simplification à 50 m puis contrôle contre le registre, refus chiffré au-delà (R). B. Refus sans simplification. C. Aucun contrôle (état actuel).
- **Q18 : Rayon par défaut des cercles (B10).** A. Rayon de la recette, sinon √(surface / π) / 3 borné, avec proposition du plus petit rayon qui passe (R). B. 10 km fixe (état actuel).
- **Q19 : Départage par la poussée branchée (B16), si Q7 = A.** A. Oui, à ±5 points de taux utile (R). B. Affiché seulement, sans effet sur le défaut.
- **Q20 : Minimums de population (B13).** A. Deux paramètres (par unité, par groupe), chacun avec son comportement, lus du registre (R). B. Garder le paramètre unique actuel.
- **Q21 : Exactitude par composition (B15).** A. Fondée sur les unités constitutives enregistrées dans la recette (R). B. Fondée sur le type de recette (état actuel).
- **Q22 : Revue finale et preuve navigateur de ⑤ (T6).** A. Les faire avant le lot 1 des corrections, sur l'état commité, A1 mis de côté (R) ~~A. Les faire avant le lot 1 des corrections, sur l'état actuel (R).~~ *(Amendement E6.)* B. Les faire après les trois lots, une seule fois.
- **Q23 : Catégories d'annonces spéciales Meta (C29).** A. Case sur le jeu de zone et borne conditionnelle (≥ 15 km) dans le registre (R). B. Note seulement (état actuel).

**Zones (③)**

- **Q24 : Différence avec une zone nationale (C21).** A. Autoriser « zone nationale moins zones locales », la nationale en premier opérande seulement (R). B. Garder le refus.
- **Q25 : Intersection (C20).** A. 2 à 20 zones, comme l'union et la différence (R). B. Exactement 2 (état actuel).

**Analyse (④)**

- **Q26 : Journal de la bataille après un changement de zone.** A. Le vider (R). B. Le garder comme trace.
- **Q27 : Boutons de la bataille en capitales.** A. Sentence case dans les deux interfaces (R). B. Capitales gardées par parité avec React.
- **Q28 : « Script bidding DV360 » affiché sur un lien partagé de zone.** A. Le retirer, le custom bidding étant hors V1 (R). B. Le garder.

**Répartition des rôles**

- **Q29 : Reclassement des tickets.** A. Accepter : A7, B14, B16, C27, C29 à nous (valeurs à confirmer par dentsu), C28 seul à dentsu (R). B. Revenir au tri initial (A7, B14, B16, C27, C28, C29 à dentsu).

**Noyau d'optimisation**

- **Q30 : Formule de correction unique.** A. Spécification v2 amortie (reste à livrer, fenêtre glissante, département puis CP) (R). B. Rebid plafonné ±50 %. C. Recalage amorti actuel sans fenêtre ni hiérarchie.
- **Q31 : Sort des deux formules actuelles.** A. Réexportées depuis le noyau, puis supprimées après validation ; l'ancienne gardée sous un drapeau pour comparaison (R). B. Gardées en parallèle.
- **Q32 : Constantes α = 0,8, k = 200, fenêtre 7 jours (minimum 3), bornes de correction 1/3 à 3, convention de normalisation (moyenne arithmétique non pondérée, avant écrêtage).** ~~Q32 : Constantes α = 0,8, k = 200, fenêtre 7 jours (minimum 3), bornes de correction 1/3 à 3.~~ *(Amendements E4 et E10 : la convention fixe la dérive du coût moyen après correction.)* A. Valeurs de la spécification comme défauts, réglables par campagne (R). B. Constantes figées dans le code.
- **Q33 : Bornes des poids dans le noyau.** A. Plage du mécanisme lue dans le registre, bornes techniques si inconnue (R) ~~A. Plage de la plateforme lue dans le registre, bornes techniques si inconnue (R).~~ B. 0,001 / 999,999 partout. *(Amendement E2.)*
- **Q34 : Dilution ×0,6 (spécification § 4) avec Q1 = A.** A. Retirée : la restriction aux CP retenus la remplace (R). B. Gardée pour les seuils inférieurs à 20 %. C. Gardée telle que la spécification l'écrit.
- **Q35 : Historique des cycles.** A. Une table de cycles (entrée, sortie, statut par cycle) écrite par la couche serveur, le noyau restant pur (R). B. Pas d'historique en V1.
- **Q36 : Paliers du script de custom bidding.** A. Paliers par valeur et score médian (spécification v2), dans le noyau, l'envoi restant à dentsu ; paliers et nb_max_entrees lus dans le registre du mécanisme (R) ~~A. Paliers par valeur et score médian (spécification v2), dans le noyau, l'envoi restant à dentsu (R).~~ *(Amendement E2.)* B. Quantiles par rang (état actuel). C. Hors V1, rien dans le noyau.

**Propositions complémentaires**

- **Q37 : Calculs de fond (seuils sur la métropole).** A. Après ⑧, comme décidé le 27/10 (R). B. Avant la fin des corrections du découpage.
- **Q38 : (a) Calibration sur les impressions livrées.** A. Option C du § 4.1 : volume attendu paramétrable, population en V1, calibration avec les données datées des adaptateurs (R). B. Calibrer tout de suite sur la campagne Adform. C. Rien.
- **Q39 : (b) Zones de référence.** A. Cinq zones plus la zone composite, construites avant le lot 1 sur l'état commité, A1 mis de côté ; attendus versionnés par ticket (R) ~~A. Cinq zones plus la zone composite, construites avant le lot 1 (R).~~ *(Amendement E6.)* B. Cinq zones seulement. C. Rien.
- **Q40 : (c) Seuil optimal.** A. Courbe et seuil proposé à 80 % de couverture, sans application automatique, après le lot 2 (R). B. Courbe seule. C. Application automatique. D. Rien.
- **Q41 : (d) Population présente.** A. Étude de faisabilité après la V1 (R). B. Cible complète maintenant. C. Rien.

---

*Sources lues le 31/10/2026 : plan de corrections `2026-10-31-decoupage-zones-corrections.md` ; méthodologie de découpage (docx du 31/10) ; document d'algorithme d'optimisation (docx du 26/10) ; spécification rebid v2 (29/10) ; spécification « carte en parcours » et plans des lots ② (28/10), ③ (29/10), ④ (30/10), ⑤ (24/10 et 30/10) ; code de la branche `feat/carte-finitions` (y compris les modifications non commitées du ticket A1) ; base locale en lecture seule (registre des plateformes, populations par CP, groupes de CP, livraisons de campagne).*
