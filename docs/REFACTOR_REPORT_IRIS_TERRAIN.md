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
