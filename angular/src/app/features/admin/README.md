# admin — administration

**Rôle** : les écrans d'administration portés de `/admin/*` (lot 6). Cible validée par le propriétaire :
trois pages à onglets — **Accès**, **Données**, **Système** (en place depuis le 2026-10-12, T6). Aujourd'hui :
Accès (comptes et espaces de travail) ; Données → Sources, Importer (POI, IRIS, Radio), Historique, Qualité ; Système → Santé, Fraîcheur des données, Connexions API.

**Routes** (`admin.routes.ts`, `ROUTES_ADMIN`, enfant de la coquille) :

| Chemin | Écran |
|---|---|
| `admin` | redirige vers `admin/systeme` |
| `admin/systeme` | `systeme/systeme.page.ts` — cadre : titre, `mg-onglets-routes`, outlet ; `''` → `sante` |
| `admin/systeme/sante` | `health/health.page.ts` — vérifications d'infrastructure (ex-onglet « Diagnostic système ») |
| `admin/systeme/fraicheur` | `health/fraicheur.component.ts` — fraîcheur des sources hors socle |
| `admin/systeme/api` | `api/connexions-api.page.ts` — en-tête de section et SOUS-onglets de l'écran React ; `''` → `dv360` |
| `admin/systeme/api/dv360` | `api/dv360.page.ts` — connexion DV360 (diagnostic, méthode, OAuth, test, purge, journal) |
| `admin/systeme/api/{meta,ttd}` | `api/fournisseur-a-venir.component.ts` — « bientôt disponible » (`data.fournisseur`) |
| `admin/systeme/api/tiktok` | `api/tiktok.page.ts` — connexion TikTok (diagnostic, App ID + secret, OAuth, test, purge, journal) |
| `admin/systeme/api/logs` | `api/journal-dsp.page.ts` — journal des appels DSP de l'organisation, filtre « Erreurs uniquement » |
| `admin/donnees` | `donnees/donnees.page.ts` — cadre ; `''` → `sources` |
| `admin/donnees/sources` | `sources/sources.page.ts` — neuf onglets, vue « Toutes » (tuiles, données système, liste et détail d'une source : filtres, nom, export CSV, suppression) ; panneaux par type (T19) ; DSP et Zones perso (T20) |
| `admin/donnees/importer` | `importer/importer.page.ts` — choix du type d'import en sous-onglets (écrans PORTÉS seulement) ; `''` → `poi` |
| `admin/donnees/importer/poi` | `import/import-poi.page.ts` (état de page `import/etat/import-poi.service.ts`) + `import/etapes/` — import POI : dépôt, catégorie, correspondance, colonnes (T12) ; géocodage, essai, import en flux (T13) |
| `admin/donnees/importer/iris` | `iris-crawler/iris-crawler.page.ts` — dépôt d'un CSV IRIS, correspondance des colonnes, import NDJSON avec progression |
| `admin/donnees/importer/radio[/import]` | `radio/radio.page.ts` (cadre, onglets propres, état de page `radio/etat/radio-import.service.ts`) + `radio/onglet-import.component.ts` — imports ANFR / enrichissement / ODS en flux, journal filtrable, historique, zone dangereuse (T16) |
| `admin/donnees/historique` | `imports/imports.page.ts` — historique des imports |
| `admin/donnees/qualite` | `qualite-donnees/qualite-donnees.page.ts` — contenu des données (absente, partielle, périmée, fausse) |
| `admin/health`, `admin/qualite-donnees`, `admin/imports`, `admin/iris-crawler`, `admin/sources`, `admin/radio`, `admin/import`, `admin/api[/<x>]` | anciennes adresses, redirigées (RELATIVEMENT) vers `systeme`, `donnees/qualite`, `donnees/historique`, `donnees/importer/iris`, `donnees/sources`, `donnees/importer/radio`, `donnees/importer/poi`, `systeme/api[/<x>]` |
| `admin/acces` | `espaces/espaces.page.ts` — colonne des espaces, puis `socle`, `comptes` ou `:id` (fiche d'un espace) |
| `admin/espaces[/:id]` | anciennes adresses, redirigées vers `admin/acces` |

**Entrée** : `cadre-admin.component.ts` (le cadre commun) et `roleResoluGuard` : le rôle est relu à chaque
navigation ; un compte non super-administrateur voit le message de refus, sans requête.

**Services** : fournis par la ROUTE (`FOURNISSEURS_ADMIN`), pas par `FOURNISSEURS_DISTANTS` — l'injecteur de
la route reçoit nos intercepteurs. État : `etat/role-admin.service.ts` ; pour Accès,
`espaces/etat/espaces-etat.service.ts` (la liste des espaces, relue après chaque écriture), fourni par
`espaces.page.ts` et détruit avec elle.

**Sous-dossiers** :
- `commun/` — barre d'onglets liée au routeur (`onglets-routes`, partagée par Données et Système), dépôt de
  fichiers, journal temps réel, barre de progression d'import (règle « jamais de
  traitement DB silencieux »).
- `api/` — Connexions API : `data/dsp.api.ts` (routes `app/api/admin/dsp/**`, fournisseur en paramètre),
  `logique/fournisseurs.ts` (copie de `PROVIDERS`, logos `angular/public/logos/` copiés à l'octet),
  `naviguer-hors-application.ts` (seule navigation hors application, consentement OAuth) et
  `retour-oauth.ts` (`?oauth=` lu dans la route puis retiré, partagé par DV360 et TikTok) ; ce que DV360 et TikTok
  ont d'identique : `connexion-dsp.css` (styles) et `logique/connexion-dsp.ts` (message d'échec, ligne de journal,
  lectures annulables).
- `logique/` — rôles (`roles.ts`, copie de `lib/auth/roles.ts`, seule source des libellés de rôle) et types
  copiés du serveur, verrouillés par `admin-logique-paritaire.test.ts`.
- `sources/` — écran Sources : `sources.page` (onglets, état, suppression confirmée), `tuiles-sources`, `liste-sources`,
  `detail-source` (recréé à chaque source choisie), `logique/constantes.ts` (copies de React), `data/sources-admin.api.ts`.
  Onglets DSP et Zones perso (T20) dans `sources/panneaux/` : `dsp` (liste relue à chaque visite, suppression
  confirmée), `dialogue-import-dsp` (`<dialog>` non fermable pendant le flux SSE, progression par étape),
  `zones-custom` (filtres, tableau) et `dialogue-suppression-zone` ; `testing/dsp-import.fixture.ts` (flux SSE).
  Panneaux par type (T19), même dossier : `ooh` (réduit à `ooh.total`, A6) et `carreaux` (statistiques de l'écran,
  sans lecture), `transport` (tableau repliable), `iris` + `iris-synchro` (millésime, PMTiles et suppression sous
  `mg-confirmation`), `poi` + `dialogue-poi` (`<dialog>`, focus dans « Nom ») ; `panneaux-commun.css` (bandeau,
  grand total, cases, blocs) ; types des réponses dans `data/panneaux.types.ts`. POI, IRIS et Transport sont
  créés à la première visite de leur onglet puis GARDÉS, masqués (`.masque`), comme l'état de React vivait
  dans le parent.
- `commun/data/organisations-liste.api.ts` — `GET /api/admin/organizations` (amendement A2, créé en T20, réutilisé
  par l'import POI en T12) ; pas de cache dans le service : chaque écran garde sa lecture.
- `commun/data/categories-poi.api.ts` — `GET` / `POST /api/admin/poi-categories` (T12) ; même règle de cache.
- `import/` — import POI (T12-T13) : `import-poi.page` (fournit l'état), `etat/import-poi-preparation.ts` (classe de
  base : étapes 01-03b, `configGeo`) et `etat/import-poi.service.ts` (l'état de page de React complet : géocodage,
  essai, import en flux, `etapeAccessible`), `etapes/` (une étape par composant, `etape.css` commun : carte, badges,
  champs ; `etape-actions.css` : boutons, encarts, tuiles de 03c / 04 / 05), `data/import-poi.api.ts` (dépôt
  multipart, géocodage, essai, import SSE), `logique/constantes.ts` (copies de `shared.tsx`), `testing/` (analyse de
  `tests/fixtures/admin/poi-essai.csv`, géocodage et essai, flux `import-poi.sse`).
- `radio/data/radio-admin.api.ts` — `/api/radio/*` : `stats()` (Sources, T18), puis `historique()`, `journal()`, `importerAnfr()`, `enrichir()`, `importerOds()` (flux NDJSON) et `supprimer()` (DELETE avec corps) pour l'écran Radio (T16).
- `espaces/` — page Accès : fiches (`fiche-espace`, `fiche-socle`, `fiche-utilisateur`), onglets (Membres,
  Données, Aperçu, Réglages), dialogues `<dialog>` natifs, `logique/` (règles pures), `data/espaces.api.ts`.
  `fiche-commune.css` porte les boutons et la « Zone dangereuse » communs à la fiche utilisateur et à
  l'onglet Réglages.

**Ajouter un écran** : c'est un ONGLET de Données ou de Système, jamais une page de plus. Une route enfant
de `donnees` ou `systeme` dans `ROUTES_ADMIN`, son onglet dans `ONGLETS_DONNEES` / `ONGLETS_SYSTEME`, son
service d'API dans `FOURNISSEURS_ADMIN` (`@Injectable()` sans `providedIn`, héritier de `HttpBaseService`),
une redirection RELATIVE depuis l'ancienne adresse React, et la `cible` de son entrée dans
`layout/navigation.ts` : une entrée portée n'est plus rendue dans la barre (`sectionsRendues`), sa page l'est.
Un écran détruit à chaque changement d'onglet garde ses données dans un service d'état fourni par le cadre
(patron `health/etat/`).

**Ajouter un onglet à une fiche d'espace** : un composant `onglet-<nom>.component.ts` dans `espaces/`, monté
par `fiche-espace.component.ts` ; ses règles pures dans `espaces/logique/`.
