# admin — administration

**Rôle** : les écrans d'administration portés de `/admin/*` (lot 6). Cible validée par le propriétaire :
trois pages à onglets — **Accès**, **Données**, **Système**. Aujourd'hui : Accès (comptes et espaces de
travail), Health check, Qualité des données.

**Routes** (`admin.routes.ts`, `ROUTES_ADMIN`, enfant de la coquille) :

| Chemin | Écran |
|---|---|
| `admin` | redirige vers `admin/health` |
| `admin/health` | `health/health.page.ts` — vérifications d'infrastructure, fraîcheur des sources |
| `admin/qualite-donnees` | `qualite-donnees/qualite-donnees.page.ts` — contenu des données (absente, partielle, périmée, fausse) |
| `admin/acces` | `espaces/espaces.page.ts` — colonne des espaces, puis `socle`, `comptes` ou `:id` (fiche d'un espace) |
| `admin/espaces[/:id]` | anciennes adresses, redirigées vers `admin/acces` |

**Entrée** : `cadre-admin.component.ts` (le cadre commun) et `roleResoluGuard` : le rôle est relu à chaque
navigation ; un compte non super-administrateur voit le message de refus, sans requête.

**Services** : fournis par la ROUTE (`FOURNISSEURS_ADMIN`), pas par `FOURNISSEURS_DISTANTS` — l'injecteur de
la route reçoit nos intercepteurs. État : `etat/role-admin.service.ts` ; pour Accès,
`espaces/etat/espaces-etat.service.ts` (la liste des espaces, relue après chaque écriture), fourni par
`espaces.page.ts` et détruit avec elle.

**Sous-dossiers** :
- `commun/` — dépôt de fichiers, journal temps réel, barre de progression d'import (règle « jamais de
  traitement DB silencieux »).
- `logique/` — rôles (`roles.ts`, copie de `lib/auth/roles.ts`, seule source des libellés de rôle) et types
  copiés du serveur, verrouillés par `admin-logique-paritaire.test.ts`.
- `espaces/` — page Accès : fiches (`fiche-espace`, `fiche-socle`, `fiche-utilisateur`), onglets (Membres,
  Données, Aperçu, Réglages), dialogues `<dialog>` natifs, `logique/` (règles pures), `data/espaces.api.ts`.
  `fiche-commune.css` porte les boutons et la « Zone dangereuse » communs à la fiche utilisateur et à
  l'onglet Réglages.

**Ajouter un écran** : une route enfant dans `ROUTES_ADMIN`, son service d'API dans `FOURNISSEURS_ADMIN`
(`@Injectable()` sans `providedIn`, héritier de `HttpBaseService`), et sa `cible` dans `layout/navigation.ts`
pour rendre l'entrée de la barre latérale active.

**Ajouter un onglet à une fiche d'espace** : un composant `onglet-<nom>.component.ts` dans `espaces/`, monté
par `fiche-espace.component.ts` ; ses règles pures dans `espaces/logique/`.
