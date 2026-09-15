# Suite — deux troncatures PostgREST vivantes en production

> Écrit le 2026-09-15, pendant la relecture finale de `feat/suivi-v2`.
> **Ces deux défauts sont ANTÉRIEURS à cette branche et actifs en production
> aujourd'hui.** Ils en sortent par décision (ruling FR-1) : les corriger dans
> une branche déjà bicéphale, sur deux domaines sans rapport avec le suivi de
> campagne, aurait mélangé deux choses que personne ne peut plus relire
> séparément. Ils ne sont pas abandonnés pour autant — ce fichier existe pour
> qu'ils ne se perdent pas.

## Le mécanisme, une bonne fois

**PostgREST tronque à 5 000 lignes TOUTE fonction `RETURNS TABLE`, sans
erreur, sans avertissement, sans en-tête.** L'appelant reçoit un tableau
parfaitement valide de 5 000 éléments et n'a aucun moyen de savoir qu'il en
manquait 1 187.

Le projet l'a maintenant rencontré **quatre fois** :

| # | Où | Découvert | Corrigé |
|---|---|---|---|
| 1 | `correlation_campagne_indicateur` | 2026-09-13 | sql/154 (jumelle `RETURNS jsonb`) |
| 2 | `codes_postaux_du_perimetre` | 2026-09-15 | sql/168 + sql/169 (jumelle + enveloppe) |
| 3 | `calculer_score_composite` | 2026-09-15 (relecture finale) | en cours |
| 4 | `get_zone_centroids` et `codes_postaux_dans_bbox` | 2026-09-15 (relecture finale) | **ce document** |

Ce n'est plus un piège, c'est une propriété de la plateforme. Le correctif
ponctuel ne suffit plus : il faut un test qui balaie les fonctions
`RETURNS TABLE` appelées par l'application et signale celles qui peuvent
dépasser 5 000 lignes.

## Défaut A — la météo efface l'outre-mer

**`app/api/meteo-geo/route.ts:258`**, via `get_zone_centroids('cp')`.

6 187 codes postaux demandés, 5 000 rendus. Et **les 136 codes ultramarins
sont tous dans la queue perdue** — mesuré, pas supposé : l'ordre de la
fonction les place en fin de liste.

Ce n'est pas une absence, et c'est ce qui le rend grave. Quand la bbox
demandée ne rend aucune zone, la route **retombe sur la France entière**. Une
carte cadrée sur La Réunion n'affiche donc pas « aucune donnée » : elle
affiche la météo de la métropole. L'utilisateur lit un chiffre faux sans
aucun signe que quelque chose a échoué.

C'est le **quatrième effacement de l'outre-mer** rencontré sur ce chantier,
après le `97` fantôme de la tâche 6, l'amputation de Mayotte par
simplification en 13A, et le piège inversé du filtre France. Les trois autres
ont été trouvés parce qu'on les cherchait. Celui-ci ne l'a été par aucune des
seize tâches.

**Correction attendue :** jumelle `RETURNS jsonb` de `get_zone_centroids` sur
le patron sql/168-169 (jumelle porteuse de la logique + originale réduite à
une enveloppe mince, pour qu'aucune des deux ne puisse dériver). Et surtout :
**le repli « pas de zone → France entière » doit disparaître ou devenir
visible**. Un repli silencieux qui substitue un territoire à un autre est pire
que l'erreur qu'il prétend masquer.

## Défaut B — la carte santé environnementale est incomplète

**`app/api/civic-indicators/health-map/route.ts:133`**, via
`codes_postaux_dans_bbox`.

6 051 codes postaux dans la bbox métropole, 5 000 rendus. La choroplèthe
pollen/ATMO est donc incomplète, en silence, sur environ un code postal sur
six.

Circonstance aggravante : **`sql/147:24` cite cette mesure**. Le chiffre
« 5 000 rendus pour 6 051 réels » est écrit dans nos propres migrations depuis
le 13 septembre, comme argument justifiant un autre correctif — et personne
n'est remonté au consommateur de cette fonction. Nous avions la mesure, la
conclusion, et nous ne l'avons pas appliquée là où elle valait aussi.

**Correction attendue :** même patron de jumelle `RETURNS jsonb`.

## Ce qui doit accompagner les deux correctifs

Une correction de plus ne vaut rien sans ce qui empêche la cinquième. Au
minimum :

1. **Une règle dans `CLAUDE.md`**, au même rang que les autres règles d'I/O :
   toute RPC appelée par l'application dont le résultat peut dépasser
   5 000 lignes est `RETURNS jsonb`, et la forme `RETURNS TABLE` reste réservée
   aux résultats bornés par construction.
2. **Un test qui balaie** les fonctions `RETURNS TABLE` référencées dans
   `app/` et `lib/`, et échoue sur celles dont on ne peut pas prouver la borne.
   Un contrôle automatique plutôt que la discipline — c'est déjà la doctrine du
   projet pour la dérive documentaire (`tests/unit/docs/derive-documentation.test.ts`).
3. **Le repli silencieux de `meteo-geo`** doit être traité comme un défaut à
   part entière, pas comme un dommage collatéral de la troncature.
