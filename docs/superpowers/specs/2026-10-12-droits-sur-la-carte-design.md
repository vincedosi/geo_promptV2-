# Droits sur la carte — design

Date : 2026-10-12 · Décideur : Vincent · Suite de `2026-10-08-espaces-de-travail-design.md` (§ 10 « Interface Vos données côté carte : chantier distinct »).

## 1. Ce que Vincent a décidé (verbatim résumé)

| # | Décision |
|---|---|
| R1 | Les droits se gèrent **par espace de travail**, jamais par utilisateur. Un utilisateur voit ce que voit son espace actif. |
| R2 | Sur la carte, chacun voit **les données communes (socle, open data) + celles de son espace actif**, rien d'autre. |
| R3 | **Le super admin aussi.** Dans l'espace BMW il voit la carte de BMW, exactement comme un client BMW. Pas de vue « tout voir » sur la carte. |
| R4 | **L'espace « dentsu.explore (interne) » est un espace comme un autre** : socle + ses propres données. Pour voir les données d'un client, on passe dans son espace. |
| R5 | Ce qui est produit dans un espace (isochrones, zones, analyses) **reste dans cet espace**, toujours. |
| R6 | Les listes de la carte se coupent en **deux groupes** : données communes à tous les espaces / données de l'espace (POI, isochrones, zones…). Libellés et mise en forme exacts : passe visuelle ultérieure. |
| R7 | Les pages d'administration (Accès, Données, Système) ne changent pas : le super admin y garde tous ses droits. |

## 2. Hors champ

Droits par utilisateur ; origine affichée dans la fiche d'un point ; partage d'isochrones/zones entre espaces ; refonte visuelle des panneaux (passe « front » prévue après) ; toute page d'admin.

## 3. Serveur

### 3.1 Le super admin filtré par son espace actif, hors administration

Aujourd'hui `getOrgSourceIds` (`lib/auth/getOrgSourceIds.ts`) rend `null` (aucun filtre) pour un super_admin, et `sourcesVisiblesDeLaRequete` (`lib/auth/perimetre-donnees.ts`) le relaie à toutes les routes non-admin de la carte.

Changement : **`sourcesVisiblesDeLaRequete` applique la règle de l'espace actif à TOUT le monde**, super_admin compris (socle + sources de `orgId` + celles partagées avec `orgId`). `getOrgSourceIds` garde son contrat actuel pour les appelants d'administration (`lib/espaces/*`, `app/api/admin/**`), qui en ont besoin pour décrire un espace ; une option explicite (ex. `{ vueEspace: true }`) porte la nouvelle règle, pour qu'aucun appelant ne change de comportement sans le dire.

Toutes les routes non-admin qui lisent des données client passent déjà par ce module (`tests/unit/securite/perimetre-routes.test.ts`) : carte (`map/categories`, `map/pois`, `map/ooh`, `map/poi-natures`, `map/transport`), `custom-geo/source/{battle,voronoi}`, `isochrone-cache-check`, `isochrone-battle(-v2)`. Celles qui appellent `getOrgSourceIds` directement passent à la nouvelle option. ⚠ `app/api/isochrone-battle/route.ts` est un fichier protégé : modification déjà autorisée par Vincent le 2026-10-10 pour les droits (« BMW ne doit pas voir les isochrones de la Marine ») ; la nouvelle modification est de même nature et sera citée.

Conséquences assumées :
- l'empreinte de périmètre (`empreintePerimetre`) d'un super_admin n'est plus `tout` mais celle de l'espace : les caches de battle déjà calculés sous `tout` ne lui sont plus resservis, il les recalcule à l'empreinte de l'espace (coût : un calcul, une fois) ;
- `categorieEntierementVisible` refuse désormais au super_admin, dans l'espace BMW, un Voronoï sur une catégorie qui contient des POI de la Marine — comme à un client.
- La jumelle SQL `source_visible()` (RLS, accès PostgREST directs) **n'est pas modifiée** : elle protège la base, pas la carte, et le super_admin doit garder l'accès complet côté administration.

Zones custom (`custom_geo_zones`) : déjà filtrées par `org_id` de l'espace actif (`app/api/custom-geo/list/route.ts`) — R5 tenue, à vérifier pour le super_admin.

### 3.2 L'origine de chaque jeu dans les réponses

Pour faire les deux groupes (R6), les réponses qui listent des jeux disent leur origine :
- `GET /api/map/categories` : chaque catégorie porte `origine: 'commune' | 'espace'`. Une catégorie est « espace » si au moins un de ses POI visibles vient d'une source privée de l'espace actif (ou partagée avec lui) ; « commune » sinon (socle et référentiels système). Une catégorie mixte est rangée « espace » (ce que le client a importé prime). Calcul sur `data_sources` (petite table) + l'index de `poi_france.categorie` : pas de scan.
- Panneaux (`map/ooh`) : même champ au niveau de la source si la carte les liste par source ; sinon commun.
- Zones, isochrones, analyses : toujours « espace » (R5), sans champ supplémentaire.
- Champ ajouté, rien retiré : React (gelé) l'ignore.

## 4. Angular (`angular/src/app/features/carte/**`)

### 4.1 Changer d'espace recharge la carte

Défaut actuel : `carte.page.ts` (`organisationChangee`) ferme le panneau ouvert et retire les zones, mais **ne relit ni le catalogue POI (`etat/catalogue-poi.service.ts`), ni les points/panneaux affichés, ni les sélections**. Après un changement d'espace, la carte montre encore les données de l'espace précédent.

Changement (arbitré à l'écriture du plan, 2026-10-12) : un changement d'espace **recrée la page carte**, exactement comme la coquille recrée la page courante (`layout/coquille.component.ts`, `generation`) et comme React fait `window.location.reload()`. Tous les services d'état de la carte sont fournis par la page : les recréer remet à zéro TOUT ce qui dépend du périmètre (catalogue POI, points, panneaux, batailles, clusters, zones, analyses, plan média) sans liste à tenir à jour — une liste d'invalidations manuelles oublierait le prochain service ajouté. Rien n'est relu automatiquement au-delà de ce qu'une ouverture de carte lit déjà (règles I/O inchangées). Les sélections en cours sont perdues, comme en React ; la vue (centre, zoom, fond) est gardée si l'URL la porte.

### 4.2 Deux groupes

Dans les listes qui montrent des jeux de données (types de POI du panneau Calques, et leurs équivalents du panneau Filtre), deux sections : **données communes** puis **données de l'espace** (libellés provisoires « Données communes » / « Données de l'espace », à revoir à la passe visuelle). Une section vide ne s'affiche pas. Mise en forme : celle des groupes existants (`mg-groupe-calques`), jetons du design system, rien de neuf.

## 5. Preuve attendue

Base locale, navigateur, React non concerné. Avec le compte super_admin :
- espace **BMW GROUP** : concessions BMW visibles, CIRFA absents, concessions dans « données de l'espace » ;
- espace **MARINE** : l'inverse ;
- espace **dentsu.explore (interne)** : ni concessions BMW ni CIRFA ; lycées, Filosofi, Brest au socle visibles en « données communes » ;
- passage BMW → MARINE sans rechargement manuel : catalogue et points changent, chiffres relevés avant/après ;
- un compte client BMW voit exactement la même carte que le super_admin dans l'espace BMW (mêmes chiffres) ;
- une isochrone/zone calculée dans BMW n'apparaît pas dans MARINE ni dans interne.
- Pages d'admin : le super_admin voit toujours tout (Accès, Données) — non-régression.

Tests : unitaires sur la nouvelle option de `getOrgSourceIds` et sur l'origine des catégories ; `perimetre-routes.test.ts` complété ; specs Angular du rechargement et des deux groupes ; deux thèmes pour les captures.

## 6. Risques

- **I/O** : le calcul d'origine des catégories ajoute une lecture de `data_sources` (quelques dizaines de lignes) par appel au catalogue — négligeable ; à mesurer par `EXPLAIN ANALYZE` si une jointure sur `poi_france` est nécessaire.
- **Rechargement** : invalider sans rafale — respecter le limiteur à 3 et le chargement à la demande.
- **Caches de battle** sous empreinte `tout` : devenus inaccessibles au super_admin sur la carte (recalcul) ; pas de purge.

## 7. Écarts à la livraison (2026-10-12, T5)

Preuve faite sur la base locale, Angular et Next du chantier, deux thèmes, compte super_admin et un compte client jetable de BMW GROUP (créé puis supprimé, vérifié en SQL). Ce qui diffère du texte ci-dessus :

- **Ordre et forme des groupes (§ 4.2).** Livré : « Données de l'espace » PUIS « Données communes », sous-titres `text-[11px] font-medium text-secondary` et non `mg-groupe-calques` — arbitrage du plan (T4), ce que le client a importé passe en tête. Chaque groupe porte `role="group"` + `aria-label`.
- **Panneau Filtre (§ 4.2).** Non traité : il liste des zones et des territoires, pas des jeux de données ; rien à y grouper.
- **Espace sans donnée propre (§ 5, interne).** Quand tout est commun, la section POI garde sa liste unique SANS sous-titre « Données communes » (un groupe seul ne se titre pas, Review Focus 4). Lycées : dans cette liste. Filosofi : couche socio-démographique, hors liste POI. Brest : panneaux « Médias offline » (1 434, socle), hors liste POI.
- **Panneaux (§ 3.2).** `map/ooh` ne porte pas de champ `origine` : la carte ne liste pas les panneaux par source, ils restent communs, comme le texte le permettait.
- **`risque_industriel`.** Absent du catalogue POI de tous les espaces (POI sans source, écartés par `getCategoriesVisibles`) ; il a sa couche propre dans Environnement. Gardé tel quel pour ce chantier, à reprendre dans la refonte du parcours carte.
- **Vue gardée « si l'URL la porte » (§ 4.1).** Centre et zoom ne sont pas dans l'URL : après un changement d'espace la vue revient au cadrage d'ouverture, comme le `reload` de React.
- **Zones (R5).** Tenue à l'écran : la liste lit l'espace actif. Par appel direct, `/api/custom-geo/list?org_id=` reste ouvert au super_admin pour n'importe quel espace (droit d'administration) ; un client reçoit 403 hors de son espace (vérifié).

Chiffres relevés : voir `ARCHITECTURE.md`, paragraphe « Sur la carte, le super_admin voit comme son espace actif ».
