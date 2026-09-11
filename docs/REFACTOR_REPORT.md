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

Le seul constat **critique** de l'audit, `ECH-001` — duplication totale des
données à chaque rejeu d'un import de POI — a été traité après coup, le
2026-09-11, dans un chantier dédié (section « `ECH-001` » plus bas). Ce qui
reste ouvert est listé en fin de rapport et relève de l'arbitrage produit.

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
| `ECH-001` — identité déterministe des POI | *ce commit* | ✅ hors des neuf lots, voir plus bas |

Documentation et audit : `a800ff8`, `127ba69`, `c818505`.

## Métriques avant / après

| Mesure | Avant | Après |
|---|---|---|
| Erreurs `tsc` | 0 | **0** |
| Warnings lint | 0 | **0** |
| Tests | 483 | **570** (+87) |
| Fichiers de tests | 64 | 70 |
| Taille max de fichier | 1 118 l. (`useMapLayers.ts`) | 1 118 l. — non traité, délibérément |
| Appels externes sans délai d'expiration | **14** | **0** |
| Requêtes pour `/api/admin/iris/stats` | **21** (~15 s) | **1** (112 ms) |
| Requêtes par lot d'import de 50 lignes | **50** | **1** (repli à 50 en cas d'échec) |
| POI dupliqués au rejeu d'un import | **100 %** des lignes | **0** (`ECH-001`, les 2 chemins d'écriture) |
| Compteur `inserted` d'un rejeu | annoncerait 100 % | **0 inséré, N ignorés** — mesuré, pas estimé |
| Insertions par lots de 500 | 2 endroits | **0** |
| Définitions de la règle « sources d'une org » | **3** | **1** |
| Définitions de la mise en forme des nombres | **15** | **3** (+2 variantes assumées, isolées) |
| Définitions de la liste des rôles | **5** | **1** |
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
| `app/api/admin/sources/[id]/route.ts:148` | Le `DROP TABLE` échoue, la suppression de la source se poursuit, la réponse dit `success: true`. Le lot 4 a rendu l'échec visible dans le journal ; **faire échouer la suppression serait un changement de comportement** | haute |
| `app/api/admin/init-admin/route.ts` + `app/init/page.tsx` | La route qui crée le **premier** administrateur est bloquée **deux fois** : le middleware exige une session (`/api/admin` est protégé par `startsWith`), et la page `/init` n'envoie jamais l'en-tête `x-admin-key`. Vérifié le 2026-09-11. Le second blocage n'a pas de correctif simple — `ADMIN_INIT_KEY` est un secret serveur qu'une page de navigateur ne peut pas porter. Corriger le premier impose de toucher `middleware.ts`, **fichier protégé** : demande l'accord de Vincent | moyenne |

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

## `ECH-001` — corrigé le 2026-09-11

Le seul défaut critique de l'audit, traité séparément parce qu'il change une
donnée écrite en base et non une forme de code.

**Le défaut.** `lib/import/validator.ts` posait `id: randomUUID()` à chaque
analyse du fichier, et `lib/import/inserter.ts` insérait avec
`{ onConflict: 'id', ignoreDuplicates: true }`. L'identifiant étant neuf à
chaque exécution, le conflit ne pouvait **jamais** se produire :
`ignoreDuplicates` donnait une illusion d'idempotence. Rejouer le même fichier
— reprise après coupure réseau, double clic, relance après échec partiel —
dupliquait l'intégralité des POI, sans une erreur.

**Le correctif.** `lib/import/identite-poi.ts` calcule l'identifiant comme une
empreinte UUIDv5 (RFC 4122, vérifiée contre le vecteur de test canonique de la
RFC) du contenu de la ligne : source, catégorie, nom, adresse, code postal,
ville, latitude, longitude — chacun normalisé (`trim`, minuscules, NFC, espaces
internes repliés, coordonnées à 6 décimales ≈ 11 cm). Le même contenu produit
toujours le même identifiant, donc le `onConflict: 'id'` déjà écrit devient
opérant et le rejeu est absorbé.

**Ce qui n'a pas été fait, et pourquoi.** Le plan recommandait une contrainte
`UNIQUE` sur une clé métier, à l'image de `panneaux_affichage (source,
source_ref)`. Deux faits mesurés en base l'écartent : `poi_france` n'a **pas**
de colonne `source_ref` — les fichiers importés n'apportent aucun identifiant
externe, il n'y a rien à contraindre — et **358 des 290 877 lignes sont déjà en
doublon**, donc la contrainte échouerait à la pose. Rendre l'identifiant
déterministe est le changement minimal qui rend correct le code existant :
aucune migration, aucune contrainte, réversible en une ligne.

`data_source_id` est délibérément **exclu** de l'identité : chaque import crée
une nouvelle ligne `data_sources`
(`app/api/admin/import-poi/execute/route.ts:146`, un `insert` et non un
`upsert`), l'inclure annulerait exactement l'effet recherché. `categorie` est
**inclus** : l'exclure ferait fusionner silencieusement deux POI distincts
partageant nom et adresse. Entre un doublon visible et une perte silencieuse,
on prend le doublon.

**Limite à ne pas découvrir en production.** Les 290 877 POI déjà en base
portent des identifiants aléatoires : le premier ré-import d'un fichier déjà
importé **créera encore une dernière série de doublons**, les nouveaux
identifiants ne pouvant pas rencontrer les anciens. Le fichier devient
idempotent à partir de ce ré-import.

**Les deux chemins d'écriture sont couverts.** `import-datagouv`
(`app/api/admin/import-datagouv/route.ts`) écrit dans la même table et portait
le commentaire « pas upsert : pas de doublon possible sans ID stable ». Il l'est
désormais : même identité, `upsert onConflict: 'id'`.

**Un effet de bord de ce correctif, traité dans le même chantier.** Tant que
`id` était un `randomUUID()`, tout ce qui était envoyé était écrit — compter
`inserted = batch.length` disait vrai. Depuis le correctif, un rejeu n'écrit
RIEN, et ce compteur annonçait « 1 200 POI importés » sur un import qui n'en
créait aucun : le correctif rendait le rapport menteur. Les deux chemins font
maintenant `.select('id')` après l'upsert — `ON CONFLICT DO NOTHING` ne renvoie
que les lignes réellement écrites — d'où `inserted` / `ignored` exacts, un
journal où un rejeu affiche `[SKIP]` et non `[OK]`, et un écran d'import qui dit
« aucun nouveau point : les N points du fichier étaient déjà en base » au lieu
de « N points importés ». Coût : un UUID par ligne écrite sur le retour.

**`ECH-003` de ce rapport était FAUX** — cinquième constat inexact sur
vingt-deux. Mesuré le 2026-09-11 : l'import de campagne se rattache déjà à une
campagne existante par liaison plateforme ou nom identique
(`findMatchingCampaign`), puis purge la plage de dates du fichier avant
réinsertion. Rejouer le même fichier est donc déjà idempotent ; une seconde
campagne n'apparaît que si le nom ne correspond à rien, ce qui est le
comportement voulu.

**Preuve.** 22 tests, tous vus rouges avant d'être verts —
`tests/unit/import/identite-poi.test.ts` (14, dont le vecteur RFC) et
`tests/unit/import/import-rejouable.test.ts` (6, qui font tourner la vraie
chaîne `processRows` sans rien simuler), plus deux tests de comptage dans
`inserter-caracterisation.test.ts`. Avec l'ancien `randomUUID()`, quatre des six
tests de chaîne échouent ; avec l'ancien comptage, les deux tests de compteur
échouent.

## Lots non traités

| Lot | Raison |
|---|---|
| Découpage de `useMapLayers.ts` (1 118 l.) et des 25 fichiers de 500-1500 l. | **Écarté volontairement.** Gros diff, valeur nulle : l'audit montre que la dette n'est pas de forme |
| ~~Validation Zod (`SEC-001`)~~ — **traité le 2026-09-11** | **39 des 40 routes** validées en quatre tranches (voir `docs/AUDIT.md#sec-001`). La dernière est `isochrone-battle/route.ts`, fichier protégé par `CLAUDE.md`. Huit défauts fermés au passage. Cliquet : `tests/unit/api/validation-corps.test.ts` |
| Unification de `fmtNum` (`DUP-001`) | **Duplication traitée le 2026-09-11**, arbitrage toujours ouvert. Quinze implémentations trouvées (et non quatre) ; les treize à sortie identique sont remplacées par `lib/format/nombre.ts`, à sortie constante. Les DEUX divergences visibles — le palier `G` et le séparateur décimal — sont désormais côte à côte dans un seul fichier, chacune réductible en une ligne le jour où Vincent tranche |
| `DROP` de 4 tables et ~55 fonctions | Destructif, demande une validation objet par objet |
| Cycles d'import dans `lib/` (`ARC-002`) | 8 des 10 passent par des `import()` dynamiques : aucun crash, coût de compréhension seulement |
| `maplibre-gl` 6 (faille XSS) | **Tenté et abandonné** : la v6 ne rend rien. Risque abaissé — le chemin d'exploitation a été coupé à la source (`d058719`) |

## Risques résiduels et prochaines étapes

`ECH-001` est fermé sur les deux chemins qui écrivent dans `poi_france`, et
`ECH-003` s'est révélé inexistant (sections ci-dessus). **Ce qui reste à
surveiller est la transition, pas le code** : les 290 877 POI déjà en base
portent des identifiants aléatoires, donc le premier ré-import d'un fichier déjà
importé créera une dernière série de doublons avant de devenir idempotent. Et
comme les compteurs disent maintenant la vérité, un import de routine qui
affichait « 1 200 importés » affichera « 0 inséré, 1 200 déjà présents » — ce
n'est pas une régression, c'est la première fois que l'écran est honnête.

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
