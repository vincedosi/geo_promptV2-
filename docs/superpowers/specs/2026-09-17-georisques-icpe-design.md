# Spec — Zones à risque industriel : installations classées (ICPE) Géorisques

> Date : 2026-09-17 · Statut : design validé (brainstorm), à relire avant plan
> Source : API Géorisques du ministère de la Transition écologique
> Périmètre de CE document : les **points** ICPE. Les périmètres PPRT
> (polygones) sont un chantier distinct, esquissé au §9 et **hors de cette spec**.

## 1. Problème

Un media planner qui prépare une campagne OOH ou DOOH n'a aujourd'hui aucun moyen,
dans MAGELIAN, de savoir qu'un secteur est un bassin industriel à risque. Il ne peut
donc ni l'éviter (image de marque, publics sensibles) ni le cibler (recrutement
industriel, communication de prévention, information des riverains). La donnée
publique existe et est de qualité : elle n'est simplement pas dans l'outil.

## 2. Objectif V1

Faire apparaître les **138 423 installations classées de France** comme une
catégorie de POI à part entière, **filtrable par nature de risque** et **lisible
par gravité**, en réutilisant la plomberie POI existante plutôt qu'en créant un
calque parallèle.

## 3. Ce que la source expose — mesuré le 2026-09-17, pas supposé

Toutes les valeurs ci-dessous ont été relevées par appels réels à l'API.

| Fait | Valeur mesurée | Conséquence |
|---|---|---|
| Endpoint | `GET /api/v1/installations_classees` | REST, JSON |
| Jeton | **aucun** pour la v1 | pas de secret à gérer |
| Volume national | **138 423** | ~140 Mo, import surveillé |
| `page_size` maximum | **1 000** (2 000 rend 0 ligne) | **139 appels** sortants |
| Géométrie | `longitude` / `latitude` — **point** | va dans `poi_france` |
| Identifiant stable | `codeAIOT` (ex. `0006400036`) | clé de l'UUIDv5 |
| Recherche géographique | `latlon` + `rayon` (268 ICPE dans 5 km autour de Marseille) | non utilisée en V1, utile plus tard |
| Filtre `statut_seveso` | **IGNORÉ** — 138 423 résultats quelle que soit la valeur | on ne peut PAS demander « seulement les Seveso » : il faut ingérer puis classer en base |

### Valeurs réellement prises par les champs de classement
Échantillon de 200 à 400 sites du département 13 :

- `regime` : `Autorisation` (96), `Enregistrement` (73), `Autres régimes` (22), `Non ICPE` (9)
- `statutSeveso` : `Non Seveso` (152), `null` (31), `Seveso seuil haut` (9), `Seveso seuil bas` (8)
- `etatActivite` : `En exploitation avec titre` (105), `En fin d'exploitation` (**64**), `null` (31)
- `ied` : 28 vrais · `prioriteNationale` : 44 vrais
- filières : `industrie` 165, `carriere` 4, `eolienne`/`bovins`/`porcs`/`volailles` 0

### Les catégories de risque viennent des rubriques
`rubriques[]` porte `numeroRubrique`, `nature` en clair, `regimeAutoriseAlinea` et
`quantiteTotale`. **Renseignées sur 179 sites sur 300 (60 %)** — le reste devra
tomber dans une nature « non précisée », pas être écarté.

Familles observées, avec les libellés de Géorisques :

| Préfixe | Nature | Exemples relevés |
|---|---|---|
| 41xx | Toxicité aiguë | 4110 cat. 1, 4120 cat. 2 |
| 42xx | Explosibles | (non rencontré dans l'échantillon) |
| 43xx | Gaz et liquides inflammables | 4310 gaz cat. 1-2, 4331 liquides |
| 45xx | Dangereux pour le milieu aquatique | 4510, 4511 |
| 47xx | GPL et produits pétroliers | 4718 GPL, 4734 carburants |
| 14xx / 15xx | Inflammables et entrepôts | 1434, 1450, 1510, 1532 |
| 27xx | Déchets — dont **2797 radioactifs** | 2720 déchets d'extraction |
| 34xx / 35xx | Chimie et déchets IED | 3410, 3450 pharma, 3540 |
| 29xx | Combustion et refroidissement | 2915, 2921 |
| 25xx / 26xx | Matériaux et plastiques | 2515 concassage, 2662 |

## 4. Décision de modèle, et sa contrepartie assumée

**Un site porte PLUSIEURS rubriques, donc plusieurs natures de risque.** Choix
validé au brainstorm : **la nature filtre, la gravité colore.**

- `metadata.libelle_nature` = la nature **DOMINANTE** (une seule valeur)
- `metadata.natures_risque[]` = **toutes** les natures, pour le panneau de détail
- `sous_categorie` = la gravité, qui pilote la couleur et la légende

**Contrepartie explicite** : le filtre existant fait
`.in('metadata->>libelle_nature', natures)`, donc il retient les sites dont la
nature **dominante** correspond — pas tous ceux qui ont cette rubrique quelque
part. Un site majoritairement pétrolier qui stocke aussi un toxique ne remontera
pas sur un filtre « toxicité aiguë ». Le jour où ce croisement est nécessaire, il
faut une colonne indexée de natures multiples et un paramètre supplémentaire dans
`/api/map/pois` — ce n'est pas dans cette V1, et c'est un choix, pas un oubli.

**La nature dominante est celle du plus haut `rang_gravite`** parmi les rubriques
du site (§5). À rang égal, la rubrique de plus grande `quantiteTotale` gagne ;
à quantité égale ou absente, le plus petit `numeroRubrique`, pour que le résultat
soit **déterministe** et qu'un réimport ne fasse pas changer la couleur d'un point.

## 5. Registre des familles — en base, pas en dur

Table de référence `icpe_rubrique_familles` :

| Colonne | Type | Rôle |
|---|---|---|
| `prefixe` | `text` PK | 2 premiers chiffres du numéro de rubrique (`41`, `47`…) |
| `libelle` | `text` | libellé affiché et valeur écrite dans `libelle_nature` |
| `rang_gravite` | `int` | départage la nature dominante, et rien d'autre |

Seedée par migration depuis la nomenclature ICPE. Motif du projet : même intention
que `cible_indicator_registry` ou `dsp_metrics_registry` — un libellé qui change
est une ligne de SQL, pas un déploiement. Un préfixe inconnu tombe sur
« Nature non précisée » avec le rang le plus faible : **l'import ne casse pas**
quand la nomenclature évolue.

## 6. Table et champs

Aucune table nouvelle pour les points : `poi_france` porte déjà tout.

| Colonne | Contenu |
|---|---|
| `id` | `UUIDv5('georisques:icpe:' + codeAIOT)` — rejeu sans doublon |
| `categorie` | `'risque_industriel'` |
| `sous_categorie` | `seveso_haut` \| `seveso_bas` \| `ied` \| `autorisation` \| `enregistrement` \| `autre` |
| `nom` | `raisonSociale` |
| `adresse` | `adresse1..3` concaténées, `.trim()` (règle CSV INSEE : espaces invisibles) |
| `ville` / `code_postal` | `commune` / `codePostal` |
| `lat` / `lng` / `geom` | `latitude` / `longitude` ; `geom` posé par le trigger `auto_set_geom` (helper `triggerFilled`) |
| `source` | `'georisques_icpe'` |
| `metadata.libelle_nature` | nature dominante (§4) |
| `metadata.natures_risque[]` | toutes les natures |
| `metadata.*` | `code_aiot`, `code_insee`, `regime`, `statut_seveso`, `ied`, `priorite_nationale`, `etat_activite`, `dreal` (`serviceAIOT`), `siret`, `code_naf`, `rubriques[]` (n° + nature + régime + quantité + unité), `date_maj_source`, `derniere_inspection`, `nb_inspections` |

Plus **une ligne dans `poi_categories`** : `categorie='risque_industriel'`,
`label_fr='Zones risque indus'`, `icone`, `couleur_carte`, `source_defaut='georisques_icpe'`,
`actif=true`. C'est cette ligne qui fait apparaître la catégorie dans le sélecteur,
via `/api/map/categories`.

### Dérivation de la gravité — première règle qui s'applique

| `sous_categorie` | Condition |
|---|---|
| `seveso_haut` | `statutSeveso = 'Seveso seuil haut'` |
| `seveso_bas` | `statutSeveso = 'Seveso seuil bas'` |
| `ied` | `ied = true` (et pas Seveso) |
| `autorisation` | `regime = 'Autorisation'` |
| `enregistrement` | `regime = 'Enregistrement'` |
| `autre` | le reste, `Non ICPE` et `null` compris |

## 7. UX — l'essentiel existe déjà

Vérifié dans `PoiSection.tsx` et `app/api/map/pois/route.ts` : la section POI gère
un type, puis un **sous-filtre « natures »** alimenté par
`metadata->>'libelle_nature'`, multi-sélection, **filtré côté serveur**. La
catégorie apparaît donc dans Calques → « POI et mobilité » avec son filtre par
nature **sans une ligne d'UI nouvelle**.

**Ce n'est pas le panneau Filtre.** Chez MAGELIAN, Filtre = « où je regarde », le
périmètre unique ; y placer un filtre thématique casserait la règle du filtre
unique (`lib/carte/filtre.ts`, garde-fou de l'incident du 28/03).

Deux ajouts seulement :

1. **Case « Inclure les sites en fin d'exploitation »**, décochée par défaut.
   64 sites sur 200 sont en fin d'exploitation : les peindre à côté des sites
   actifs surestime le risque. Ils sont importés (l'historique compte pour un sol
   pollué) mais masqués.
2. **Légende de gravité**, 6 entrées. `sous_categorie` est déjà renvoyée au client
   par `/api/map/pois` (`SELECT_COLS`), donc la couleur est à portée immédiate.

### Couleurs — aucune palette inventée
La gravité est une **intensité croissante** : on réutilise la rampe séquentielle
du design system. `--seq-5` Seveso seuil haut · `--seq-4` Seveso seuil bas ·
`--seq-3` IED · `--seq-2` Autorisation · `--seq-1` Enregistrement ·
`--donnee-absente` (gris neutre) pour `autre`. Conforme au DESIGN_SYSTEM : pas de
rouge vif, qui y est réservé au statut système.

**Vérifié dans `lib/carte/degrades.ts`** : les huit `DegradeId` déclarés
(`carreaux`, `iris`, `civic-indicateurs`, `civic-sante`, `meteo`,
`campagne-impressions`, `score`, `diffusion`) sont tous des **choroplèthes**, des
remplissages de polygones. Des épingles POI colorées n'en sont pas une : la règle
du dégradé unique ne s'applique donc pas, et la légende de gravité n'a **pas** à
s'enregistrer dans ce registre. Les POI portent déjà leur couleur par type
(`poi-style.ts`).

## 8. Import

Route `/api/admin/import-georisques`, `requireAdmin()`, `export const dynamic = 'force-dynamic'`.

- **Flux NDJSON avec progression** : pourcentage, lignes traitées/total, étapes
  nommées (`appel API → classement → insertion`), compteurs finaux
  `inserted`/`ignored`. Règle non négociable du projet sur les imports.
- **Appels sortants** par `lib/http/lecture-avec-reprise.ts` : une lecture est
  idempotente, la reprise est donc légitime — et importer l'un ou l'autre module
  EST la déclaration d'idempotence.
- **Liste blanche SSRF** : vérifié, elle n'est PAS partagée — `ALLOWED_DOMAINS`
  est une constante **locale** à `/api/admin/import-datagouv` (8 domaines, ligne 58).
  La nouvelle route déclare donc la sienne, bornée à `georisques.gouv.fr`, sur le
  même motif (comparaison `hostname === d || hostname.endsWith('.' + d)`). Rien à
  modifier dans la route data.gouv, dont la liste ne doit pas s'élargir.
- **Écritures par lots de 50**, une seule requête par lot, `upsert` sur
  `onConflict: 'id'` **suivi de `.select('id')`** — sans ce select, « inséré » et
  « déjà présent » sont indiscernables. Corps validé par Zod en `.passthrough()`
  si la charge repart vers une RPC.
- **Corps de requête** par `lireCorps()`, jamais `await request.json()` nu.
- Coût : 139 appels sortants, ~2 769 lots, ~140 Mo. Import surveillé, jamais
  déclenché au chargement d'une page.

## 8bis. Un défaut de l'existant que cette feature révèle

`/api/map/poi-natures` fait `.select('metadata').eq('categorie', …)` puis
déduplique **côté client**. Sur une catégorie de quelques centaines de lycées
c'est indolore ; sur **138 423 lignes de jsonb**, c'est un balayage complet de
table — la famille exacte de l'incident du 28/03 (I/O épuisé → 504).

**Correctif inclus dans cette feature** : pour `risque_industriel`, les natures
sont servies **depuis `icpe_rubrique_familles`** (une quinzaine de lignes bornées)
et non par un scan des POI. Le comportement des autres catégories reste inchangé.

## 9. Hors périmètre — les zones PPRT, plus tard

Les vrais **polygones** de risque industriel existent, mais pas dans l'API REST :
- WFS `ms:PPRT_PERIMETRE_RISQIND` — `Polygon`, 822 sommets sur l'exemple relevé,
  sortie GeoJSON en CRS84, attributs `id_sup`, `id_gaspar`, `lib_ppr`,
  `libelle_sous_etat`, `dat_approbation`, `num_risque`, `zr_exists`
- `ms:PPRT_COMMUNE_RISQIND_APPROUV` (902), `ms:SSP_ETS_GE_POLYGON` (3 494)
- `GET /api/v1/gaspar/pprt` donne les **415 procédures** et leur zonage
  réglementaire (`codeZone` R = interdiction, B = autorisation avec prescription)
  mais **aucune géométrie** ; `id_gaspar` fait la jointure avec le WFS.

Deux réserves à lever avant de s'y engager : le WFS **plafonne ses réponses à
80 000 features** (le vrai compte reste à établir, département par département)
et sa dernière mise à jour annoncée est **février 2023** — c'est un référentiel
figé, pas un flux.

Table dédiée (`geometry(MultiPolygon,4326)` + index GIST), tuiles **MVT** sur le
motif de `/api/tiles/[z]/[x]/[y]`, jamais du GeoJSON France entière. L'intérêt
produit réel : une source de zone custom (`/api/custom-geo/source/pprt`) pour
**exclure ou cibler un bassin industriel dans une campagne**, puis l'exporter en
ciblage DSP.

## 10. Vérifications

- **Test unitaire pur** de la dérivation gravité + nature dominante, sur une table
  de vérité bâtie des cas réellement mesurés : Seveso haut, Seveso bas, IED sans
  Seveso, `Autorisation`, `Enregistrement`, `Non ICPE`, `statutSeveso` null,
  `rubriques` vide, préfixe inconnu, égalité de rang départagée par la quantité.
- **Idempotence** : même `codeAIOT` → même UUIDv5 ; deux imports d'affilée →
  `inserted` nul au second.
- **Déterminisme** de la nature dominante : le même site, réimporté, garde sa
  couleur.
- `ARCHITECTURE.md` mis à jour **dans le même commit** : la route, la table de
  référence, la catégorie POI, la dépendance externe `georisques.gouv.fr`.
  `tests/unit/docs/derive-documentation.test.ts` garde les dépendances externes —
  il échouera si la dépendance n'est pas documentée.

## 11. Ce que cette V1 ne fait PAS

- Pas de polygones (§9).
- Pas de croisement « toutes natures » (§4).
- Pas de sites et sols pollués CASIAS (`/api/v1/ssp`) : même patron de point, à
  ajouter ensuite si l'ICPE prouve son utilité.
- Pas de rafraîchissement automatique : l'import est manuel et surveillé. Une
  cadence Inngest se discutera quand la fraîcheur côté source sera caractérisée
  (`date_maj` est renseignée par site, ce qui permettra un import incrémental).
