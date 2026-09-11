# Audit — IRIS, météo, allergènes, flux routier

> 2026-09-11. Périmètre demandé : l'affichage des IRIS, la météo, les
> allergènes (pollen) et les flux routiers. L'audit global du projet reste
> `docs/AUDIT.md` — ce document ne le remplace pas, il le complète sur ces
> quatre domaines.
>
> Chaque constat est mesuré. Ce qui n'a pas été vérifié n'est pas écrit.

---

## Les trois constats qui comptent

### TER-001 [Architecture] 🔴 La couche IRIS n'a **jamais** pu s'afficher en production

- **Localisation** : `lib/version.ts:18`, `.vercelignore:6`, `.gitignore:38`,
  `app/copilote/_hooks/useMapInit.ts:743-745`
- **Constat, vérifié de bout en bout** :
  - la carte charge `pmtiles:///iris_france.pmtiles`, un fichier de **361 Mo**
    posé dans `public/` ;
  - ce fichier est exclu par `.gitignore` **et** par `.vercelignore` : il ne
    part donc jamais dans le déploiement ;
  - en production, `GET /iris_france.pmtiles` répond **`<!DOCTYPE`** — la page
    404 de Next, pas un binaire. Les huit premiers octets attendus sont
    `PMTiles\x03` ; on reçoit `<!DOCTYP`.
  - l'autre chemin documenté, la GitHub Release `iris-pmtiles-latest`, existe
    bien (asset `iris.pmtiles`, 361 140 992 octets) mais **le dépôt est privé** :
    un `curl` anonyme reçoit `404 Not Found`. Un navigateur ne peut pas la lire.
- **Le code l'avoue** (`lib/version.ts:17`) : « Fichier servi depuis /public **en
  attendant la première exécution du workflow** ». L'attente dure depuis mars.
- **Impact** : la couche IRIS fonctionne sur le poste du développeur, où le
  fichier est sur le disque, et **nulle part ailleurs**. Aucune erreur visible :
  MapLibre échoue en silence sur une source vide.
- **Gravité** : critique — c'est la moitié du périmètre demandé.
- **Effort** : M

### TER-002 [Échelle] 🔴 Pollen et qualité de l'air affichent des données vieilles de **70 jours**

- **Localisation** : `pollen_map_daily`, `atmo_map_daily`,
  `lib/inngest/functions/civicDailyIngest.ts`,
  `app/map/_components/CivicHealthMapLayer.tsx:268`
- **Constat mesuré en base le 2026-09-11** : `max(date_ech)` vaut **2026-07-03**
  dans les deux tables. 6 004 lignes de pollen et 4 967 d'air, toutes du même
  jour, figées.
- **Cause** : l'alimentation est un cron Inngest quotidien (05h30). Les clés
  `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` sont absentes en production : le
  cron n'a jamais tourné. La dernière ingestion est celle lancée à la main le
  jour de la livraison.
- **Impact** : la carte des allergènes montre les niveaux d'**ambroisie**, de
  **graminées** et d'**aulne** du 3 juillet comme s'ils étaient d'aujourd'hui.
  Sur un indicateur saisonnier, c'est faux et plausible à la fois — le pire des
  deux. Le seul avertissement prévu par l'interface dit « (donnée de la
  veille) » : il ne sait pas exprimer « d'il y a dix semaines ».
- **Gravité** : critique
- **Effort** : S pour rendre la péremption visible, **hors code** pour la
  remettre à jour (clés Inngest).
- **Traité le 2026-09-11, à moitié — et la moitié qui reste n'est pas du code.**
  L'écran signale désormais la péremption : au-delà de trois jours (les tables
  sont purgées à J-2, trois jours laissent la marge d'un fuseau ou d'un cron en
  retard), un bandeau annonce l'âge exact et propose le même bouton de
  ré-ingestion manuelle que le cas « aucune donnée ». La date était déjà
  affichée, mais en légende sous un sélecteur — personne ne lit une légende
  avant de croire une carte.
  - Le piège évité : traiter une date ABSENTE comme un âge infini. Cela
    afficherait « périmé » là où il n'y a simplement rien, cas que l'écran
    signale déjà autrement. `ageEnJours` rend `null`, jamais un grand nombre.
  - **Ce qui n'est pas réglé** : la donnée elle-même. La remettre à jour demande
    que le cron tourne, donc `INNGEST_EVENT_KEY` et `INNGEST_SIGNING_KEY` en
    production. C'est un arbitrage de Vincent, pas une ligne de code.

### TER-003 [Goulot] Les IRIS sont servis à des zooms où ils sont illisibles

- **Localisation** : `app/copilote/_hooks/useMapInit.ts:752` (`minzoom: 5`)
- **Constat** : mesuré par tuile, à 46° de latitude, en appliquant la règle de
  lisibilité déjà retenue pour les carreaux (une maille se lit entre 10 et
  40 px) :

  | zoom | IRIS dans la tuile | poids MVT | m/px | IRIS de 1 km |
  |---|---|---|---|---|
  | 5  | **31 149** | **1 694 kB** | 1 699 | 0,6 px |
  | 6  | 16 066 | 879 kB | 850 | 1,2 px |
  | 7  | 6 308 | 342 kB | 425 | 2,4 px |
  | 8  | 2 272 | 111 kB | 212 | 4,7 px |
  | 10 | 692 | 39 kB | 53 | **19 px** |
  | 13 | 55 | 3,2 kB | 6,6 | 150 px |

- **Impact** : sous z9, on transporte jusqu'à 1,7 Mo par tuile pour un rendu
  où aucun IRIS n'est distinguable — exactement le défaut corrigé sur les
  carreaux le 2026-09-11.
- **Gravité** : moyenne
- **Effort** : S

---

## Constats secondaires

### TER-004 [Maintenabilité] La pyramide de simplification IRIS ne simplifie presque rien

- **Localisation** : colonnes `iris.geom_z7`, `iris.geom_z10`
- **Constat mesuré** : sur 984 183 points au total,
  `geom_z7` en garde **73,2 %** et `geom_z10` **98,8 %**. La seconde est donc
  une copie de `geom_3857` à 1,2 % près — elle occupe de la place et ne fait
  rien.
- **Conséquence pratique** : inutile de construire une cascade à trois niveaux.
  Deux suffisent, et c'est ce qui a été fait.
- **Gravité** : faible — **aucune action** : reconstruire la colonne coûterait
  un UPDATE sur 49 448 géométries, soit précisément le genre de traitement que
  le budget d'I/O Nano ne supporte pas, pour un gain nul.

### TER-005 [Goulot] La tuile TMJA pèse 2,6 fois ce que son propre commentaire annonce

- **Localisation** : `app/api/tmja-tiles/[z]/[x]/[y]/route.ts:7`
- **Constat** : le commentaire annonce « ~150 KB → ~35 KB par tuile ». Mesure
  sur la tuile 10/518/351 (Paris) : **391 535 octets** avant gzip.
- **Impact** : limité — le gzip et le cache CDN d'une semaine font leur travail.
  Mais un chiffre faux dans un commentaire de performance est un piège pour qui
  s'y fiera pour arbitrer plus tard.
- **Gravité** : faible
- **Effort** : S (corriger le commentaire avec la mesure)

### TER-006 [Architecture] `is_true_iris` ne doit JAMAIS filtrer l'affichage

- **Constat** : 16 404 IRIS sur 49 448 portent `is_true_iris = true`.
  `CLAUDE.md` demande ce filtre « pour toute analyse statistique » — et c'est
  juste. Mais mesuré sur une tuile de France rurale (z10, centre 2,29°E
  46,44°N) : **50 IRIS présents, 0 avec `is_true_iris`**.
- **Impact** : appliquer ce filtre à la couche cartographique effacerait toute
  la France rurale, où l'IRIS est la commune entière. Le piège est d'autant
  plus sérieux que la règle du projet, sortie de son contexte, invite à le
  faire.
- **Gravité** : moyenne (piège documenté, pas un défaut présent)

---

## Ce que l'audit a cherché et n'a PAS trouvé

Dit explicitement, pour que personne ne refasse le chemin :

- **Météo** — `/api/meteo-geo` échantillonne à 500 points par appel, diffuse en
  NDJSON et accepte une bbox de viewport ; `/api/meteo-geo/zones` sert des
  polygones simplifiés avec un cache CDN d'une semaine. Rien à redire : c'est
  déjà le patron que le reste du projet devrait suivre.
- **Flux routier** — la route TMJA fait gzip, cache CDN, cache mémoire,
  déduplication des requêtes simultanées et filtrage adaptatif au zoom. C'est
  le modèle qui a servi à écrire la route des tuiles IRIS.
