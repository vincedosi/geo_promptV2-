# Optimisation en Python — phase 1 : rapport de non-régression (tâche 1.7)

05/11/2026. Branche `feat/optimisation-python`. Rien n'est poussé. Rien n'est basculé : le TypeScript reste le moteur
servi (drapeaux à `ts` par défaut).

## En une phrase

Sur la campagne « Démo pilotage — élections », **le Python rend exactement les mêmes valeurs que le TypeScript et le
SQL actuels, sur tous les chiffres demandés.** Aucun écart, à tolérance nulle.

## Comment c'est vérifié

- Les valeurs de référence ne sont pas recopiées à la main. Elles sont **produites par le code actuel** (TS et
  fonctions SQL de la base locale), figées dans des fichiers de test, puis comparées à la sortie du Python.
- La comparaison est faite **au texte près** pour le SQL (même nombre de décimales) et **au bit près** pour le TS.
- Campagne : `dccc0000-0000-4000-8000-000000000002`, 01/04-31/05/2026, budget 65 000 €, stratégie par donnée INSEE
  (abstention), pression 1,6. Mesures arrêtées au 30/04.
- Recalculé ce 05/11 par le Python : `pytest` **516 tests passés**, 0 sauté, 0 échec.

## Les chiffres

### Plan initial (méthode A, donnée INSEE)

| Valeur | TS / SQL | Python | Écarts |
|---|---|---|---|
| Multiplicateurs de la démo | 11 435 codes | 11 435 codes | **0** |
| Codes postaux achetés (multiplicateur > 0) | 1 641 | 1 641 | 0 |
| Multiplicateur maximal | 1,6 | 1,6 | 0 |
| 13001 / 75011 / 29200 | 1,214 / 0,848 / 1,012 | 1,214 / 0,848 / 1,012 | 0 |
| Courbe de pression | 1 160 cas | identiques | 0 |

### Part du plan et impressions prévues

| Valeur | TS / SQL | Python | Écarts |
|---|---|---|---|
| Part du plan, code par code | 11 435 lignes | identiques | **0** |
| Part de 13001 | 0,00085284071829701618 | 0,00085284071829701618 | 0 |
| Codes postaux dans la cible | 1 641 | 1 641 | 0 |
| Impressions prévues | 10 000 000 (99 cas) | 10 000 000 | 0 |
| Répartition par code postal | 1 641 CP, somme exacte | identique | 0 |
| Attendu au 30/04 | 4 920 000 | 4 920 000 | 0 |

### Mesures (score, écarts, alertes)

| Valeur | SQL | Python | Écarts |
|---|---|---|---|
| **Score** | **93 / 100** | 93 | 0 |
| Sous-pression / sur-pression / conformes | 3,84 % / 3,35 % / 72,5 % | identiques | 0 |
| Département 13 / 59 / 62 | −48,4 % / −46,2 % / +11,3 % | identiques | 0 |
| Codes postaux sous 70 % du plan | 161 | 161 | 0 |
| Rythme de livraison | 0,80 | 0,80 | 0 |
| Livré au 30/04 | 3 936 390 | 3 936 390 | 0 |
| Autres réglages essayés | 5 scores, 7 mailles, 4 suivis | identiques | 0 |

### Correction des poids : les deux formules actuelles

Entrée « 4 départements » du document d'algorithme (13, 59, 75, 29).

| Valeur | TS | Python | Écarts |
|---|---|---|---|
| Facteurs du rebid plafonné | 1,2089 / 1,1585 / 0,6172 / 0,5873 | identiques | 0 |
| Poids avant → après | 48,1 / 32,5 / 10,3 / 9,1 → 54,1 / 35,0 / 5,9 / 5,0 | identiques | 0 |
| Corrections du recalage amorti | 1,164 / 1,125 / 0,680 / 0,653 | identiques | 0 |

Le document écrit 0,618 pour le 75. La valeur exacte est 0,6172 : c'est un arrondi du document, pas un écart.

Au-delà de la démo : 3 448 cas rejoués (tests TS, cas limites, 3 400 cas tirés au hasard). **0 écart.**

| Famille | Cas | Écarts |
|---|---|---|
| Rebid plafonné | 1 516 | 0 |
| Recalage amorti | 1 513 | 0 |
| Simulateur de convergence | 419 | 0 |
| dont boucle de convergence (3 tours, déjà comptée au-dessus) | 9 | 0 |

### Le service appelé par HTTP

- Route de recalage (`/v1/historique/recaler`) : plus de 200 cas rejoués par HTTP, **0 écart**.
- Plan des zones dessinées (méthode B) : 276 cas, **0 écart** (acquis de la tâche 1.0).

### Mode ombre, de bout en bout

Mesuré le 05/11 à la tâche 1.6 : le TS sert, le Python calcule à côté, l'écart est compté.

| Cas réel | Écarts | Durée Python |
|---|---|---|
| Lyon 5 km, DV360 20 % + TTD 10 % au CP | **0** | — |
| France métropolitaine, DV360 au CP (≈ 6 000 unités) | **0** | 0,8 à 1,4 s |
| Plan d'un jeu de risque existant (2 081 lignes) | **0** | — |
| Recalage de ce jeu (1 927 CP) | **0** | — |

Le constat est écrit en base, dans l'extraction : `{moteur: 'ts', ombre: {moteur: 'python', ecarts: 0}}`.

## Ce qui reste ouvert

1. **Le mode ombre n'a pas été relancé aujourd'hui.** Il faut démarrer le conteneur Python, et la machine n'avait que
   330 Mo de mémoire libre. Les chiffres ci-dessus sont ceux du 05/11 (tâche 1.6).
2. **Le mode `python` (Python servi seul) n'est prouvé qu'en test unitaire.** Il n'a pas tourné de bout en bout.
3. **La bascule n'est pas faite.** Elle attend votre accord. Le TS reste en place jusque-là.
4. **Le cas « jeu de zones avec part prévue » n'a jamais été comparé au SQL** : aucune ligne en base ne le porte
   (relecture, M5). Le code est un simple relais. À couvrir par un cas construit en phase 2.
5. **Une campagne livrée à zéro fait une division par zéro**, en SQL comme en Python (fidèle). Au branchement, elle
   partira en erreur 500. À traduire en message clair quand une route l'appellera (relecture, M4).
6. **Les écrans Next acceptent encore de créer une stratégie « par palier » ou « par sous-zone »**
   (`app/api/bidding/strategies`). Le service, lui, les refuse. Non touché : hors du service, à décider.

## Décisions prises seul

1. **Modes abandonnés** (votre décision du 05/11). Le service répond **422** avec le message « Mode de pondération
   « par palier » abandonné : il n'est plus calculé. » Vérifié avant : aucune stratégie en base ne les emploie
   (1 par donnée INSEE, 4 par jeu de zones). En mots métier :
   - « par palier » : le poids suivait une liste de départements écrite à la main (grande ville, ville, périurbain,
     rural). Aucune donnée INSEE derrière.
   - « par sous-zone » : un poids fixe sur des groupes de codes postaux choisis à la main.
2. **Mineurs de la relecture traités** : M3 (limite négative refusée, limite vide = sans limite, comme Postgres),
   M1 (départage de deux stratégies créées au même instant, écrit dans le code), M7 et M8 (plan corrigé), I1
   (documentation : sql/343 et sql/344 sont appliquées ; le lot 2 est décrit).
3. **Mineurs laissés** : M2 (champs absurdes non textuels — aucune donnée réelle n'en a), M6 (égalités dans un
   maximum — risque théorique), M9 (lecture sans borne — une seule requête, 7 ms sur la démo), M4 et M5 (voir plus
   haut).
4. **Lecture des départements 75 et 29** : la mesure par département les donne à +1,1 % et +6,2 %. Les facteurs
   0,6172 et 0,5873 viennent d'une autre entrée : les 4 départements seuls, renormalisés, comme dans le document.
   Les deux sont justes ; ce ne sont pas les mêmes calculs.
