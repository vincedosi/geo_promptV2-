# Amendements au « Fil d'Ariane et noyau d'optimisation » (relecture du 31/10/2026)

Source : `fil-ariane-decoupage-optimisation-a-trancher.md` (31/10/2026).
Verdict : document fiable, chiffres vérifiés, tension A1 / noyau correctement identifiée. Dix amendements, dont trois changent la formulation de questions du § 5 (Q7, Q8/Q9, Q10) et un change l'ordre des travaux (E6). Aucun ne remet en cause la spécification v2 dans son principe.

## Règles de travail

1. E6 (1) s'applique immédiatement. Tous les autres amendements modifient des documents (plan de corrections, `docs/rebid-v2.md`, document de relecture), pas du code, tant que Q1 à Q7 ne sont pas tranchées.
2. Un commit par amendement, message préfixé (`E1`...).
3. Quand un amendement reformule une question du § 5, la nouvelle formulation remplace l'ancienne dans le document de relecture, et l'ancienne est conservée barrée pour trace.

---

## E1. ARB-7 / Q7 : le taux utile seul est un critère dégénéré

- Constat : « maille au taux utile simulé maximal » favorise la maille qui retient le moins. Un CP unique à 95 % couvrant 10 % de la zone bat des cercles à 70 % couvrant 90 %. L'option A de Q7, et le ticket B9 tel qu'écrit dans le plan, sont incomplets.
- Attendu : critère en deux temps. Parmi les mailles natives et disponibles dont la couverture simulée atteint la couverture cible (80 % par défaut, paramètre partagé avec le seuil optimal D1 / Q40), retenir celle de taux utile maximal ; si aucune n'atteint la cible, celle de couverture maximale. Départage B16 à ± 5 points de taux utile. La ligne d'explication affiche les deux chiffres (« couverture 91 %, taux utile 71 %, contre 10 % / 95 % en CP »).
- Reformuler Q7 A : « Taux utile simulé maximal sous couverture ≥ 80 % (paramètre partagé avec le seuil optimal) ».
- Fichiers : plan § ARB-7 et B9 ; plus tard `lib/zones/conversion.ts` (mailleParDefaut).
- Test (à écrire dans B9) : zone où la maille CP retient un CP à 95 % couvrant 10 %, et où les cercles couvrent 90 % à 70 % → cercles proposés.

## E2. Dimension manquante du registre : le mécanisme de poids

- Constat : le registre est indexé (plateforme, maille). Les poids transitent par des mécanismes différents : multiplicateur géographique DV360 (0,1 à 10, non confirmé), script de custom bidding DV360 (scores par paliers, au plus 2 000 CP par envoi), paliers Meta et TikTok (non gérés), répartition de budget par ligne (TTD ?), aucun poids. A1 met la plage sur la ligne (DV360, CP) ; Q11 et Q33 parlent de « plage de la plateforme » ; Q36 suppose des paliers ; B16 « poussée branchée » dépend aussi du mécanisme.
- Attendu : une table `plateformes_poids` (ou un bloc de colonnes) : plateforme, maille, mécanisme {multiplicateur, script, budget_ligne, aucun}, valeur_min, valeur_max, pas, nb_max_entrees, nb_paliers_max, branché, à_vérifier. A1, le noyau (Q33) et la quantification (Q36) lisent cette table. Multiplicateur et paliers sont deux sorties du même plan, pas deux plans.
- Reformuler Q11 et Q33 : « plage du mécanisme » au lieu de « plage de la plateforme ». Q36 A précise : « paliers et nb_max_entrees lus dans le registre du mécanisme ».
- Test (à écrire dans A1) : plan de 6 000 CP en mécanisme script → découpé ou agrégé selon nb_max_entrees = 2 000, avec message ; en mécanisme multiplicateur → bornes 0,1 / 10.

## E3. A1 contre spécification v2 : les CP hors zone

- Constat : A1 dit « seuls les CP retenus entrent au plan ». La quantification de la spécification v2 dit « hors zone : 0 en zones strictes, 0,8 × poids minimal en mode national », et le noyau fait vivre des CP « jamais servis ». Deux définitions du plan coexistent.
- Attendu : le plan porte une ligne pseudo-CP `HORS_ZONE` (poids 0 en mode strict, plancher en mode national), avec un drapeau de mode {strict, national} figé à l'extraction. Sa part prévue se calcule comme les autres (E5), avec pour volume attendu la somme des populations totales des CP non retenus du référentiel. Le noyau la traite comme un CP sans département (elle suit sa propre correction). Toute impression livrée sur un CP absent du plan lui est imputée.
- Fichiers : plan § A1 ; `docs/rebid-v2.md` (§ quantification et § entrées) ; plus tard `lib/zones/plan.ts`, extraction.
- Test (à écrire dans A1) : mode strict → `HORS_ZONE` poids 0 et sa part observée affichée comme taux de fuite ; mode national → poids plancher.

## E4. A1 : ordre des opérations et « moyenne = 1 »

- Constat : « part ÷ moyenne des parts × poids de classe, ramené à la plage » : après le poids de classe et l'écrêtage, la moyenne n'est plus 1, et la moyenne (pondérée ou non) n'est pas définie. La spécification v2 fait l'inverse (écrêter puis diviser par la moyenne).
- Attendu : une seule séquence, identique dans A1 et dans le noyau : (1) brut = part × poids de classe sur les CP retenus ; (2) normalisation à moyenne arithmétique non pondérée 1 ; (3) écrêtage à la plage du mécanisme ; (4) pas de renormalisation après écrêtage. Le bilan affiche la moyenne obtenue après écrêtage et le nombre de CP écrêtés. L'invariant du noyau devient « moyenne = 1 avant écrêtage ». La convention « non pondérée » est un paramètre explicite (voir E10), car elle fixe la dérive du coût moyen après correction.
- Fichiers : plan § A1 ; `docs/rebid-v2.md` (formule poids' et invariants).
- Test (à écrire dans A1) : seuil 0 %, parts de 0,1 % à 100 % → écrêtage DV360 déclenché, compteur affiché, moyenne avant écrêtage = 1.

## E5. Q8 / Q9 : la part prévue se simplifie et débloque A1

- Constat : avec Q1 = A et Q9 = A, part prévue = multiplicateur × population totale ÷ Σ = (part × population totale) ÷ Σ = population dans la zone ÷ Σ population dans la zone (× poids de classe). La normalisation du multiplicateur disparaît du calcul. C'est la part de population en zone, la quantité que l'ancien mode exclusif produisait déjà.
- Attendu : écrire la part prévue directement ainsi en V1, avec le « volume attendu » comme point d'extension : part prévue(cp) = part(cp) × volume(cp) × classe(cp) ÷ Σ, volume = population totale en V1 (Q9 A), `HORS_ZONE` comprise (E3). Multiplicateur et part prévue sont découplés : A1 (le multiplicateur) n'est plus bloqué par Q8, seulement par Q1 ; la correction de la part prévue (`sql/107`, `sql/113` : `bid_multiplier / Σ` remplacé par la formule ci-dessus) devient un ticket distinct A8, lot 1.
- Reformuler Q8 A : « part prévue = part × volume attendu × classe ÷ Σ, soit en V1 la part de population en zone, indépendante du multiplicateur ». Supprimer Q8 C (plus nécessaire).
- Test (A8) : les trois CP de l'exemple (parts 90 / 30 / 12 %, seuil 20 %) → parts prévues 18 000 ÷ 27 000 = 66,7 % et 9 000 ÷ 27 000 = 33,3 %, inchangées si les multiplicateurs sont écrêtés.

## E6. Mise à l'abri de A1 et ordre des tickets

- Constat : A1 = 21 fichiers et une migration appliquée en base locale, non commités, sur la branche où T6 (Q22) et les zones de référence (Q39) doivent être faits « sur l'état actuel ». Geler dans l'arbre de travail = risque de perte et preuve T6 polluée. Par ailleurs A2 change l'unité CP (le groupe), dont A1 dépend ; B11 change les ensembles retenus, donc tous les chiffres de référence.
- Attendu :
  1. Immédiatement : commit WIP de A1 sur une branche `wip/A1-plan-cp`, script de rollback de la migration locale, retour à l'état commité de la branche de travail pour T6 et les zones de référence.
  2. Ordre du lot 1 : B11 en tête (il change toutes les listes retenues), puis A2 avant A1 (ou A1 écrit sur une abstraction « unité CP » que A2 remplit par le groupe), puis A8 (E5), puis le reste.
  3. Zones de référence (Q39) : les chiffres attendus sont versionnés par ticket. Le commit d'un ticket qui change un chiffre attendu met à jour le fichier d'attendus avec la raison en une ligne. Sans cela le filet de non-régression casse dès B11.
- Reformuler Q10 A : « commit WIP sur branche dédiée, reprise après la réponse à Q1 ». Q22 A et Q39 A : préciser « sur l'état commité, A1 mis de côté ».
- Fichiers : plan § « Règles de travail » et ordre du lot 1 ; document de relecture § 4.2.

## E7. C25 : cohérence hiérarchique de la table de rattachement

- Constat : CP et IRIS sont attribués par test spatial (centroïde), la commune par « premier code de l'attribut communal INSEE du carreau » (liste `lcog_geo`, ordre non garanti), l'IRIS en recouvrement par « plus petit code ». Rien ne garantit IRIS ⊂ commune ⊂ département pour un même carreau : un carreau peut porter l'IRIS 331850101 et la commune 33200. Les mailles commune (TikTok), IRIS et département deviennent incohérentes entre elles, et avec le rattachement département des CP qu'utilise le noyau.
- Attendu : dériver la commune de l'IRIS attribué (cinq premiers caractères, arrondissements PLM compris) et le département de la commune ; garder l'attribut INSEE comme contrôle. Invariant testé sur les 2 324 577 carreaux : commune = IRIS[0:5] et département = f(commune), avec un rapport des écarts entre commune dérivée et attribut INSEE (quelques % en bordure sont attendus). Documenter aussi la règle de rattachement département d'un CP à cheval sur deux départements (proposition : département majoritaire en population du CP), car le noyau l'utilise.
- Fichiers : plan § C25 ; script de construction de la table (à localiser).
- Test (C25) : zéro carreau violant l'invariant après reconstruction ; CP 75016 → département 75 ; un CP à cheval connu → département majoritaire.

## E8. Noyau : dénominateur de la part observée, fuite et CP par défaut

- Constat : `obs_part(z) = livré ÷ Σ` sans définir Σ. La campagne Adform montre 89 CP livrés sans population connue et des CP par défaut de géolocalisation (75001 : 3,46 % des impressions pour 14 421 habitants). Σ sur les seuls CP du plan gonfle les parts ; un CP par défaut présent dans le plan est corrigé en boucle, et sa baisse de poids pénalise les vrais habitants du CP.
- Attendu dans `docs/rebid-v2.md` : Σ sur toutes les impressions de la plateforme (CP du plan + `HORS_ZONE`, E3) ; taux de fuite = part observée de `HORS_ZONE`, alerte au-delà d'un seuil réglable par campagne ; table `cp_geoloc_defaut` (liste manuelle + critère statistique proposé : rapport impressions / population > 5 et CP de centre-ville) dont les CP sont neutralisés dans la correction (corr forcée à 1, poids gelé, exclus de la part observée) et signalés dans le suivi. L'hypothèse 75001 reste à vérifier par dentsu sur une campagne datée.
- Test (noyau) : simulation avec un CP par défaut recevant 3 % des impressions → poids des autres CP identiques à une simulation sans ce CP.

## E9. Registre : « à vérifier » par paramètre

- Constat : la ligne DV360 / CP porte « à vérifier : non » alors que sa plage 0,1 à 10 n'est pas confirmée. Un drapeau par ligne ne sait pas dire quel paramètre est incertain.
- Attendu : drapeau par paramètre (ou liste des paramètres à vérifier dans la ligne), affiché à côté de la valeur concernée. La règle « sûre avant à vérifier » de B9 ne regarde que les paramètres qui conditionnent la maille (achetable, bornes de rayon, plafond d'unités), pas la plage de poids.
- Fichiers : `lib/zones/plateformes.ts`, migration `plateformes_geo`, plan § B9.

## E10. Rédaction du document de relecture et de la spécification

- § 4.1 : « approximation optimiste pour les zones périurbaines et rurales » n'est pas démontré par les données citées ; le sens du biais dépend de la corrélation entre part et inventaire à l'intérieur de l'ensemble retenu. Écrire : « biais de sens inconnu, d'amplitude probablement forte (rapport médian 0,48 ; 37 % des CP à moins d'un facteur 2) ».
- Nommer une fois les univers de CP et dire lequel sert à quoi : référentiel 6 187 (score, noyau), peuplés 6 009 (plan), métropole peuplés 5 956 (couverture), livrés Adform 6 030.
- Invariant « erreur logarithmique × 0,25 par itération » : ne vaut que pour λ ≈ 1 (CP bien servis) ; l'écrire.
- Q32 : ajouter la convention de normalisation (moyenne non pondérée, E4) à la liste des paramètres réglables.
- § 0.3, ligne ③ : ajouter B8 (ARB-5, rayon minimal de la recette) aux tickets qui touchent ③.
- Typographie : remplacer les tirets cadratins (« — ») par deux-points, parenthèses ou virgules, dans ce document et dans tous les livrables en français.

---

## Questions du § 5 dont la formulation change

| Question | Amendement | Changement |
|---|---|---|
| Q7 | E1 | option A : taux utile maximal sous couverture ≥ 80 % |
| Q8 | E5 | option A reformulée ; option C supprimée |
| Q9 | E5 | inchangée, mais devient le « volume attendu » de la formule E5 |
| Q10 | E6 | option A : commit WIP sur branche dédiée |
| Q11, Q33 | E2 | « plage du mécanisme » |
| Q22, Q39 | E6 | « sur l'état commité, A1 mis de côté » ; attendus versionnés par ticket |
| Q32 | E4, E10 | convention de normalisation ajoutée aux paramètres |
| Q36 | E2 | paliers et nombre maximal d'entrées lus dans le registre du mécanisme |

Nouveau ticket : A8 (part prévue, E5), lot 1, après A1.

---

## Prompt de lancement

```
Lis docs/superpowers/plans/2026-10-31-fil-ariane-amendements.md en entier.
Applique E6 (1) tout de suite : commit WIP de A1 sur la branche wip/A1-plan-cp, script de rollback de la migration locale, retour à l'état commité de la branche de travail. Vérifie que git status est propre.
Puis, sans toucher au code, applique E1 à E10 dans les documents : le plan 2026-10-31-decoupage-zones-corrections.md (ARB-7, A1, A2, B9, B16, C25, nouveau ticket A8, ordre du lot 1 : B11, A2, A1, A8, puis le reste), docs/rebid-v2.md (E3, E4, E8, E10) et le document de relecture (questions reformulées selon le tableau, anciennes formulations barrées).
Un commit par amendement. Ne code rien d'autre avant les réponses à Q1 à Q7.
```
