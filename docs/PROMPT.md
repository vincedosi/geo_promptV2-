\# GEOMATIK — Indicateur civique "Santé environnementale" dans Données terrain



\## Contexte

GEOMATIK (Next.js 14 + TypeScript + Supabase + MapLibre). On ajoute un nouvel

indicateur civique dans la section "Données terrain" qui affiche pour la zone

sélectionnée (commune / IRIS / périmètre carto courant) :

&#x20; 1. L'indice ATMO du jour (qualité de l'air, 6 niveaux)

&#x20; 2. L'indice pollen du jour (risque allergique, 5 niveaux, 6 espèces)



Source unique : Atmo Data (Atmo France + AASQA, licence ODbL).

Le RNSA n'existe plus depuis 2024, la pollen est désormais dans Atmo Data.



\## Source de données

\- API : https://admindata.atmo-france.org/api/doc/v2

\- Carte : https://map.atmo-france.org/

\- Granularité : commune (code INSEE)

\- Indice ATMO : J et J+1, mis à jour quotidiennement \~14h

\- Indice pollen : J, J+1, J+2, 6 espèces (ambroisie, armoise, aulne, bouleau,

&#x20; graminées, olivier), mis à jour quotidiennement

\- Licence ODbL → mention obligatoire "Source : Atmo France et les AASQA"



Avant de coder : lis la doc /api/doc/v2, identifie les endpoints exacts pour

indice\_atmo et indice\_pollen par code INSEE, et vérifie le format de réponse

(GeoJSON ou JSON tabulaire selon le flux). Documente dans un commentaire les

2 endpoints retenus.



\## Spécification fonctionnelle



\### Backend

\- Nouvelle route API Next.js : `/api/civic-indicators/health/\[code\_insee]`

\- Server-side fetch vers Atmo Data, agrège ATMO + pollen en une réponse :

```ts

&#x20; type HealthIndicator = {

&#x20;   code\_insee: string

&#x20;   commune: string

&#x20;   air: {

&#x20;     date: string

&#x20;     indice: 1 | 2 | 3 | 4 | 5 | 6

&#x20;     qualificatif: 'bon' | 'moyen' | 'dégradé' | 'mauvais'

&#x20;                 | 'très mauvais' | 'extrêmement mauvais'

&#x20;     sous\_indices: { pm10: number; pm25: number; no2: number;

&#x20;                     o3: number; so2: number }

&#x20;     previsionJ1?: { indice: number; qualificatif: string }

&#x20;   } | null

&#x20;   pollen: {

&#x20;     date: string

&#x20;     indice\_global: 0 | 1 | 2 | 3 | 4 | 5

&#x20;     especes: {

&#x20;       ambroisie: number; armoise: number; aulne: number;

&#x20;       bouleau: number; graminees: number; olivier: number

&#x20;     }

&#x20;     previsionJ1?: { indice: number }

&#x20;     previsionJ2?: { indice: number }

&#x20;   } | null

&#x20;   fetchedAt: string

&#x20;   source: 'Atmo France et AASQA'

&#x20; }

```

\- Cache : `revalidate: 3600` côté Next, + table Supabase `civic\_health\_cache`

&#x20; (code\_insee, payload jsonb, fetched\_at) pour fallback offline et

&#x20; réduire les appels API. TTL effectif 24h (données mises à jour à 14h).

\- Gestion erreur : si API down, retourne le dernier snapshot Supabase < 48h

&#x20; avec un flag `stale: true`. Si rien, retourne null avec message clair.

\- Pas de besoin d'auth API Atmo (open data public), mais respecte un

&#x20; rate limit poli (1 req/sec max, throttle si batch).



\### Frontend

\- Nouveau composant `<HealthIndicatorCard />` dans `components/donnees-terrain/`

\- À insérer dans le panel "Données terrain" existant, en bas de la liste des

&#x20; indicateurs actuels.

\- Layout : carte unique avec 2 sous-blocs côte à côte (Air | Pollen),

&#x20; responsive (stack vertical sur mobile).

\- Air : pastille couleur officielle Atmo (vert→bordeaux), label qualificatif,

&#x20; petit barchart des 5 sous-indices au hover.

\- Pollen : pastille couleur (vert→rouge), 6 picto par espèce avec niveau 0–5,

&#x20; espèces inactives (saison) grisées.

\- Footer : "Source : Atmo France et AASQA — mis à jour le {date}" + lien

&#x20; vers map.atmo-france.org pour la commune.

\- Loading skeleton + état vide ("Données indisponibles pour cette zone").



\### Logique de zone

\- Si l'utilisateur a sélectionné un IRIS → remonte au code commune parent

&#x20; (la jointure existe déjà via `iris\_geo`).

\- Si zone polygonale custom → prendre la commune dont le centroïde est le

&#x20; plus proche du centroïde de la zone (helper PostGIS, RPC dédiée si besoin).

\- Si rien de sélectionné → ne pas afficher le widget (état neutre).



\## Contraintes GEOMATIK

\- Respecter le DESIGN\_SYSTEM.md existant (couleurs, typo, spacing).

\- RLS Supabase : la table `civic\_health\_cache` est en lecture publique

&#x20; (data publique ODbL), écriture réservée au service role (route API).

&#x20; ⚠️ NE PAS toucher aux fonctions PostGIS battle existantes ni à

&#x20; /api/isochrone-battle/route.ts.

\- Pas de modif du multi-agent prompt router.

\- TypeScript strict, pas de `any`.



\## Plan attendu

Avant d'écrire la moindre ligne :

1\. Affiche les 2 endpoints Atmo Data retenus avec un curl de test réel sur

&#x20;  un code INSEE connu (ex : 75056 Paris, 69123 Lyon).

2\. Propose le schéma SQL de `civic\_health\_cache` + migration.

3\. Propose l'arborescence des fichiers à créer/modifier.

4\. Attends validation avant d'implémenter.



\## Livrables finaux

\- Migration Supabase (`supabase/migrations/xxx\_civic\_health\_cache.sql`)

\- Route API + types

\- Composant React + intégration dans Données terrain

\- Test manuel documenté (3 communes : Paris, Marseille, un village)

\- Mention ODbL ajoutée au README ou à la page about

