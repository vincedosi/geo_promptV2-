# Rapport — audit et refactor IRIS / météo / allergènes / flux routier

> 2026-09-11, mode one-shot. Audit : `docs/AUDIT_IRIS_TERRAIN.md`.

## Ce qu'il faut retenir

**La couche IRIS n'avait jamais fonctionné en production.** Ce n'était pas une
lenteur à optimiser : il n'y avait rien à l'écran, et aucune erreur nulle part.
Tout le reste du lot découle de ce constat.

Les trois autres domaines audités — météo, allergènes, flux routier — ne
souffraient pas du même mal. La météo et le TMJA sont, en l'état, les deux
meilleurs exemples du projet : échantillonnage borné, diffusion NDJSON, gzip,
cache CDN, déduplication. La route des tuiles IRIS a été écrite en les copiant.

## Ce qui a changé

| Constat | État | Preuve |
|---|---|---|
| `TER-001` couche IRIS morte en production | **corrigé** | prod servait `<!DOCTYP` au lieu de `PMTiles` ; désormais tuiles MVT, vérifiées au navigateur |
| `TER-003` IRIS servis à des zooms illisibles | **corrigé** | plancher z9 ; une tuile z5 pesait 1 694 kB pour des IRIS de 0,6 px |
| `TER-002` pollen et air vieux de 70 jours | **à moitié** | péremption désormais signalée ; la donnée, elle, attend les clés Inngest |
| `TER-005` commentaire de perf TMJA faux | **corrigé** | 391 535 octets mesurés contre « ~150 KB » annoncés |
| `TER-004` pyramide IRIS inutile | **aucune action, délibérément** | `geom_z10` garde 98,8 % des points : la reconstruire coûterait un UPDATE sur 49 448 géométries pour un gain nul |
| `TER-006` piège `is_true_iris` | **documenté et verrouillé** | test de garde ; 50 IRIS ruraux, 0 avec le drapeau |

Ajouté par-dessus : **le relief 3D des IRIS**, demandé explicitement.

## Mesures

| | avant | après |
|---|---|---|
| Couche IRIS en production | **rien à l'écran** | tuiles MVT rendues |
| Poids d'une tuile IRIS (Paris) | — | z9 231 kB · z10 154 kB · z13 19 kB |
| Temps de génération (z9) | — | **83 ms** |
| Tuiles demandées sous z9 | jusqu'à 1 694 kB | **aucune** (204) |
| Tests | 593 | **607** (+14) |

## Décisions prises seul, et leur raison

- **Servir les IRIS depuis Postgres plutôt que réparer les PMTiles.** Réparer
  aurait demandé soit de rendre le dépôt public, soit un proxy authentifié — et
  ce proxy avait justement été supprimé en 09/2026 au motif que « les PMTiles le
  remplacent ». Tout l'outillage nécessaire au chemin base dormait déjà :
  `geom_3857`, `geom_z7`, `geom_z10` peuplées sur 49 363 IRIS, index GIST
  compris.
- **Route sous `/api/tiles/iris/` et non `/api/iris-tiles/`.** Le matcher de
  `middleware.ts` raisonne par segment : `/api/iris/:path*` n'aurait pas couvert
  `/api/iris-tiles`. Ce placement protège la route sans toucher à un fichier
  que `CLAUDE.md` déclare protégé.
- **Ne pas filtrer `is_true_iris` côté serveur.** La règle du projet demande ce
  filtre pour l'analyse statistique, et c'est juste — l'appliquer à l'affichage
  effacerait la France rurale.
- **Ne pas reconstruire `geom_z10`.** Un UPDATE sur 49 448 géométries est
  exactement le traitement que le budget d'I/O Nano ne supporte pas, pour 1,2 %
  de points en moins.

## Correctif du 2026-09-12 — la couche ne montrait toujours rien

Remonté par Vincent après test : « j'ai testé, j'ai aucun IRIS qui s'affichent ».
Le rapport ci-dessus affirmait la couche réparée. Elle l'était côté serveur, et
restait invisible côté utilisateur. Trois causes, toutes de mon fait.

**1. La carte démarre à z5,5, le plancher est à z9.** Sous le minzoom d'une
source, MapLibre ne demande AUCUNE tuile et n'émet AUCUNE erreur. Cocher
« Couche IRIS » depuis la vue France par défaut ne produisait donc rien du tout.
J'avais remplacé un affichage cassé par un affichage muet — et je l'avais
« vérifié » en production après avoir moi-même zoomé de six niveaux, ce qui ne
prouvait rien sur le geste réel d'un utilisateur.

**2. « Vrais IRIS uniquement » était coché par défaut.** `CLAUDE.md` dit que
`is_true_iris = true` sert l'analyse statistique et **jamais** l'affichage. La
RPC respectait la règle, le panneau la violait. Mesuré : sur une tuile z10 de
France rurale, 50 IRIS présents, ZÉRO passant le filtre.

**3. Rien ne l'expliquait.** Aucun indice de zoom dans le panneau : une carte
vide sans message se lit comme une panne, et c'est exactement ce qui s'est passé.

### Ce qui a été fait

| Fichier | Changement |
|---|---|
| `lib/version.ts` | `IRIS_ZOOM_PLANCHER` — source unique du plancher, avec les mesures qui interdisent de le baisser |
| `app/api/tiles/iris/[z]/[x]/[y]/route.ts` | lit la constante au lieu d'en garder une copie |
| `app/copilote/_hooks/useMapInit.ts` | les quatre `minzoom: 9` (source + 3 couches) lisent la constante |
| `app/copilote/_hooks/useMapLayers.ts` | `setIrisVisible` remonte la caméra au plancher à l'activation ; relevé du zoom (`zoomend`) exposé au panneau ; défaut `irisTrueOnly` passé à `false` |
| `app/map/_components/filter-panel/IrisSection.tsx` | bandeau « Trop loin pour les IRIS » + bouton « Zoomer » quand la couche est active sous le plancher |
| `tests/unit/carreaux/iris-couche.test.ts` | 13 tests, dont 4 nouveaux sur le plancher unique, la remontée de caméra, l'indice et le défaut du filtre |

### Ce qui a été écarté, et pourquoi

**Baisser le plancher à z8.** C'était mon intention de départ, sur une mesure
que je n'avais pas refaite. Mesuré le 2026-09-12 : la tuile 8/129/88 (Paris)
couvre **4 251 IRIS**, et la 9/259/176 pèse déjà **788 kB** pour 3 387 IRIS —
loin des 231 kB que documentait l'en-tête de la route, qui décrivait un cas
courant et non un plafond. Surtout, la France entière tient en ~75 tuiles z8 :
un utilisateur qui dézoome couche allumée déclencherait l'incident du 28/03
(bbox France entière → I/O épuisé → 504). Un palier z8 aurait acheté un seul
niveau de zoom au prix du risque que `CLAUDE.md` interdit nommément.

Remonter la caméra coûte une tuile. Dézoomer en coûterait soixante-quinze.

### Vérification

Au navigateur, sur `localhost:3000/map`, le 2026-09-12 :

1. Chargement → badge `z5 20km`, « Vrais IRIS uniquement » **décoché**.
2. Un clic sur « Couche IRIS » → la caméra monte seule à `z9 1km`, et les
   contours IRIS s'affichent, France rurale comprise (Berry/Allier), légende
   renseignée (≤ 209 … ≥ 844 sur `pop_15_29`).
3. Cinq dézooms jusqu'à `z4` → le bandeau apparaît :
   « Trop loin pour les IRIS — lisibles à partir du zoom 9 (z4.0) ».
4. Un clic sur « Zoomer » → retour à `z9`, bandeau disparu.

Aucun test unitaire ne pouvait attraper ce défaut : une carte vide est un
succès pour tout ce qui n'est pas un œil. Les tests ajoutés verrouillent les
mécanismes ; c'est le navigateur qui prouve le résultat.

## Ce qui reste, et qui n'est pas du code

1. **Clés Inngest en production** — sans elles, pollen et qualité de l'air
   resteront figés. L'écran le dit maintenant ; il ne peut pas le réparer.
2. **Le sort du pipeline PMTiles.** Le workflow `generate-iris-pmtiles`, son
   script d'upload et le bouton « Régénérer PMTiles IRIS » de l'administration
   sont intacts — et n'alimentent plus rien. Soit on les supprime, soit on les
   branche derrière un proxy authentifié si l'on veut revenir aux PMTiles un
   jour. Laisser un bouton qui régénère un fichier que personne ne lit est un
   piège.
3. **Le fichier `public/iris_france.pmtiles` (361 Mo) et `iris_france.geojson`
   (43 Mo)** occupent le disque du poste de développement sans servir. Ni l'un
   ni l'autre n'est suivi par git.

## Ce que l'audit n'a pas trouvé

Dit explicitement pour que personne ne refasse le chemin : rien à redire sur
`/api/meteo-geo` ni sur `/api/tmja-tiles`, au-delà d'un commentaire chiffré à
corriger. Ces deux routes font déjà ce que le reste du projet devrait faire.
