# dentsu.explore — application Angular : guide de reprise

Interface Angular de **dentsu.explore**, portée écran par écran depuis l'application React/Next.js
(`docs/superpowers/plans/2026-09-29-transition-angular-feuille-de-route.md`). Elle appelle l'API
Next.js existante, qui reste la seule source de vérité : aucun calcul métier n'est refait ici.

Elle est livrée comme **remote Native Federation** du shell AIDA (`federation.config.js`, exposition
`./Routes` → `remoteRoutes` d'`app.routes.ts`), et se lance aussi seule pour le développement.

> L'architecture complète (routes, tables, RPC, décisions de chaque lot) est dans `ARCHITECTURE.md` à la
> racine du dépôt : le lire par `Grep` sur le nom de l'écran ou du composant. Ce guide n'en est que l'entrée.

## Démarrer

    # 1. la base locale et l'API (à la racine du dépôt)
    bash scripts/local/00-docker-up.sh && bash scripts/local/01-supabase-up.sh
    npm run dev                  # API sur :3000

    # 2. l'application Angular
    cd angular
    npm install
    npm start                    # :4200, écrit d'abord public/config.local.json

Se connecter sur `http://localhost:4200/connexion` avec le même compte que sur :3000 — la session est un
cookie partagé par les deux. En autonome, toutes les pages vivent sous `/app` (`/app/carte`,
`/app/carte/risques`, `/app/admin/acces`…) ; dans le shell, sous le préfixe que le shell choisit.

    npm start          # serveur de dev, /api redirigé vers :3000 (proxy.conf.json)
    npm test           # tests des composants et de la logique (Vitest, via ng test)
    npm run build      # build de production — doit sortir sans AUCUN avertissement
    npm run config     # régénère public/config.local.json

Les gardes structurelles (plus bas) se lancent à la racine : `npx vitest run --project unit tests/unit/angular`.

## Arborescence : ce qui va où

| Dossier | Contenu | Règle |
|---|---|---|
| `src/app/core/` | Services racine sans écran : auth et session, config, démarrage, HTTP (`HttpBaseService`, intercepteurs, limiteur à 3 appels), thème et `CouleursService`, formats de nombres et de texte | Rien de métier. Une fonction de format se met dans `core/format/nombre.ts` (nombres) ou `core/format/texte.ts` (`plierTexte` : recherche sans casse ni accents), jamais en local |
| `src/app/ui/` | Briques de gabarit réutilisables (`mg-confirmation`, `mg-champ`, `mg-kpi`, `mg-icone`, `mg-reglette`…) | Aucune ne connaît une API ; leur guide vivant est la page `catalogue` |
| `src/app/layout/` | Coquille : racine d'ombre (`racine-distante`), barre latérale, chrome du haut | `navigation.ts` recopie les entrées React |
| `src/app/carte/` | `mg-carte` : le SEUL cycle de vie MapLibre (création, `ResizeObserver`, destruction), bbox, chargement par cadre, popups sûres | Le parent pose ses sources au `(prete)` |
| `src/app/graphiques/` | `mg-courbe`, `mg-graphique`, `mg-nuage` sur Apache ECharts (import modulaire) | Couleurs par jetons, comme la carte |
| `src/app/features/` | Un dossier par écran ; chacun a son `README.md` | Une responsabilité par fichier, ≤ 400 lignes |

Dans un dossier de feature, le découpage est toujours le même : `data/` (services d'API `*.api.ts`),
`etat/` (services d'état de l'écran), `logique/` (fonctions PURES, testées sans TestBed — les copies de la
logique React vivent là aussi), puis les composants. `testing/` porte les fixtures des specs.

## Patrons du projet — un fichier à lire pour chacun

| Patron | À lire |
|---|---|
| **Service d'API** : `@Injectable()` SANS `providedIn`, hérite de `HttpBaseService`, appelle `this.httpClient` avec `${this.baseUrl}/…` ; fourni par `FOURNISSEURS_DISTANTS` (`app.routes.ts`) | `features/carte/data/radio.api.ts` |
| **Couche MapLibre** : un service (état, lectures, `effect` sur `carteCourante` qui RE-POSE la couche après un changement de fond) + une fonction pure `couche-*.ts` (sources, couches, peintures) ; place dans `logique/ordre-couches.ts` | `features/carte/couches/radio.service.ts` + `couche-radio.ts`, contrat dans `etat/couches-carte.service.ts` |
| **Couleurs MapLibre / ECharts** : `CouleursService.palette(JETONS)` rend un signal de valeurs CALCULÉES, relu à chaque thème ; jamais `var()` dans `paint`, jamais un hex recopié | `core/theme/couleurs.service.ts`, usage dans `couches/radio.service.ts` |
| **Un seul dégradé à la fois** : `EtatCarteService.basculerDegrade` évince le précédent et l'annonce DANS le geste | `features/carte/etat/etat-carte.service.ts` |
| **Garde de périmètre des outils d'analyse** : tout lancement commence par `verifierPerimetreOutil('<outil>')` | `features/carte/logique/garde-perimetre.ts`, `panneaux/analyse/panneau-analyse.component.ts` |
| **Dialogue** : `<dialog>` natif ouvert par `showModal()` DANS la racine d'ombre, jamais un portail vers `body` | `ui/confirmation/confirmation.component.ts` |
| **Navigation RELATIVE** : `router.navigate(['..'], { relativeTo })`, `routerLink` relatifs — le préfixe du shell est inconnu | `features/risques/risque.page.ts` (`fermer`) |
| **Signals, zoneless** : `signal`/`computed`/`linkedSignal` pour l'état, `effect` seulement vers une API impérative ; aucune vue ne bouge sans écriture d'un signal | `features/admin/espaces/fiche-utilisateur.component.ts` |
| **Logique pure à part** : le composant garde l'état et les écritures, les règles vont dans `logique/` | `features/risques/logique/panneau-campagne.ts` et son spec |

## Contraintes AIDA (le shell hôte)

- **Remote Native Federation** : la forme de `remoteRoutes` et l'exposition `./Routes` ne changent pas sans
  concertation ; seul leur contenu grandit. Les services d'écran sont fournis par les routes ou les pages, pas
  `providedIn: 'root'` (un service racine recevrait le `HttpClient` du shell, sans nos intercepteurs).
- **Pas de `@angular/core/rxjs-interop`** (ni `toSignal`, ni `toObservable`) : un hôte par défaut ne le
  partage pas, et sa copie locale casse `inject()` (NG0203). Une clé de signal part dans un `Subject` par un
  `effect` (exemple : `relier` dans `features/risques/etat/donnees-risque.service.ts`).
- **Racines d'ombre** : toute l'interface vit dans la racine d'ombre de `RacineDistanteComponent`. Jamais
  `position: fixed`, jamais `::ng-deep`, jamais rien posé dans `document.body` ni sur `<html>`. Les écouteurs
  clavier se posent sur l'hôte, et `composedPath()[0]` remplace `document.activeElement`.

## Tests et gardes structurelles

`npm test` (dans `angular/`) lance les specs à côté du code. À la racine, `tests/unit/angular/` verrouille la
structure — un échec y désigne une règle, pas un bogue à contourner :

| Test | Ce qu'il verrouille |
|---|---|
| `isolement.test.ts` | Angular et React/Next ne s'importent jamais l'un l'autre |
| `imports-partages.test.ts` | Le remote n'importe que des entrées d'Angular partagées par tout hôte (pas de `rxjs-interop`) |
| `modele-aida.test.ts` | Tout `*.api.ts` hérite de `HttpBaseService`, n'injecte ni `HttpClient` ni la base |
| `portails-hors-ombre.test.ts` | Rien ne s'affiche hors de la racine d'ombre (`fixed`, `::ng-deep`, `document.body`) |
| `gardes-styles.test.ts` | `inject: false` sur chaque feuille globale ; aucun `rem` dans un style de composant |
| `isolation-hote.test.ts` | Ce que l'hôte peut atteindre de nous (`:host`) est borné |
| `jetons-paritaires.test.ts` | `styles/jetons.css` = jetons de `app/globals.css`, dans les deux thèmes |
| `format-paritaire.test.ts` | `core/format/nombre.ts` rend ce que rend `lib/format/nombre.ts` |
| `icones-lucide.test.ts` | Chaque tracé de `ui/icone/icones.ts` est celui de lucide, attribut par attribut |
| `carte-logique-paritaire`, `carte-couches-paritaire`, `risques-logique-paritaire`, `risques-logique-carte-paritaire`, `simulation-paritaire`, `admin-logique-paritaire`, `espaces-types-paritaires` | Les copies de la logique React (décision P6) rendent la même chose que leur source |
| `carte-ordre-couches.test.ts` | L'ordre d'empilement des couches est celui de React |
| `panneau-analyse-garde.test.ts` | Chaque lancement d'outil d'analyse passe par la garde de périmètre |
| `taille-fichiers.test.ts` | Aucun `.ts` non-spec au-delà de 400 lignes (exception nommée : `icones.ts`) |

## Pièges connus

- **PostgREST coupe à 1 000 lignes**, sans erreur ni en-tête. Une liste qui peut dépasser passe par une RPC
  `jsonb` côté serveur (voir `CLAUDE.md`, section « Troncature PostgREST ») — jamais un `.limit()` ici.
- **`var()` dans un `paint` MapLibre** : `addLayer` lève, la couche n'est jamais ajoutée, et rien ne s'affiche
  en rouge. Couleur calculée par `CouleursService`, toujours.
- **`<select [value]>` avec des `<option>` en `@for`** : la valeur est posée avant que les options existent, le
  choix est perdu. Écrire `[selected]` sur chaque `<option>` (exemple : `fiche-utilisateur.component.html`).
- **Un `input()` nommé comme un attribut natif** (`style`, `title`, `id`…) lie l'attribut de l'hôte, pas
  l'entrée : préfixer le nom.
- **Une carte qui ne doit pas se recréer** ne se met jamais sous un `@if` : on la masque (`visibility`, largeur
  nulle), comme le module risque.
