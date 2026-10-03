# Lot 3 — Module risque en Angular — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Méthode obligatoire de CHAQUE tâche :** le skill personnel `porting-react-to-angular`
> (`~/.claude/skills/porting-react-to-angular/SKILL.md` + `aida-remote-app.md` +
> `reference-angular-21.md`). Lire la source React EN ENTIER, inventorier les briques
> Angular existantes en LISANT leur fichier, ne jamais appeler une API non lue,
> recenser les défauts de React, prouver par captures et chiffres.

**Goal:** Porter en Angular le module « Population à risque industriel » — les cinq étapes ① Sites › ② Rayon › ③ Couverture › ④ Zones › ⑤ Campagne, l'état dans l'URL, les exports, la barre de progression unique — avec des chiffres identiques à l'écran React sur le même état d'URL, sans retirer l'écran React.

**Architecture:** Un écran plein écran `risques` monté sous `remoteRoutes` (patron de `essai-carte`, Rendu R4), hors coquille. L'état unique du module (`EtatRisque`, copie de `lib/risques/etat-url.ts`) vit dans un service fourni PAR L'ÉCRAN et se reflète dans le paramètre de requête `risque` par le `Router` (navigation relative, `replaceUrl`). Les données partagées (bandes, courbe, sites, cibles, référentiel) vivent dans un second service d'écran qui applique les règles d'I/O (calcul au relâchement, anti-rebond 400 ms, annulation, cache avant appel). UNE instance MapLibre permanente pour les étapes ①-④ (jamais démontée), une seconde carte des codes postaux montée en permanence à largeur nulle (caméras liées à ④), une troisième pour ⑤ montée à la première visite. La logique pure de `lib/` est RECOPIÉE dans `angular/` (décision P6) et verrouillée par des tests de parité à la racine.

**Tech Stack:** Angular 21.2.4 (standalone, zoneless, signals, OnPush), Tailwind 4, MapLibre GL 5.18.0, Apache ECharts 6.1.0 (via `mg-courbe`), RxJS 7.8, Vitest (Angular : `ng test` ; racine : `npm run test:unit`), Playwright MCP pour les captures.

**Spec:** ligne « 3 — Module risque » de `docs/superpowers/plans/2026-09-29-transition-angular-feuille-de-route.md` (verbatim : « Les cinq étapes ① Sites › ② Rayon › ③ Couverture › ④ Zones › ⑤ Campagne, l'état dans l'URL, les exports, la barre de progression unique. Gel P5 à l'ouverture » ; livrable : « Chaque étape comparée à l'écran React sur le même état d'URL, chiffres identiques. ⚠ Le module React N'EST PAS retiré au lot 3 […] les deux écrans cohabitent jusqu'à la fin de la migration, et Next.js ne perd ses pages qu'au lot 7 ») ; objectif du propriétaire, verbatim : « je veux la même chose que Next.js mais Angular en respectant la doc donnée ». Références de rendu et de comportement : `components/risques/**`, `ARCHITECTURE.md` (arborescence `components/risques/` et § Application Angular), `DESIGN_SYSTEM.md`, la doc AIDA (privée, jamais stagée).

---

## Préalable bloquant (à vérifier AVANT la tâche 1)

- [ ] Le lot « Rendu » est TERMINÉ sur `feat/angular-lot0` : tâches R9 (mobilier de carte — `angular/src/app/carte/legende/*`, contrôles, popup) et R11 (composition de l'écran d'essai sur le squelette risque) relues et validées dans `.superpowers/sdd/2026-09-30-angular-lot-rendu/progress.md`. Ce lot RÉUTILISE ce que R9 et R11 produisent (légende, contrôles, raccourcis de zone, en-tête d'écran) : ne rien écrire avant d'avoir LU leurs fichiers finaux. Si R9/R11 ne sont pas finis : STOP, ne pas commencer.
- [ ] Gel P5 consigné : la feuille de route reçoit, dans le commit de la tâche 1, la mention « Gel du module risque React depuis le <date d'ouverture> (P5) ». À partir de là, tout correctif urgent du module React est reporté À LA MAIN dans la tâche Angular en cours et cité dans son rapport.
- [ ] Dossier de chantier créé : `.superpowers/sdd/2026-10-03-angular-lot3-risque/` (registre `progress.md`, captures, rapports de tâche).

---

## Arbitrages proposés (chef de projet)

| # | Arbitrage | Coût si c'est faux |
|---|---|---|
| A1 | **Écran = route plein écran `risques`** sous `remoteRoutes` (frère de `essai-carte`, hors `mg-coquille`, `authGuard`), et non un overlay `position: fixed` comme React (`AnalysePopulationOverlay.tsx:900`) : `position: fixed` est interdit dans la racine d'ombre. Même rendu (plein cadre), même en-tête. | Faible : déplacer le composant sous une autre route. |
| A2 | **L'état passe par le `Router`** (`navigate([], { relativeTo, queryParams: { risque }, queryParamsHandling: 'merge', replaceUrl: true })`), jamais `history.replaceState` : dans un hôte AIDA, le routeur appartient au shell, et écrire l'historique derrière son dos désynchronise son état. Même paramètre unique `risque`, même encodage (`ecrireEtatUrl`) que React : une URL React se colle telle quelle. | Moyen : si le shell réagit mal aux navigations de requête, repasser à une écriture différée. |
| A3 | **Le Territoire (fil d'Ariane) VA dans l'URL** (`etat.chemin`, un élément `niveau:code` — `region:93`, `departement:13` — parce que 18 codes INSEE désignent à la fois une région et un département ; noms résolus depuis `/api/ref/geo`). Le format de `etat.chemin` (liste de chaînes) et `etat-url.ts` restent inchangés ; React ignore ce champ. Défaut objectif de React, corrigé et listé : React garde `chemin` en état local (`AnalysePopulationOverlay.tsx:257`), donc `etat.chemin` vaut toujours `[]`, un lien partagé perd le territoire et la pastille de l'étape ③ ne s'allume jamais (`lib/risques/etape.ts` : `couverture` ⇔ `chemin.length > 0`). Conséquence pour les comparaisons : côté React on choisit le territoire au menu, côté Angular l'URL le porte. | Faible : retirer l'écriture du champ `chemin`. |
| A4 | **La maille choisie (« Lister par ») reste LOCALE**, comme React (`mailleChoisie`, l.272) : `etat.maille` (défaut `departement`) contredirait la maille naturelle `region` de React à l'ouverture et changerait le bandeau KPI. Parité stricte. | Faible. |
| A5 | **Les natures de risque viennent de `etat.natures`** (libellés, URL), défaut `[]`. React les reçoit par la prop `typesRisque` du panneau Calques (`page.tsx:1204`), vide par défaut (`use-risque-industriel.ts:71`), et ignore `etat.natures`. Chiffres identiques sur l'état par défaut ; le lot 4 (carte principale) écrira `natures` dans `risque=` avant d'ouvrir le module. Aucune commande de nature dans le module (React n'en a pas). | Faible : brancher une seconde source au lot 4. |
| A6 | **« Voir sur la carte » (`BoutonVoirCarte.tsx`) n'est PAS porté** : il ferme le module et allume `ZonesRisqueLayer` sur `/map`, qui n'existe pas en Angular avant le lot 4. Le bouton est ABSENT (pas inerte) jusqu'au lot 4 — ligne « écart restant justifié ». | Faible : le porter au lot 4. |
| A7 | **Fermer** (bouton ✕ et Échap) navigue vers le parent RELATIF (`['..']`, `relativeTo`), soit l'accueil, au lieu de `/map` (absent). La pile Échap de React (`lib/carte/pile-echap.ts`) n'est pas portée : le module est seul ; Échap est écouté sur l'élément hôte de l'écran (jamais sur `document`, qui serait celui du shell). | Faible. |
| A8 | **Tous les téléchargements passent par `HttpClient` en `blob`** (Bearer + limiteur), via une fonction unique `telechargerFichier`. Défaut objectif de React, corrigé et listé APRÈS vérification au navigateur en T10 : trois exports React sont de simples `<a href>` (`OngletZones.tsx:641`, `PanneauExtractions.tsx:263`, `PanneauCampagne.tsx:184`) vers des routes `requireAuth()` qui ne lisent QUE l'en-tête `Authorization` (`lib/api/middleware.ts:32`, `lib/auth.ts:66`) — attendu : 401. | Nul si React répond 200 : on garde le blob, qui marche dans les deux cas. |
| A9 | **Les flux NDJSON (⑤ Simuler, Recaler) passent par `HttpClient`** (`observe: 'events'`, `reportProgress: true`, `responseType: 'text'`, `partialText`), donc par le jeton, le limiteur et l'intercepteur de session. Un flux occupe une place du limiteur pendant ~11 s : voulu, c'est un appel lourd en base. | Moyen : si l'hôte AIDA bufferise la réponse, la progression n'avancerait qu'à la fin (données justes, barre figée). Repli : `fetch` dans le service d'API, Bearer posé à la main. |
| A10 | **Palettes de DONNÉES (`CARREAUX_PALETTES`, `lib/carreaux/catalogue.ts:69-100`) recopiées en hexadécimal** dans un seul fichier Angular, verrouillé par un test de parité, exception documentée à la règle « aucune couleur en dur » : ce sont des échelles de données identiques dans les deux thèmes, pas des couleurs d'interface, et React les écrit ainsi. | Faible : 36 jetons à créer plus tard dans `globals.css` ET `jetons.css`. |
| A11 | **Couleurs « d'un thème fixe » lues dans la feuille construite** : la carte de diffusion ⑤ peint la palette CLAIRE dans les deux thèmes (fond Positron, `lib/simulation/palette-carte.ts`), la carte des codes postaux une rampe FIXE égale aux `--seq-*` SOMBRES (`CarteCodesPostaux.tsx:77`). `CouleursService` reçoit `paletteDuTheme(jetons, 'clair' \| 'sombre')`, qui lit les déclarations `--x` du bloc `:root, :host` (sombre) ou `html.light, :host(.light)` (clair) dans les règles de la feuille `magelian.css` déjà construite — jamais un hexadécimal recopié. | Moyen : si la feuille n'est pas lisible dans l'hôte, la carte prendrait les couleurs du thème courant (écart visuel, pas de chiffre faux). |
| A12 | **Validation des profils sans Zod** : `lib/risques/profil.ts` et `lib/zones/jeu.ts` reposent sur `zod`, absent d'`angular/package.json` et interdit d'ajout (AIDA). La copie Angular réécrit `normaliserProfil` à la main avec les MÊMES règles et les mêmes messages ; le test de parité compare sorties ET levées. De `jeu.ts`, seuls le type `JeuDeZones` et les constantes sont recopiés (la normalisation est faite par le serveur). | Faible : le test de parité attrape toute divergence. |
| A13 | **Les services d'API nouveaux rejoignent `FOURNISSEURS_DISTANTS`** (`app.routes.ts`), patron établi ; les services d'ÉTAT (état d'URL, données, atelier, simulation) sont fournis par le composant d'écran (`providers`), donc détruits avec lui — comme les fournisseurs React démontés à la fermeture. | Faible. |
| A14 | **Le seuil de couverture réglé à ④ est propagé par un signal du service d'atelier**, pas par l'événement DOM `magelian:jeu-zones-regle` (`use-jeux-zones.ts:51,245`) : en Angular les deux cartes et le panneau partagent l'injecteur de l'écran. | Nul. |

---

## Global Constraints

Repris du plan Rendu (`.superpowers/sdd/2026-09-30-angular-lot-rendu/contexte-commun.md`, plan `2026-09-30-angular-lot-rendu.md` § Global Constraints) et des règles de chantier de la feuille de route — ils valent pour CHAQUE tâche :

- Angular **21.2.4** exact ; **aucune nouvelle dépendance** (AIDA : seules native-federation et mecha-lib-ui). Pas de `zod`, pas de `ngx-echarts`, pas du CDK Overlay.
- À l'exécution, imports `@angular/*` limités à `core`, `common`, `common/http`, `router`, `platform-browser` (garde `tests/unit/angular/imports-partages.test.ts`) — **jamais `@angular/core/rxjs-interop`** (`toSignal`, `takeUntilDestroyed`) : NG0203 dans un hôte par défaut. Désabonnement explicite par `DestroyRef.onDestroy`, ou `versEtat`.
- Services d'API : `*.api.ts`, `@Injectable()` **sans `providedIn`**, héritent de `HttpBaseService`, n'écrivent jamais `HttpClient` (garde `modele-aida.test.ts`), fournis par `FOURNISSEURS_DISTANTS`.
- Rien dans `angular/` n'importe hors d'`angular/` (garde `isolement.test.ts`). Dossiers d'accès aux données sous `angular/src/**/data/` (exception `.gitignore`).
- Racine d'ombre : interdits `position: fixed`, `document.body`, `querySelector('body')`, `appendTo: 'body'`, CDK Overlay, `::ng-deep`, `ViewEncapsulation.None` (garde `portails-hors-ombre.test.ts`) ; aucun `rem` dans un style de composant (`gardes-styles.test.ts`) ; `<html>` jamais écrit (`ECRIRE_HTML`). Menus/infobulles : `<dialog>` ou popover, ou `title` natif.
- Couleurs : jetons de `styles/jetons.css` dans le DOM (classes Tailwind arbitraires `bg-[var(--x)]` ou `[style.x]`) ; **MapLibre et ECharts reçoivent leurs couleurs par `CouleursService`**, jamais un hexadécimal recopié, **jamais `var()` dans `paint`** (`addLayer` lève et la couche n'existe pas — `ARCHITECTURE.md`, `CarteRisque.tsx:602`). Seule exception : A10.
- Liens et navigations RELATIFS ; ressources par `urlRessourceDistante`.
- Composants : préfixe `mg`, OnPush, `input()`/`output()`/`model()`, `@if`/`@for (… ; track id)`, `inject()`, `protected` pour le gabarit, `readonly` pour les entrées. Pas de méthode appelée dans le gabarit (→ `computed`).
- Bords 0,5 px, sentence case, Inter + JetBrains Mono, flat total, pas de violet d'interface (A10 excepté).
- **Règles d'I/O de `CLAUDE.md`, côté Angular** : au plus 3 appels `HttpClient` simultanés (tenu par `limiteurInterceptor`, ne PAS le contourner) ; **calcul au relâchement** d'une réglette, jamais par pixel ; **cache avant appel** (cibles, référentiel géo, contours, géométries : une fois par écran) ; **bbox = carte visible**, jamais la France entière au premier chargement (sites, codes postaux, bassins) ; les tuiles MapLibre échappent au limiteur, donc la discipline de bbox est dans le composant de carte.
- **Critère de sortie de toute tâche d'affichage** : captures React et Angular du même écran, 1440 × 900, même état d'URL, **deux thèmes**, rangées dans `.superpowers/sdd/2026-10-03-angular-lot3-risque/` sous `<tache>-<ecran>-<theme>-{react,angular}.png`, plus survol / focus clavier / chargement / erreur quand la tâche les nomme ; **chiffres identiques** à React (même formatage `fr-FR`) ; tableau « identifiant → corrigé / écart restant justifié » et liste des défauts React corrigés dans le rapport.
- Serveurs : racine `npm run dev` (:3000), Angular `cd angular && npm start` (:4200, routes sous `/app`). Identifiants : mémoire `reference_geomatik_credentials.md` (jamais recopiés). Arrêter l'arbre complet des serveurs en fin de tâche.
- Après chaque tâche : `cd angular && npx ng test --watch=false` et `npm run build` verts sans nouvel avertissement ; racine `npx tsc --noEmit` (code de retour lu DIRECTEMENT, jamais derrière un pipe) et `npm run test:unit` verts.
- `ARCHITECTURE.md` (§ Application Angular) mis à jour dans le commit de chaque tâche qui ajoute un composant partagé, un service ou une route. Commits atomiques `type: description`, terminés par `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. **Ne jamais pousser** ; ne jamais stager la doc AIDA (`docs/documentation-remote-app-native-federation-aida.pdf`).
- Ne PAS toucher aux fichiers du lot Rendu en cours d'écriture par d'autres agents ; après le préalable, seuls les fichiers nommés par la tâche sont modifiés. `components/risques/**` et `lib/**` (React) ne sont JAMAIS modifiés (gel P5), sauf mention explicite.

## Review Focus

- **Réponse périmée d'un réglage précédent** : déplacer deux fois la réglette, ou changer de territoire pendant un calcul de 2,8 s — l'écran doit montrer le résultat du DERNIER réglage, jamais celui qui arrive en dernier (React : jeton `mien !== jeton.current`, `use-bandes.ts:157`). Test : T5 (`switchMap` + anti-rebond, ordre inversé des réponses).
- **Allers-retours d'étapes** ②↔③↔④ : aucune carte remontée, aucune requête rejouée, vue conservée (React : « zéro appel » mesuré pour cinq bascules). Test : T4 (la carte n'est créée qu'une fois) + T7 (nombre d'appels `preparer` après trois bascules = 1).
- **URL collée, tronquée ou ancienne** (`onglet=territoires`, `fusion=oui`, profil illisible, `jeu=` non-UUID) : l'écran s'ouvre sur un état partiellement récupéré, jamais un écran blanc. Test : T1 (parité `lireEtatUrl`) + T4 (montage avec une URL malformée).
- **Données absentes ou pré-calcul manquant** (`409 a_construire`, territoire non carroyé 971/973/976, aucun site retenu, aucune extraction, simulation absente) : un message qui dit pourquoi, jamais un zéro ni un chargement sans fin. Tests : T5 (bandes en 409), T9 (0 site), T10 (courbe `a_construire`), T16 (jeu sans extraction).
- **Thème basculé avec les trois cartes et les courbes montées** : chaque `paint` repeint, aucune source recréée, aucune tuile redemandée ; cartes ⑤ et codes postaux gardent leur palette fixe. Test : T7, T15, T17 (`setPaintProperty` appelé, `addSource` non rappelé).

---

## Inventaire : React → Angular

Racine Angular du module : `angular/src/app/features/risques/` (abrégé `R/`).

| Fichier React | Lignes | Cible Angular | Tâche |
|---|---|---|---|
| `components/risques/AnalysePopulationOverlay.tsx` | 1698 | `R/risque.page.{ts,html}` (squelette, en-tête, corps), `R/commandes/barre-commune.component.ts` (l.990-1199), `R/etat/donnees-risque.service.ts` (l.431-890), `R/etapes/couverture/etape-couverture.component.ts` (l.1377-1574) | T4, T5, T11, T12 |
| `ContexteRisque.tsx` | 128 | `R/etat/etat-risque.service.ts` | T4 |
| `ContexteChargement.tsx` | 99 | déjà porté : `core/chargement/chargement.service.ts` | — |
| `BarreProgression.tsx` | 112 | déjà porté : `ui/barre-progression` + `ui/perime` | — |
| `Kpi.tsx` | 65 | déjà porté : `ui/kpi` | — |
| `elements.tsx` | 156 | déjà porté : `ui/champ`, `ui/pastille`, `ui/fil-ariane`, `ui/tableau/cellules` | — |
| `FilArianeEtapes.tsx` | 126 | `ui/fil-etapes` (existant) + adaptation `R/commandes/etapes.ts` | T4 |
| `BandeauKpi.tsx` | 179 | `R/commandes/bandeau-kpi-risque.component.ts` (sur `mg-bandeau-kpi`) | T5 |
| `use-sites-compte.ts`, `use-courbe-rayon.ts`, `use-bandes.ts` | 85+139+227 | `R/etat/donnees-risque.service.ts` | T5 |
| `RegletteRayons.tsx` | 196 | `R/commandes/reglette-rayons.component.ts` (sur `mg-reglette`) | T6 |
| `PanneauProfil.tsx` | 279 | `R/commandes/panneau-profil.component.ts` | T6 |
| `ResumeProfil.tsx` | 93 | `R/commandes/resume-profil.component.ts` | T6 |
| `CarteRisque.tsx` | 1090 | `R/cartes/carte-risque.component.ts` + `R/cartes/couches-zones.ts` + `R/cartes/couches-sites.ts` | T7, T8 |
| `PanneauSites.tsx` | 215 | `R/etapes/sites/panneau-sites.component.ts` | T9 |
| `OngletRayons.tsx` | 196 | `R/etapes/rayon/etape-rayon.component.ts` | T9 |
| `TableauBandes.tsx` | 229 | `R/etapes/rayon/tableau-bandes.component.ts` | T9 |
| `OngletRayonInfluence.tsx` | 464 | `R/etapes/rayon/courbe-rayon.component.ts` (sur `mg-courbe`) | T10 |
| `BoutonExportRayon.tsx` | 102 | `R/exports/bouton-export.component.ts` (générique) | T10 |
| `BoutonExportProfil.tsx` | 126 | idem, câblé dans l'en-tête | T10 |
| `BoutonVoirCarte.tsx` | 108 | **non porté** (A6) | — |
| `TableauCouverture.tsx` | 367 | `R/etapes/couverture/tableau-couverture.component.ts` | T11 |
| `CarteMiniFrance.tsx` | 558 | `R/etapes/couverture/carte-mini-france.component.ts` (SVG) + `R/logique/mini-france.ts` (projection, cadre, lointains) | T12 |
| `OngletZones.tsx` | 835 | `R/etapes/zones/etape-zones.component.ts` + `dilution`, `tableau-classes`, `mode-plan`, `actions-jeu`, `bibliotheque` | T13 |
| `use-jeux-zones.ts` | 276 | `R/etat/atelier-jeux.service.ts` | T13 |
| `PanneauExtractions.tsx` | 349 | `R/etapes/zones/panneau-extractions.component.ts` | T14 |
| `VueCartesZones.tsx` | 369 | `R/cartes/vue-cartes.component.ts` | T4 (cadre), T15 (double carte) |
| `CarteCodesPostaux.tsx` | 435 | `R/cartes/carte-codes-postaux.component.ts` | T15 |
| `TableauGrappes.tsx` | 200 | `R/cartes/tableau-grappes.component.ts` | T15 |
| `campagne/ContexteSimulation.tsx` | 215 | `R/etat/simulation.service.ts` | T16 |
| `campagne/PanneauCampagne.tsx` | 569 | `R/etapes/campagne/panneau-campagne.component.ts` | T16 |
| `campagne/BandeauCampagne.tsx` | 85 | `R/etapes/campagne/bandeau-campagne.component.ts` | T16 |
| `campagne/CarteCampagne.tsx` | 434 | `R/cartes/carte-campagne.component.ts` | T17 |
| `campagne/TableauZonesCampagne.tsx` | 118 | `R/etapes/campagne/tableau-zones-campagne.component.ts` | T17 |

Logique pure recopiée (P6) dans `R/logique/` — chaque fichier porte en tête « Copie de `<chemin React>` (gel P5 du <date>) ; parité : `<test>` » :

| Source React | Copie | Ce qui change | Tâche |
|---|---|---|---|
| `lib/risques/profil.ts` | `R/logique/profil.ts` | Zod remplacé (A12) | T1 |
| `lib/risques/code-profil.ts`, `dimensions.ts`, `gravites.ts`, `etape.ts`, `etat-url.ts`, `affectation.ts`, `libelle-classe.ts`, `exploration.ts`, `kpi.ts`, `palette-natures.ts` | `R/logique/<même nom>.ts` | imports relatifs | T1 |
| `lib/risques/chargement.ts` | déjà `core/chargement/chargement.ts` | — | — |
| `lib/carte/seuils-naturels.ts` | `R/logique/seuils-naturels.ts` | — | T2 |
| `lib/carte/palette-zones-risque.ts` (opacités et expressions SEULEMENT, pas `COULEUR_NIVEAU`) | `R/logique/opacites-zones.ts` | couleurs retirées | T2 |
| `lib/carte/nature-zone.ts` (`TIRETE_ZONE_CALCULEE`, `LARGEUR_TRAIT_ZONE`) | `R/logique/nature-zone.ts` | — | T2 |
| `lib/version.ts` (`ZONES_RISQUE_ZOOM_PLANCHER/LISIBLE/DETAIL`) | `R/logique/zooms.ts` | — | T2 |
| `app/copilote/_lib/constants.ts` (`circleGeoJSON`) | `R/logique/cercle.ts` | — | T2 |
| `lib/carreaux/catalogue.ts` (`CARREAUX_PALETTES`) | `R/logique/palettes-donnees.ts` | A10 | T2 |
| `lib/zones/jeu.ts` (`MODES_PLAN`, `POIDS_MIN`, `POIDS_MAX`, `MOTIF_CLASSE`, type `JeuDeZones`) | `R/logique/jeu.ts` | Zod retiré (A12) | T2 |
| `lib/simulation/vue.ts`, `alignement.ts`, `payload.ts`, `types.ts`, `entrees.ts` + `lib/campagne/alignement.ts` | `R/logique/simulation/*.ts` | imports relatifs | T2 |
| `lib/simulation/generateur.ts` (`PARAMS_DEFAUT` SEUL) | `R/logique/simulation/parametres.ts` | constante seule | T2 |
| `lib/simulation/palette-carte.ts` | **non copié** : jetons (`brand-teal`, `text-tertiary`, `text-primary`, `success`/`warning`/`danger`) en palette CLAIRE fixe (A11) | — | T17 |
| `lib/campagne/palette-divergente.ts` (`BORNES_DIVERGENTES`, `trancheDivergente`) | `R/logique/palette-divergente.ts` (sans les hex) | couleurs = jetons `diverge-*` | T2 |
| `lib/carte/palette-risques.ts`, `lib/import/georisques/familles.ts` | **non copiés** (A5) | — | — |
| `lib/risques/methode.ts`, `export-rayon/*`, `lib/zones/plan.ts`, `groupes.ts`, `lib/simulation/generateur.ts` (hors constante), `recalage.ts`, `serveur.ts` | **non copiés** : serveur uniquement | — | — |

Routes API consommées (aucune n'est modifiée, D4) : `/api/risques/exposition/cibles`, `/api/ref/geo` (cookie), `/api/meteo-geo/zones?scale=`, `/api/risques/sites/compter`, `/api/risques/exposition/rayon`, `/api/risques/profil/bandes`, `/api/risques/zones/preparer`, `/api/tiles/zones-risque/{z}/{x}/{y}` (cookie, MapLibre), `/api/map/risques-industriels`, `/api/risques/profil/export`, `/api/risques/exposition/rayon/export`, `/api/zones/jeux` (GET/POST), `/api/zones/jeux/[id]` (GET/PATCH/DELETE), `/[id]/cp-geo`, `/[id]/grappes`, `/[id]/export`, `/[id]/extractions` (GET/POST), `/[id]/extractions/[version]/export`, `/[id]/simulation` (GET/POST NDJSON/DELETE), `/[id]/simulation/recaler` (POST NDJSON), `/[id]/simulation/carte`, `/[id]/simulation/export`.

---

## Chiffres de référence (base locale, mesurés le 2026-10-03)

À REMESURER au début de chaque tâche qui les cite (la base bouge) — par l'écran React ET par SQL :

```bash
MSYS_NO_PATHCONV=1 docker exec supabase_db_genesis_app psql -U postgres -At -c "
select r->>'total', r->>'n_codes_postaux', r->>'hors_zone', r->>'n_carreaux', r->'par_classe'
from (select population_par_classe('{\"haut\":[1000,2000,5000],\"bas\":[500,1000],\"autres\":[],\"lie\":false,\"inclurePPRT\":true}'::jsonb,'ind','region',null,200,null,null) r) x;"
```

| État d'URL | Valeur | Mesure 2026-10-03 |
|---|---|---|
| défaut (`risque` absent), bandeau KPI | population totale (somme exclusive) | **14 103 578** |
| idem | part du territoire étudié | **22,1 %** (14 103 578 / 63 783 569) |
| idem | sites retenus | **1 259 / 1 259** |
| idem | codes postaux touchés | **1 927** |
| idem | taux d'utile | **—** (toutes les unités touchées à la maille région) |
| idem | gain marginal « par 100 m de plus », au rayon de 5 000 m | **+555 930** |
| défaut, étape ② tableau des bandes | haut:1 / haut:2 / haut:3 / haut:pprt | **526 874 / 2 337 495 / 10 482 317 / 239 131** |
| idem | bas:1 / bas:2 / bas:pprt | **106 419 / 410 641 / 701** |
| idem | hors zone / carreaux classés | **26 980 106 / 215 646** |
| défaut, étape ② courbe (seuils haut + bas, toutes natures) | à moins de 1 km (curseur initial) | **1 647 943** |
| idem | à moins de 5 km / total à 10 km | **25 261 303 / 42 409 940** |
| `gravites=seveso_haut` (essai lot 2) | à moins de 5 km | **13 841 288** |
| Territoire = département 13, Lister par = commune | total / unités | **388 272 / 46** |
| idem | sites retenus | **66 / 66** |
| `etape=zones&jeu=0b7ece33-4903-4a0b-a57a-f6c54e78a729` (« Seveso France — test phase 4 ») | codes postaux retenus (seuil 35) | **1 006** ; 2 extractions ; simulation `v2` |
| `etape=campagne&jeu=0b7ece33-…` | alignement v1 → v2 (doc) | **62 → 89** (à relire à l'écran React) |

Reproduire un état React : ouvrir `http://localhost:3000/map?risque=<valeur encodée>`, panneau Calques › Risque industriel › « Analyser la population à risque → » (l'overlay lit l'URL à son montage). Angular : `http://localhost:4200/app/risques?risque=<même valeur>`. Valeur encodée : `encodeURIComponent(ecrireEtatUrl(etat))` (ex. `etape%3Drayon`).

⚠ Écritures en base : les gestes « Construire », « Enregistrer », « Supprimer », « Extraire », « Simuler », « Recaler », « Purger » ÉCRIVENT. Ne jamais les jouer sur les deux jeux existants (`0b7ece33…`, `d9b81560…`) ; construire un jeu jetable `[ESSAI lot 3] …`, et le supprimer en fin de tâche.

---

## Structure de fichiers Angular

```
angular/src/app/features/risques/
├── risque.page.ts / .html            # écran : en-tête, barre, tiroir, barre de progression, bandeau, corps
├── commandes/
│   ├── barre-commune.component.ts    # Cible, Lister par, Territoire, Réglettes, Nature de zone, Niveau, Lecture
│   ├── reglette-rayons.component.ts
│   ├── panneau-profil.component.ts   # tiroir des anneaux
│   ├── resume-profil.component.ts
│   ├── bandeau-kpi-risque.component.ts
│   └── etapes.ts                     # EtapeAffichee[] depuis etape.ts
├── etat/
│   ├── etat-risque.service.ts        # EtatRisque + URL
│   ├── donnees-risque.service.ts     # cibles, ref géo, contours, sites, courbe, bandes (+ explorées)
│   ├── atelier-jeux.service.ts       # jeux de zones (④)
│   └── simulation.service.ts         # simulation (⑤)
├── etapes/sites|rayon|couverture|zones|campagne/…
├── cartes/
│   ├── vue-cartes.component.ts       # 1, 2 ou 3 cartes, jamais démontées
│   ├── carte-risque.component.ts, couches-zones.ts, couches-sites.ts
│   ├── carte-codes-postaux.component.ts, tableau-grappes.component.ts
│   └── carte-campagne.component.ts
├── exports/bouton-export.component.ts
├── logique/…                         # copies pures (P6)
└── data/                             # services d'API
    ├── sites-risque.api.ts (étendu), zones-risque.api.ts (étendu)
    ├── profil-risque.api.ts, referentiel.api.ts
    ├── jeux-zones.api.ts, simulation.api.ts
angular/src/app/core/http/ndjson.ts, telecharger.ts   # outils génériques
```

---

### Task 1: Logique pure du risque — copies et parité

**Files:**
- Create: `angular/src/app/features/risques/logique/{profil,code-profil,dimensions,gravites,etape,etat-url,affectation,libelle-classe,exploration,kpi,palette-natures}.ts`
- Create: `tests/unit/angular/risques-logique-paritaire.test.ts`
- Modify: `docs/superpowers/plans/2026-09-29-transition-angular-feuille-de-route.md` (ligne lot 3 : « ouvert le <date> — gel P5 »)

**Sources React :** `lib/risques/profil.ts:1-322`, `code-profil.ts:1-153`, `dimensions.ts:1-93`, `gravites.ts:1-107`, `etape.ts:1-138`, `etat-url.ts:1-284`, `affectation.ts:1-160`, `libelle-classe.ts:1-70`, `exploration.ts:1-210`, `kpi.ts:1-88`, `palette-natures.ts:1-122`.

**Interfaces:**
- Produces: les mêmes exports, mêmes noms, mêmes signatures que React (`ProfilRayons`, `PROFIL_DEFAUT`, `NIVEAUX`, `Niveau`, `LIBELLE_NIVEAU`, `GRAVITE_DU_NIVEAU`, `RAYON_MIN_M`, `RAYON_MAX_M`, `PAS_RAYON_M`, `ANNEAUX_MAX`, `anneauxDuNiveau`, `poserRayonExterieur`, `normaliserProfil`, `profilDesGravites`, `libelleRayon`, `codeProfil`, `profilDepuisCode`, `codeZonesRisque`, `encStrict`, `DIMENSIONS`, `DIMENSIONS_PROPOSEES`, `LIBELLE_DIMENSION`, `Dimension`, `MODES_ZONE`, `ModeZone`, `modesValides`, `NIVEAUX_RISQUE`, `libelleGravite`, `ETAPES`, `Etape`, `LIBELLE_ETAPE`, `ETAPES_HERITEES`, `rangEtape`, `EtatParcours`, `etapeRenseignee`, `EtatRisque`, `ETAT_DEFAUT`, `ecrireEtatUrl`, `lireEtatUrl`, `classerCarreau`, `idClasse`, `classesDuProfil`, `HORS_ZONE`, `anneauxParNiveau`, `libelleClasse`, `SegmentExploration`, `mailleExploree`, `perimetreExplore`, `peutDescendre`, `peutRemonter`, `descendre`, `remonter`, `codesDessines`, `partExposee`, `tauxUtile`, `TEINTES_NATURE`, `teinteNature`, `partsDeNature`, `PartNature`, `NATURES_DISTINGUABLES`, `LIBELLE_AUTRES_NATURES`). **Aucune différence de comportement**, aucune dépendance Angular.

**Pièges :** Zod (A12) ; `etat-url.ts` lit `URLSearchParams` — garder la même API (pas de `ParamMap`) ; `palette-natures.ts` rend des `var(--nature-n)` : correct pour le DOM, interdit pour ECharts (T10 traduit en nom de jeton).

- [ ] **Step 1: Écrire le test de parité (il échoue : fichiers absents)**

```ts
// tests/unit/angular/risques-logique-paritaire.test.ts
/**
 * La logique du module risque copiée dans angular/ (décision P6) rend la MÊME
 * chose que lib/risques/. Rien dans angular/ n'importe hors d'angular/ : ce test
 * est ce qui empêche la copie de dériver pendant la cohabitation (gel P5).
 */
import { describe, expect, it } from 'vitest';
import * as R from '@/lib/risques/profil';
import * as A from '../../../angular/src/app/features/risques/logique/profil';
import * as Rc from '@/lib/risques/code-profil';
import * as Ac from '../../../angular/src/app/features/risques/logique/code-profil';
import * as Ru from '@/lib/risques/etat-url';
import * as Au from '../../../angular/src/app/features/risques/logique/etat-url';
import * as Rx from '@/lib/risques/exploration';
import * as Ax from '../../../angular/src/app/features/risques/logique/exploration';
import * as Rk from '@/lib/risques/kpi';
import * as Ak from '../../../angular/src/app/features/risques/logique/kpi';
import * as Ra from '@/lib/risques/affectation';
import * as Aa from '../../../angular/src/app/features/risques/logique/affectation';
import * as Rl from '@/lib/risques/libelle-classe';
import * as Al from '../../../angular/src/app/features/risques/logique/libelle-classe';
import * as Rn from '@/lib/risques/palette-natures';
import * as An from '../../../angular/src/app/features/risques/logique/palette-natures';
import * as Re from '@/lib/risques/etape';
import * as Ae from '../../../angular/src/app/features/risques/logique/etape';
import * as Rd from '@/lib/risques/dimensions';
import * as Ad from '../../../angular/src/app/features/risques/logique/dimensions';
import * as Rg from '@/lib/risques/gravites';
import * as Ag from '../../../angular/src/app/features/risques/logique/gravites';

/** Même sortie, ou même levée (le message n'est pas comparé : Zod ≠ Error). */
function memeIssue<T>(r: () => T, a: () => T, etiquette: string) {
  let sr: unknown; let sa: unknown; let er = false; let ea = false;
  try { sr = r(); } catch { er = true; }
  try { sa = a(); } catch { ea = true; }
  expect(ea, `${etiquette} : levée`).toBe(er);
  if (!er) expect(sa, etiquette).toEqual(sr);
}

const PROFILS_BRUTS: unknown[] = [
  R.PROFIL_DEFAUT,
  { haut: [2000, 1000, 1000], bas: [500], autres: [], lie: false, inclurePPRT: true },
  { haut: [100, 10000], bas: [], autres: [], lie: true, inclurePPRT: false },
  { haut: [50], bas: [], autres: [], lie: false, inclurePPRT: true },           // sous le plancher
  { haut: [10001], bas: [], autres: [], lie: false, inclurePPRT: true },        // au-dessus
  { haut: [1500.5], bas: [], autres: [], lie: false, inclurePPRT: true },       // non entier
  { haut: [100, 200, 300, 400, 500], bas: [], autres: [], lie: false, inclurePPRT: true }, // 5 anneaux
  { haut: [1000], bas: [500], autres: [], lie: 'non', inclurePPRT: true },      // booléen faux
  { haut: [1000] },                                                             // champs manquants
  null, 'h1000', 42,
];

const CODES = [
  'h1000.2000.5000_b500.1000_a_L0_P1', 'h5000_b5000_a5000_L1_P1', 'h_b_a_L0_P0',
  'h1000_b_a_L2_P1', 'x1000_b_a_L0_P1', 'h1000.abc_b_a_L0_P1', 'h1000_b_a_L0', '',
  'h50_b_a_L0_P1', 'h100.200.300.400.500_b_a_L0_P1',
];

const URLS = [
  '', 'cible=pop_65_plus', 'etape=rayon', 'onglet=territoires', 'onglet=rayons&etape=zones',
  'etape=inexistante', 'maille=arrondissement', 'maille=commune', 'chemin=13', 'chemin=84.13',
  'natures=Inflammables%20(ancienne%20nomenclature).Explosibles', 'natures=%E0%A4%A',
  'modes=pprt', 'modes=rien', 'gravites=seveso_haut', 'gravites=haut.bas', 'profil=h1000_b_a_L0_P1',
  'profil=illisible', 'jeu=0b7ece33-4903-4a0b-a57a-f6c54e78a729', 'jeu=pas-un-uuid', 'atelier=1',
  'fusion=0', 'fusion=oui', 'campagne=0b7ece33-4903-4a0b-a57a-f6c54e78a729',
];

describe('logique du risque : Angular = React', () => {
  it('profil — normaliserProfil, mêmes sorties et mêmes refus', () => {
    PROFILS_BRUTS.forEach((p, i) => memeIssue(() => R.normaliserProfil(p), () => A.normaliserProfil(p), `profil #${i}`));
  });
  it('profil — constantes', () => {
    for (const k of ['PROFIL_DEFAUT', 'NIVEAUX', 'LIBELLE_NIVEAU', 'GRAVITE_DU_NIVEAU', 'RAYON_MIN_M', 'RAYON_MAX_M', 'PAS_RAYON_M', 'ANNEAUX_MAX'] as const) {
      expect((A as Record<string, unknown>)[k], k).toEqual((R as Record<string, unknown>)[k]);
    }
  });
  it('profil — poserRayonExterieur, profilDesGravites, libelleRayon, anneauxDuNiveau', () => {
    const profils = [R.PROFIL_DEFAUT, { ...R.PROFIL_DEFAUT, lie: true }, { ...R.PROFIL_DEFAUT, bas: [] }];
    for (const p of profils) for (const n of R.NIVEAUX) {
      expect(A.anneauxDuNiveau(p, n)).toEqual(R.anneauxDuNiveau(p, n));
      for (const m of [0, 100, 450, 1999, 5000, 9999, 12000]) {
        memeIssue(() => R.poserRayonExterieur(p, n, m), () => A.poserRayonExterieur(p, n, m), `poser ${n} ${m}`);
      }
      for (const g of [[], ['seveso_haut'], ['seveso_bas'], ['seveso_haut', 'seveso_bas'], ['ied']]) {
        expect(A.profilDesGravites(p, g)).toEqual(R.profilDesGravites(p, g));
      }
    }
    for (const m of [100, 500, 1000, 1500, 2000, 10000]) expect(A.libelleRayon(m)).toBe(R.libelleRayon(m));
  });
  it('code-profil — aller et retour', () => {
    for (const c of CODES) expect(Ac.profilDepuisCode(c), c).toEqual(Rc.profilDepuisCode(c));
    expect(Ac.codeProfil(R.PROFIL_DEFAUT)).toBe(Rc.codeProfil(R.PROFIL_DEFAUT));
    for (const n of [[], ['Explosibles'], ['Toxicité aiguë', 'Explosibles'], ['Inflammables (ancienne nomenclature)']]) {
      expect(Ac.codeZonesRisque('h1000_b_a_L0_P1', n)).toBe(Rc.codeZonesRisque('h1000_b_a_L0_P1', n));
    }
  });
  it('etat-url — lecture puis écriture, URL par URL', () => {
    for (const u of URLS) {
      const r = Ru.lireEtatUrl(new URLSearchParams(u));
      const a = Au.lireEtatUrl(new URLSearchParams(u));
      expect(a, u).toEqual(r);
      expect(Au.ecrireEtatUrl(a), u).toBe(Ru.ecrireEtatUrl(r));
    }
    expect(Au.ETAT_DEFAUT).toEqual(Ru.ETAT_DEFAUT);
  });
  it('exploration — mailles, périmètres, descente, codesDessines', () => {
    const chemins = [[], [{ niveau: 'region', code: '93', nom: 'PACA' }]] as Rx.SegmentExploration[][];
    for (const c of chemins) for (const d of Rd.DIMENSIONS) {
      expect(Ax.mailleExploree(c, d)).toEqual(Rx.mailleExploree(c, d));
      expect(Ax.peutDescendre(d)).toBe(Rx.peutDescendre(d));
      expect(Ax.descendre(c, d, '13', 'Bouches-du-Rhône')).toEqual(Rx.descendre(c, d, '13', 'Bouches-du-Rhône'));
    }
    const opts = { chemin: [], exploration: chemins[1], mailleDessinee: 'departement' as const,
      unites: ['04', '05', '06', '13', '83', '84'], deptsParRegion: { '93': ['04', '05', '06', '13', '83', '84'] } };
    expect(Ax.codesDessines(opts)).toEqual(Rx.codesDessines(opts));
    expect(Ax.perimetreExplore(chemins[1], { region: null, parent: null })).toEqual(Rx.perimetreExplore(chemins[1], { region: null, parent: null }));
  });
  it('kpi — part et taux d\'utile', () => {
    const cas: [number, number | null, number | null][] = [
      [14103578, 63783571, 63783569], [388272, 1500000, 2000000], [0, 0, 100], [10, null, null], [5, 10, 20],
    ];
    for (const [t, tou, ref] of cas) {
      expect(Ak.partExposee(t, ref)).toBe(Rk.partExposee(t, ref));
      expect(Ak.tauxUtile(t, tou, ref)).toBe(Rk.tauxUtile(t, tou, ref));
    }
  });
  it('affectation, libellés de classe, natures, étapes, dimensions, gravités', () => {
    const p = R.PROFIL_DEFAUT;
    expect(Aa.classesDuProfil(p)).toEqual(Ra.classesDuProfil(p));
    for (const d of [{ d_haut_m: 800, d_bas_m: null, pprt_niveau: null }, { d_haut_m: null, d_bas_m: 400, pprt_niveau: 'bas' }, { d_haut_m: 12000, d_bas_m: 9000, pprt_niveau: null }]) {
      expect(Aa.classerCarreau(d as never, p)).toEqual(Ra.classerCarreau(d as never, p));
    }
    const ap = Rl.anneauxParNiveau(p);
    expect(Al.anneauxParNiveau(p)).toEqual(ap);
    for (const c of ['haut:1', 'haut:3', 'haut:pprt', 'bas:2', 'hors']) expect(Al.libelleClasse(c, ap)).toBe(Rl.libelleClasse(c, ap));
    const pn = { 'Toxicité aiguë': 502, 'GPL et produits pétroliers': 485, Explosibles: 79, 'Gaz et liquides inflammables': 50, 'Inflammables (ancienne nomenclature)': 46, Déchets: 45, 'Dangereux pour le milieu aquatique': 25, 'Nature non précisée': 12, 'Chimie (IED)': 4 };
    expect(An.partsDeNature(pn)).toEqual(Rn.partsDeNature(pn));
    expect(An.TEINTES_NATURE).toEqual(Rn.TEINTES_NATURE);
    expect(Ae.ETAPES).toEqual(Re.ETAPES);
    expect(Ae.ETAPES_HERITEES).toEqual(Re.ETAPES_HERITEES);
    for (const e of Re.ETAPES) {
      const parcours = { gravites: ['seveso_haut'], profil: p, chemin: ['13'], jeu: null, simulation: false };
      expect(Ae.etapeRenseignee(e, parcours)).toBe(Re.etapeRenseignee(e, parcours));
    }
    expect(Ad.LIBELLE_DIMENSION).toEqual(Rd.LIBELLE_DIMENSION);
    expect(Ad.modesValides(['pprt', 'x'])).toEqual(Rd.modesValides(['pprt', 'x']));
    expect(Ag.NIVEAUX_RISQUE).toEqual(Rg.NIVEAUX_RISQUE);
  });
});
```

- [ ] **Step 2: Lancer et constater l'échec**

Run : `npx vitest run tests/unit/angular/risques-logique-paritaire.test.ts` — Expected : FAIL (« Failed to resolve import …/logique/profil »).

- [ ] **Step 3: Recopier les dix fichiers**, imports `@/lib/risques/x` → `./x`. Pour `profil.ts`, remplacer `AnneauxSchema` / `ProfilRayonsSchema` par la validation manuelle ci-dessous (même ordre de contrôles que Zod : type, entier, bornes, PUIS tri/dédoublonnage, PUIS nombre d'anneaux) :

```ts
export interface ProfilRayons {
  haut: number[]; bas: number[]; autres: number[];
  /** Tous les niveaux partagent les anneaux du niveau haut. Mode comparaison. */
  lie: boolean;
  /** Les périmètres PPRT forment une classe à part, avant toute bande. */
  inclurePPRT: boolean;
}

/** Erreur de profil : même contrat que `z.ZodError` côté React — elle LÈVE, l'appelant décide. */
export class ProfilInvalide extends Error {}

function anneaux(brut: unknown, niveau: string): number[] {
  if (!Array.isArray(brut)) throw new ProfilInvalide(`Anneaux du niveau ${niveau} illisibles.`);
  for (const r of brut) {
    if (typeof r !== 'number' || !Number.isFinite(r)) throw new ProfilInvalide(`Anneaux du niveau ${niveau} illisibles.`);
    if (!Number.isInteger(r)) throw new ProfilInvalide('Un rayon se saisit en mètres entiers.');
    if (r < RAYON_MIN_M) throw new ProfilInvalide(`Le rayon minimal est de ${RAYON_MIN_M} m.`);
    if (r > RAYON_MAX_M) throw new ProfilInvalide(`Le rayon maximal est de ${RAYON_MAX_M} m.`);
  }
  const tries = [...new Set(brut as number[])].sort((a, b) => a - b);
  if (tries.length > ANNEAUX_MAX) throw new ProfilInvalide('Quatre anneaux au maximum par niveau.');
  return tries;
}

export function normaliserProfil(brut: unknown): ProfilRayons {
  if (typeof brut !== 'object' || brut === null) throw new ProfilInvalide('Profil de rayons illisible.');
  const o = brut as Record<string, unknown>;
  if (typeof o['lie'] !== 'boolean' || typeof o['inclurePPRT'] !== 'boolean') throw new ProfilInvalide('Profil de rayons illisible.');
  const p: ProfilRayons = {
    haut: anneaux(o['haut'], 'haut'), bas: anneaux(o['bas'], 'bas'), autres: anneaux(o['autres'], 'autres'),
    lie: o['lie'], inclurePPRT: o['inclurePPRT'],
  };
  if (!p.lie) return p;
  return { ...p, bas: p.haut, autres: p.haut };
}
```

Garder les commentaires d'en-tête React utiles, et ajouter la ligne de provenance (« Copie de … »).

- [ ] **Step 4: Lancer le test** — Expected : PASS. Puis `cd angular && npx ng test --watch=false` (aucune régression) et `npm run build`.
- [ ] **Step 5: Gardes** : `npx vitest run tests/unit/angular/` (isolement, imports partagés) — PASS.
- [ ] **Step 6: Commit** — `git add angular/src/app/features/risques/logique tests/unit/angular/risques-logique-paritaire.test.ts docs/superpowers/plans/2026-09-29-transition-angular-feuille-de-route.md` ; message `feat(angular): logique pure du module risque, copiée avec test de parité (lot 3, T1)`.

---

### Task 2: Logique pure — zones, simulation, carte

**Files:**
- Create: `R/logique/{seuils-naturels,opacites-zones,nature-zone,zooms,cercle,palettes-donnees,jeu,palette-divergente}.ts`, `R/logique/simulation/{vue,alignement,alignement-campagne,payload,types,entrees,parametres}.ts`
- Create: `tests/unit/angular/risques-logique-carte-paritaire.test.ts`, `tests/unit/angular/simulation-paritaire.test.ts`

**Sources React :** `lib/carte/seuils-naturels.ts:1-150`, `lib/carte/palette-zones-risque.ts:55-170` (opacités, `opaciteDeClasse`, `expressionOpaciteBande`, `expressionOpaciteSelonZoom` — PAS `COULEUR_NIVEAU*` ni `expressionCouleurNiveau`, couleurs = jetons), `lib/carte/nature-zone.ts:41-52`, `lib/version.ts:109-137`, `app/copilote/_lib/constants.ts:12-40` (`circleGeoJSON` seul), `lib/carreaux/catalogue.ts:63-100`, `lib/zones/jeu.ts:39-92` (constantes + type `JeuDeZones` écrit à la main, + `JEU_DEFAUT`), `lib/campagne/palette-divergente.ts` (bornes et `trancheDivergente`, sans hex), `lib/simulation/{vue,alignement,payload,types,entrees}.ts`, `lib/campagne/alignement.ts`, `lib/simulation/generateur.ts:31-55` (`PARAMS_DEFAUT` seul, recopié en littéral).

**Interfaces — Produces :** `seuilsNaturels(valeurs, k)`, `classeDe(v, bornes)`, `OPACITE_BANDE`, `OPACITE_PPRT`, `opaciteDeClasse`, `expressionOpaciteBande()`, `expressionOpaciteSelonZoom(z)`, `TIRETE_ZONE_CALCULEE`, `LARGEUR_TRAIT_ZONE`, `ZONES_RISQUE_ZOOM_PLANCHER = 4`, `ZONES_RISQUE_ZOOM_LISIBLE = 7`, `ZONES_RISQUE_ZOOM_DETAIL = 10`, `cercleGeoJSON(lng, lat, rayonM, segments = 64): GeoJSON.Feature<GeoJSON.Polygon>` (même signature que `circleGeoJSON`, nom francisé), `PALETTES_DONNEES` (= `CARREAUX_PALETTES`), `MODES_PLAN`, `POIDS_MIN`, `POIDS_MAX`, `MOTIF_CLASSE`, `JeuDeZones`, `JEU_DEFAUT`, `BORNES_DIVERGENTES`, `trancheDivergente`, `Periode`, `LIBELLE_PERIODE`, `LigneZone`, `VueSimulation`, `construireVue`, `PointCourbe`, `courbeAlignement`, `constats`, `etatSite`, `ReponseSimulation`, `EvenementSimulation`, `EntreeBrute`, `ParamsSimulation`, `PARAMS_DEFAUT`.

**Pièges :** `PARAMS_DEFAUT` contient la graine `20_260_924` et une liste de partenaires — recopier À L'IDENTIQUE (le test compare `toEqual`). `palettes-donnees.ts` porte un commentaire d'exception A10 et un `// Exception A10 : échelles de DONNÉES, identiques dans les deux thèmes`.

- [ ] **Step 1: Écrire les deux tests de parité** (échec attendu). Squelette de `simulation-paritaire.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import * as Rv from '@/lib/simulation/vue';
import * as Av from '../../../angular/src/app/features/risques/logique/simulation/vue';
import { PARAMS_DEFAUT as RP } from '@/lib/simulation/generateur';
import { PARAMS_DEFAUT as AP } from '../../../angular/src/app/features/risques/logique/simulation/parametres';
import type { ReponseSimulation } from '@/lib/simulation/payload';

/** Une réponse de GET /api/zones/jeux/[id]/simulation figée, enregistrée dans le fichier ci-dessous. */
import reponse from './fixtures/simulation-reponse.json';

describe('simulation : Angular = React', () => {
  it('PARAMS_DEFAUT identiques', () => expect(AP).toEqual(RP));
  for (const p of ['v1', 'v2', 'tout'] as const) {
    it(`construireVue(${p})`, () => {
      expect(Av.construireVue(reponse as ReponseSimulation, p)).toEqual(Rv.construireVue(reponse as ReponseSimulation, p));
    });
  }
  it('courbeAlignement', () => expect(Av.courbeAlignement(reponse as ReponseSimulation)).toEqual(Rv.courbeAlignement(reponse as ReponseSimulation)));
  it('etatSite', () => { for (const i of [null, 0, 49, 50, 80, 120]) expect(Av.etatSite(i)).toBe(Rv.etatSite(i)); });
});
```

Fixture : `tests/unit/angular/fixtures/simulation-reponse.json` = la réponse RÉELLE de `GET /api/zones/jeux/0b7ece33-4903-4a0b-a57a-f6c54e78a729/simulation` (lue en session navigateur React, `fetch` avec Bearer depuis la console) RÉDUITE à 40 codes postaux et 5 bassins cohérents (garder `simulation`, `entrees`, `agregats` des mêmes ids) — taille < 200 ko. Le carte-paritaire compare : `seuilsNaturels` sur 6 tableaux (vide, constant, 1 valeur, 30 valeurs aléatoires à graine fixe, valeurs réelles « part % » de 13 régions, 1000 valeurs) pour k = 3 et 5 ; `classeDe` ; les opacités et expressions (`toEqual`) ; les trois zooms ; `cercleGeoJSON(5.0, 43.4, 2000)` coordonnée par coordonnée contre `circleGeoJSON` ; `PALETTES_DONNEES` contre `CARREAUX_PALETTES` ; `MODES_PLAN`/`POIDS_*`/`MOTIF_CLASSE.source`/`JEU_DEFAUT` ; `trancheDivergente` sur [-80,-50,-49.9,-25,-10,0,9.9,10,25,50,80,null].
- [ ] **Step 2: Lancer** — FAIL (imports absents).
- [ ] **Step 3: Recopier** les fichiers (imports relatifs ; `lib/simulation/alignement.ts` importe `@/lib/campagne/alignement` → `./alignement-campagne`).
- [ ] **Step 4: Lancer les deux tests** — PASS ; `ng test`, `npm run build`, gardes `tests/unit/angular/` — PASS.
- [ ] **Step 5: Commit** — `feat(angular): logique pure zones, simulation et carte, avec tests de parité (lot 3, T2)`.

---

### Task 3: Couche API du module

**Files:**
- Modify: `angular/src/app/features/risques/data/sites-risque.api.ts` (+ spec), `zones-risque.api.ts` (+ spec)
- Create: `R/data/{profil-risque,referentiel,jeux-zones,simulation}.api.ts` (+ specs), `angular/src/app/core/http/ndjson.ts` (+ spec), `angular/src/app/core/http/telecharger.ts` (+ spec)
- Modify: `angular/src/app/app.routes.ts` (`FOURNISSEURS_DISTANTS`), `ARCHITECTURE.md` (§ Application Angular : services du module risque)

**Sources React (formes de requête à reproduire À L'OCTET près des paramètres) :** `use-sites-compte.ts:57-80`, `use-courbe-rayon.ts:106-125`, `use-bandes.ts:157-210`, `use-jeux-zones.ts:140-260`, `CarteRisque.tsx:520-580`, `CarteCodesPostaux.tsx:205-230`, `TableauGrappes.tsx:50-70`, `PanneauExtractions.tsx:80-125`, `ContexteSimulation.tsx:110-200`, `CarteCampagne.tsx:140-160`, `BoutonExportProfil.tsx:41-100`, `BoutonExportRayon.tsx:30-80`, `AnalysePopulationOverlay.tsx:431-471,559-577`.

**Interfaces — Produces** (types de réponse recopiés des hooks React, mêmes noms de champs) :

```ts
// sites-risque.api.ts — ÉTEND, reste compatible avec l'accueil (appel sans argument)
compter(f?: { gravites?: string[]; natures?: string[]; perimNiveau?: 'region' | 'departement' | null; perimCode?: string | null }): Observable<CompteSites>;
// zones-risque.api.ts — ÉTEND, compatible avec essai-carte (arguments optionnels)
preparer(codeProfil: string, natures: string[] = []): Observable<unknown>;          // corps { profil } ; + natures si non vide
urlTuilesZones(codeProfil: string, natures: string[] = []): string;                 // + &natures=<a,b> encodé si non vide
sites(bbox: string, f?: { gravites?: string[]; natures?: string[] }): Observable<GeoJSON.FeatureCollection>;
courbe(gravites: string, f?: { cible?: string; natures?: string[]; perimNiveau?: string | null; perimCode?: string | null }): Observable<ReponseCourbe>;
// profil-risque.api.ts
bandes(q: { profil: string; cible: string; maille: Dimension; parent: string | null; region: string | null; natures: string[] }): Observable<Bandes>;
cibles(): Observable<{ cibles: Cible[] }>;
exportProfil(q: URLSearchParams): Observable<HttpResponse<Blob>>;   // /risques/profil/export?…
exportRayon(q: URLSearchParams): Observable<HttpResponse<Blob>>;    // /risques/exposition/rayon/export?…
// referentiel.api.ts
geo(): Observable<ReponseRefGeo>;                                   // /ref/geo
contours(scale: 'region' | 'departement'): Observable<GeoJSON.FeatureCollection>; // /meteo-geo/zones?scale=
// jeux-zones.api.ts
lister(): Observable<{ jeux: JeuResume[] }>;
lire(id: string): Observable<JeuDetail>;
construire(jeu: JeuDeZones): Observable<{ id: string }>;            // POST { jeu, brouillon: true }
regler(id: string, champs: ReglageJeu): Observable<unknown>;        // PATCH
supprimer(id: string): Observable<unknown>;                         // DELETE
cpGeo(id: string, bbox: string): Observable<ChargementCp>;
grappes(id: string): Observable<{ grappes: Grappe[] }>;
extractions(id: string): Observable<{ extractions: Extraction[] }>;
extraire(id: string, corps: { commentaire?: string | null }): Observable<unknown>;
exportJeu(id: string): Observable<HttpResponse<Blob>>;
exportExtraction(id: string, version: number): Observable<HttpResponse<Blob>>;
// simulation.api.ts
lire(id: string): Observable<ReponseSimulation>;
simuler(id: string, version: number, params: Partial<ReglagesSimulation>): Observable<EvenementSimulation>; // NDJSON
recaler(id: string): Observable<EvenementSimulation>;                                                       // NDJSON
purger(id: string): Observable<unknown>;
carte(id: string, bbox: string): Observable<GeoJSON.FeatureCollection>;
exportSimulation(id: string): Observable<HttpResponse<Blob>>;
```

Outils génériques (`core/http/`) :

```ts
// ndjson.ts — découpe un texte NDJSON reçu par morceaux ; une ligne illisible est IGNORÉE (ContexteSimulation.tsx:62-87)
export function lignesNdjson<T>(evenements: Observable<HttpEvent<string>>): Observable<T> {
  return new Observable<T>((abonne) => {
    let lu = 0;
    const traiter = (texte: string, fin: boolean) => {
      const bout = fin ? texte.length : texte.lastIndexOf('\n') + 1;
      if (bout <= lu) return;
      for (const ligne of texte.slice(lu, bout).split('\n')) {
        const l = ligne.trim();
        if (!l) continue;
        try { abonne.next(JSON.parse(l) as T); } catch { /* une ligne illisible ne coupe pas la progression */ }
      }
      lu = bout;
    };
    const s = evenements.subscribe({
      next: (e) => {
        if (e.type === HttpEventType.DownloadProgress) traiter((e as HttpDownloadProgressEvent).partialText ?? '', false);
        else if (e.type === HttpEventType.Response) traiter((e as HttpResponse<string>).body ?? '', true);
      },
      error: (err) => abonne.error(err),
      complete: () => abonne.complete(),
    });
    return () => s.unsubscribe();
  });
}
```

Dans `simulation.api.ts` : `return lignesNdjson<EvenementSimulation>(this.httpClient.post(url, corps, { observe: 'events', reportProgress: true, responseType: 'text' }));`

```ts
// telecharger.ts — un fichier binaire rendu par une route requireAuth (Bearer), jamais un <a href> nu (A8)
export function nomDeFichier(reponse: HttpResponse<Blob>, repli: string): string {
  const cd = reponse.headers.get('content-disposition') ?? '';
  const m = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(cd);
  return m ? decodeURIComponent(m[1] ?? m[2]) : repli;
}
export function enregistrerFichier(doc: Document, reponse: HttpResponse<Blob>, repli: string): void {
  const url = URL.createObjectURL(reponse.body!);
  const a = doc.createElement('a');           // jamais inséré dans document.body (racine d'ombre)
  a.href = url;
  a.download = nomDeFichier(reponse, repli);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
```

Vérifier dans `BoutonExportProfil.tsx:78-85` la regex exacte du nom de fichier React et la REPRENDRE à l'identique si elle diffère.

**Pièges :** `*.api.ts` ne nomme jamais `HttpClient` (garde) — `observe: 'events'` passe par `this.httpClient` ; `HttpParams` encode `+` et les espaces différemment de `URLSearchParams` : pour `natures` (libellés accentués, parenthèses), construire `HttpParams` avec `fromString` d'un `URLSearchParams` OU vérifier dans la spec l'URL émise contre celle de React (`'Toxicité aiguë'` → `natures=Toxicit%C3%A9%20aigu%C3%AB` côté React, `+` côté `URLSearchParams.toString()`… comparer à ce que la route décode : `liste(p.natures)` en `split(',')`, la spec vérifie la VALEUR DÉCODÉE) ; `/api/ref/geo` est au cookie seul (middleware) : le Bearer ajouté est sans effet, ne pas l'en retirer.

- [ ] **Step 1: Specs (échec)** — pour CHAQUE méthode : `HttpTestingController.expectOne` sur l'URL et la méthode, corps exact pour POST/PATCH, `flush` d'une réponse type. Cas obligatoires : `compter()` sans argument → `/api/risques/sites/compter` (spec existante inchangée) ; `compter({ gravites: ['seveso_haut','seveso_bas'], perimNiveau: 'departement', perimCode: '13' })` → paramètres `gravites=seveso_haut,seveso_bas&perim_niveau=departement&perim_codes=13` ; `preparer(code)` → corps `{ profil }` (spec existante inchangée) et `preparer(code, ['Explosibles'])` → `{ profil, natures: ['Explosibles'] }` ; `urlTuilesZones(code, ['Toxicité aiguë','Explosibles'])` → suffixe `&natures=Toxicit%C3%A9%20aigu%C3%AB%2CExplosibles` (même encodage que `CarteRisque.tsx:396`) ; `bandes(...)` → `profil, cible, maille` toujours, `parent`/`region`/`natures` seulement si renseignés (ordre et présence comme `use-bandes.ts:180-186`) ; `construire` → corps `{ jeu, brouillon: true }`. Spec `ndjson.ts` : trois `DownloadProgress` cumulatifs coupant une ligne au milieu + une ligne non-JSON + `Response` final → exactement les objets attendus, dans l'ordre, la ligne illisible ignorée. Spec `telecharger.ts` : `nomDeFichier` sur `attachment; filename="jeu.xlsx"`, sur `filename*=UTF-8''Jeu%20%C3%A9t%C3%A9.xlsx`, sans en-tête → repli ; `enregistrerFichier` crée un `<a>` non attaché (`a.isConnected === false`) et appelle `click`.
- [ ] **Step 2: Lancer** `cd angular && npx ng test --watch=false` — FAIL.
- [ ] **Step 3: Implémenter**, enregistrer `ProfilRisqueApi`, `ReferentielApi`, `JeuxZonesApi`, `SimulationApi` dans `FOURNISSEURS_DISTANTS`.
- [ ] **Step 4: Tests** PASS ; `npm run build` ; racine `npm run test:unit` (gardes `modele-aida`, `imports-partages`, `portails-hors-ombre`) PASS ; vérifier que `essai-carte` et l'accueil compilent sans changement.
- [ ] **Step 5: Doc + commit** — `ARCHITECTURE.md` § Application Angular : paragraphe « Services du module risque » (liste ci-dessus, NDJSON par `HttpClient`, téléchargement par blob et pourquoi). Commit `feat(angular): services d'API du module risque, NDJSON et téléchargement (lot 3, T3)`.

---

### Task 4: État d'URL, route plein écran et squelette de l'écran

**Files:**
- Create: `R/etat/etat-risque.service.ts` (+ spec), `R/risque.page.{ts,html}` (+ spec), `R/commandes/etapes.ts` (+ spec), `R/cartes/vue-cartes.component.ts` (cadre seul : une carte permanente, interrupteur, « Carte seule »)
- Modify: `angular/src/app/app.routes.ts` (route `risques`), `angular/src/app/ui/icone/icones.ts` (+ `maximize-2`, `minimize-2`), `tests/unit/angular/icones-lucide.test.ts` (compte), `angular/src/app/remote.spec.ts`, `angular/src/app/app.config.spec.ts`, `ARCHITECTURE.md`

**Sources React :** `ContexteRisque.tsx:1-128`, `AnalysePopulationOverlay.tsx:383-404` (étape, largeur, carte seule), `896-978` (en-tête), `1240` (barre de progression), `1307-1376` + `1576-1638` (corps : panneau gauche `visibility`, poignée 320-900 px, zone carte), `FilArianeEtapes.tsx:1-126`, `VueCartesZones.tsx:64-268` (montage permanent, `visibility: hidden` + largeur nulle, interrupteur Rayons/Codes postaux désactivé sans jeu, bouton « Carte seule »). Lire AUSSI l'écran d'essai final (R11) et `carte/legende/*` (R9) : réutiliser leur en-tête d'écran et leurs proportions.

**Interfaces:**
- Consumes : T1 (`EtatRisque`, `ETAT_DEFAUT`, `lireEtatUrl`, `ecrireEtatUrl`, `ETAPES`, `LIBELLE_ETAPE`, `rangEtape`, `etapeRenseignee`), `ChargementService`, `mg-barre-progression`, `mg-fil-etapes`, `mg-fil-ariane`, `mg-carte`, `mg-icone`.
- Produces :

```ts
@Injectable()
export class EtatRisqueService {
  readonly etat: Signal<EtatRisque>;
  maj(partiel: Partial<EtatRisque>): void;
  reinitialiser(): void;
}
/** Le paramètre unique du module dans l'URL (ContexteRisque.tsx:58). */
export const PARAM_RISQUE = 'risque';
export function etapesAffichees(etat: EtatRisque, simulation: boolean): EtapeAffichee[];
// risque.page : `largeurPanneau` (signal, 480), `carteSeule` (signal), `apercuRayon` (signal<ApercuRayon | null>)
// vue-cartes : input `etape`, `jeuId`, `carteSeule` (model) ; output `carteRayons` (maplibregl.Map) pour T7
```

Implémentation de référence du service :

```ts
@Injectable()
export class EtatRisqueService {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly courant = signal<EtatRisque>(
    lireEtatUrl(new URLSearchParams(this.route.snapshot.queryParamMap.get(PARAM_RISQUE) ?? '')),
  );
  readonly etat = this.courant.asReadonly();
  /** Le dernier encodage écrit : sans lui, chaque passe réécrirait l'URL (ContexteRisque.tsx:82-92). */
  private dernier: string | null = null;

  constructor() {
    effect(() => {
      const encode = ecrireEtatUrl(this.courant());
      if (encode === this.dernier) return;
      this.dernier = encode;
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { [PARAM_RISQUE]: encode === '' ? null : encode },
        queryParamsHandling: 'merge',
        replaceUrl: true,          // pas une entrée d'historique par cran de réglette
      });
    });
  }
  maj(partiel: Partial<EtatRisque>): void { this.courant.update((e) => ({ ...e, ...partiel })); }
  reinitialiser(): void { this.courant.set(ETAT_DEFAUT); }
}
```

Route (frère d'`essai-carte`, AVANT la route coquille) :

```ts
{
  path: 'risques',
  canActivate: [authGuard],
  loadComponent: () => import('./features/risques/risque.page').then((m) => m.RisquePage),
},
```

`RisquePage` : `providers: [ChargementService, EtatRisqueService]` (T5-T16 y ajoutent leurs services), `host: { class: 'flex h-full flex-col bg-[var(--bg-primary)]', '(keydown.escape)': 'fermer()', tabindex: '-1' }`. `fermer()` = `router.navigate(['..'], { relativeTo: route })`. En-tête : pastille teal 7 px, titre « Population à risque industriel » (Inter 15/500), `mg-fil-ariane` du territoire (segments vides en T4, « France entière »), `mg-fil-etapes` (`choisir` → `maj({ etape })`), libellé cible (mono 11, « Population totale » en T4), espace, bouton ✕ (`aria-label="Fermer"`). Corps : `<aside>` à largeur `carteSeule() ? 0 : largeurPanneau()`, `visibility: hidden` quand replié (JAMAIS `@if` : les panneaux d'étape restent montés), contenu par `@switch (etat().etape)` avec un texte provisoire par étape (remplacé T9-T16) ; poignée `role="separator"` `aria-orientation="vertical"` `aria-label="Largeur du panneau"` qui suit le pointeur par `setPointerCapture` sur ELLE-MÊME (`pointermove`/`pointerup` sur l'élément, pas `window`), bornée 320-900 ; `mg-vue-cartes` à droite.

**Pièges :** NG0203 (`effect` dans le constructeur seulement) ; `runGuardsAndResolvers: 'always'` sur la route racine rejoue `demarrageGuard` à chaque navigation de requête — `demarrer()` est idempotent, mais VÉRIFIER qu'aucun rechargement visible n'a lieu ; le composant d'écran ne doit PAS être recréé par une navigation de requête (même route) — spec ; `visibility` et non `@if` ; aucune `position: fixed` ; l'écouteur Échap est sur l'hôte, jamais `document`.

- [ ] **Step 1: Specs (échec)** — `etat-risque.service.spec.ts` : (a) URL `?risque=etape%3Drayon` → `etat().etape === 'rayon'` ; (b) `maj({ cible: 'pop_65_plus' })` puis `TestBed.tick()` → `router.navigate` appelé avec `queryParams.risque === 'cible=pop_65_plus'`, `replaceUrl: true`, `queryParamsHandling: 'merge'` ; (c) deux `maj` identiques → UN seul `navigate` ; (d) retour au défaut → `queryParams.risque === null` ; (e) URL malformée `?risque=profil%3Dillisible%26onglet%3Dterritoires%26jeu%3Dx` → `etape 'couverture'`, profil par défaut, `jeu null`. `risque.page.spec.ts` (routeur de test, `provideRouter([{ path: 'risques', component: RisquePage }])`, `RouterTestingHarness`) : (f) l'en-tête porte le titre et cinq étapes ; (g) cliquer l'étape ③ change le `?risque=` sans recréer le composant (même instance avant/après) ; (h) « Carte seule » met l'`aside` en `visibility: hidden` et le panneau d'étape reste dans le DOM ; (i) Échap navigue vers le parent ; (j) `mg-carte` est créée UNE fois après trois changements d'étape (fabrique de carte factice `carte/testing/carte-factice.ts`, compteur de créations). `etapes.spec.ts` : `etapesAffichees(ETAT_DEFAUT, false)` → 5 étapes, rangs 1-5, libellés `LIBELLE_ETAPE`, `renseignee` = `etapeRenseignee`. `remote.spec.ts`/`app.config.spec.ts` : la route `risques` existe sous `remoteRoutes`, hors coquille, gardée par `authGuard`, en autonome sous `/app/risques`.
- [ ] **Step 2: Lancer** — FAIL. **Step 3: Implémenter.** **Step 4: Tests** PASS ; build.
- [ ] **Step 5: Navigateur** — ouvrir `/app/risques`, `/app/risques?risque=etape%3Dzones`, `/app/risques?risque=onglet%3Dterritoires` ; vérifier l'URL après chaque clic d'étape (une seule entrée d'historique : « retour » quitte l'écran). Captures en-tête + corps vides, deux thèmes, contre React à l'étape ① (`T4-squelette-{sombre,clair}-{react,angular}.png`) ; cadrer les écarts de contenu attendus (étapes vides) dans le rapport.
- [ ] **Step 6: Doc + commit** — `ARCHITECTURE.md` : route `risques`, état d'URL par `Router` (A2), règle « la carte ne se démonte jamais ». Commit `feat(angular): écran du module risque — état d'URL, route plein écran, squelette (lot 3, T4)`.

---

### Task 5: Données partagées, barre commune et bandeau KPI

**Files:**
- Create: `R/etat/donnees-risque.service.ts` (+ spec), `R/commandes/barre-commune.component.ts` (+ spec), `R/commandes/bandeau-kpi-risque.component.ts` (+ spec)
- Modify: `R/risque.page.{ts,html}` (providers, barre, bandeau, fil d'Ariane du territoire, libellé de cible)

**Sources React :** `AnalysePopulationOverlay.tsx:257-341` (chemin, maille choisie, modes, niveaux, `profilCalcul` l.316), `431-471` (cibles, référentiel), `478-500` (maille naturelle, périmètre), `582-725` (natures, courbe, bandes, pistes de chargement, `perime`), `734-748` (rayon max, courbe totale), `893-894`, `990-1199` (barre commune hors réglettes), `1240-1259` (barre + bandeau), `use-bandes.ts`, `use-courbe-rayon.ts`, `use-sites-compte.ts`, `BandeauKpi.tsx:1-179`.

**Interfaces:**
- Consumes : T1 (`profilDesGravites`, `codeProfil`, `NIVEAUX`, `anneauxDuNiveau`, `DIMENSIONS_PROPOSEES`, `LIBELLE_DIMENSION`, `MODES_ZONE`, `NIVEAUX_RISQUE`, `partExposee`, `tauxUtile`), T3 (APIs), T4 (`EtatRisqueService`), `ChargementService`, `mg-champ`, `button[mgPastille]`, `mg-kpi`, `mg-bandeau-kpi`, `[mgPerime]`.
- Produces (fourni par `RisquePage`) :

```ts
export interface Segment { niveau: 'region' | 'departement'; code: string; nom: string }
@Injectable()
export class DonneesRisqueService {
  readonly cibles: Signal<Cible[]>;
  readonly libelleCible: Signal<string>;                  // 'Population totale' par défaut
  readonly refGeo: Signal<{ regions: UniteRef[]; departements: UniteRef[]; deptsParRegion: Record<string, string[]> }>;
  readonly chemin: Signal<Segment[]>;                     // dérivé de etat.chemin + refGeo (A3)
  readonly mailleChoisie: WritableSignal<Dimension | null>; // locale (A4)
  readonly dimension: Signal<Dimension>;                  // mailleChoisie ?? maille naturelle (region|departement|commune)
  readonly natures: Signal<string[]>;                     // etat.natures (A5)
  readonly profilCalcul: Signal<ProfilRayons>;            // profilDesGravites(etat.profil, etat.gravites)
  readonly rayonMaxProfil: Signal<number | null>;
  readonly bandes: Signal<ResultatBandes>;                // { etat, bandes, erreur, aConstruire }
  readonly courbe: Signal<ResultatCourbe>;                // { data, chargement, erreur, aConstruire }
  readonly compteSites: Signal<{ compte: CompteSites | null; chargement: boolean }>;
  readonly courbeTotale: Signal<PointCourbe[] | null>;
  readonly perime: Signal<boolean>;
  /** Second calcul, pour l'exploration de ③ (T11) : actif seulement si la requête est non nulle. */
  readonly requeteExploree: WritableSignal<RequeteBandes | null>;
  readonly bandesExplorees: Signal<ResultatBandes>;
  contours(scale: 'region' | 'departement'): Signal<GeoJSON.Feature[] | null>;  // cache par échelle (T12)
  choisirTerritoire(valeur: '' | `${'region' | 'departement'}:${string}`): void;
  remonter(n: number): void;
}
```

Règles de chargement (à reproduire EXACTEMENT, c'est le cœur des règles d'I/O) :
- **bandes** : anti-rebond **400 ms** (`use-bandes.ts:112`) puis `switchMap` (une réponse d'un réglage précédent est jetée — équivalent du jeton React) ; paramètres `profil = codeProfil(profilCalcul)`, `cible`, `maille = dimension`, `parent` = code du segment `departement` du chemin, `region` = code du segment `region`, `natures`. Pendant le calcul, `etat: 'chargement'` en GARDANT la valeur précédente (pour `perime`). Erreur 409 → `aConstruire = corps.a_construire === true`, message = `corps.error`.
- **courbe** : sans anti-rebond ; dépend de `cible`, `gravites`, `natures`, périmètre (dernier segment région/département) ; `switchMap`.
- **sites** : dépend de `gravites`, `natures`, périmètre ; ne dépend PAS du profil (`AnalysePopulationOverlay.tsx:692-702`).
- **cibles** et **référentiel** : une fois par écran (cache), échec silencieux comme React.
- Pistes : `suivre('bandes', 'Calcul de la population par classe…', …)`, `('courbe', 'Lecture de la courbe de couverture…', …)`, `('sites', 'Comptage des sites…', …)` — libellés EXACTS de React.
- Le flux d'entrées est construit en `computed` sérialisé (clé texte) puis converti en `Observable` par un `effect` qui pousse dans un `Subject` (pas de `toObservable`, interdit) ; désabonnement dans `DestroyRef.onDestroy`.

Barre commune (T5 sans les réglettes, posées en T6) : « Cible » (`<select>` groupé par famille, `<option value="ind">Population totale</option>` tant que le catalogue est vide), « Lister par » (pastilles `DIMENSIONS_PROPOSEES`, infobulles commune/code postal mot pour mot l.1033-1038), « Territoire » (`<select>` France entière / Régions / Départements `code — nom`), « Nature de la zone » (au moins une gardée), « Niveau réglementaire » (au moins un gardé), « Lecture des zones » (Fusionnées / Site par site). Bandeau KPI : six `mg-kpi` dans `mg-bandeau-kpi`, valeurs, libellés, notes et infobulle MOT POUR MOT (`BandeauKpi.tsx:77-179`), `—` tant que la donnée manque, enveloppé par `[mgPerime]`.

**Pièges :** zoneless — l'écriture des signaux dans `subscribe` suffit, aucun `markForCheck` ; ne jamais lire l'objet `etat()` entier comme dépendance d'un chargement (la bascule « Lecture des zones » ne doit relancer AUCUN appel — `etat-url.ts` l.104) : chaque chargement dépend d'un `computed` de clé texte ; `versEtat` interdit dans un `computed` ; `<select>` natif et non un menu flottant (racine d'ombre) ; la région part dans `region`, jamais dans `parent` (18 codes INSEE communs, sql/171).

- [ ] **Step 1: Specs (échec)** — `donnees-risque.service.spec.ts` (APIs factices en `Subject`, `vi.useFakeTimers()` avec `TestBed.tick()`) : (a) deux changements de profil à 100 ms d'intervalle → UN appel `bandes` après 400 ms ; (b) réponse du premier réglage arrivant APRÈS le second → ignorée (le signal porte le second) ; (c) `etat.fusionner` basculé → zéro appel nouveau ; (d) `etat.chemin = ['departement:13']` avec référentiel → segment `{ niveau: 'departement', code: '13', nom: 'Bouches-du-Rhône' }`, `parent='13'`, `region=null` ; `['region:84']` (Auvergne-Rhône-Alpes) et `['departement:84']` (Vaucluse) donnent deux segments DIFFÉRENTS (A3) ; un élément sans préfixe ou inconnu du référentiel est ignoré, jamais une erreur ; (e) 409 `{ error, a_construire: true }` → `aConstruire === true` ; (f) cibles et référentiel appelés une seule fois en 3 relectures. `bandeau-kpi-risque.spec.ts` : avec la réponse mesurée (total 14103578, population_reference 63783569, pop_unites_touchees 63783571, n_codes_postaux 1927) → `14 103 578`, `22,1 %`, `1 927`, `—` (taux), `+555 930` avec une courbe dont le point r=5000 porte i=555930 et `rayonMax=5000` ; sans données → six `—`. `barre-commune.spec.ts` : décocher le dernier niveau → refusé (reste coché) ; « Lister par » commune puis région naturelle → `mailleChoisie` revient à `null`.
- [ ] **Step 2: Lancer** — FAIL. **Step 3: Implémenter.** **Step 4: Tests** PASS ; build.
- [ ] **Step 5: Navigateur et chiffres** — état par défaut : les six KPI égaux au tableau « Chiffres de référence » ET à React ; `Territoire = 13 — Bouches-du-Rhône` + `Lister par = Commune` : total **388 272**, sites **66 / 66** ; ouvrir l'onglet Réseau : au repos, au plus 3 requêtes `/api` simultanées, aucune requête répétée en basculant « Lecture des zones ». Captures barre + bandeau, deux thèmes, état par défaut, plus état « chargement » (chiffres estompés) : `T5-barre-bandeau-{theme}-{react,angular}.png`.
- [ ] **Step 6: Commit** — `feat(angular): données partagées, barre commune et bandeau KPI du module risque (lot 3, T5)`.

---

### Task 6: Réglette des rayons, tiroir des anneaux, résumé du profil

**Files:**
- Create: `R/commandes/reglette-rayons.component.ts` (+ spec), `R/commandes/panneau-profil.component.ts` (+ spec), `R/commandes/resume-profil.component.ts` (+ spec)
- Modify: `R/commandes/barre-commune.component.ts` (réglettes), `R/risque.page.{ts,html}` (tiroir `etat.atelier`, résumé dans l'en-tête, `apercuRayon`), `ui/icone/icones.ts` (+ `lock`, `lock-open`, et les icônes utilisées par `PanneauProfil.tsx` — les lire), `tests/unit/angular/icones-lucide.test.ts`

**Sources React :** `RegletteRayons.tsx:1-196`, `PanneauProfil.tsx:1-279`, `ResumeProfil.tsx:1-93`, `AnalysePopulationOverlay.tsx:950-953,1100-1107,1209-1224`.

**Interfaces:**
- Consumes : `mg-reglette` (`valeur`, `min`, `max`, `pas`, `formater`, `complement`, `apercu`, `valider` — LIRE `ui/reglette/reglette.component.ts`), T1 (`poserRayonExterieur`, `normaliserProfil`, `libelleRayon`, `LIBELLE_NIVEAU`, `RAYON_MIN_M`, `RAYON_MAX_M`, `PAS_RAYON_M`, `classesDuProfil`), `DonneesRisqueService.bandes` (`par_classe`, pour le tiroir).
- Produces : `export interface ApercuRayon { niveau: Niveau | null; rayonM: number }` ; `mg-reglette-rayons` : input `profil`, outputs `profil` (au RELÂCHEMENT seulement) et `apercu` (`ApercuRayon | null`) ; `mg-panneau-profil` : inputs `profil`, `parClasse`, output `profil` ; `mg-resume-profil` : input `profil`, output `ouvrirAtelier`.

**Pièges :** **le calcul ne part qu'au relâchement** — `apercu` à chaque position, `profil` seulement sur `valider` (mesure attendue : zéro requête `bandes` sur 20 positions, une au relâchement) ; cadenas fermé = UNE réglette « Tous les niveaux » et aperçu `niveau: null` ; « autres » n'a pas de réglette ; textes d'infobulle du cadenas MOT POUR MOT (l.110-112) ; l'aperçu ne va jamais dans l'URL.

- [ ] **Step 1: Specs (échec)** — réglette : 20 `apercu` simulés puis `valider(3000)` → 20 émissions `apercu`, 1 émission `profil` avec `haut = [1000, 2000, 3000]`, puis `apercu(null)` ; cadenas : clic → `profil.lie === true` et une seule réglette ; tiroir : ajout d'un anneau 1500 au seuil bas → `bas = [500, 1000, 1500]`, un 5e anneau refusé (message `Quatre anneaux au maximum par niveau.`) ; chaque classe affiche sa population depuis `parClasse` formatée ; résumé : rend le libellé React pour `PROFIL_DEFAUT` (le lire dans `ResumeProfil.tsx`).
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; build.**
- [ ] **Step 5: Navigateur** — glisser la réglette du seuil haut de 5 km à 3 km : onglet Réseau, **une** requête `/api/risques/profil/bandes` au relâchement, zéro pendant ; l'URL porte `profil=…` au relâchement seulement. Captures réglettes + tiroir ouvert, deux thèmes, + focus clavier sur une réglette : `T6-reglettes-tiroir-{theme}-{react,angular}.png`.
- [ ] **Step 6: Commit** — `feat(angular): réglettes de rayon, tiroir des anneaux et résumé du profil (lot 3, T6)`.

---

### Task 7: Carte permanente I — zones de risque

**Files:**
- Create: `R/cartes/carte-risque.component.ts` (+ spec), `R/cartes/couches-zones.ts` (+ spec)
- Modify: `R/cartes/vue-cartes.component.ts` (monte `mg-carte-risque` à la place du `mg-carte` provisoire de T4)

**Sources React :** `CarteRisque.tsx:1-217` (constantes, raccourcis de grappes `GRAPPES` l.154-161, vue initiale = Étang de Berre), `289-316` (codes, étiquettes de classe depuis le profil), `318-355` (création, `ResizeObserver`), `356-560` (préparation puis pose des couches zones : fond, contour tireté au détail, PPRT plein, étiquettes le long du contour, trois régimes de zoom, recréation de la source quand le CODE change), `955-1090` (raccourcis, légende, bandeau sous le seuil lisible). Lire l'écran d'essai (`essai-carte.page.ts`) et `carte/legende/*` (R9) : REPRENDRE leurs couches, leur légende et leurs contrôles au lieu de les réécrire.

**Interfaces:**
- Consumes : `mg-carte` (`prete`, `zoom`, `cadre`), `ZonesRisqueApi.preparer/urlTuilesZones`, T1 (`codeProfil`, `codeZonesRisque`, `anneauxParNiveau`, `libelleRayon`), T2 (`opacites-zones`, `nature-zone`, `zooms`), `CouleursService.palette({ haut: 'niveau-haut', bas: 'niveau-bas', autres: 'niveau-autres', halo: 'halo-carte', contour: 'contour-carte' })`, `ChargementService`.
- Produces : `mg-carte-risque` : inputs `profil`, `natures`, `gravites`, `fusionner`, `apercu` (`ApercuRayon | null`) ; output `carte` (`maplibregl.Map`) pour la liaison de caméras (T15) ; `poserCouchesZones(carte, opts): void`, `retirerCouchesZones(carte): void` (fonctions pures du point de vue d'Angular, testées sur la carte factice).

**Pièges :** **la carte n'est jamais démontée** (créée une fois, couches et source recréées quand `codeZonesRisque(codeProfil(profil), natures)` change) ; **jamais `var()` dans `paint`** ; repeindre au changement de thème par `setPaintProperty` sans recréer la source (comme `essai-carte.page.ts:146-158`) — mais RECRÉER les couches si le code change ; `minzoom` sur la COUCHE (7 lisible, 10 détail) et plancher 4 sur la source ; `ResizeObserver` (la poignée et « Carte seule » changent la taille sans bouger la fenêtre) — vérifier que `mg-carte` le porte déjà ; préparation AVANT les tuiles (une seule requête `preparer` par code) ; la visibilité à la création suit `fusionner` lu sans dépendance (`untracked`) — l'équivalent de `fusionnerRef` (`ARCHITECTURE.md`) — et la bascule est un `effect` séparé qui ne fait que `setLayoutProperty('visibility')`.

- [ ] **Step 1: Specs (échec)** — carte factice : (a) création → `preparer` appelé une fois puis `addSource('atelier-zones' …)` avec l'URL de `urlTuilesZones(code, natures)` ; (b) trois changements d'étape (inputs inchangés) → aucun nouvel appel ; (c) changement de profil → `removeLayer`/`removeSource` puis nouvelle source avec le nouveau code ; (d) bascule de thème → `setPaintProperty` sur le fond, aucun `addSource` ; (e) `fusionner=false` → couches zones `visibility: none`, aucun appel réseau ; (f) l'expression de couleur ne contient aucune chaîne commençant par `var(`. `couches-zones.spec.ts` : ids, `minzoom`, opacité selon zoom égale à `expressionOpaciteSelonZoom(10)`.
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; build.**
- [ ] **Step 5: Navigateur** — défaut : zoom 9 sur l'Étang de Berre, tuiles `zones-risque` en 200 ; dézoomer sous z7 → bandeau « sous le seuil lisible » ; entre 7 et 10 aplats fondus ; au-delà, bandes + étiquettes de rayon. Captures carte, mêmes cadrage et zoom (raccourci « Étang de Berre »), z8 et z11, deux thèmes : `T7-carte-zones-z{8,11}-{theme}-{react,angular}.png`.
- [ ] **Step 6: Commit** — `feat(angular): carte permanente du module risque — zones et trois régimes de zoom (lot 3, T7)`.

---

### Task 8: Carte permanente II — sites, survol, site par site, aperçu

**Files:**
- Create: `R/cartes/couches-sites.ts` (+ spec)
- Modify: `R/cartes/carte-risque.component.ts` (+ spec)

**Sources React :** `CarteRisque.tsx:562-728` (sites sur la bbox visible, anti-rebond 350 ms, `limite=800`, `gravites`/`natures`, popup au clic, curseur, compte « N sites affichés »), `700-727` (survol : anneaux du site, 64 segments, AUCUNE requête), `729-767` (aperçu pendant le glissement : cercles approximatifs, `APERCU_SITES_MAX = 250`), `768-843` (mode site par site : cercles tiretés, `CERCLES_MAX = 400` CERCLES et non sites), `844-955` (couches de survol/aperçu/cercles et leur repeinte).

**Interfaces:**
- Consumes : `chargerParCadre`, `contenuPopup` (et la popup portée par R9), `ZonesRisqueApi.sites(bbox, { gravites, natures })`, T2 `cercleGeoJSON`, `CouleursService`.
- Produces : `poserCouchesSites`, `cerclesDesSites(fc, profil, max): GeoJSON.Feature[]` (pure, plafond sur les CERCLES), `cerclesApercu(fc, apercu, max): GeoJSON.Feature[]` (pure).

**Pièges :** bbox visible uniquement, jamais la France (I/O) ; `chargerParCadre` annule la requête précédente ; le survol ne fait AUCUN appel ; les cercles du site par site dérivent des sites DÉJÀ chargés ; couleur des points par `gravite` via `CouleursService`, jamais `COULEUR_NIVEAU_CSS` ; popup par `contenuPopup` (textContent, jamais HTML) ; libellés de popup identiques à React (les lire l.640-700).

- [ ] **Step 1: Specs (échec)** — `cerclesDesSites` : 150 sites × 3 anneaux → 400 cercles exactement (plafond sur cercles) ; `cerclesApercu` : 300 sites → 250 cercles ; carte factice : un `moveend` → une requête `sites` avec `bbox=…&limite=800&gravites=seveso_haut,seveso_bas` ; survol d'un site → `setData` sur la source de survol et zéro requête ; `apercu` non nul → source d'aperçu peuplée, `null` → vidée.
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; build.**
- [ ] **Step 5: Navigateur** — Étang de Berre, défaut : compte « N sites affichés » égal à React ; clic sur un site de Berre-l'Étang → popup identique ; « Site par site » → cercles tiretés, zéro requête au clic de bascule (Réseau) ; glisser une réglette → cercles d'aperçu pendant le geste. Captures : sites + popup, site par site, aperçu en cours, deux thèmes : `T8-carte-sites-{etat}-{theme}-{react,angular}.png`.
- [ ] **Step 6: Commit** — `feat(angular): sites, survol, mode site par site et aperçu de rayon sur la carte du module (lot 3, T8)`.

---

### Task 9: Étape ① Sites et étape ② tableau des bandes

**Files:**
- Create: `R/etapes/sites/panneau-sites.component.ts` (+ spec), `R/etapes/rayon/etape-rayon.component.ts` (+ spec), `R/etapes/rayon/tableau-bandes.component.ts` (+ spec)
- Modify: `R/risque.page.html` (branches `sites` et `rayon`)

**Sources React :** `PanneauSites.tsx:1-215`, `OngletRayons.tsx:1-196` (sans la courbe : T10), `TableauBandes.tsx:1-229`, `AnalysePopulationOverlay.tsx:1329-1336,1358-1375`.

**Interfaces:**
- Consumes : `DonneesRisqueService` (`compteSites`, `bandes`, `profilCalcul`, `libelleCible`, `chemin`), T1 (`partsDeNature`, `anneauxDuNiveau`, `LIBELLE_NIVEAU`, `NIVEAUX`), `mg-kpi`, `th[mgTh]`, `td[mgTd]`.
- Produces : `mg-panneau-sites`, `mg-etape-rayon` (porte un emplacement `<ng-content select="[courbe]">` rempli en T10), `mg-tableau-bandes` (inputs `profil`, `parClasse`, `horsZone`, `total`, `libelleCible`).

**Pièges :** barre empilée calculée sur les EFFECTIFS et non les parts arrondies ; segments de nature en `var(--nature-n)` dans le DOM (`[style.background]`) ; message « Aucun site ne passe les filtres… » MOT POUR MOT ; état `a_construire` : encadré avertissement + `node scripts/construire_carreau_risque.mjs` en mono ; `—` jamais `0` pendant le chargement.

- [ ] **Step 1: Specs (échec)** — sites : `par_nature` mesuré (14 natures, 1 259 sites) → 7 segments + « Autres natures », somme des largeurs = 100 %, KPI `1 259 / 1 259`, note « sur la France entière — le total porte le même territoire » ; `retenus = 0` → avertissement ; tableau des bandes : `par_classe` mesuré → lignes haut:1/2/3/pprt, bas:1/2/pprt, hors zone, total `14 103 578` ; KPI par niveau haut `13 585 817`, bas `517 761`, carreaux `215 646`.
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; build.**
- [ ] **Step 5: Chiffres + captures** — `?risque=` vide (étape ①) et `?risque=etape%3Drayon` : chaque nombre égal à React et au tableau de référence ; décocher « Seveso seuil bas » : React et Angular rendent le même total. Captures ① et ②, deux thèmes, + ① en chargement : `T9-{sites,rayon}-{theme}-{react,angular}.png`.
- [ ] **Step 6: Commit** — `feat(angular): étapes ① Sites et ② tableau des bandes (lot 3, T9)`.

---

### Task 10: Étape ② courbe de couverture et exports

**Files:**
- Create: `R/etapes/rayon/courbe-rayon.component.ts` (+ spec), `R/exports/bouton-export.component.ts` (+ spec)
- Modify: `R/etapes/rayon/etape-rayon.component.ts`, `R/risque.page.html` (export du profil dans l'en-tête), `ui/icone/icones.ts` si une icône manque, `ARCHITECTURE.md`

**Sources React :** `OngletRayonInfluence.tsx:1-464` (KPI au rayon, curseur LOCAL de lecture sans recalcul, défaut 1 000 m, case « Afficher les étiquettes (tous les 1 km) », masquage d'une nature par la légende, bandeau « Pré-calcul partiel » si `couverture_pct < 99`, `Squelette`, erreur `a_construire`), `BoutonExportRayon.tsx:1-102`, `BoutonExportProfil.tsx:1-126`, `AnalysePopulationOverlay.tsx:958-965`.

**Interfaces:**
- Consumes : `mg-courbe` (LIRE `graphiques/courbe.component.ts` et `option-courbe.ts` : `series`, `repere`, `domaineX`, `graduationsX`, `etiquettes`, `hauteur`, `formater*`), `DonneesRisqueService.courbe`, `ProfilRisqueApi.exportRayon/exportProfil`, `enregistrerFichier`.
- Produces : `mg-bouton-export` : inputs `libelle`, `charger: () => Observable<HttpResponse<Blob>>`, `nomRepli` ; état « Export… » pendant, message d'erreur français sinon.

**Pièges :** séries ECharts par NOM DE JETON (`nature-1`…`nature-8`, totale `brand-teal`), jamais `var()` ; courbe totale = clé `'*'`, libellée « Toutes natures » ; graduations 1-10 km, domaine `[100, rayon_max_m]` ; le curseur ne déclenche AUCUN appel ; paramètres d'export recopiés de React (`BoutonExportRayon.tsx:35-45`, `BoutonExportProfil.tsx:50-63`) ; vérifier en NAVIGATEUR React les trois liens `<a href>` d'export (jeu, extraction, simulation) : noter le code de réponse dans le rapport (A8) — si 401, le défaut est confirmé et listé « corrigé par Angular ».

- [ ] **Step 1: Specs (échec)** — avec la courbe réelle (fixture `tests` Angular : réponse de `/api/risques/exposition/rayon?gravites=seveso_haut,seveso_bas` réduite aux points multiples de 1 000 m + 5 000) : KPI au rayon 1 000 → `1 647 943`, part `3,9 %`, au rayon 5 000 → `25 261 303` ; déplacer le curseur → zéro appel API ; masquer une nature → série absente des `series` ; `couverture_pct: 80` → bandeau partiel ; bouton d'export : clic → `charger` appelé une fois, `enregistrerFichier` reçoit la réponse, bouton désactivé pendant.
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; build.**
- [ ] **Step 5: Navigateur** — `?risque=etape%3Drayon` : KPI 1 km et 5 km égaux à la référence et à React ; télécharger l'export du rayon et celui du profil depuis Angular : fichiers `.xlsx` ouverts, mêmes onglets et mêmes totaux que ceux téléchargés depuis React. Captures courbe + KPI + survol du point 5 km, étiquettes cochées, deux thèmes : `T10-courbe-{etat}-{theme}-{react,angular}.png`.
- [ ] **Step 6: Commit** — `feat(angular): courbe de couverture de l'étape ② et exports rayon/profil (lot 3, T10)`.

---

### Task 11: Étape ③ tableau de couverture et exploration locale

**Files:**
- Create: `R/etapes/couverture/etape-couverture.component.ts` (+ spec), `R/etapes/couverture/tableau-couverture.component.ts` (+ spec)
- Modify: `R/risque.page.html` (branche `couverture`), `ui/icone/icones.ts` (+ `chevron-left`, `chevron-right`), `tests/unit/angular/icones-lucide.test.ts`

**Sources React :** `TableauCouverture.tsx:1-367`, `AnalysePopulationOverlay.tsx:540-557` (exploration, sélection), `665-672` (second calcul, garde `exploration.length > 0`), `1377-1457` (tableau + fil local d'exploration).

**Interfaces:**
- Consumes : `DonneesRisqueService.bandes`, `requeteExploree`, `bandesExplorees`, `dimension`, `chemin` ; T1 (`mailleExploree`, `perimetreExplore`, `peutDescendre`, `peutRemonter`, `descendre`, `remonter`, `libelleClasse`, `anneauxParNiveau`).
- Produces : `mg-etape-couverture` porte l'état LOCAL `exploration` (`signal<SegmentExploration[]>`), `actif` (survol), `selectionCarte` ; expose `bandesTableau = computed(() => exploration().length > 0 ? bandesExplorees() : bandes())`, `mailleTableau` — consommés par la mini-carte (T12).

**Pièges :** **l'exploration ne touche JAMAIS le filtre Territoire** (l'URL ne bouge pas en descendant) ; le second calcul ne part QUE pendant une exploration (sinon il double chaque calcul) ; survol et sélection effacés au changement de niveau (homonymes région/département) ; trois gestes distincts : clic = sélection, flèche droite = descendre, flèche gauche = remonter ; fil local « Exploration : … — le filtre Territoire de la barre, lui, n'a pas bougé. » MOT POUR MOT.

- [ ] **Step 1: Specs (échec)** — descendre dans `93` → `requeteExploree` = `{ maille: 'departement', region: '93', parent: null, … }`, `?risque=` inchangé ; remonter → `requeteExploree` null et zéro appel ; tri et colonnes (part, densité, effectif, classes) sur une réponse réelle ; « — » et non 0 si `pop_totale` manque.
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; build.**
- [ ] **Step 5: Navigateur** — `?risque=etape%3Dcouverture` : 13 régions + lignes égales à React ; descendre dans Provence-Alpes-Côte d'Azur : 6 départements, mêmes valeurs ; bandeau KPI inchangé pendant l'exploration. Captures tableau à la racine et exploré, deux thèmes, + focus clavier sur une flèche : `T11-couverture-{niveau}-{theme}-{react,angular}.png`.
- [ ] **Step 6: Commit** — `feat(angular): étape ③ — tableau de couverture et exploration locale (lot 3, T11)`.

---

### Task 12: Étape ③ mini-carte, encodages et palettes

**Files:**
- Create: `R/etapes/couverture/carte-mini-france.component.ts` (+ spec), `R/logique/mini-france.ts` (+ spec)
- Modify: `R/etapes/couverture/etape-couverture.component.ts`

**Sources React :** `CarteMiniFrance.tsx:1-558` (projection Mercator, cadre déduit du contenu, outre-mer en encarts `COTE_OM`, `separerLointains`, aplat vs cercles proportionnels, Jenks `N_CLASSES = 5`, gris = donnée absente, survol, cadrage sur sélection), `AnalysePopulationOverlay.tsx:125-148` (encodages), `559-577` (contours par échelle, cache), `771-890` (`zonesAffichees` via `codesDessines` sur `bandesTableau`, valeurs, encodage indisponible au code postal), `1459-1572` (pastilles d'encodage, palette, textes).

**Interfaces:**
- Consumes : `DonneesRisqueService.contours(scale)`, `refGeo.deptsParRegion`, T11 (`bandesTableau`, `mailleTableau`, `exploration`, `actif`, `selectionCarte`), T1 `codesDessines`, T2 `seuilsNaturels`, `classeDe`, `PALETTES_DONNEES`.
- Produces : `mg-carte-mini-france` : inputs `zones`, `valeurs: Map<string, number>`, `libelleValeur`, `formater`, `stops: string[]`, `mode: 'aplat' | 'cercles'`, `codeActif`, `cadrageSur` ; outputs `survol`, `clic`. `mini-france.ts` : `mercatorX`, `mercatorY`, `cadreDe`, `elargir`, `chemin`, `centreDe`, `separerLointains` (copiés de React l.137-299, testés).

**Pièges :** **la carte lit `bandesTableau` et JAMAIS le calcul global** (défaut du 2026-09-22 : « Aude 26,0 % ») ; couleurs SVG par `[style.fill]` (pas l'attribut `fill="var(…)"`) ; palette de données par défaut `rouge` ; maille commune → AUCUNE requête, phrase « Pas de carte à la maille commune… » MOT POUR MOT ; contours chargés une fois par échelle (cache) ; un clic sur la carte SÉLECTIONNE, ne descend pas.

- [ ] **Step 1: Specs (échec)** — `mini-france.spec.ts` : `cadreDe`, `separerLointains`, `chemin` et `centreDe` sur 5 zones (dont La Réunion et la Martinique). Ces fonctions ne sont PAS exportées par `CarteMiniFrance.tsx`, et le gel P5 interdit de les exporter : les valeurs attendues sont produites UNE fois en exécutant la version React (copie temporaire hors dépôt, ou `npx tsx -e` sur un extrait des lignes 137-299), puis figées dans la spec avec, en commentaire, la commande qui les a produites ; composant : exploration de `93` → seules les zones `04,05,06,13,83,84` dessinées ; encodage `part` au code postal → bascule sur l'effectif + avertissement.
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; build.**
- [ ] **Step 5: Navigateur** — `?risque=etape%3Dcouverture` : mini-carte des régions, encodages Part/Densité/Effectif, palette Bleu ; exploration PACA : 6 départements dessinés et colorés avec les valeurs du tableau ; contours demandés UNE fois par échelle (Réseau). Captures mini-carte aux trois encodages, racine et explorée, deux thèmes : `T12-mini-carte-{encodage}-{theme}-{react,angular}.png`.
- [ ] **Step 6: Commit** — `feat(angular): mini-carte SVG de l'étape ③, encodages et palettes (lot 3, T12)`.

---

### Task 13: Étape ④ atelier des jeux de zones

**Files:**
- Create: `R/etat/atelier-jeux.service.ts` (+ spec), `R/etapes/zones/{etape-zones,dilution,tableau-classes,mode-plan,actions-jeu,bibliotheque}.component.ts` (+ specs)
- Modify: `R/risque.page.{ts,html}` (provider `AtelierJeuxService`, branche `zones`), `ui/icone/icones.ts` (+ `save`, `copy`, `trash-2`, `folder-open`), `tests/unit/angular/icones-lucide.test.ts`

**Sources React :** `OngletZones.tsx:1-835` (Section, KPI visée/utile/codes postaux, Dilution, TableauClasses, ModePlan, Actions, Bibliothèque, EtatAtelierVide, Alerte, textes), `use-jeux-zones.ts:1-276`, `AnalysePopulationOverlay.tsx:1339-1357` (territoire = DÉPARTEMENT du chemin, jamais la région).

**Interfaces:**
- Consumes : `JeuxZonesApi`, T2 (`JeuDeZones`, `MODES_PLAN`, `POIDS_MIN`, `POIDS_MAX`), T1 (`libelleClasse`, `anneauxParNiveau`), `EtatRisqueService` (`jeu`), `DonneesRisqueService` (`profilCalcul`, `natures`, `chemin`, `libelleCible`), `ProfilRisqueApi`/`JeuxZonesApi.exportJeu`, `mg-bouton-export`.
- Produces :

```ts
@Injectable()
export class AtelierJeuxService {
  readonly bibliotheque: Signal<JeuResume[]>;
  readonly etatBibliotheque: Signal<EtatAtelier>;
  readonly detail: Signal<JeuDetail | null>;
  readonly etat: Signal<EtatAtelier>;         // 'vide' | 'chargement' | 'echec' | 'pret'
  readonly erreur: Signal<string | null>;
  /** Incrémenté après chaque réglage réussi : la carte des codes postaux relit (A14). */
  readonly reglage: Signal<number>;
  construire(jeu: JeuDeZones): void;
  ouvrir(id: string): void;
  regler(champs: ReglageJeu): Promise<boolean>;
  supprimer(id: string): Promise<boolean>;
}
```

**Pièges :** construire = geste EXPLICITE (21 s, Kong coupe à 60 s : message d'échec de React repris) ; le seuil se rejoue sans reconstruire (PATCH, 22-65 ms) ; un réglage arrivé après un autre est ignoré (jeton) ; `etat.jeu` dans l'URL ; ouvrir un jeu depuis l'URL au montage (`OngletZones.tsx` l'effet `jeuOuvert`) ; `piste('jeu-de-zones', 'Construction du jeu de zones…')` ; l'export du jeu passe par `mg-bouton-export` (A8) ; NE PAS rattacher à une campagne (absent de React).

- [ ] **Step 1: Specs (échec)** — service : `construire` → POST `{ jeu, brouillon: true }` puis GET du détail, `etat` chargement → pret ; deux `regler` successifs, réponses inversées → détail du second ; `supprimer` du jeu ouvert → `detail` null et `etat` vide ; composant : KPI visée/utile/codes postaux depuis `classes` (taux `—` si achetée = 0) ; curseur de dilution → `regler({ seuil_couverture_cp })` au RELÂCHEMENT seulement.
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; build.**
- [ ] **Step 5: Navigateur** — lecture : `?risque=etape%3Dzones%26jeu%3D0b7ece33-4903-4a0b-a57a-f6c54e78a729` → **1 006** codes postaux retenus, classes, taux d'utile égaux à React ; écriture sur un jeu JETABLE `[ESSAI lot 3]` (Territoire 13 pour aller vite) : construire, régler le seuil 20 → 35, enregistrer, supprimer — même comportement que React. Captures atelier vide, en construction, prêt ; bibliothèque ; deux thèmes : `T13-atelier-{etat}-{theme}-{react,angular}.png`.
- [ ] **Step 6: Commit** — `feat(angular): étape ④ — atelier des jeux de zones (lot 3, T13)`.

---

### Task 14: Étape ④ extractions

**Files:**
- Create: `R/etapes/zones/panneau-extractions.component.ts` (+ spec)
- Modify: `R/etapes/zones/etape-zones.component.ts`, `ui/icone/icones.ts` si besoin (`package-check` : lire l'usage React)

**Sources React :** `PanneauExtractions.tsx:1-349` ; `OngletZones.tsx` section « Extractions pour le custom bidding » (`cleFraicheur = construit_le`).

**Interfaces:** Consumes `JeuxZonesApi.extractions/extraire/exportExtraction`, `mg-bouton-export`. Produces `mg-panneau-extractions` : inputs `jeuId: string | null`, `cleFraicheur: string`.

**Pièges :** refusé pour un brouillon (`jeuId` null → message React) ; idempotent : `deja_extraite: true` → message React, pas de doublon ; la date en `fr-FR` (`dateFr` l.62) ; le commentaire saisi n'est pas dans l'empreinte ; export par blob (A8).

- [ ] **Step 1: Specs (échec)** — liste de deux versions ; extraction → POST puis relecture de la liste ; réponse `deja_extraite` → message ; `jeuId` null → aucun appel.
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; build.**
- [ ] **Step 5: Navigateur** — jeu `0b7ece33…` : 2 extractions listées comme React ; télécharger la v1 depuis Angular (fichier ouvert, 5 onglets) ; extraire sur le jeu jetable. Captures deux thèmes : `T14-extractions-{theme}-{react,angular}.png`.
- [ ] **Step 6: Commit** — `feat(angular): étape ④ — extractions figées pour le custom bidding (lot 3, T14)`.

---

### Task 15: Étape ④ double carte — codes postaux, caméras liées, bassins

**Files:**
- Create: `R/cartes/carte-codes-postaux.component.ts` (+ spec), `R/cartes/tableau-grappes.component.ts` (+ spec)
- Modify: `R/cartes/vue-cartes.component.ts` (+ spec), `angular/src/app/core/theme/couleurs.service.ts` (+ spec : `paletteDuTheme`, A11), `ui/icone/icones.ts` (+ `grid-3x3`), `tests/unit/angular/icones-lucide.test.ts`, `ARCHITECTURE.md`

**Sources React :** `VueCartesZones.tsx:64-369` (double carte si `etape === 'zones' && jeuId`, montage permanent, `jumpTo` initial, liaison, recadrage des deux cartes, coloration plan/exposition/population, bandeau des quatre chiffres, interrupteur hors ④/⑤, `Etiquette`), `CarteCodesPostaux.tsx:1-435` (bbox visible, une ligne par CP, rampe fixe, gris des écartés, surbrillance au survol d'une grappe, relecture au réglage du seuil), `TableauGrappes.tsx:1-200`.

**Interfaces:**
- Consumes : `lierCameras(a, b)` (verrou + `jumpTo`, déjà porté), `chargerParCadre`, `JeuxZonesApi.cpGeo/grappes`, `AtelierJeuxService.reglage`, T7 output `carte`.
- Produces :

```ts
// couleurs.service.ts
paletteDuTheme<K extends string>(jetons: Record<K, string>, theme: 'clair' | 'sombre'): Record<K, string>;
// Lit les déclarations `--x` du bloc `:root, :host` (sombre) ou `html.light, :host(.light)` (clair)
// dans les règles de la feuille construite `magelian.css` (core/ressources, `feuille()`), en descendant
// dans les @layer/@media. Lève « Jeton de couleur inconnu : --x » comme `palette()`.
export function jetonsDuBloc(regles: ArrayLike<RegleCss>, selecteur: ':host' | ':host(.light)'): Map<string, string>;
export interface RegleCss { selectorText?: string; style?: { getPropertyValue(n: string): string; length: number; item(i: number): string }; cssRules?: ArrayLike<RegleCss> }
```

**Pièges :** **les deux cartes restent montées** (largeur nulle + `visibility: hidden`, jamais `@if`) ; liaison établie seulement en double vue, détachée sinon ; recadrage = `fitBounds` sur les DEUX cartes ; la part du plan vient du serveur (`genererPlanCp`), l'écran ne recalcule rien ; rampe = `seq-1..5` SOMBRES fixes (`paletteDuTheme(…, 'sombre')`), gris écarté = `donnee-absente` à 0,28 d'opacité appliquée par `fill-opacity` (et non un `rgba` recopié) ; relire au réglage du seuil (`reglage()` change) ; bbox visible uniquement ; les bassins (580, 186 ko) chargés une fois par jeu.

- [ ] **Step 1: Specs (échec)** — `jetonsDuBloc` sur des règles factices imbriquées (un `@layer` contenant `:root, :host { --seq-1: #132625 }` et `html.light, :host(.light) { --seq-1: #eaf7f5 }`) → valeurs justes pour chaque thème ; `paletteDuTheme({ a: 'seq-1' }, 'sombre')` en thème clair → `#132625` ; vue-cartes : `etape='zones'` + `jeuId` → deux cartes visibles, `lierCameras` appelé une fois ; changement d'étape → détaché, aucune carte détruite ; survol d'une grappe → `surbrillance` transmise ; `reglage` incrémenté → une relecture `cpGeo`.
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; build.**
- [ ] **Step 5: Navigateur** — jeu `0b7ece33…`, étape ④ : glisser la carte de gauche → celle de droite suit sans tremblement ; bandeau « Codes postaux du jeu / Retenus / Taux d'utile / Affichés dans le cadre » égal à React sur le même cadre ; cliquer une grappe → les deux cartes recadrent ; bascule de thème → couleurs des codes postaux INCHANGÉES (rampe fixe), comme React. Captures double carte + tableau des bassins, survol d'une grappe, deux thèmes : `T15-double-carte-{etat}-{theme}-{react,angular}.png`.
- [ ] **Step 6: Doc + commit** — `ARCHITECTURE.md` : `paletteDuTheme` (A11). Commit `feat(angular): étape ④ — double carte, caméras liées, codes postaux et bassins (lot 3, T15)`.

---

### Task 16: Étape ⑤ simulation — service NDJSON, panneau, bandeau, courbe

**Files:**
- Create: `R/etat/simulation.service.ts` (+ spec), `R/etapes/campagne/panneau-campagne.component.ts` (+ spec), `R/etapes/campagne/bandeau-campagne.component.ts` (+ spec)
- Modify: `angular/src/app/graphiques/option-courbe.ts` + `courbe.component.ts` (+ specs) — ajouts RÉTROCOMPATIBLES : `points: ReadonlyArray<readonly [number, number | null]>` (trou, pas de liaison), `domaineY?: readonly [number, number]`, `graduationsY?: readonly number[]`, `marqueurs?: boolean` par série (rayon 2), libellé de repère `repere.libelle` en haut ; `R/risque.page.{ts,html}` (provider `SimulationService` chargé à la première visite de ⑤, bandeau ⑤ à la place des KPI, branche `campagne`) ; `ui/icone/icones.ts` (+ `play`, `refresh-cw`, `plus` selon React) ; `tests/unit/angular/icones-lucide.test.ts`

**Sources React :** `campagne/ContexteSimulation.tsx:1-215`, `PanneauCampagne.tsx:1-569` (extractions, six réglages `REGLAGES` l.40-50 avec bornes et formats, `DEFAUTS` l.52-59, Simuler / Recaler / Exporter / Purger, barre de progression avec pourcentage et `faites/total`, période v1/v2/tout, courbe annotée « Recalage v2 », Bilan, À corriger, Partenaires, Sites sous-servis), `BandeauCampagne.tsx:1-85`, `AnalysePopulationOverlay.tsx:385,1242-1248,1677-1686` (chargé à la première visite seulement).

**Interfaces:**
- Consumes : `SimulationApi` (NDJSON), `JeuxZonesApi.extractions`, T2 (`construireVue`, `courbeAlignement`, `constats`, `LIBELLE_PERIODE`, `PARAMS_DEFAUT`), `mg-courbe`, `mg-bouton-export`.
- Produces :

```ts
@Injectable()
export class SimulationService {
  readonly etat: Signal<'vide' | 'chargement' | 'echec' | 'pret'>;
  readonly erreur: Signal<string | null>;
  readonly reponse: Signal<ReponseSimulation | null>;
  readonly periode: WritableSignal<Periode>;
  readonly vue: Signal<VueSimulation | null>;
  readonly courbe: Signal<PointCourbe[]>;
  readonly zoneActive: WritableSignal<string | null>;
  readonly progression: Signal<{ message: string; pourcentage: number | null; faites?: number; total?: number } | null>;
  activer(): void;                       // première visite de ⑤ ; avant, aucun appel
  simuler(version: number, reglages: Partial<ReglagesSimulation>): Promise<void>;
  recaler(): Promise<void>;
  purger(): Promise<void>;
}
```

**Pièges :** **rien ne se charge avant la première visite de ⑤** ; un flux qui s'arrête sans événement final = échec « Le flux s'est interrompu avant la fin. » ; événements `insertion` → pourcentage, `preparation`/`generation` → indéterminé (`ContexteSimulation.tsx:143-149`) ; pistes `simulation` et `simulation-lecture` ; aucun badge « Simulation » (arbitrage React du 2026-09-24) ; une réponse d'un autre jeu est périmée ; courbe v1 en `diverge-sous-2`, v2 en `brand-teal`, trou entre les deux (pas de liaison) ; « Simuler » ÉCRIT (83 977 lignes) : seulement sur le jeu jetable.

- [ ] **Step 1: Specs (échec)** — service : `activer` non appelé → zéro requête ; flux factice (3 `DownloadProgress` puis `Response`) → `progression` 0 → 50 → 100 puis `null` et relecture ; flux terminé sur `{ etape: 'erreur', message }` → `erreur` = message ; option-courbe : série `[[1, 60], [2, null], [3, 70]]` → `connectNulls: false`, valeur `null` émise, `yAxis.min/max` = `domaineY`, graduations Y ; les specs existantes de `mg-courbe` passent INCHANGÉES ; bandeau : six KPI depuis `vue` (formats `pct` / `eur` l.18-19).
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; build ; vérifier que la courbe de `essai-carte` et de ② est inchangée (captures T10 rejouées).**
- [ ] **Step 5: Navigateur** — lecture : `?risque=etape%3Dcampagne%26jeu%3D0b7ece33-…` → bandeau, bilan v1 / v2, courbe (rupture au jour du recalage), partenaires, sites sous-servis ÉGAUX à React (alignement **62 → 89** à relire) ; écriture sur le jeu jetable : extraire v1, Simuler (barre « N / M lignes »), Recaler, Exporter (fichier ouvert), Purger. Captures panneau + bandeau, période v1 / v2 / tout, simulation en cours, deux thèmes : `T16-campagne-{etat}-{theme}-{react,angular}.png`.
- [ ] **Step 6: Commit** — `feat(angular): étape ⑤ — simulation NDJSON, panneau, bandeau et courbe annotée (lot 3, T16)`.

---

### Task 17: Étape ⑤ carte de diffusion et tableau des zones

**Files:**
- Create: `R/cartes/carte-campagne.component.ts` (+ spec), `R/etapes/campagne/tableau-zones-campagne.component.ts` (+ spec)
- Modify: `R/cartes/vue-cartes.component.ts` (3e carte montée à la première visite de ⑤, puis gardée ; tableau sous les cartes à ⑤)

**Sources React :** `campagne/CarteCampagne.tsx:1-434` (cadre métropole, bassins colorés par indice de pression `tranche` l.65, cercles d'impressions par CP, sites vert/orange/rouge `etatSite`, bascule Bassins / Codes postaux, légende, survol `zoneActive`), `TableauZonesCampagne.tsx:1-118` (tri par écart en POINTS DE PART, `LIGNES_VISIBLES = 40`), `VueCartesZones.tsx:68-78,213-224,303-304`.

**Interfaces:** Consumes `SimulationApi.carte(id, bbox)`, `JeuxZonesApi.cpGeo`, `SimulationService` (`vue`, `zoneActive`), T2 (`trancheDivergente`, `etatSite`), `CouleursService.paletteDuTheme(…, 'clair')` (jetons `brand-teal`, `text-tertiary`, `text-primary`, `success`, `warning`, `danger`, `diverge-*`). Produces `mg-carte-campagne`, `mg-tableau-zones-campagne`.

**Pièges :** **palette CLAIRE dans les deux thèmes** (A11) — une bascule de thème ne doit RIEN changer à cette carte ; aucune donnée de diffusion dans la géométrie (changer de période ne redemande aucune géométrie : les indices sont fusionnés côté client) ; `?bbox=` obligatoire ; 3e instance MapLibre seulement après la première visite de ⑤ ; aucun `var()` dans `paint`.

- [ ] **Step 1: Specs (échec)** — vue-cartes : avant ⑤ → 2 instances, après ⑤ → 3, retour à ② → toujours 3 et aucune détruite ; carte : changer de période → `setPaintProperty`/`setFeatureState`, zéro requête ; bascule de thème → aucun `setPaintProperty` de couleur ; tableau : tri par `|part_diffusee - part_plan|`, 40 lignes.
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; build.**
- [ ] **Step 5: Navigateur** — jeu `0b7ece33…` à ⑤ : bassins et sites colorés comme React, mêmes 40 premières lignes du tableau, période v1/v2 sans requête de géométrie. Captures carte + tableau, bassins puis codes postaux, deux thèmes : `T17-carte-campagne-{vue}-{theme}-{react,angular}.png`.
- [ ] **Step 6: Commit** — `feat(angular): étape ⑤ — carte de diffusion et tableau des zones (lot 3, T17)`.

---

### Task 18: Entrées, parité finale, épreuve AIDA, documentation

**Files:**
- Modify: `angular/src/app/layout/navigation.ts` (`LIENS_DEVELOPPEMENT` : « Module risque » → `risques`), `angular/src/app/features/accueil/accueil.page.{ts,html}` (la tuile « Sites à risque industriel en base » devient cliquable vers `risques`, lien RELATIF), specs associées, `ARCHITECTURE.md`, `docs/superpowers/plans/2026-09-29-transition-angular-feuille-de-route.md`

**Sources :** toutes les tâches ; `aida-remote-app.md` (épreuve dans un hôte par défaut).

- [ ] **Step 1: Specs (échec)** — accueil : la tuile porte un `routerLink` relatif `risques` et `mg-tuile-chiffre` en `cliquable` ; coquille : le lien de développement mène à `/app/risques` en autonome.
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; build ; racine `tsc` et `test:unit`.**
- [ ] **Step 5: Parité finale, état par état** — rejouer, React et Angular côte à côte, 1440 × 900, deux thèmes : (1) défaut ① ; (2) `etape=rayon` ; (3) `etape=couverture` + Territoire 13 + Lister par Commune ; (4) `etape=zones&jeu=0b7ece33-…` ; (5) `etape=campagne&jeu=0b7ece33-…` ; (6) `fusion=0` ; (7) `atelier=1` ; (8) `gravites=seveso_haut` ; plus 375 × 812 sur (1) pour constater le comportement (React n'a pas de mise en page mobile : parité, pas d'amélioration). Tableau final « état → chiffre React → chiffre Angular » (tous égaux) ; liste des défauts React corrigés (A3, A8 et ceux trouvés en route) ; écarts restants justifiés (A6, A7).
- [ ] **Step 6: Épreuve AIDA** (hôte jetable PAR DÉFAUT, `ignoreUnusedDeps: true`, remote en `ng serve` PUIS en build de production — procédure de `ARCHITECTURE.md` § « Épreuve dans un shell hôte jetable ») : `/outils/magelian/risques` stylé, les cinq étapes, tuiles 200, NDJSON qui progresse (A9 : noter si l'hôte bufferise), téléchargement d'un export, URL de l'hôte portant `?risque=`, thème piloté par l'hôte, tableau de fuite = 0 différence, aucune erreur console, limiteur : au plus 3 appels `/api` simultanés à l'ouverture de l'étape ③.
- [ ] **Step 7: Documentation** — `ARCHITECTURE.md` § Application Angular : paragraphe « Module risque (lot 3) » (route, services d'état, règle des cartes permanentes, I/O, A1-A14 en une ligne chacun) ; feuille de route : ligne « 3 — Module risque » ✅ avec la date, écarts restants, et une section « À savoir pour les lots suivants (revue finale du lot 3) » (lot 4 : écrire `natures` dans `risque=` et porter « Voir sur la carte »).
- [ ] **Step 8: Commit** — `feat(angular): entrées vers le module risque, parité finale et épreuve AIDA (lot 3, T18)`.

---

## Auto-relecture (faite)

- Couverture de la spec : cinq étapes (T9 ①, T9-T10 ②, T11-T12 ③, T13-T15 ④, T16-T17 ⑤), état dans l'URL (T1, T4), exports (T3, T10, T13, T14, T16), barre de progression unique (T4-T5, pistes dans chaque tâche), gel P5 (préalable + T1), cohabitation (aucun fichier React modifié), comparaison chiffrée (chaque tâche d'affichage + T18).
- Noms croisés vérifiés : `EtatRisqueService.maj`, `DonneesRisqueService.{bandes,courbe,compteSites,requeteExploree,bandesExplorees,contours}`, `AtelierJeuxService.reglage`, `SimulationService.activer`, `CouleursService.paletteDuTheme`, `cercleGeoJSON`, `lignesNdjson`, `enregistrerFichier`, `ApercuRayon`.
- Review Focus : chaque ligne a son test dans la tâche propriétaire (T5 a/b, T4 j + T7 b, T1 + T4 e, T5 e + T9 + T10 + T16, T7 d + T15 + T17).
