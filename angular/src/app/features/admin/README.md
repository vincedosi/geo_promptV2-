# admin — administration

**Rôle** : les écrans d'administration portés de `/admin/*` (lot 6). Cible validée par le propriétaire :
trois pages à onglets — **Accès**, **Données**, **Système** (en place depuis le 2026-10-12, T6). Aujourd'hui :
Accès (comptes et espaces de travail) ; Données → Qualité ; Système → Santé, Fraîcheur des données.

**Routes** (`admin.routes.ts`, `ROUTES_ADMIN`, enfant de la coquille) :

| Chemin | Écran |
|---|---|
| `admin` | redirige vers `admin/systeme` |
| `admin/systeme` | `systeme/systeme.page.ts` — cadre : titre, `mg-onglets-routes`, outlet ; `''` → `sante` |
| `admin/systeme/sante` | `health/health.page.ts` — vérifications d'infrastructure (ex-onglet « Diagnostic système ») |
| `admin/systeme/fraicheur` | `health/fraicheur.component.ts` — fraîcheur des sources hors socle |
| `admin/donnees` | `donnees/donnees.page.ts` — cadre ; `''` → `qualite` |
| `admin/donnees/qualite` | `qualite-donnees/qualite-donnees.page.ts` — contenu des données (absente, partielle, périmée, fausse) |
| `admin/health`, `admin/qualite-donnees` | anciennes adresses, redirigées (RELATIVEMENT) vers `systeme`, `donnees/qualite` |
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
- `logique/` — rôles (`roles.ts`, copie de `lib/auth/roles.ts`, seule source des libellés de rôle) et types
  copiés du serveur, verrouillés par `admin-logique-paritaire.test.ts`.
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
