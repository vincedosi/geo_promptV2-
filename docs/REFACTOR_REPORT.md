# Rapport de refactor — 2026-09-11

## Résumé

L'audit a conclu qu'**il n'y avait pas de dette de forme** : typecheck et lint à
zéro, couches respectées, aucun secret en dur, aucun IDOR, whitelists SSRF
correctes, clé `service_role` dans aucun fichier client. Aucun refactor
cosmétique n'a donc été entrepris — `useMapLayers.ts` fait toujours 1 118 lignes,
et c'est délibéré.

Les neuf lots ont corrigé des **comportements aux limites** : ce qui se passe
quand un tiers ne répond pas, quand on rejoue un import, quand une erreur
survient, quand le volume monte. Le gain le plus net : `/api/admin/iris/stats`
passe de **~15 secondes à 112 millisecondes** de travail base par ouverture.

Il reste **deux constats critiques non traités**, tous deux hors périmètre parce
qu'ils exigent un arbitrage humain — au premier rang `ECH-001`, une duplication
totale des données à chaque rejeu d'import.

## Lots réalisés

| Lot | Commits | Statut |
|---|---|---|
| 0 — filet de sécurité | `93daa76` | ✅ 14 tests de caractérisation |
| 1 — délais sur les appels externes | `771ef87` | ✅ 14 appels bornés |
| 2 — garde-fou routes publiques | `8adbce8` | ✅ |
| 3 — insertions 500 → 50 | `ccdb974` | ✅ |
| 4 — erreurs visibles | `e510aa1` | ✅ 7 actions corrigées |
| 5 — `/api/admin/iris/stats` | `0ffd0cf` | ✅ facteur 130 |
| 6 — insertion groupée | `2068b76` | ✅ facteur 50 |
| 7 — dédoublonnage de l'autorisation | `ebe52bb` | ✅ |
| 8 — nettoyages | `aadc220` | ✅ |

Documentation et audit : `a800ff8`, `127ba69`, `c818505`.

## Métriques avant / après

| Mesure | Avant | Après |
|---|---|---|
| Erreurs `tsc` | 0 | **0** |
| Warnings lint | 0 | **0** |
| Tests | 483 | **512** (+29) |
| Fichiers de tests | 64 | 68 |
| Taille max de fichier | 1 118 l. (`useMapLayers.ts`) | 1 118 l. — non traité, délibérément |
| Appels externes sans délai d'expiration | **14** | **0** |
| Requêtes pour `/api/admin/iris/stats` | **21** (~15 s) | **1** (112 ms) |
| Requêtes par lot d'import de 50 lignes | **50** | **1** (repli à 50 en cas d'échec) |
| Insertions par lots de 500 | 2 endroits | **0** |
| Définitions de la règle « sources d'une org » | **3** | **1** |
| Actions d'administration échouant en silence | 7 | **0** |
| `any` explicites | 14 (dont 6 en fichier protégé) | 14 — non traité |

## Ce que l'audit a dit de faux, et que l'exécution a corrigé

C'est la partie la plus utile de ce rapport. **Quatre constats sur vingt-deux
étaient inexacts**, découverts en allant les corriger.

| Constat | Ce que l'audit disait | La réalité |
|---|---|---|
| `ARC-001` | « un oubli rend une route publique en silence » | Vrai comme fragilité, mais **aucun trou** : le modèle réel est « middleware **OU** garde en handler ». Les 170 routes sont couvertes. Ma première version du test signalait 40 « fausses » routes publiques |
| `MAINT-001` | 10 `catch` « préoccupants » | **3 sur 10 étaient corrects par conception** — deux sondes de format de cookie, et un logger qui ne doit jamais lever |
| `MAINT-002` | « rien n'empêche un doublon au rejeu » | **Faux** : la route fait `DELETE` ciblé + `INSERT`, le patron idempotent du projet. Aucune clé primaire n'a été posée |
| `PERF-001` | « 21 `count(exact)` » | Vrai, **et en plus la route mentait sur 4 de ses 9 statistiques** |

## Bugs métier détectés, non corrigés

| Localisation | Description | Gravité |
|---|---|---|
| `lib/import/validator.ts:196` + `lib/import/inserter.ts:65` | `id: randomUUID()` généré à chaque parse, avec `onConflict: 'id'` : le conflit ne peut **jamais** se produire. Rejouer un import de POI duplique tout, sans une erreur | **critique** |
| `app/api/admin/campaigns/import/route.ts:246-269` | Même nature : un rejeu crée une seconde campagne | haute |
| `app/api/admin/import-datagouv/route.ts:282` | `.insert()` sans clé stable — le code le reconnaît en commentaire | haute |
| `app/api/admin/sources/[id]/route.ts:148` | Le `DROP TABLE` échoue, la suppression de la source se poursuit, la réponse dit `success: true`. Le lot 4 a rendu l'échec visible dans le journal ; **faire échouer la suppression serait un changement de comportement** | haute |
| `app/api/admin/init-admin/route.ts` | La route qui crée le **premier** administrateur exige déjà une session valide. Amorçage impossible sur une installation neuve | moyenne |

## Bugs corrigés en cours de route, avec changement de comportement assumé

`/api/admin/iris/stats` affichait quatre chiffres faux sur neuf. Une page de
supervision dont le rôle est de dire la vérité sur les données ne pouvait pas
rester ainsi. Mesuré en base avant correction :

| Champ | Affichait | Réalité |
|---|---|---|
| Départements | **2** | **104** |
| Avec géométrie | 49 448 (recopie du total) | **49 363** |
| Taille table | `'28 MB'` en dur | **221 Mo** |
| Taille index | `'5.7 MB'` en dur | **28 Mo** |

Réversible : seule la RPC `get_iris_admin_stats` (`sql/131`) est en jeu.

## Lots non traités

| Lot | Raison |
|---|---|
| Découpage de `useMapLayers.ts` (1 118 l.) et des 25 fichiers de 500-1500 l. | **Écarté volontairement.** Gros diff, valeur nulle : l'audit montre que la dette n'est pas de forme |
| Validation Zod sur 38 routes (`SEC-001`) | Ajouter un schéma **rejette** des entrées aujourd'hui acceptées. À faire route par route, en mode permissif d'abord |
| Unification de `fmtNum` (`DUP-001`) | « 1.2M » sur un écran, « 1,2M » sur un autre. Unifier change l'affichage — arbitrage |
| `DROP` de 4 tables et ~55 fonctions | Destructif, demande une validation objet par objet |
| Cycles d'import dans `lib/` (`ARC-002`) | 8 des 10 passent par des `import()` dynamiques : aucun crash, coût de compréhension seulement |
| `maplibre-gl` 6 (faille XSS) | **Tenté et abandonné** : la v6 ne rend rien. Risque abaissé — le chemin d'exploitation a été coupé à la source (`d058719`) |

## Risques résiduels et prochaines étapes

**Le seul vrai danger restant est `ECH-001`** : à chaque rejeu d'un import de
POI, toutes les lignes sont dupliquées, silencieusement. Ce n'est pas de la
dette, c'est une corruption progressive des données. Le corriger impose de
choisir une **clé métier de déduplication** — `panneaux_affichage` le fait déjà
avec `onConflict source,source_ref`, ce qui donne le modèle. Ce choix change ce
qui compte comme « la même ligne » : il appartient au produit, pas au refactor.

Deux effets de bord à surveiller après déploiement :

- Les imports `datagouv` et Arcom sont désormais **dix fois plus fragmentés**
  (lots de 50 au lieu de 500). Plus sûrs pour le budget I/O, mais plus longs. Si
  l'un dépasse le délai de la plateforme, la réponse est de reprendre l'import
  par tranches — **pas** de remonter la taille des lots en douce.
- Les appels vers DV360, TikTok et Modal **échouent désormais au bout de 15 s**
  au lieu de pendre. Un tiers durablement lent produira des erreurs visibles là
  où il produisait des blocages silencieux : c'est le but, mais ça se verra.

Enfin, trois garde-fous ont été installés pour que ces constats ne reviennent
pas : `tests/unit/api/routes-publiques.test.ts` (aucune route publique par
accident), `tests/unit/docs/derive-documentation.test.ts` (la doc ne peut plus
dériver en silence), et les tests de caractérisation de `inserter.ts` et
`getOrgSourceIds`. Chacun a été **vu rouge avant d'être vu vert**.
