# Lot 4 — Carte principale en Angular — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Méthode obligatoire de CHAQUE tâche :** le skill personnel `porting-react-to-angular`
> (`~/.claude/skills/porting-react-to-angular/SKILL.md` + `aida-remote-app.md` +
> `reference-angular-21.md`). Lire la source React EN ENTIER (composant, hooks, enfants),
> inventorier les briques Angular existantes en LISANT leur fichier, ne jamais appeler une
> API non lue, recenser les défauts de React, prouver par captures et chiffres.

**Goal:** Porter en Angular la carte principale `/map` — rail des cinq thèmes (plus Assistant, Réglages, Aide), barre du haut, panneaux Filtre / Calques / Analyse / Zones, les couches de données qu'ils pilotent, la légende, et l'intégration du module risque du lot 3 (« Analyser la population », « Voir sur la carte », Fermer → carte) — avec un « parcours complet du rail » rendu et chiffré comme l'écran React, sans retirer l'écran React.

**Architecture:** Un écran plein écran `carte` monté sous `remoteRoutes` (patron des routes `essai-carte` / `risques`, hors coquille). La page porte UNE instance MapLibre, publiée dans un signal `carteCourante` ; chaque couche est un service d'écran qui pose / repeint / retire ses sources par un `effect` dépendant de ce signal, ce qui rend le changement de fond (qui recrée la carte, comme React) et le changement de thème sûrs par construction. L'état transverse de la page (filtre unique, entrée active du rail, dégradé actif, rail masqué, sélection de POI, périmètre) vit dans un service fourni PAR LA PAGE ; le module risque devient une route ENFANT `carte/risques` rendue en surimpression dans la page — la carte n'est jamais démontée, exactement comme l'overlay React posé sur `/map`. La logique pure de `lib/navigation`, `lib/carte`, `lib/carreaux`, `lib/iris`, `lib/meteo`, `lib/custom-geo` est RECOPIÉE dans `angular/` (P6) et verrouillée par des tests de parité à la racine.

**Tech Stack:** Angular 21.2.4 (standalone, zoneless, signals, OnPush), Tailwind 4, MapLibre GL 5.18.0 (via `mg-carte`), Apache ECharts 6.1.0 (via `mg-courbe`, si un graphique est rencontré), RxJS 7.8, Vitest (Angular : `ng test` ; racine : `npm run test:unit`), Playwright MCP pour les captures.

**Spec:** ligne « 4 — Carte principale » de `docs/superpowers/plans/2026-09-29-transition-angular-feuille-de-route.md` (verbatim : « `/map`, rail des cinq thèmes, panneaux Filtre/Calques/Analyse/Zones » ; livrable : « Parcours complet du rail » ; dépend de : 3) ; les sections « À savoir pour les lots suivants » de la même feuille de route (lots 0, 1, AIDA, 3 — CONTRAIGNANTES, en particulier celle du lot 3 : écrire `natures` dans `risque=` avant d'ouvrir le module, porter « Voir sur la carte » avec `ZonesRisqueLayer`, Fermer du module → `/map`) ; objectif du propriétaire, verbatim : « je veux la même chose que Next.js mais Angular en respectant la doc donnée ». Références de rendu et de comportement : `app/map/**`, `components/map/**`, `app/copilote/_hooks/useMapInit.ts`, `app/copilote/_hooks/useMapLayers.ts`, `ARCHITECTURE.md` (§ « Navigation de /map », § Application Angular), `DESIGN_SYSTEM.md`, la doc AIDA (privée, jamais stagée). Modèle de forme : `docs/superpowers/plans/2026-10-03-angular-lot3-module-risque.md`.

---

## Préalable bloquant (à vérifier AVANT la tâche 1)

- [ ] Le lot 3 est TERMINÉ (✅ 2026-10-04 dans la feuille de route ; dernier commit `a4e882c1` « revue finale du lot 3 »). Ce lot RÉUTILISE ses fichiers : `features/risques/cartes/couches-zones.ts`, `couches-sites.ts`, `logique/{cercle,palettes-donnees,zooms,nature-zone,opacites-zones,seuils-naturels,etat-url,code-profil,profil}.ts`, `data/{zones-risque,sites-risque,referentiel}.api.ts`, `core/http/{ndjson,telecharger}.ts`, `carte/legende/*`. Les LIRE avant d'écrire.
- [ ] **Gel P5 étendu à `/map`** : la feuille de route reçoit, dans le commit de la tâche 1, la mention « Gel de la carte React (`app/map/**`, `components/map/**`, `components/custom-geo/**`, `lib/carte/**`, `lib/navigation/**`, `lib/custom-geo/**`, `app/copilote/_hooks/useMapInit.ts`, `useMapLayers.ts`) depuis le <date d'ouverture> (P5) ». Tout correctif urgent côté React est reporté À LA MAIN dans la tâche Angular en cours et cité dans son rapport.
- [ ] Dossier de chantier : `.superpowers/sdd/2026-10-04-angular-lot4-carte/` (registre `progress.md`, captures, rapports de tâche).
- [ ] Réponse du propriétaire aux trois questions de la fin de ce plan (Assistant, dessin libre, clustering). Sans réponse, les DÉFAUTS écrits dans les arbitrages B5, B8 et B7 s'appliquent.

---

## Arbitrages proposés (chef de projet)

| # | Arbitrage | Coût si c'est faux |
|---|---|---|
| B1 | **Écran = route plein écran `carte`** sous `remoteRoutes` (React `/map`), frère de `risques`/`essai-carte`, hors `mg-coquille`, `authGuard`. Nom français comme `risques`. L'entrée « Explorer » de la barre latérale (`layout/navigation.ts`, `cible: null`) reçoit `cible: 'carte'`. Toutes les `position: fixed` de React (rail `RailNavigation.tsx:41`, top bar `MapTopBar.tsx:41`, boutons flottants `page.tsx:1334-1400`, enveloppe `page.tsx:1129`) deviennent `absolute` dans l'hôte de la page (`relative h-full`), mêmes `z-index` relatifs. | Faible : renommer la route. |
| B2 | **Le module risque devient une route ENFANT `carte/risques`**, rendue par un `<router-outlet>` de la page carte en surimpression (`absolute inset-0`, au-dessus du rail et de la top bar). La carte reste montée DESSOUS — c'est ce que fait React (`AnalysePopulationOverlay` monté dans `page.tsx:1201`, carte intacte derrière). Conséquence : le Fermer du lot 3 (`router.navigate(['..'], { relativeTo })`, `risque.page.ts:202-205`) ramène À LA CARTE sans changer une ligne — A7 levé. La route racine `risques` devient `{ path: 'risques', redirectTo: 'carte/risques' }` (les paramètres de requête suivent) ; la tuile de l'accueil et le lien de développement visent `carte/risques`. | Moyen : si la double carte (carte principale + carte permanente du module) pèse trop en mémoire, rendre la carte principale `visibility: hidden` pendant que le module est ouvert (jamais la démonter). |
| B3 | **« Voir sur la carte » (A6 du lot 3)** passe par un jeton `PONT_CARTE` (`InjectionToken<PontCarte>`), fourni par `CartePage` et injecté en `optional` par `RisquePage` : le module rendu sous la carte le voit (injecteur d'élément de l'outlet), la carte d'essai ne le voit pas. Bouton présent ⇔ pont présent — toujours vrai depuis B2. Le geste : `preparer(code, natures)` puis `pont.afficherZonesRisque({ profil, natures })` puis Fermer. **Défaut objectif de React corrigé et listé** : `BoutonVoirCarte.tsx:51-56` et `ZonesRisqueLayer.tsx:165-168` n'envoient pas `natures` — la carte montrait les anneaux de TOUTES les natures sous un module filtré sur une seule, exactement le « même mensonge » que sql/220 ferme. Angular passe `natures` (`codeZonesRisque`, déjà copié). Identique à React quand `natures` est vide (cas par défaut). | Nul sur l'état par défaut. |
| B4 | **Natures vers `risque=`** (exigence du lot 3) : « Analyser la population à risque → » (`RisqueIndustrielSection.tsx:492-516`) lit le `risque=` courant (`lireEtatUrl`), y remplace `natures` par `librellesDuType(t, FAMILLES_ICPE_SEED)` de chaque type coché, plus `NATURE_NON_PRECISEE` si `non_precise` est coché (formule EXACTE de `AnalysePopulationOverlay.tsx:582-588`), puis navigue vers `risques` (relatif à la carte) avec `queryParams: { risque: ecrireEtatUrl(etat) || null }`. Les GRAVITÉS cochées dans Calques ne sont PAS transmises : React les passe en prop mais le module lit `etat.gravites` (`AnalysePopulationOverlay.tsx:298`) — parité. `palette-risques.ts` et `familles.ts`, non copiés au lot 3, le sont ici (T2). | Faible. |
| B5 | **L'Assistant (copilote IA, tiroir droit, `Ctrl+K`) est HORS du lot 4** : `ChatPanel.tsx` (772 l.), `useChatControls`, `useToolProcessor`, `useSmartPrompt`, `useSavedMaps`, `useRateLimitHandler`, `useProviderSelector`, flux `/api/chat` au protocole Vercel AI SDK. L'entrée du rail est rendue À L'IDENTIQUE mais INERTE (patron « Disponible prochainement » du lot Rendu) ; `Ctrl+K` ne fait rien. Conséquences, toutes inertes à l'identique : le **Voronoï** (`VoronoiTool` lance un prompt geo.prompt, `PanneauAnalyse.tsx:210` — aucune route directe ne calcule un Voronoï), les sections Réglages « Modèle IA » et « Vues sauvegardées » (le panneau de sauvegarde vit DANS le chat, `page.tsx:863-876`). Question au propriétaire (fin de plan) : la direction « IA externe » rend-elle ce port inutile ? | Moyen : ~2 500 lignes React et le parseur de flux à écrire dans un lot à part ; aucune autre tâche de ce plan n'en dépend. |
| B6 | **Tout ce qui est « Campagne » relève du lot 5** : entrée Campagne du rail et `Alt+C`, bascule Campagne / Carte de la top bar (`MapTopBar.tsx:70-150`), `CampagneActiveCard`, `BarreContexteCampagne`, groupe « Campagne active » de Calques, `SuiviMapLayer`, `DiffusionMapLayer`, dégradés `campagne-impressions` et `diffusion`. Rendus inertes là où React les rend sans campagne active (entrée du rail, bouton « Campagne » de la top bar) ; absents là où React les cache sans campagne (carte flottante, barre de contexte, groupe Calques). L'union `DegradeId` est copiée ENTIÈRE avec son verrou `UnionCouverte` : le lot 5 ne fera qu'ajouter des producteurs. | Faible. |
| B7 | **Analyse : batailles V1/V2, application, cache d'isochrones, score composite, corrélation → IN ; clustering → IN mais en DERNIER** (T19-T20), découpé pour pouvoir être reporté en lot 4b sans toucher au reste : `ClusterPanel.tsx` (1 075 l.) + `ClusteringWizard.tsx` (846 l.) + un moteur Python lancé en processus fils (`/api/poi-clusters/run` répond 503 si le script manque). Les fichiers protégés (`app/api/isochrone-battle/route.ts`, fonctions PostGIS battle) ne sont PAS modifiés : Angular les APPELLE, comme React. | Moyen : si le propriétaire reporte le clustering, retirer T19-T20, la section reste inerte. |
| B8 | **Dessin libre sans `terra-draw`** (aucune nouvelle dépendance d'exécution — contrat AIDA, et toute dépendance impose de rejouer l'épreuve d'hôte) : tracé maison sur les événements MapLibre — polygone (clic par sommet, double-clic ou clic sur le premier sommet pour fermer, Retour arrière retire le dernier sommet), rectangle (deux clics), « Effacer ». **Écart restant justifié** : pas de mode « sélection » (déplacement de sommets, `TerraDrawSelectMode`, `DessinLibre.tsx:104-110`). Question au propriétaire (fin de plan). | Moyen : si le propriétaire veut l'édition de sommets, ajouter `terra-draw` (dépendance pure JS) et rejouer l'épreuve dans l'hôte par défaut. |
| B9 | **Aucun état de carte dans l'URL** au-delà de ce que React lit : `customZone` (`page.tsx:771-839`, lu une fois quand la carte est prête) et `risque` (porté par la route enfant). Filtre, calques, entrée active ne sont PAS dans l'URL — React ne les y met pas. Préférences par poste reprises AVEC LES MÊMES CLÉS `localStorage` (try/catch, rendu correct sans) : `genesis_map_style`, `genesis_density_mode`, la clé de `use-filter-sections.ts:72`. | Faible : un état d'URL s'ajoute plus tard sans casser. |
| B10 | **Clavier : un seul écouteur, sur l'HÔTE de la page** (`tabindex="-1"`, focalisé au montage), jamais `window`/`document` (ce seraient ceux du shell) : `Échap` → `PileEchapService.fermerLePlusHaut()`, `Alt+1..4` via `entreeParRaccourci`, garde `ignorerRaccourciClavier` (copies T1). La pile Échap devient un service fourni par la page (même logique que `lib/carte/pile-echap.ts`, état non global). **Écart justifié** : quand le focus est dans le SHELL, les raccourcis ne partent pas — une remote n'a pas à capter les frappes de son hôte. Les événements clavier traversent la frontière d'ombre (`composed`) : un clic sur la carte (canevas focalisable) ou dans un panneau garde le focus sous l'hôte. | Faible. |
| B11 | **Changer de fond RECRÉE la carte**, comme React (`useMapInit.ts:1083-1089`, dépendance `[mapStyleUrl]`) : la page rend `mg-carte` sous `@for (f of [fond()]; track f)` ; `prete` publie la nouvelle instance dans `carteCourante` ; chaque service de couche re-pose ses sources par `effect` sur `carteCourante()`. Défaut Liberty (`MAP_STYLES[0]`), choix « MAGELIAN » = Positron + surcharges de `applyMagelianStyle` (dépendantes du thème, `useMapInit.ts:1091-1102`). Centre et zoom initiaux de React (`[2.3, 46.6]`, z5.5, `useMapInit.ts:131-145`) : `mg-carte` reçoit deux entrées optionnelles `centre`/`zoomInitial` qui prennent le pas sur `cadre` (ajout rétrocompatible, specs des lots 2-3 inchangées). | Moyen : une couche qui oublierait l'`effect` disparaîtrait au changement de fond — d'où le test « re-pose après recréation » exigé de CHAQUE service de couche. |
| B12 | **Palettes de DONNÉES recopiées (A10 étendu)** dans `C/logique/palettes-donnees-carte.ts`, verrouillées par un test de parité : `CATEGORY_COLORS`, `ISOCHRONE_COLORS`, `VORONOI_PALETTE`, `BATTLE_PALIER_OPACITY` (`app/copilote/_lib/constants.ts:71-127`), palettes météo (`lib/meteo/palettes.ts`), paliers TMJA et radio (`useMapInit.ts:391-530`), échelles civiques (`CivicIndicatorsLayer.tsx`, `CivicHealthMapLayer.tsx`). Les couleurs d'INTERFACE (le `#4ecdc4` de `zone-circle`, `useMapInit.ts:605-606`) passent par `CouleursService` (`brand-teal`) ; les types de risque et le PPRT par leurs jetons existants (`--risque-*`, `--pprt-*`, `--donnee-absente`). ⚠ `CATEGORY_COLORS` porte deux teintes violettes (`#6366f1`, `#8b5cf6` par défaut) que `DESIGN_SYSTEM.md` interdit : gardées pour la parité (échelle de DONNÉES), listées comme défaut React. | Faible : jetons à créer plus tard dans `globals.css` ET `jetons.css`. |
| B13 | **Modales en `<dialog>` natif** (`showModal()`, couche supérieure, DANS l'arbre de la racine d'ombre) : panneau météo (`page.tsx:1456-1488`), capture de zone (`CustomGeoCaptureModal`), confirmations. Jamais un portail ni un voile `position: fixed`. | Faible. |
| B14 | **Notification d'exclusivité des dégradés** (`toast.info(...)`, `page.tsx:571`) : `mg-annonce` minimal (région `role="status"` `aria-live="polite"`, en `absolute` dans la page, disparaît après 4 s, texte EXACT de React). Pas de service global de notifications (reporté aux lots 5-6 par le lot 1) : celui-ci est fourni par la page. | Faible : le remplacer par le service des lots 5-6. |
| B15 | **Services** : les services d'API nouveaux rejoignent `FOURNISSEURS_DISTANTS` (`app.routes.ts`, patron établi, garde `modele-aida.test.ts`) ; les services d'ÉTAT et de COUCHE sont fournis par `CartePage` (`providers`), donc détruits avec elle et visibles du module risque monté dans son outlet (B2, B3). | Faible. |
| B16 | **Marqueurs POI** : `maplibregl.Marker` DOM (`useMapMarkers.ts`) — leurs éléments sont insérés DANS le conteneur de la carte, donc dans la racine d'ombre : autorisé. Le canevas des rayons de POI (`useMapInit.ts:150-154`, `drawPOICirclesOnCanvas` `:42-100`) est un enfant du conteneur, idem. Le badge de zoom (`:156-185`) est porté comme élément du gabarit, pas comme `style.cssText` injecté. | Nul. |
| B17 | **Street View d'un panneau OOH** (`MapPanel.tsx:232-300`) : clé lue dans `config.local.json` (champ optionnel `googleMapsKey`, écrit par `angular/scripts/ecrire-config.mjs` depuis `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` si présente) ; absente → le même bandeau rouge qui NOMME la variable que React (`MapPanel.tsx:331`). | Faible. |

---

## Global Constraints

Repris du lot 3 (`2026-10-03-angular-lot3-module-risque.md` § Global Constraints) et des règles de chantier de la feuille de route — ils valent pour CHAQUE tâche :

- Angular **21.2.4** exact ; **aucune nouvelle dépendance** (B8). Pas de `zod`, pas de `ngx-echarts`, pas du CDK Overlay, pas de `terra-draw`.
- À l'exécution, imports `@angular/*` limités à `core`, `common`, `common/http`, `router`, `platform-browser` (garde `tests/unit/angular/imports-partages.test.ts`) — **jamais `@angular/core/rxjs-interop`** (`toSignal`, `takeUntilDestroyed`) : NG0203 dans un hôte par défaut. Désabonnement explicite par `DestroyRef.onDestroy`, ou `versEtat` (hors contexte réactif).
- Services d'API : `*.api.ts`, `@Injectable()` **sans `providedIn`**, héritent de `HttpBaseService`, n'écrivent jamais `HttpClient` (garde `modele-aida.test.ts`), fournis par `FOURNISSEURS_DISTANTS`. Dossiers d'accès aux données sous `angular/src/**/data/`.
- Rien dans `angular/` n'importe hors d'`angular/` (garde `isolement.test.ts`). Importer DEPUIS `features/risques/` est permis (même application) ; ne pas recopier ce que le lot 3 a déjà copié.
- Racine d'ombre : interdits `position: fixed`, `document.body`, `querySelector('body')`, `appendTo: 'body'`, CDK Overlay, `::ng-deep`, `ViewEncapsulation.None` (garde `portails-hors-ombre.test.ts`) ; aucun `rem` dans un style de composant (`gardes-styles.test.ts`) ; `<html>` jamais écrit (`ECRIRE_HTML`) ; aucun écouteur sur `window`/`document` du shell (B10). Modales : `<dialog>` (B13).
- Couleurs : jetons de `styles/jetons.css` dans le DOM ; **MapLibre reçoit ses couleurs par `CouleursService`**, jamais `var()` dans `paint` (`addLayer` LÈVE et la couche n'existe pas), jamais un hexadécimal recopié — seule exception : B12 (et A10 du lot 3).
- Liens et navigations RELATIFS ; ressources par `urlRessourceDistante`.
- Composants : préfixe `mg`, OnPush, `input()`/`output()`/`model()`, `@if`/`@for (… ; track id)`, `inject()`, `protected` pour le gabarit, `readonly` pour les entrées. Pas de méthode appelée dans le gabarit (→ `computed`). Un `input()` ne s'appelle jamais `style`, `class`, `id`, `title`, `hidden`, `role`.
- Bords 0,5 px, sentence case, Inter + JetBrains Mono, flat total.
- **Règles d'I/O de `CLAUDE.md`, côté Angular** : au plus 3 appels `HttpClient` simultanés (`limiteurInterceptor`, ne PAS le contourner) ; **1 colonne IRIS à la fois** (la tuile porte les colonnes, l'indicateur ne fait que changer l'expression : zéro requête au changement d'indicateur) ; bornes IRIS lues UNE fois (`/api/iris/bornes`) ; **bbox = carte visible ou filtre actif**, jamais la France entière au premier chargement — la règle EXACTE de `bboxPourRequete` (bbox envoyée SEULEMENT si un filtre géographique est actif) pour POI, OOH, santé environnementale, météo ; **cache avant appel** (catégories, natures, référentiel, contours météo, options radio, bornes : une fois par écran) ; **calcul au relâchement** de toute réglette qui part en requête ; aucun outil d'Analyse lancé sans périmètre (`messageGardeOutil`) ; les tuiles MapLibre échappent au limiteur, donc la discipline est dans le service de couche.
- **Critère de sortie de toute tâche d'affichage** : captures React et Angular du même écran, 1440 × 900, même état, **deux thèmes**, rangées dans `.superpowers/sdd/2026-10-04-angular-lot4-carte/` sous `<tache>-<ecran>-<theme>-{react,angular}.png`, plus survol / focus clavier / chargement / erreur quand la tâche les nomme ; **chiffres identiques** à React (formatage `fr-FR`) ; tableau « identifiant → corrigé / écart restant justifié » et liste des défauts React corrigés dans le rapport.
- Serveurs : racine `npm run dev` (:3000), Angular `cd angular && npm start` (:4200, routes sous `/app`). Identifiants : mémoire `reference_geomatik_credentials.md` (jamais recopiés). Arrêter l'arbre complet des serveurs en fin de tâche (zombies `next dev` sous Windows).
- Après chaque tâche : `cd angular && npx ng test --watch=false` et `npm run build` verts sans nouvel avertissement ; racine `npx tsc --noEmit` (code de retour lu DIRECTEMENT, jamais derrière un pipe) et `npm run test:unit` verts.
- `ARCHITECTURE.md` (§ Application Angular) mis à jour dans le commit de chaque tâche qui ajoute une route, un service ou un composant partagé. Commits atomiques `type: description`, terminés par `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. **Ne jamais pousser** ; ne jamais stager la doc AIDA.
- **Écritures en base pendant les vérifications** (enregistrer une zone, opération booléenne, plan média, analyse, ingestion civique, run de clustering) : uniquement sur des objets jetables nommés `[ESSAI lot 4] …`, supprimés en fin de tâche et vérifiés par SQL. Les 7 zones de `custom_geo_zones`, les 2 jeux de zones, les 2 analyses et les 2 modèles de clustering existants servent de référence en LECTURE seule.
- Fichiers React gelés (préalable) JAMAIS modifiés ; `components/risques/**` non plus, sauf mention explicite. Les fichiers Angular du lot 3 ne sont modifiés que là où une tâche le dit (T13).

## Review Focus

- **Un calque survit-il au changement de fond ?** Réglages › Fond de carte › « Clair » avec carreaux + IRIS + POI + risques allumés : React recrée la carte (B11) ; Angular doit retrouver chaque couche allumée, son indicateur et sa palette, sans requête en double. Test : T4 (registre de couches, instance recréée → `poser` rappelé une fois par couche active) + spec « re-pose après recréation » de CHAQUE service de couche (T6-T12, T15, T17, T19).
- **Deux dégradés allumés l'un après l'autre** (carreaux puis IRIS, IRIS puis score, météo appliquée pendant que santé env. est allumée, zones de risque ramenées par « Voir sur la carte ») : un seul reste peint, la légende parle du dernier, l'annonce nomme l'évincé. Test : T3 (`EtatCarteService.basculerDegrade` + annonce), T7 (IRIS évince carreaux), T13 (zones de risque évincent IRIS — défaut React corrigé B3).
- **Analyse lancée sans périmètre, ou sur « Périmètre national »** : refus qui NOMME l'outil, aucun appel réseau. Test : T17 (lit le SOURCE du panneau Analyse Angular, comme `panneau-analyse-garde.test.ts`), T18 (score composite admis en national).
- **Données absentes ou périmées** : santé environnementale au code postal alors que `pollen_map_daily` s'arrête au **2026-09-17** (cron mort), météo sans réponse Open-Meteo, clustering sans script Python (503), Street View sans clé, aucune zone enregistrée : un message qui dit pourquoi, jamais un zéro ni un chargement sans fin. Tests : T10 (statut `no_data` + date), T20 (503 affiché), T8 (bandeau Street View).
- **Aller-retour carte ↔ module risque** : ouvrir le module depuis Calques, régler, « Voir sur la carte », Fermer, rouvrir : la carte principale n'est jamais recréée, ses calques restent, l'URL `risque=` porte les natures, une seule entrée d'historique par geste. Test : T13 (même instance de `CartePage` avant/après, compteur de créations de la fabrique de carte = 1).

---

## Inventaire : React → Angular

Racine Angular de l'écran : `angular/src/app/features/carte/` (abrégé `C/`). `R/` = `features/risques/`.

| Fichier React | Lignes | Cible Angular | Tâche |
|---|---|---|---|
| `app/map/page.tsx` | 1 491 | `C/carte.page.{ts,html}` (squelette, outlet du module, boutons flottants), `C/etat/etat-carte.service.ts` (l.140-260, 526-640), `C/etat/couches-carte.service.ts` (« Tout effacer » l.681-765) | T3, T4 |
| `app/map/layout.tsx` | 46 | non porté : providers React (contexte MAGELIAN, session) — lot 5 pour la campagne | — |
| `lib/navigation/config.ts`, `garde-saisie.ts` | 153+31 | `C/logique/navigation.ts` (icônes = `NomIcone`), `C/logique/garde-saisie.ts` | T1 |
| `lib/carte/{filtre,bbox-requete,degrades,calques-actifs,garde-perimetre,pile-echap}.ts` | 64+35+60+84+132+45 | `C/logique/<même nom>.ts` | T1 |
| `lib/carte/{palette-risques,palette-pprt}.ts` + `lib/import/georisques/familles.ts` | 223+95+67 | `C/logique/{types-risque,pprt,familles-icpe}.ts` (sans les hex : jetons) | T2 |
| `components/map/RailNavigation.tsx` | 258 | `C/rail/rail.component.ts` | T3 |
| `components/map/MapTopBar.tsx` | 150 | `C/rail/barre-haut.component.ts` (bascule Campagne inerte, B6) | T3 |
| `components/map/OverlayPanel.tsx` | 264 | `C/rail/panneau.component.ts` | T3 |
| `components/map/FiltreChip.tsx` | 88 | `C/filtre/puce-filtre.component.ts` | T5 |
| `components/map/LegendeCarte.tsx` | 656 | `C/legende/legende-carte.component.ts` (cadre T6, un cas par tâche de couche) | T6-T18 |
| `components/map/jetons-carte.ts` | 69 | lu, recopié en classes Tailwind arbitraires | T3 |
| `components/map/overlays/AIOverlay.tsx` | 156 | **non porté** (B5) | — |
| `components/map/overlays/SettingsOverlay.tsx` | 275 | `C/panneaux/reglages.component.ts` | T4 |
| `components/map/overlays/HelpOverlay.tsx` | 53 | `C/panneaux/aide.component.ts` | T4 |
| `components/map/overlays/ZonesOverlay.tsx` + `ZonesOperations.tsx` | 624+219 | `C/panneaux/zones/mes-zones.component.ts`, `operations-zones.component.ts` | T14 |
| `app/map/_components/panneaux/PanneauFiltre.tsx` + `panneau-filtre-logique.ts` | 404+79 | `C/panneaux/filtre/panneau-filtre.component.ts` + `C/logique/panneau-filtre-logique.ts` | T1, T5 |
| `filter-panel/PerimeterSections.tsx`, `MultiDropdown.tsx`, `use-territory-selection.ts` | 235+148+153 | `C/panneaux/filtre/perimetre.component.ts`, `liste-multiple.component.ts` | T5 |
| `panneaux/PanneauCalques.tsx` + `GroupeCalques.tsx` + `use-filter-sections.ts` | 715+66+117 | `C/panneaux/calques/panneau-calques.component.ts`, `groupe-calques.component.ts` | T6 |
| `filter-panel/CarreauxSection.tsx` | 184 | `C/panneaux/calques/section-carreaux.component.ts` | T6 |
| `filter-panel/IrisSection.tsx` + `IrisDetailPanel.tsx` + `_hooks/useIrisDetail.ts` | 280+224+76 | `section-iris.component.ts`, `C/couches/detail-iris.component.ts` | T7 |
| `filter-panel/PoiSection.tsx` + `use-poi-catalog.ts` + `use-poi-styles.ts` + `poi-style.ts` + `_hooks/useMapMarkers.ts` | 251+106+34+15+206 | `section-poi.component.ts`, `C/couches/pois.service.ts` | T8 |
| `filter-panel/TransportSection.tsx`, `OohSection.tsx` + `MapPanel.tsx` (tiroir panneau, l.232-352) | 92+86+120 | `section-transport`, `section-ooh`, `C/couches/tiroir-panneau.component.ts` | T8 |
| `filter-panel/TmjaSection.tsx`, `RadioSection.tsx`, `RadioSearchInput.tsx` + `_hooks/useRadioLayer.ts` | 115+299+67+265 | `section-tmja`, `section-radio`, `C/couches/{tmja,radio}.service.ts` | T9 |
| `filter-panel/CivicIndicatorsSection.tsx`, `CivicHealthSection.tsx`, `use-civic-ingest.ts` + `CivicIndicatorsLayer.tsx`, `CivicHealthMapLayer.tsx` | 100+318+94+259+440 | `section-civique`, `section-sante`, `C/couches/{indicateurs-civiques,sante}.service.ts` | T10 |
| `filter-panel/MeteoSection.tsx` + `_hooks/useMeteoLayer.ts` + `analyse/digital/_components/MeteoGeoPanel.tsx` | 82+186+450 | `section-meteo`, `C/couches/meteo.service.ts`, `C/panneaux/calques/dialogue-meteo.component.ts` | T11 |
| `filter-panel/RisqueIndustrielSection.tsx` + `use-risque-industriel.ts` + `RisqueIndustrielLayer.tsx` + `PprtLayer.tsx` | 695+100+581+284 | `section-risque.component.ts`, `C/etat/risque-carte.service.ts`, `C/couches/{risques-industriels,pprt}.service.ts` | T12 |
| `ZonesRisqueLayer.tsx` + `components/risques/BoutonVoirCarte.tsx` | 239+108 | `C/couches/zones-risque.service.ts` (sur `R/cartes/couches-zones.ts`), `R/exports/bouton-voir-carte.component.ts` | T13 |
| `panneaux/JeuxDeZonesRail.tsx` | 131 | `C/panneaux/zones/jeux-de-zones.component.ts` | T13 |
| `panneaux/PanneauZones.tsx` | 161 | `C/panneaux/zones/panneau-zones.component.ts` | T14 |
| `ZoneMediaPlanPanel.tsx` + `lib/custom-geo/media-plan.ts` | 669+46 | `C/panneaux/zones/plan-media.component.ts` | T15 |
| `panneaux/CreerZoneCodesPostaux.tsx`, `CreerZoneRayon.tsx`, `CreerZoneDessin.tsx` + `DessinLibre.tsx` + `lib/custom-geo/parse-cp.ts` | 237+315+180+215+92 | `C/panneaux/zones/creer-{codes-postaux,rayon,dessin}.component.ts`, `C/couches/dessin.service.ts` (B8) | T16 |
| `components/custom-geo/CustomGeoCaptureModal.tsx` + `lib/custom-geo/{CustomGeoCaptureContext.tsx,composition.ts,cibles.ts,source-type-labels.ts}` + `CaptureLayers.tsx` | 615+103+175+42+29+315 | `C/panneaux/zones/capture.component.ts` (`<dialog>`), `C/etat/capture.service.ts` | T16 |
| `panneaux/PanneauAnalyse.tsx` + `SpatialAnalysisIntro.tsx` + `analysis-types.ts` | 472+66+25 | `C/panneaux/analyse/panneau-analyse.component.ts` | T17 |
| `filter-panel/IsochronesTool.tsx`, `BattleV2Tool.tsx`, `use-isochrone-battle.ts` + `_hooks/useMapDirectActions.ts` (l.bataille) + couches bataille/isochrones (`useMapInit.ts:735-741,997-1060`, `useMapLayers.ts:1029-1186`) | 288+276+354+523 | `outil-isochrones`, `outil-bataille-v2`, `C/couches/bataille.service.ts` | T17 |
| `filter-panel/VoronoiTool.tsx` | 69 | rendu INERTE (B5) dans `panneau-analyse` | T17 |
| `filter-panel/ScoreCompositeTool.tsx` + `ScoreMapLayer.tsx` | 439+304 | `outil-score.component.ts`, `C/couches/score.service.ts` | T18 |
| `filter-panel/CorrelationTool.tsx` + `use-analyses.ts` (Mes analyses) | 305+73 | `outil-correlation.component.ts`, `C/panneaux/calques/mes-analyses.component.ts` | T18 |
| `filter-panel/ClusteringSection.tsx` + `ClusterPanel.tsx` | 223+1 075 | `C/panneaux/analyse/clustering/*` | T19 |
| `ClusteringWizard.tsx` | 846 | `C/panneaux/analyse/clustering/assistant-clustering.component.ts` | T20 |
| `app/copilote/_hooks/useMapInit.ts` | 1 112 | réparti : sources posées par chaque service de couche (T6-T19), badge de zoom et canevas (T4, T8) | T4-T19 |
| `app/copilote/_hooks/useMapLayers.ts` | 1 334 | réparti : carreaux (T6), IRIS (T7), bataille/isochrones (T17), dégradé (T3) | T3-T17 |
| `app/copilote/_components/{ChatPanel,AnalyseCard,DataGouvCard,ImportPoiButton,PromptsPanel,…}.tsx`, `_hooks/{useChatControls,useToolProcessor,useSavedMaps,useSmartPrompt,useRateLimitHandler,useProviderSelector}.ts` | ~2 600 | **non portés** (B5) | — |
| `components/magelian/*`, `components/campagne/*`, `SuiviMapLayer.tsx`, `DiffusionMapLayer.tsx` | — | **lot 5** (B6) | — |
| `app/map/analyse/digital/**` (sauf `MeteoGeoPanel`), `app/map/custom-geo/**` | ~3 600 | **hors lot 4** : pages distinctes de `/map` (« Zones custom » de la barre latérale = lot 5 ou 6, à trancher au lot 5) | — |

Logique pure recopiée (P6) dans `C/logique/` — chaque fichier porte en tête « Copie de `<chemin React>` (gel P5 du <date>) ; parité : `<test>` » :

| Source React | Copie | Ce qui change | Tâche |
|---|---|---|---|
| `lib/navigation/config.ts` | `C/logique/navigation.ts` | `icone: LucideIcon` → `icone: NomIcone` (table `sparkles→etincelles`, `megaphone→porte-voix`, `funnel→entonnoir`, `layers→calques`, `flask-conical→fiole`, `shapes→formes`, `settings→reglages`, `circle-help→aide`) | T1 |
| `lib/navigation/garde-saisie.ts`, `lib/carte/{filtre,bbox-requete,degrades,calques-actifs,garde-perimetre}.ts`, `panneaux/panneau-filtre-logique.ts` | même nom | imports relatifs ; `UnionCouverte` gardé MOT POUR MOT | T1 |
| `lib/carte/pile-echap.ts` | `C/etat/pile-echap.service.ts` | état d'instance au lieu d'un tableau de module | T1 |
| `lib/carte/palette-risques.ts` (types, `TYPE_PAR_PREFIXE`, `LIBELLE_TYPE`, `ORDRE_TYPES`, `typeRisqueDepuisPrefixes`, `typeRisqueDepuisLibelle`, `librellesDuType`), `lib/import/georisques/familles.ts` | `C/logique/{types-risque,familles-icpe}.ts` | `COULEURS_MAPLIBRE`/`COULEURS_CSS`/`CONTOUR_POINT` retirés (jetons `--risque-*`, `--donnee-absente`, `--point-actif-contour`) | T2 |
| `lib/carte/palette-pprt.ts` | `C/logique/pprt.ts` | couleurs → jetons `--pprt-*` | T2 |
| `lib/carreaux/{normalisation,bornes,expressions}.ts` | `C/logique/carreaux/*` | — (`catalogue.ts` déjà copié : `R/logique/palettes-donnees.ts`) | T2 |
| `lib/iris/echelle.ts` | `C/logique/iris-echelle.ts` | — | T2 |
| `lib/meteo/{types,palettes,requete,aggregation}.ts` | `C/logique/meteo/*` | palettes = B12 | T2 |
| `lib/version.ts` (`CARREAUX_TILE_VERSION`, `IRIS_TILE_VERSION`, `IRIS_ZOOM_PLANCHER`, `PPRT_ZOOM_PLANCHER`) | `C/logique/versions.ts` | constantes seules | T2 |
| `lib/custom-geo/{parse-cp,composition,cibles,source-type-labels}.ts` | `C/logique/zones/*` | — | T2 |
| `app/copilote/_lib/constants.ts` (`MAP_STYLES`, `MAP_STYLE`, palettes de données) | `C/logique/fonds.ts` + `palettes-donnees-carte.ts` (B12) | `circleGeoJSON` déjà copié (`R/logique/cercle.ts`) | T2 |
| `filter-panel/{constants,types,poi-style}.ts`, `lib/geo/france-admin.ts` (`ISO_MODES`) | `C/logique/{constantes-calques,modes-isochrones}.ts` | types seuls | T2 |

Routes API consommées (aucune n'est modifiée, D4) : `/api/ref/geo` (cookie), `/api/custom-geo/list`, `/stats`, `/[id]/geometry`, `/save`, `/capture`, `/source/{codes-postaux,rayon,dessin,intersection,difference,composite,carreaux,iris,radio,tmja,score,battle,voronoi,indicator-threshold}`, `/media-plan` (GET/POST/DELETE), `/media-plan/snapshot`, `/national-totals`, `/[id]/items-audience`, `/[id]/export`, `/api/map/pois` (POST), `/api/map/categories`, `/api/map/poi-natures`, `/api/map/ooh` (POST), `/api/map/transport`, `/api/map/risques-industriels`, `/api/map/pprt`, `/api/map/territory-mask`, `/api/tiles/{z}/{x}/{y}` et `/api/tiles/iris/…` et `/api/tiles/zones-risque/…` (cookie, MapLibre), `/api/tmja-tiles/…` (MapLibre), `/api/iris/bornes`, `/api/iris/detail`, `/api/insee-variables/[code]/geojson`, `/api/insee-variables/cp-detail`, `/api/civic-indicators/health-map` (NDJSON en `scale=departement`), `/api/admin/civic-ingest` (NDJSON, super_admin), `/api/meteo-geo` (NDJSON), `/api/meteo-geo/zones`, `/api/radio/{emetteurs,filter-options,stations}`, `/api/risques/zones/preparer`, `/api/zones/jeux`, `/api/cibles/indicators`, `/api/analyses` (GET/POST), `/api/analyses/[id]` (GET/DELETE), `/[id]/rejouer`, `/api/analyses/score`, `/api/analyses/correlation`, `/api/digital/campaigns`, `/api/isochrone-battle` (fichier protégé — APPELÉ, jamais modifié), `/api/isochrone-battle-v2`, `/api/isochrone-battle/apply-battle`, `/api/isochrone-cache-check`, `/api/poi-clusters{,/run,/models,/models/[version],/models/[version]/analysis,/models/[version]/generate-analysis,/[clusterId],/poi/[poiId],/history/[poiId],/count,/poi-types,/france-averages,/model}`.

---

## Chiffres de référence (base locale, mesurés le 2026-10-04)

À REMESURER au début de chaque tâche qui les cite (la base bouge) — par l'écran React ET par SQL :

```bash
MSYS_NO_PATHCONV=1 docker exec supabase_db_genesis_app psql -U postgres -At -c "
select 'poi_risque', count(*) from poi_france where categorie='risque_industriel'
union all select 'poi_seveso', count(*) from poi_france where categorie='risque_industriel' and sous_categorie in ('seveso_haut','seveso_bas')
union all select 'ooh_actif', count(*) from panneaux_affichage where actif
union all select 'emetteurs', count(*) from emetteurs_radio
union all select 'radios', count(*) from radios
union all select 'pprt', count(*) from pprt_perimetres
union all select 'custom_geo_zones', count(*) from custom_geo_zones
union all select 'zone_sets_nommes', count(*) from zone_sets where not brouillon
union all select 'analyses', count(*) from analyses
union all select 'iris_bornes', count(*) from iris_bornes_echelle
union all select 'cibles_indic', count(*) from cible_indicator_registry
union all select 'clustering_models', count(*) from clustering_models;
select 'cp_dept13', jsonb_array_length(codes_postaux_du_perimetre_jsonb('departement','13'));
select 'pollen_max', max(date_ech) from pollen_map_daily;"
```

| Grandeur | Valeur | Où la relire côté écran |
|---|---|---|
| Sites ICPE (`risque_industriel`) | **99 152** | Calques › Environnement › Zones à risque, total « sur N » |
| dont Seveso (haut + bas, défaut de la couche) | **1 327** | même section, compte par défaut ; légende « N sites » au cadre France (à RELEVER sur React, même cadre) |
| Périmètres PPRT | **664** ; z8 sur l'Étang de Berre : **126 zones** (doc, à relever) | couche PPRT, légende |
| Panneaux OOH actifs | **1 434** | Médias offline › OOH |
| Émetteurs radio / radios | **12 704 / 1 175** | Médias offline › Radio (ARCHITECTURE annonçait 11 836 / 861 : la base a bougé, relever React) |
| Catégories de POI | **5** (`arret_transport` 285 015, `risque_industriel` 99 152, `lycee` 5 584, `bmw` 177, `cirfa` 101) | POI et mobilité › POI (liste du catalogue `/api/map/categories`) |
| Comptages routiers | **1 100** (TMJA mesuré seul — le proxy OSM a été abandonné) | TMJA, nombre de tronçons au cadre (à relever) |
| Bornes IRIS | **37** colonnes | IRIS : la liste d'indicateurs proposés (+ 4 entièrement vides proposées quand même, ARCHITECTURE) |
| Indicateurs du registre de cibles | **19** | Analyse › Score composite, liste d'indicateurs |
| Zones custom | **7** (toutes orgs) — la liste du panneau est scopée à l'org active : relever React | Zones › Mes zones ; Filtre › zone enregistrée |
| Jeux de zones nommés | **2** (`0b7ece33…`, `d9b81560…`) | Zones › Jeux de zones |
| Analyses enregistrées | **2** | Calques › Mes analyses |
| Modèles de clustering | **2** | Analyse › Clustering |
| CP du département 13 | **127** | Analyse › Score composite, filtre département 13 : « scores sur N » |
| Dernière date pollen | **2026-09-17** | Santé environnementale au code postal → message `no_data` daté |
| Centre / zoom initial | `[2.3, 46.6]` / **5.5** ; badge « `z5  20km` » | badge de zoom en haut à gauche de la carte |

Reproduire un état React : `http://localhost:3000/map`, mêmes gestes ; Angular : `http://localhost:4200/app/carte`. Pour le module : React = Calques › Risque industriel › « Analyser la population à risque → » ; Angular = même geste (→ `/app/carte/risques?risque=…`).

---

## Structure de fichiers Angular

```
angular/src/app/features/carte/
├── carte.page.ts / .html            # hôte relative, rail, barre du haut, panneau gauche, carte, outlet du module
├── rail/
│   ├── rail.component.ts            # 8 entrées depuis logique/navigation.ts
│   ├── barre-haut.component.ts      # logo, bascule Campagne inerte (B6)
│   └── panneau.component.ts         # cadre des panneaux gauches (OverlayPanel)
├── etat/
│   ├── etat-carte.service.ts        # filtre, entrée active, rail masqué, dégradé actif, POI sélectionnés, périmètre
│   ├── couches-carte.service.ts     # carteCourante, registre des couches, « Tout effacer »
│   ├── pile-echap.service.ts
│   ├── annonce.service.ts           # B14
│   ├── risque-carte.service.ts      # état de la couche ICPE + PPRT (use-risque-industriel)
│   └── capture.service.ts           # sources contributives (CustomGeoCaptureContext)
├── couches/                         # un service par couche : poser / repeindre / retirer, effect sur carteCourante
│   ├── carreaux.service.ts, iris.service.ts, detail-iris.component.ts
│   ├── pois.service.ts, ooh.service.ts, transport.service.ts, tiroir-panneau.component.ts
│   ├── tmja.service.ts, radio.service.ts
│   ├── indicateurs-civiques.service.ts, sante.service.ts, meteo.service.ts
│   ├── risques-industriels.service.ts, pprt.service.ts, zones-risque.service.ts
│   ├── zones-custom.service.ts, dessin.service.ts
│   ├── bataille.service.ts, score.service.ts, clusters.service.ts
├── legende/legende-carte.component.ts
├── filtre/puce-filtre.component.ts
├── panneaux/
│   ├── filtre/…, calques/…, analyse/…, zones/…
│   ├── reglages.component.ts, aide.component.ts
├── commun/
│   ├── annonce.component.ts         # mg-annonce (B14)
│   └── boutons-flottants.component.ts
├── logique/…                        # copies pures (P6)
└── data/                            # services d'API
    ├── carte.api.ts                 # pois, catégories, natures, ooh, transport, territory-mask
    ├── iris.api.ts, civique.api.ts, meteo.api.ts, radio.api.ts
    ├── zones-custom.api.ts, analyses.api.ts, isochrones.api.ts, clustering.api.ts
```

---

### Task 1: Logique pure — navigation, filtre, dégradés, gardes, Échap

**Files:**
- Create: `C/logique/{navigation,garde-saisie,filtre,bbox-requete,degrades,calques-actifs,garde-perimetre,panneau-filtre-logique}.ts`, `C/etat/pile-echap.service.ts` (+ spec)
- Create: `tests/unit/angular/carte-logique-paritaire.test.ts`
- Modify: `angular/src/app/ui/icone/icones.ts` (+ `etincelles` Sparkles, `porte-voix` Megaphone, `entonnoir` Funnel, `fiole` FlaskConical, `formes` Shapes, `reglages` Settings, `aide` CircleHelp), `tests/unit/angular/icones-lucide.test.ts` (compte), `docs/superpowers/plans/2026-09-29-transition-angular-feuille-de-route.md` (ligne lot 4 : « ouvert le <date> — gel P5 étendu à /map »)

**Sources React :** `lib/navigation/config.ts:1-153`, `lib/navigation/garde-saisie.ts:1-31`, `lib/carte/filtre.ts:1-64`, `bbox-requete.ts:1-35`, `degrades.ts:1-60`, `calques-actifs.ts:1-84`, `garde-perimetre.ts:1-132`, `pile-echap.ts:1-45`, `app/map/_components/panneaux/panneau-filtre-logique.ts:1-79`. Tests React existants à reprendre comme cas : `tests/unit/navigation/{config,garde-saisie}.test.ts`, `tests/unit/carte/{filtre,degrades,calques-actifs,garde-perimetre,pile-echap,panneau-filtre}.test.ts`.

**Interfaces — Produces** (mêmes noms, mêmes signatures que React) : `EntreeId`, `EntreeNavigation` (avec `icone: NomIcone`), `LARGEUR_RAIL = 76`, `ECART_RAIL_PANNEAU = 8`, `LARGEUR_PANNEAU = 340`, `ENTREES_NAVIGATION`, `entreeParRaccourci(e: Pick<KeyboardEvent,'key'|'ctrlKey'|'metaKey'|'altKey'|'shiftKey'>)`, `ignorerRaccourciClavier`, `BBOX_METRO`, `FiltreActif`, `poserFiltre`, `retirerFiltre`, `bboxDuFiltre`, `bboxPourRequete`, `DegradeId`, `libelleDegrade`, `activerDegrade`, `validerDegradeId`, `basculerDegrade`, `MESSAGE_PERIMETRE_MANQUANT`, `perimetreChoisi`, `messageGardePerimetre`, `OutilAnalyse`, `outilAdmetNational`, `messageRefusNational`, `messageGardeOutil`, `seedDepuisFiltre`, `composerFiltreVille`, `composerFiltreCodePostal`, `filtreApresChangementScope`. Et :

```ts
@Injectable()
export class PileEchapService {
  empiler(id: string, fermer: () => void): void;   // id EXISTANT : met à jour la fonction SANS changer la position
  depiler(id: string): void;
  fermerLePlusHaut(): void;                       // sans effet si vide
  etat(): readonly { id: string }[];              // pour les specs
}
```

**Pièges :** `ENTREES_NAVIGATION` est `as const` en React avec des composants lucide : la parité compare TOUT sauf `icone`, et un second test vérifie la table lucide → `NomIcone` (8 entrées) ; `UnionCouverte` doit FAIRE ÉCHOUER `tsc` si on retire un membre de `DEGRADE_IDS` — le vérifier une fois à la main (retirer `'zones-risque'`, constater l'échec de `npx ng build`, remettre) et le noter au rapport ; `BBOX_METRO` reste `Object.freeze` ; `entreeParRaccourci` reçoit un objet de forme `KeyboardEvent` (le test passe des littéraux).

- [ ] **Step 1: Écrire le test de parité (échec : fichiers absents)**

```ts
// tests/unit/angular/carte-logique-paritaire.test.ts
/**
 * La logique de navigation et de carte copiée dans angular/ (P6) rend la MÊME chose
 * que lib/navigation et lib/carte. Ce test empêche la copie de dériver pendant la
 * cohabitation (gel P5 étendu à /map au lot 4).
 */
import { describe, expect, it } from 'vitest';
import * as Rn from '@/lib/navigation/config';
import * as An from '../../../angular/src/app/features/carte/logique/navigation';
import * as Rs from '@/lib/navigation/garde-saisie';
import * as As from '../../../angular/src/app/features/carte/logique/garde-saisie';
import * as Rf from '@/lib/carte/filtre';
import * as Af from '../../../angular/src/app/features/carte/logique/filtre';
import * as Rb from '@/lib/carte/bbox-requete';
import * as Ab from '../../../angular/src/app/features/carte/logique/bbox-requete';
import * as Rd from '@/lib/carte/degrades';
import * as Ad from '../../../angular/src/app/features/carte/logique/degrades';
import * as Rc from '@/lib/carte/calques-actifs';
import * as Ac from '../../../angular/src/app/features/carte/logique/calques-actifs';
import * as Rg from '@/lib/carte/garde-perimetre';
import * as Ag from '../../../angular/src/app/features/carte/logique/garde-perimetre';
import * as Rp from '@/app/map/_components/panneaux/panneau-filtre-logique';
import * as Ap from '../../../angular/src/app/features/carte/logique/panneau-filtre-logique';

const ICONES: Record<string, string> = {
  assistant: 'etincelles', campagne: 'porte-voix', filtre: 'entonnoir', calques: 'calques',
  analyse: 'fiole', zones: 'formes', reglages: 'reglages', aide: 'aide',
};

const FILTRES: (Rf.FiltreActif | null)[] = [
  null,
  { type: 'region', code: '93', label: 'Provence-Alpes-Côte d’Azur' },
  { type: 'departement', code: '13', label: 'Bouches-du-Rhône' },
  { type: 'commune', code: '13055', label: 'Marseille' },
  { type: 'cp', code: '13001', label: '13001' },
  { type: 'zone', code: '00000000-0000-0000-0000-000000000001', label: 'Zone', bbox: [4.8, 43.2, 5.6, 43.6] },
  { type: 'france', code: 'france', label: 'France entière' },
];

const TOUCHES = [
  { key: '1', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false },
  { key: '4', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false },
  { key: 'c', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false },
  { key: 'C', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false },
  { key: 'k', altKey: false, ctrlKey: true, metaKey: false, shiftKey: false },
  { key: 'k', altKey: false, ctrlKey: false, metaKey: true, shiftKey: false },
  { key: 'k', altKey: false, ctrlKey: true, metaKey: true, shiftKey: false },
  { key: '1', altKey: true, ctrlKey: true, metaKey: false, shiftKey: false },
  { key: '1', altKey: true, ctrlKey: false, metaKey: false, shiftKey: true },
  { key: '1', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false },
  { key: '9', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false },
];

describe('logique de navigation et de carte : Angular = React', () => {
  it('navigation — constantes et entrées (icônes à part)', () => {
    expect(An.LARGEUR_RAIL).toBe(Rn.LARGEUR_RAIL);
    expect(An.ECART_RAIL_PANNEAU).toBe(Rn.ECART_RAIL_PANNEAU);
    expect(An.LARGEUR_PANNEAU).toBe(Rn.LARGEUR_PANNEAU);
    const sans = (l: readonly { icone: unknown }[]) => l.map(({ icone: _i, ...r }) => r);
    expect(sans(An.ENTREES_NAVIGATION)).toEqual(sans(Rn.ENTREES_NAVIGATION));
    for (const e of An.ENTREES_NAVIGATION) expect(e.icone, e.id).toBe(ICONES[e.id]);
  });
  it('navigation — raccourcis', () => {
    for (const t of TOUCHES) {
      expect(An.entreeParRaccourci(t), JSON.stringify(t)).toBe(Rn.entreeParRaccourci(t as KeyboardEvent));
    }
  });
  it('garde de saisie', () => {
    const cibles = [null, { tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'DIV', isContentEditable: true }, { tagName: 'BUTTON' }];
    for (const touche of ['Escape', 'a', '1']) for (const c of cibles) {
      expect(As.ignorerRaccourciClavier(touche, c as Element)).toBe(Rs.ignorerRaccourciClavier(touche, c as Element));
    }
  });
  it('filtre — poser, retirer, bbox', () => {
    expect(Af.BBOX_METRO).toEqual(Rf.BBOX_METRO);
    expect(Object.isFrozen(Af.BBOX_METRO)).toBe(true);
    for (const a of FILTRES) {
      expect(Af.bboxDuFiltre(a)).toEqual(Rf.bboxDuFiltre(a));
      expect(Ab.bboxPourRequete(a)).toEqual(Rb.bboxPourRequete(a));
      for (const b of FILTRES) if (b) expect(Af.poserFiltre(a, b)).toEqual(Rf.poserFiltre(a, b));
    }
    expect(Af.retirerFiltre()).toBe(Rf.retirerFiltre());
  });
  it('dégradés — libellés, activation, bascule, validation', () => {
    const ids = ['carreaux', 'iris', 'civic-indicateurs', 'civic-sante', 'meteo', 'campagne-impressions', 'score', 'diffusion', 'zones-risque'] as const;
    for (const id of ids) expect(Ad.libelleDegrade(id)).toBe(Rd.libelleDegrade(id));
    for (const actif of [null, ...ids]) for (const cible of ids) {
      expect(Ad.activerDegrade(actif, cible)).toEqual(Rd.activerDegrade(actif, cible));
      for (const next of [true, false]) expect(Ac.basculerDegrade(actif, cible, next)).toEqual(Rc.basculerDegrade(actif, cible, next));
    }
    for (const v of [...ids, 'inconnu', '', null, 3, undefined]) expect(Ac.validerDegradeId(v)).toBe(Rc.validerDegradeId(v));
  });
  it('garde de périmètre — six outils, sept filtres, zone sélectionnée ou non', () => {
    const outils = ['voronoi', 'bataille_v1', 'bataille_v2', 'application_bataille', 'clustering', 'score_composite'] as const;
    expect(Ag.MESSAGE_PERIMETRE_MANQUANT).toBe(Rg.MESSAGE_PERIMETRE_MANQUANT);
    for (const f of FILTRES) for (const z of [null, undefined, 'zone-1']) {
      expect(Ag.perimetreChoisi(f, z)).toBe(Rg.perimetreChoisi(f, z));
      expect(Ag.messageGardePerimetre(f, z)).toBe(Rg.messageGardePerimetre(f, z));
      for (const o of outils) expect(Ag.messageGardeOutil(o, f, z)).toBe(Rg.messageGardeOutil(o, f, z));
    }
    for (const o of outils) {
      expect(Ag.outilAdmetNational(o)).toBe(Rg.outilAdmetNational(o));
      expect(Ag.messageRefusNational(o)).toBe(Rg.messageRefusNational(o));
    }
  });
  it('panneau filtre — seed et composition', () => {
    for (const f of FILTRES) {
      expect(Ap.seedDepuisFiltre(f)).toEqual(Rp.seedDepuisFiltre(f));
      expect(Ap.filtreApresChangementScope(f)).toEqual(Rp.filtreApresChangementScope(f));
      for (const v of ['', 'Marseille', ' marseille ', '13001', '1300', '2A004', '75056']) {
        expect(Ap.composerFiltreVille(f, v)).toEqual(Rp.composerFiltreVille(f, v));
        expect(Ap.composerFiltreCodePostal(f, v)).toEqual(Rp.composerFiltreCodePostal(f, v));
      }
    }
  });
});
```

`pile-echap.service.spec.ts` (Angular) reprend les cas de `tests/unit/carte/pile-echap.test.ts` : ordre LIFO ; ré-empiler un id existant ne change pas sa position mais remplace sa fonction (le cas « Assistant re-rendu à chaque jeton » de l'en-tête) ; `fermerLePlusHaut` sur pile vide sans effet ; deux instances du service n'ont pas d'état commun.

- [ ] **Step 2: Lancer et constater l'échec** — `npx vitest run tests/unit/angular/carte-logique-paritaire.test.ts` : FAIL (« Failed to resolve import …/logique/navigation »).
- [ ] **Step 3: Recopier les huit fichiers** (imports `@/lib/...` → `./…`), écrire `PileEchapService`, ajouter les sept icônes (lire `__iconNode` de `node_modules/lucide-react/dist/esm/icons/<nom>.js`, champ `lucide`, `feather: true` si le nom est dans la LICENSE Feather), les voir dans la planche de `/app/catalogue`.
- [ ] **Step 4: Lancer** le test de parité, `icones-lucide.test.ts`, `cd angular && npx ng test --watch=false`, `npm run build` — PASS. Vérifier `UnionCouverte` à la main (Pièges).
- [ ] **Step 5: Commit** — `git add` des fichiers nommés ; message `feat(angular): logique pure de navigation et de carte, copiée avec test de parité (lot 4, T1)`.

---

### Task 2: Logique pure — couches, palettes de données, zones

**Files:**
- Create: `C/logique/{types-risque,familles-icpe,pprt,iris-echelle,versions,fonds,palettes-donnees-carte,constantes-calques,modes-isochrones}.ts`, `C/logique/carreaux/{normalisation,bornes,expressions}.ts`, `C/logique/meteo/{types,palettes,requete,aggregation}.ts`, `C/logique/zones/{parse-cp,composition,cibles,source-type-labels}.ts`
- Create: `tests/unit/angular/carte-couches-paritaire.test.ts`

**Sources React :** `lib/carte/palette-risques.ts:1-223` (SAUF `COULEURS_MAPLIBRE` l.100-116, `COULEURS_CSS` l.118-124, `couleurDuType` l.178, `expressionCouleurRisque` l.188, `CONTOUR_POINT` l.220 — couleurs = jetons), `lib/import/georisques/familles.ts:1-67`, `lib/carte/palette-pprt.ts:1-95` (logique seule), `lib/carreaux/{normalisation,bornes,expressions}.ts`, `lib/iris/echelle.ts:1-140`, `lib/meteo/{types,palettes,requete,aggregation}.ts`, `lib/version.ts` (constantes de tuiles et planchers), `lib/custom-geo/{parse-cp,composition,cibles,source-type-labels}.ts`, `app/copilote/_lib/constants.ts:71-145` (palettes, `MAP_STYLES`, `MAP_STYLE`), `app/map/_components/filter-panel/{constants,types,poi-style,analysis-types}.ts`, `lib/geo/france-admin.ts` (`ISO_MODES` seul), `useMapInit.ts:391-530` (paliers TMJA et radio, littéraux de `paint`) et les échelles en dur de `CivicIndicatorsLayer.tsx`/`CivicHealthMapLayer.tsx` (les LIRE et les nommer dans `palettes-donnees-carte.ts`).

**Interfaces — Produces :** `TypeRisque`, `TYPE_PAR_PREFIXE`, `LIBELLE_TYPE`, `ORDRE_TYPES`, `JETON_TYPE: Record<TypeRisque, string>` (`toxique→'risque-toxique'`, …, `non_precise→'donnee-absente'`), `typeRisqueDepuisPrefixes`, `typeRisqueDepuisLibelle`, `librellesDuType`, `FamilleIcpe`, `FAMILLES_ICPE_SEED`, `NATURE_NON_PRECISEE`, `CARREAUX_TILE_VERSION`, `IRIS_TILE_VERSION`, `IRIS_ZOOM_PLANCHER`, `PPRT_ZOOM_PLANCHER`, `MAP_STYLES`, `MAP_STYLE`, `CATEGORY_COLORS`, `getCatColor`, `ISOCHRONE_COLORS`, `ISOCHRONE_MODE_LABELS`, `VORONOI_PALETTE`, `BATTLE_PALIER_OPACITY`, `PALIERS_TMJA`, `TEINTES_RADIO`, plus tous les exports des copies `carreaux/*`, `iris-echelle`, `meteo/*`, `zones/*` sous leurs noms React.

**Pièges :** `palettes-donnees-carte.ts` porte en tête `// Exception B12 : échelles de DONNÉES, identiques dans les deux thèmes — deux teintes violettes de CATEGORY_COLORS gardées pour la parité (défaut React listé)` ; `librellesDuType` a la faute de frappe React (`librelles`) — GARDER le nom (parité, et le lot 3 en parle) ; `lib/meteo/requete.ts` lit peut-être `Date` : figer l'horloge dans le test (`vi.setSystemTime`).

- [ ] **Step 1: Test de parité (échec)** — même patron que T1 (`toEqual` pour les constantes ; fonction par fonction sur des tableaux de cas) : `librellesDuType` pour les cinq `TypeRisque` contre `FAMILLES_ICPE_SEED` ; `typeRisqueDepuisPrefixes` sur `[null, [], ['41'], ['47','27'], ['99']]` ; `typeRisqueDepuisLibelle` sur les 15 libellés du seed + un inconnu ; normalisation et bornes de carreaux sur les cinq paliers (20 km / 5 km / 2 km / 1 km / 200 m) et trois indicateurs (`population_totale`, une proportion, une densité) ; `expressions.ts` (`toEqual` sur les expressions MapLibre produites) ; échelle IRIS sur les trois classes (effectif/densité/proportion) ; `parse-cp` sur `'13001, 13002\n2A004;75056 abc 1300'` ; `composition` sur 2 et 3 zones ; météo : palettes et `requete` (bbox arrondie au demi-degré VERS L'EXTÉRIEUR, période bornée) ; palettes de données `toEqual` aux littéraux React.
- [ ] **Step 2: Lancer** — FAIL. **Step 3: Recopier.** **Step 4: PASS** ; gardes `tests/unit/angular/` ; `ng test` ; `npm run build`.
- [ ] **Step 5: Commit** — `feat(angular): logique pure des couches, palettes de données et zones, avec tests de parité (lot 4, T2)`.

---

### Task 3: Écran carte — route, rail, barre du haut, panneau, état, clavier

**Files:**
- Create: `C/carte.page.{ts,html}` (+ spec), `C/rail/{rail,barre-haut,panneau}.component.ts` (+ specs), `C/etat/{etat-carte,couches-carte,annonce}.service.ts` (+ specs), `C/commun/annonce.component.ts`
- Modify: `angular/src/app/app.routes.ts` (route `carte`), `angular/src/app/layout/navigation.ts` (« Explorer » → `cible: 'carte'`), `angular/src/app/carte/carte.component.ts` (+ entrées optionnelles `centre`, `zoomInitial`, B11) et sa spec, `angular/src/app/remote.spec.ts`, `angular/src/app/app.config.spec.ts`, `ARCHITECTURE.md`

**Sources React :** `app/map/page.tsx:140-260` (état, `handleEntree` l.180-196, `ouvrirJeuDeZones` l.232-240), `:288-320` (rail masqué dans la pile, écouteur clavier unique), `:526-575` (`onDegrade` + annonce), `:1121-1200` (décalage des boutons, enveloppe, top bar, rail, `FiltreChip`, `OverlayPanel` et sa table `PANNEAUX` l.924-1104), `:1330-1360` (bouton mode immersif), `components/map/RailNavigation.tsx:1-258`, `MapTopBar.tsx:1-150`, `OverlayPanel.tsx:1-264`, `jetons-carte.ts:1-69`, `useMapInit.ts:128-200` (création, centre, badge de zoom, contrôle de navigation `bottom-right`), `useMapLayers.ts:1264-1334` (`degradeActif`, `basculerDegrade`).

**Interfaces:**
- Consumes : T1 (`ENTREES_NAVIGATION`, `entreeParRaccourci`, `ignorerRaccourciClavier`, `basculerDegrade`, `libelleDegrade`, `PileEchapService`), `mg-carte`, `mg-icone`, `mg-logo`, `ThemeService`.
- Produces :

```ts
@Injectable()
export class EtatCarteService {
  readonly entreeActive: Signal<EntreeId | null>;
  readonly railMasque: WritableSignal<boolean>;
  readonly filtre: WritableSignal<FiltreActif | null>;
  readonly degradeActif: Signal<DegradeId | null>;
  readonly poiSelectionnes: WritableSignal<string[]>;
  readonly perimetreScope: WritableSignal<'metro' | 'all' | null>;
  /** Route selon le TYPE de l'entrée (page.tsx:180) : overlay-plein-ecran → rien (B6), sinon bascule. */
  choisirEntree(id: EntreeId): void;
  fermerEntree(): void;
  /** Contrat EXACT de onDegrade (page.tsx:526) : rend l'id évincé, annonce « <libellé> a été masqué — un seul dégradé de couleur à la fois ». */
  basculerDegrade(cible: DegradeId, next: boolean): DegradeId | null;
  /** Reset sans annonce (« Tout effacer », page.tsx:740). */
  reinitialiserDegrade(): void;
  /** Abonnement des services de couche à l'éviction de LEUR dégradé. */
  surEviction(cible: DegradeId, eteindre: () => void): void;
}

@Injectable()
export class CouchesCarteService {
  readonly carteCourante: Signal<maplibregl.Map | null>;
  publier(carte: maplibregl.Map | null): void;   // appelé par (prete) de mg-carte, et null à la destruction
  /** Chaque service de couche s'inscrit : « Tout effacer » appelle toutes les fonctions. */
  inscrireEffacement(id: string, effacer: () => void): void;
  toutEffacer(): void;
}
```

Route (frère de `risques`, avant la coquille), avec l'outlet enfant réservé (rempli en T13) :

```ts
{
  path: 'carte',
  canActivate: [authGuard],
  loadComponent: () => import('./features/carte/carte.page').then((m) => m.CartePage),
  children: [],
},
```

`CartePage` : `providers: [EtatCarteService, CouchesCarteService, PileEchapService, AnnonceService]`, `host: { class: 'relative flex h-full overflow-hidden bg-[var(--bg-primary)]', tabindex: '-1', '(keydown)': 'clavier($event)' }`, focus de l'hôte dans `afterNextRender`. `clavier(e)` = recopie de `page.tsx:302-318` (Échap → `pile.fermerLePlusHaut()` + `preventDefault`, sinon `entreeParRaccourci` → `choisirEntree`), `ignorerRaccourciClavier(e.key, e.composedPath()[0] as Element)` — PAS `document.activeElement` (dans une racine d'ombre, `document.activeElement` est l'HÔTE). Rail : 8 boutons, libellés, infobulles (`title`), raccourcis, séparateurs, accent teal de Campagne ; Assistant et Campagne INERTES (`aria-disabled="true"`, `title="Disponible prochainement"`, aucun effet, B5/B6). Panneau gauche : largeur `LARGEUR_PANNEAU`, à `LARGEUR_RAIL + ECART_RAIL_PANNEAU` du bord, pastille de couleur `DOT_PAR_ENTREE` (`page.tsx:111-118`, jetons `cat-*`), titre = `label`, bouton Fermer, s'empile dans la pile Échap à l'ouverture (`'panneau'`), contenu par `@switch (entreeActive())` avec un texte provisoire par entrée (remplacé T4-T19). Mode immersif : bouton `agrandir`/`reduire`, rail en `translateX(-100%)`, top bar masquée, empilé `'rail-masque'`. Badge de zoom (gabarit, B16) : `z<entier>  <palier>` — paliers `200m`/`1km`/`2km`/`5km`/`20km`/`—` (`useMapInit.ts:170-176`). Carte : `centre=[2.3, 46.6]`, `zoomInitial=5.5`, `fond=MAP_STYLE`, contrôle de navigation en bas à droite.

**Pièges :** `position: fixed` interdit — tout en `absolute` dans l'hôte `relative` ; le rail passait SOUS la top bar en React (`zIndex` 30 contre 45) : garder l'ordre ; l'annonce d'éviction se fait dans le service, jamais dans un `effect` qui recopie un signal ; l'écouteur clavier n'est PAS sur `document` ; une navigation de requête (`?risque=` en T13) ne doit pas recréer `CartePage` (spec) ; la modification de `mg-carte` doit laisser INCHANGÉES les specs `carte.component.spec.ts`, `essai-carte`, `risque.page`.

- [ ] **Step 1: Specs (échec)** — `etat-carte.service.spec.ts` : (a) `choisirEntree('filtre')` puis `choisirEntree('filtre')` → `null` ; (b) `choisirEntree('campagne')` → inchangé ; (c) carreaux actif, `basculerDegrade('iris', true)` → rend `'carreaux'`, l'abonné `surEviction('carreaux')` est appelé une fois, l'annonce porte « Carreaux Filosofi a été masqué — un seul dégradé de couleur à la fois » ; (d) `basculerDegrade('iris', false)` alors que carreaux est actif → aucune éviction, aucune annonce ; (e) `reinitialiserDegrade()` → aucune annonce. `carte.page.spec.ts` (routeur de test, fabrique de carte factice `carte/testing/carte-factice.ts`) : (f) le rail rend 8 entrées dans l'ordre de `ENTREES_NAVIGATION`, 6 en haut, 2 en bas ; (g) `Alt+2` sur l'hôte ouvre « Calques », Échap le ferme ; (h) `Alt+2` dont la cible composée est un `<input>` → rien ; (i) Échap depuis un `<input>` ferme quand même ; (j) clic sur Assistant ou Campagne → aucune entrée active ; (k) mode immersif : le rail porte `translateX(-100%)`, Échap le ré-affiche ; (l) la fabrique de carte est appelée UNE fois avec `center: [2.3, 46.6]`, `zoom: 5.5`. `carte.component.spec.ts` : `centre`/`zoomInitial` fournis → passés à la fabrique, `cadre` ignoré ; absents → comportement actuel inchangé. `remote.spec.ts`/`app.config.spec.ts` : la route `carte` existe sous `remoteRoutes`, hors coquille, gardée par `authGuard`, en autonome sous `/app/carte` ; « Explorer » mène à `/app/carte`.
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; build.**
- [ ] **Step 5: Navigateur** — `/app/carte` contre `localhost:3000/map` : rail (8 entrées, libellés non tronqués à 76 px), top bar (logo 18 px), carte Liberty au même centre/zoom, badge `z5  20km`, ouverture/fermeture de chaque panneau par clic, raccourci et Échap, mode immersif. Captures deux thèmes, + survol d'une entrée du rail, + focus clavier sur une entrée, + panneau ouvert : `T3-squelette-{etat}-{theme}-{react,angular}.png`.
- [ ] **Step 6: Doc + commit** — `ARCHITECTURE.md` § Application Angular : route `carte`, B1, B10, B11 (centre/zoom de `mg-carte`), B14. Commit `feat(angular): écran carte — route plein écran, rail, barre du haut, panneau, état et clavier (lot 4, T3)`.

---

### Task 4: Fond de carte, recréation sûre, Réglages, Aide, Tout effacer

**Files:**
- Create: `C/panneaux/{reglages,aide}.component.ts` (+ specs), `C/commun/boutons-flottants.component.ts` (+ spec), `C/couches/style-magelian.ts` (+ spec)
- Modify: `C/carte.page.{ts,html}` (`@for (f of [fond()]; track f)` autour de `mg-carte`, B11), `C/etat/couches-carte.service.ts`, `ui/icone/icones.ts` (+ `gomme` Eraser, et celles de `SettingsOverlay.tsx`/`HelpOverlay.tsx` — les lire), `tests/unit/angular/icones-lucide.test.ts`

**Sources React :** `page.tsx:320-336` (`genesis_map_style`, `genesis_density_mode`), `:681-765` (« Tout effacer »), `:1350-1376` (bouton gomme), `useMapInit.ts:217-221,1083-1102` (style MAGELIAN, recréation sur `mapStyleUrl`, `applyMagelianStyle` au changement de thème), `app/copilote/_lib/constants.ts:132-145`, `components/map/overlays/SettingsOverlay.tsx:1-275`, `HelpOverlay.tsx:1-53`. Lire `applyMagelianStyle` là où il est défini (grep) avant d'écrire `style-magelian.ts`.

**Interfaces:**
- Consumes : T3 (`CouchesCarteService`, `EtatCarteService`), T2 (`MAP_STYLES`, `MAP_STYLE`), `ThemeService.basculer()`, `CouleursService`.
- Produces : `CartePage.fond: WritableSignal<string>` (lu depuis `localStorage['genesis_map_style']` en try/catch, écrit au choix) ; `appliquerStyleMagelian(carte, couleurs)` (couleurs par `CouleursService`, jamais de hex) ; `ReglagesComponent` (sections dans l'ordre React : Modèle IA — INERTE (B5), Fond de carte — actif, Vues sauvegardées — INERTE (B5), Apparence — bascule de thème par `ThemeService.basculer()`, Back office — liens INERTES « Disponible prochainement » tant que les pages admin ne sont pas portées, patron de la barre latérale) ; `AideComponent` (texte EXACT de `HelpOverlay.tsx`).

**Contrat du registre (B11)** : chaque service de couche (T6+) suit ce patron, documenté dans l'en-tête de `couches-carte.service.ts` :

```ts
constructor() {
  effect((onCleanup) => {
    const carte = this.couches.carteCourante();
    if (!carte || !this.actif()) return;
    const poser = () => this.poser(carte);       // addSource/addLayer, idempotent (getSource/getLayer avant)
    if (carte.isStyleLoaded()) poser(); else carte.once('load', poser);
    onCleanup(() => carte.off('load', poser));
  });
  this.couches.inscrireEffacement('<id>', () => this.effacer());
}
```

**Pièges :** recréer la carte détruit les sources : JAMAIS un drapeau « déjà posé » stocké dans le service (il survivrait à l'instance) — tester `getSource` sur l'instance courante ; `@for … track f` détruit puis recrée `mg-carte` : publier `null` à la destruction pour que les effets n'écrivent pas dans une carte morte ; « Tout effacer » ne déclenche AUCUNE annonce (`page.tsx:740-743`) ; la bascule de thème de « Apparence » passe par `ThemeService.basculer()` seul (`ECRIRE_HTML`).

- [ ] **Step 1: Specs (échec)** — page : choisir « Clair » → fabrique appelée une 2e fois avec `style` Positron, `localStorage['genesis_map_style']` écrit, `carteCourante` passe par `null` puis la nouvelle instance ; un service de couche factice actif inscrit → `poser` rappelé sur la nouvelle instance ; `localStorage` qui lève → fond par défaut, aucune erreur ; Tout effacer → chaque `effacer` inscrit appelé une fois, `degradeActif` null, aucune annonce. Réglages : quatre titres de section dans l'ordre React ; « Fond de carte » marque le fond courant `aria-pressed` ; « Modèle IA » et « Vues sauvegardées » `aria-disabled`. `style-magelian.spec.ts` : avec une carte factice, `setPaintProperty` appelé avec des valeurs issues de la palette, aucune chaîne `var(`.
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; build.**
- [ ] **Step 5: Navigateur** — quatre fonds React contre Angular, même centre ; « MAGELIAN » dans les deux thèmes ; recharger la page : le fond choisi est gardé ; Réglages et Aide ouverts. Captures `T4-{reglages,aide,fond-<id>}-{theme}-{react,angular}.png`.
- [ ] **Step 6: Commit** — `feat(angular): fond de carte recréé comme React, Réglages, Aide et Tout effacer (lot 4, T4)`.

---

### Task 5: Panneau Filtre, puce du filtre, pastille du rail

**Files:**
- Create: `C/panneaux/filtre/{panneau-filtre,perimetre,liste-multiple}.component.ts` (+ specs), `C/filtre/puce-filtre.component.ts` (+ spec), `C/data/zones-custom.api.ts` (`lister`, + spec — étendu en T14)
- Modify: `C/carte.page.html`, `C/rail/rail.component.ts` (pastille teal 6 px sur Filtre quand `filtre() !== null`), `app.routes.ts` (`ZonesCustomApi` dans `FOURNISSEURS_DISTANTS`)

**Sources React :** `app/map/_components/panneaux/PanneauFiltre.tsx:1-404`, `filter-panel/PerimeterSections.tsx:1-235`, `MultiDropdown.tsx:1-148`, `use-territory-selection.ts:1-153`, `lib/geo/use-ref-geo.ts:1-78` (référentiel lu une fois), `components/map/FiltreChip.tsx:1-88`, `RailNavigation.tsx` (pastille).

**API :** `/api/ref/geo` (réutilise `ReferentielApi` du lot 3, cache par écran), `/api/custom-geo/list?…` (paramètres EXACTS de `PanneauFiltre.tsx:245-260`).

**Interfaces — Consumes :** T1 (`poserFiltre`, `seedDepuisFiltre`, `composerFiltreVille`, `composerFiltreCodePostal`, `filtreApresChangementScope`), T3 (`EtatCarteService.filtre`, `perimetreScope`). **Produces :** `ZonesCustomApi.lister(params: URLSearchParams): Observable<{ zones: ZoneCustomResume[] }>` (type recopié de la réponse de la route).

Comportements à reproduire EXACTEMENT : pill Métro / +DROM qui pilote `perimetreScope` ET retire un filtre territorial (`filtreApresChangementScope`) ; régions puis départements (sélection SIMPLE émulée sur un widget multiple, l'en-tête du fichier React le décrit) ; recherche locale ville / code postal avec anti-rebond PAR SETTER (`PanneauFiltre.tsx:203-233`, durée lue dans le fichier) ; « Périmètre national » (filtre `'france'`) ; « Filtrer sur une zone enregistrée » (un appel par montage du panneau) ; seed depuis le filtre courant à chaque ouverture (le panneau est recréé à chaque ouverture, comme React). Puce : libellé, croix « Retirer le filtre », position en haut de la carte.

**Pièges :** le référentiel ne porte pas de bbox : région/département/commune/CP composent un filtre SANS bbox (et `bboxPourRequete` rendra `BBOX_METRO`) — c'est voulu, ne pas « améliorer » ; `<select>`/listes natives, pas de menu flottant (ou `<dialog>`/popover si `MultiDropdown` ouvre une liste flottante — lire) ; un seul appel `/api/custom-geo/list` par ouverture.

- [ ] **Step 1: Specs (échec)** — choisir région 93 → `filtre` `{type:'region',code:'93'}`, re-choisir → `null` ; choisir le département 13 après la région → remplace ; pill +DROM avec filtre département → filtre retiré, `perimetreScope = 'all'` ; filtre `zone` + pill → filtre gardé ; saisie « 13001 » → filtre `cp` après l'anti-rebond, une seule écriture pour cinq frappes ; « Périmètre national » → `{type:'france'}` ; liste des zones : un seul appel pour deux ouvertures successives d'une même instance, un nouvel appel après fermeture/réouverture (parité) ; puce : « Retirer le filtre » → `null` ; pastille du rail visible ⇔ filtre.
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; build.**
- [ ] **Step 5: Navigateur** — mêmes listes que React (18 régions, 104 départements du référentiel ; zones de l'org active), chaque type de filtre posé puis retiré par la puce. Captures panneau + puce, deux thèmes, + focus clavier dans la recherche : `T5-filtre-{etat}-{theme}-{react,angular}.png`.
- [ ] **Step 6: Commit** — `feat(angular): panneau Filtre, puce du filtre unique et pastille du rail (lot 4, T5)`.

---

### Task 6: Panneau Calques — cadre, groupes, carreaux Filosofi, légende

**Files:**
- Create: `C/panneaux/calques/{panneau-calques,groupe-calques,section-carreaux}.component.ts` (+ specs), `C/couches/carreaux.service.ts` (+ spec), `C/legende/legende-carte.component.ts` (+ spec)
- Modify: `C/carte.page.html`, `ui/icone/icones.ts` (icônes lues dans `PanneauCalques.tsx`, `GroupeCalques.tsx`, `CarreauxSection.tsx`), `tests/unit/angular/icones-lucide.test.ts`

**Sources React :** `panneaux/PanneauCalques.tsx:1-715` (six groupes l.401-660, « Actifs (n) », lien avec `onDegrade`), `GroupeCalques.tsx:1-66`, `filter-panel/use-filter-sections.ts:1-117` (état replié en `localStorage`), `CarreauxSection.tsx:1-184`, `useMapInit.ts:924-975` (source `carreaux-mvt`, trois couches), `useMapLayers.ts:56-112` (expressions), `:148-610` (état, couleur, hauteur 3D, opacité, seau sélectionné), `components/map/LegendeCarte.tsx:1-656` (cadre + cas `carreaux`), `MapPanel.tsx:74-110` (badges).

**API :** `/api/tiles/{z}/{x}/{y}?v=<CARREAUX_TILE_VERSION>` (MapLibre, cookie). Aucune autre requête.

**Interfaces — Consumes :** T2 (`carreaux/*`, `CARREAUX_TILE_VERSION`, `R/logique/palettes-donnees.ts`), T3, T4 (registre). **Produces :**

```ts
@Injectable()
export class CarreauxService {
  readonly visible: WritableSignal<boolean>;
  readonly indicateur: WritableSignal<string>;         // 'population_totale'
  readonly palette: WritableSignal<string>;            // 'rouge'
  readonly opacite: WritableSignal<number>;            // 0.72
  readonly relief: WritableSignal<boolean>;            // 3D
  readonly hauteur: WritableSignal<number>;            // 1.5
  readonly seauSelectionne: WritableSignal<number | null>;
  readonly bornes: Signal<BornesEchelle | null>;
}
```

`LegendeCarteComponent` : entrée `degradeActif` + un `@switch` par dégradé ; ce lot n'implémente QUE le cas `carreaux` et le bloc « POI » vide ; chaque tâche de couche ajoute son cas. Les groupes « Campagne active » (absent sans campagne, B6) et « Mes analyses » (rempli en T18) sont posés vides.

**Pièges :** allumer les carreaux appelle `etat.basculerDegrade('carreaux', true)` ET s'abonne `surEviction('carreaux', () => visible.set(false))` ; changer d'indicateur = `setPaintProperty` seulement, ZÉRO requête ; changer d'indicateur ou de palette ne recrée pas la source (pas de rechargement de tuiles) ; la hauteur 3D est en multiples de maille (mémoire `project_carreaux_3d_et_xss_popups.md`) ; les couleurs de données viennent de `PALETTES_DONNEES` (A10), celles d'interface de `CouleursService`.

- [ ] **Step 1: Specs (échec)** — service avec carte factice : visible → `addSource('carreaux-mvt', { tiles: [<origine>/api/tiles/{z}/{x}/{y}?v=…] })` + 3 couches ; indicateur changé → `setPaintProperty`, `addSource` non rappelé ; recréation de carte → re-pose ; éviction → `visibility: none` ; Tout effacer → masqué. Panneau : six titres de groupe dans l'ordre React (« Campagne active » absent), état replié relu depuis `localStorage` (clé de `use-filter-sections.ts`), `localStorage` qui lève → groupes par défaut ; « Actifs (n) » compte 1 quand les carreaux sont allumés. Légende : cas `carreaux` rend le titre de l'indicateur et les seaux.
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; build.**
- [ ] **Step 5: Navigateur** — carreaux allumés aux zooms 5, 7, 8, 10 et 12 (Marseille) : badge de palier, couleurs et légende égaux à React ; changer d'indicateur → onglet Réseau sans requête autre que des tuiles ; 3D allumée. Captures `T6-carreaux-z{5,8,12}-{theme}-{react,angular}.png` + panneau Calques replié/déplié.
- [ ] **Step 6: Commit** — `feat(angular): panneau Calques — groupes, carreaux Filosofi et légende (lot 4, T6)`.

---

### Task 7: IRIS — section, couche en cascade, panneau de détail

**Files:**
- Create: `C/panneaux/calques/section-iris.component.ts` (+ spec), `C/couches/iris.service.ts` (+ spec), `C/couches/detail-iris.component.ts` (+ spec), `C/data/iris.api.ts` (+ spec)
- Modify: `C/legende/legende-carte.component.ts` (cas `iris`), `C/carte.page.html`, `app.routes.ts` (`IrisApi`)

**Sources React :** `filter-panel/IrisSection.tsx:1-280`, `useMapInit.ts:835-920` (source `iris-source`, `iris-fill`/`iris-border`/`iris-extrusion`, `minzoom: IRIS_ZOOM_PLANCHER`), `useMapLayers.ts:177-200,617-860` (couleur, hauteur, palette, opacité, `setIrisVisible` qui remonte la caméra au plancher, `zoomCourant`, bornes l.833-868), `_hooks/useIrisDetail.ts:1-76`, `IrisDetailPanel.tsx:1-224`, `page.tsx:1436-1453`.

**API :** `/api/tiles/iris/{z}/{x}/{y}?v=<IRIS_TILE_VERSION>` (MapLibre), `/api/iris/bornes` (UNE fois par écran), `/api/iris/detail?code=` (au clic).

**Interfaces — Produces :** `IrisApi.bornes(): Observable<BornesIris>`, `IrisApi.detail(code: string): Observable<IrisDetailData>` (type recopié de `IrisDetailPanel.tsx`) ; `IrisService` (mêmes champs que `CarreauxService` + `vraisSeulement: WritableSignal<boolean>` défaut `false`, `zoomCourant: Signal<number|null>`, `niveau: Signal<'departement'|'commune'|'iris'|null>` = `niveauAuZoom(Math.floor(zoom))`).

**Pièges :** sous `minzoom`, MapLibre ne demande AUCUNE tuile et n'émet aucune erreur : allumer remonte la caméra au plancher, et la section affiche le bandeau « sous le plancher » (texte React) ; « vrais IRIS uniquement » décoché par défaut et filtré sur `niveau = 'iris'` seulement ; 1 colonne à la fois = l'indicateur change l'expression, ZÉRO requête ; IRIS évince carreaux et réciproquement ; le panneau de détail est en `absolute` à droite (320 px) sans `box-shadow` (flat total — React en a une : défaut listé, ou parité ? → PARITÉ, ombre gardée et listée comme écart au DESIGN_SYSTEM hérité).

- [ ] **Step 1: Specs (échec)** — bornes demandées une fois pour trois allumages ; allumer à z5 → `easeTo`/`jumpTo` vers `IRIS_ZOOM_PLANCHER` ; indicateur changé → aucune requête HTTP ; IRIS allumé alors que carreaux l'est → carreaux évincés + annonce ; clic `iris-fill` → `detail(code)` puis panneau rempli ; fermer → vidé ; vrais IRIS → filtre `['any', ['!=', ['get','niveau'], 'iris'], ['==', ['get','is_true_iris'], true]]` (lire l'expression React exacte et la recopier).
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; build.**
- [ ] **Step 5: Navigateur** — `pop_15_29` aux zooms 5, 7, 9 (Paris), palier annoncé, légende log10, clic sur un IRIS parisien → mêmes valeurs que React ; Réseau : `/api/iris/bornes` une fois. Captures `T7-iris-z{5,7,9}-{theme}-…` + détail.
- [ ] **Step 6: Commit** — `feat(angular): IRIS — section, couche en cascade et panneau de détail (lot 4, T7)`.

---

### Task 8: POI, transport, OOH et tiroir des panneaux

**Files:**
- Create: `C/panneaux/calques/{section-poi,section-transport,section-ooh}.component.ts` (+ specs), `C/couches/{pois,ooh,transport}.service.ts` (+ specs), `C/couches/tiroir-panneau.component.ts` (+ spec), `C/data/carte.api.ts` (+ spec)
- Modify: `C/legende/legende-carte.component.ts` (bloc catégories POI), `angular/scripts/ecrire-config.mjs` + `core/config` (champ optionnel `googleMapsKey`, B17), `app.routes.ts` (`CarteApi`)

**Sources React :** `filter-panel/PoiSection.tsx:1-251`, `use-poi-catalog.ts:1-106`, `use-poi-styles.ts:1-34`, `poi-style.ts`, `_hooks/useMapDirectActions.ts` (parties `handleDirectSearch`, `handleDirectOOH` — LIRE le fichier en entier et ne prendre que ces deux chemins), `_hooks/useMapMarkers.ts:1-206`, `useMapInit.ts:42-100` (canevas des rayons), `:223-360` (heatmap `pois-heat`, `pois-circles` z≥11, popup), `page.tsx:487-500` (transport sur la bbox visible), `TransportSection.tsx:1-92`, `OohSection.tsx:1-86`, `MapPanel.tsx:232-352` (tiroir Street View), `LegendeCarte.tsx` (catégories).

**API :** `POST /api/map/pois` (corps EXACT de `useMapDirectActions`, avec `bbox` SEULEMENT si `bboxPourRequete(filtre)` est défini), `/api/map/categories` (une fois), `POST /api/map/ooh` (même règle de bbox), `/api/map/transport?west=&south=&east=&north=&types=` (bbox de la carte VISIBLE, `toFixed(4)`).

**Interfaces — Produces :** `CarteApi.pois(corps): Observable<ZoneData>`, `categories(): Observable<…>`, `ooh(corps)`, `transport(b: Bbox, types: string[])`, `poiNatures(cat)`, `territoryMask(…)` (types recopiés de `types/spatial.ts`, `types/poi.ts`, `types/map.ts`) ; `PoisService.zone: Signal<ZoneData | null>` (l'équivalent de `zoneData`, partagé par POI/transport/OOH comme React), `modeDensite: WritableSignal<boolean>` (`genesis_density_mode`), `styles: WritableSignal<POIStylesMap>`, `panneauSelectionne: WritableSignal<SelectedBillboard | null>`.

**Pièges :** `maplibregl.Marker` = DOM dans le conteneur (B16) : les créer par `document.createElement` du DOCUMENT de la carte, jamais un composant Angular dynamique ; supprimer TOUS les marqueurs au changement de zone et à « Tout effacer » ; heatmap ≠ marqueurs selon `modeDensite` ; le canevas des rayons se redessine sur `moveend`/`zoomend`/`idle` ; popup par `contenuPopup` (jamais d'HTML concaténé — XSS fermé au lot 2) ; Street View : `iframe` dans la racine d'ombre, sans clé → bandeau qui NOMME `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.

- [ ] **Step 1: Specs (échec)** — sans filtre : corps `pois` SANS `bbox` ; filtre zone avec bbox → `bbox` = celle de la zone ; filtre `france` → sans `bbox` ; filtre département → `BBOX_METRO` ; catégories lues une fois ; transport : bbox de la carte factice formatée `toFixed(4)` ; mode densité → couche `pois-heatmap` visible, zéro marqueur ; changement de zone → anciens marqueurs `remove()` ; clic sur un panneau OOH → tiroir ouvert, sans clé → bandeau.
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; build.**
- [ ] **Step 5: Navigateur** — POI `lycee` sur le filtre département 13 : même nombre de points et même cadrage que React ; mode densité ; transport sur Marseille ; OOH (1 434 actifs, relever le compte au cadre) ; clic sur un panneau. Captures `T8-{poi,densite,transport,ooh,tiroir}-{theme}-{react,angular}.png`.
- [ ] **Step 6: Commit** — `feat(angular): POI, transport, OOH et tiroir des panneaux sur la carte (lot 4, T8)`.

---

### Task 9: TMJA et radio

**Files:**
- Create: `C/panneaux/calques/{section-tmja,section-radio,recherche-radio}.component.ts` (+ specs), `C/couches/{tmja,radio}.service.ts` (+ specs), `C/data/radio.api.ts` (+ spec)
- Modify: `C/legende/legende-carte.component.ts` (TMJA, radio), `app.routes.ts` (`RadioApi`)

**Sources React :** `TmjaSection.tsx:1-115`, `page.tsx:470-485,502-505` (sentinelle, filtre `>= 5000`), `useMapInit.ts:386-420` (`tmja-source`, `/api/tmja-tiles/{z}/{x}/{y}?v=v10`, `minzoom 5`), `RadioSection.tsx:1-299`, `RadioSearchInput.tsx:1-67`, `_hooks/useRadioLayer.ts:1-265`, `useMapInit.ts:422-600` (clusters, compte, points, heatmap, couverture, popups, zoom sur cluster).

**API :** `/api/tmja-tiles/…` (MapLibre), `/api/radio/emetteurs`, `/api/radio/filter-options` (une fois), `/api/radio/stations` (recherche).

**Pièges :** « Masquer < 5 000 véh/j » coché par défaut ; ⚠ 1 100 tronçons MESURÉS seulement (le proxy OSM a été abandonné) : les compter au cadre et les comparer à React, pas à la doc ; `getClusterExpansionZoom` est une PROMESSE en MapLibre 5 (React l'appelle en callback, `useMapInit.ts:575` — lire et choisir la forme qui marche en 5.18, la noter) ; les réglages de couverture radio (couleur, opacité, épaisseur, taille) sont des réglettes : `setPaintProperty` au relâchement ; la couleur de couverture choisie par l'utilisateur est une DONNÉE (B12).

- [ ] **Step 1: Specs (échec)** — TMJA : allumer → source posée une fois, filtre `['>=', ['get','tmja'], 5000]`, décocher → `null` ; radio : options lues une fois, recherche → `stations?q=` anti-rebond (durée de `RadioSearchInput.tsx`), sélection d'une radio → émetteurs filtrés, couverture ; mode heatmap → couches clusters masquées ; réglettes → zéro requête.
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; build.**
- [ ] **Step 5: Navigateur** — TMJA sur l'Île-de-France ; radio : clusters France, une radio sélectionnée (couverture), heatmap. Comptes « N émetteurs » égaux à React. Captures `T9-{tmja,radio-clusters,radio-couverture,radio-heatmap}-{theme}-…`.
- [ ] **Step 6: Commit** — `feat(angular): flux routier TMJA et radio FM/DAB+ (lot 4, T9)`.

---

### Task 10: Indicateurs civiques et santé environnementale

**Files:**
- Create: `C/panneaux/calques/{section-civique,section-sante}.component.ts` (+ specs), `C/couches/{indicateurs-civiques,sante}.service.ts` (+ specs), `C/data/civique.api.ts` (+ spec)
- Modify: `C/legende/legende-carte.component.ts` (`civic-indicateurs`, `civic-sante`), `app.routes.ts`

**Sources React :** `CivicIndicatorsSection.tsx:1-100`, `CivicIndicatorsLayer.tsx:1-259`, `CivicHealthSection.tsx:1-318`, `use-civic-ingest.ts:1-94`, `CivicHealthMapLayer.tsx:1-440`, `page.tsx:384-394` (états civiques), `:1244-1255` (couche santé et ses rappels).

**API :** `/api/insee-variables/[code]/geojson?bbox=` (bbox VISIBLE), `/api/insee-variables/cp-detail?cp=` (popup), `/api/civic-indicators/health-map?dataset=&scale=departement` (**NDJSON**, `lignesNdjson` du lot 3 + `observe:'events'`), `?scale=cp&metric=&min_level=&bbox=` (bbox SEULEMENT si filtre, `bboxPourRequete`), `POST /api/admin/civic-ingest` (NDJSON, super_admin seulement — React l'affiche à qui ? LIRE `CivicHealthSection.tsx` et reproduire la même condition).

**Pièges :** NDJSON par `HttpClient` (A9 du lot 3) — la progression `{done,total}` avance ligne à ligne ; `pollen_map_daily` s'arrête au 2026-09-17 : au code postal, statut `no_data` + date, message EXACT de React, jamais une carte vide muette ; changer de jeu (pollen ↔ air) remet la métrique à `global` et la progression à `null` (`page.tsx:1023-1027`) ; deux dégradés distincts (`civic-indicateurs`, `civic-sante`).

- [ ] **Step 1: Specs (échec)** — flux factice de 3 lignes → progression 1/3, 2/3, 3/3 puis couche peinte ; `scale=cp` sans filtre → pas de `bbox` ; avec filtre département → `bbox=BBOX_METRO` ; réponse `no_data` → message daté ; indicateur civique évince IRIS ; ingestion : bouton visible seulement sous la condition React.
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; build.**
- [ ] **Step 5: Navigateur** — un indicateur civique sur le département 13 ; pollen et air à la maille département (progression jusqu'au bout) ; pollen au code postal → message daté du 2026-09-17. Captures `T10-{civique,pollen-dept,air-dept,pollen-cp}-{theme}-…`. Ne PAS lancer l'ingestion (écrit en base) sauf sur décision explicite.
- [ ] **Step 6: Commit** — `feat(angular): indicateurs civiques et santé environnementale (lot 4, T10)`.

---

### Task 11: Météo — section, dialogue de configuration, couche

**Files:**
- Create: `C/panneaux/calques/{section-meteo,dialogue-meteo}.component.ts` (+ specs), `C/couches/meteo.service.ts` (+ spec), `C/data/meteo.api.ts` (+ spec)
- Modify: `C/legende/legende-carte.component.ts` (`meteo`), `C/carte.page.html`, `app.routes.ts`

**Sources React :** `MeteoSection.tsx:1-82`, `_hooks/useMeteoLayer.ts:1-186`, `app/map/analyse/digital/_components/MeteoGeoPanel.tsx:1-450`, `page.tsx:1456-1488` (modale : reste ouverte pendant le chargement et en erreur, fermée au succès, `onDegrade('meteo', true)` au succès), `useMapInit.ts:362-385` (`meteo-source`), `lib/meteo/*` (copiés T2).

**API :** `/api/meteo-geo?…` (NDJSON, paramètres de `lib/meteo/requete.ts` : bbox arrondie au demi-degré, bbox SEULEMENT si filtre), `/api/meteo-geo/zones?scale=` (polygones, cache par échelle — réutiliser `ReferentielApi.contours` du lot 3 si sa signature couvre `cp` ; sinon l'ajouter dans `meteo.api.ts`, et le dire).

**Pièges :** la modale est un `<dialog>` (B13), Échap la ferme ET doit dépiler son entrée de pile (`'meteo'`) ; « Effacer la météo » = `basculerDegrade('meteo', false)` + vidage ; le quota serveur `geo:rl:meteo-geo` est de 20/min : jamais d'appel automatique au déplacement de carte (React n'en fait pas).

- [ ] **Step 1: Specs (échec)** — appliquer → flux NDJSON, progression, couche peinte, dialogue fermé, dégradé `meteo` actif ; échec → dialogue ouvert avec le message ; Échap dans le dialogue → fermé, carte intacte ; changement de fond → re-pose.
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; build.**
- [ ] **Step 5: Navigateur** — température, maille département, 7 derniers jours : mêmes couleurs et légende que React ; maille code postal sur le filtre département 13. Captures `T11-{dialogue,meteo-dept,meteo-cp}-{theme}-…`.
- [ ] **Step 6: Commit** — `feat(angular): météo — dialogue de configuration et couche (lot 4, T11)`.

---

### Task 12: Risque industriel — section, sites ICPE, périmètres PPRT

**Files:**
- Create: `C/panneaux/calques/section-risque.component.ts` (+ spec), `C/etat/risque-carte.service.ts` (+ spec), `C/couches/{risques-industriels,pprt}.service.ts` (+ specs)
- Modify: `R/data/sites-risque.api.ts` (méthode `carte(bbox, filtres)` pour `/api/map/risques-industriels` si absente — LIRE avant ; la spec existante reste inchangée), `C/data/carte.api.ts` (`pprt(bbox, types, limite)`, `poiNatures('risque_industriel')`), `C/legende/legende-carte.component.ts` (risques, PPRT)

**Sources React :** `filter-panel/RisqueIndustrielSection.tsx:1-695`, `use-risque-industriel.ts:1-100`, `RisqueIndustrielLayer.tsx:1-581`, `PprtLayer.tsx:1-284`, `page.tsx:1187-1214` (montage des deux couches), `LegendeCarte.tsx` (cas risques, `risquesCompte`, `pprtActif`).

**API :** `/api/map/risques-industriels?bbox=&gravites=&natures=&inclure_inactifs=&rayon_m=&limite=` (bbox VISIBLE, rechargée au `moveend` par `chargerParCadre` — 350 ms, annulation), `/api/map/pprt?bbox=&types=&limite=` (plancher `PPRT_ZOOM_PLANCHER` = 8 : sous z8, aucune requête et bandeau), `/api/map/poi-natures?categorie=risque_industriel`.

**Interfaces — Produces :** `RisqueCarteService` (recopie de `EtatRisqueIndustriel`, en signaux : `actif`, `niveaux` défaut `['seveso_haut','seveso_bas']`, `typesRisque` défaut `[]`, `inclureInactifs`, `rayonM` défaut 0, `afficherHalo` défaut `true`, `compte`, `pprtActif`, `pprtTypes`, `pprtEtat`, `filtres: Signal<FiltresRisque>`).

**Pièges :** couleurs par type de risque via `JETON_TYPE` + `CouleursService` (jamais `COULEURS_MAPLIBRE`), contour de point `--point-actif-contour` ; `n_total` compte AVANT la limite, la limite coupe les MOINS graves : la légende dit « N sur M » comme React ; tireté = zone calculée, plein = servitude (`R/logique/nature-zone.ts`) ; un panoramique rapide avec inertie peut émettre deux `moveend` espacés de plus de 350 ms (constat du lot 2) — accepté ; le bouton « Analyser la population à risque → » est posé ici mais câblé en T13 (désactivé jusque-là, `title` « Disponible prochainement »).

- [ ] **Step 1: Specs (échec)** — défaut : une requête au `moveend` avec `gravites=seveso_haut,seveso_bas`, sans `natures` ; cocher un type → `natures` = libellés du type ; rayon 500 → `rayon_m=500` ; deux `moveend` rapprochés → une requête (l'autre annulée) ; PPRT sous z8 → zéro requête et bandeau ; bascule de thème → `setPaintProperty`, aucun `addSource`.
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; build.**
- [ ] **Step 5: Navigateur** — défaut Seveso au cadre France puis Étang de Berre z9 : « N sites » égal à React (référence : 1 327 Seveso au total) ; rayon 500 m ; PPRT z8 sur l'Étang de Berre (126 zones, à relever) ; popup d'un site. Captures `T12-{france,berre,rayon,pprt,popup}-{theme}-…`.
- [ ] **Step 6: Commit** — `feat(angular): risque industriel — section, sites ICPE et périmètres PPRT (lot 4, T12)`.

---

### Task 13: Module risque intégré à la carte — route enfant, natures, « Voir sur la carte », jeux de zones

**Files:**
- Create: `C/couches/zones-risque.service.ts` (+ spec), `C/etat/pont-carte.ts` (jeton `PONT_CARTE`), `R/exports/bouton-voir-carte.component.ts` (+ spec), `C/panneaux/zones/jeux-de-zones.component.ts` (+ spec)
- Modify: `app.routes.ts` (enfant `risques` de `carte` ; `risques` racine → `redirectTo: 'carte/risques'`), `C/carte.page.{ts,html}` (`<router-outlet>` en surimpression `absolute inset-0 z-[60]`, fourniture de `PONT_CARTE`), `R/risque.page.{ts,html}` (bouton « Voir sur la carte » dans l'en-tête, `inject(PONT_CARTE, { optional: true })`), `C/panneaux/calques/section-risque.component.ts` (« Analyser la population » actif), `features/accueil/accueil.page.*` et `layout/navigation.ts` (lien « Module risque » → `carte/risques`), `angular/src/app/remote.spec.ts`, `app.config.spec.ts`, `R/risque.page.spec.ts`, `ARCHITECTURE.md`, feuille de route (A6 et A7 du lot 3 levés)

**Sources React :** `page.tsx:220-240` (`ouvrirJeuDeZones` : URL écrite AVANT de monter l'overlay), `:1197-1206` (montage de l'overlay), `components/risques/BoutonVoirCarte.tsx:1-108`, `AnalysePopulationOverlay.tsx:582-588,960-975`, `app/map/_components/ZonesRisqueLayer.tsx:1-239`, `panneaux/JeuxDeZonesRail.tsx:1-131`, `RisqueIndustrielSection.tsx:492-516`. Angular : `R/risque.page.ts:195-210` (`fermer`), `R/cartes/couches-zones.ts` (à RÉUTILISER pour la couche de `/map`), `R/data/zones-risque.api.ts` (`preparer`, `urlTuilesZones`).

**Interfaces:**

```ts
export interface PontCarte {
  /** Prépare puis allume les zones du profil sur la carte principale ; `null` éteint. */
  afficherZonesRisque(d: { profil: ProfilRayons; natures: string[]; recadrer?: Bbox } | null): void;
}
export const PONT_CARTE = new InjectionToken<PontCarte>('PONT_CARTE');
// CartePage : providers: [..., { provide: PONT_CARTE, useExisting: ZonesRisqueService }]
// ZonesRisqueService implements PontCarte ; réclame le dégradé 'zones-risque' (B3)
// Navigation vers le module : router.navigate(['risques'], { relativeTo: route, queryParams: { risque } })
```

Formule de `natures` (B4) — recopiée de `AnalysePopulationOverlay.tsx:582-588` :

```ts
export function naturesDesTypes(types: readonly string[]): string[] {
  const n = types.flatMap((t) => librellesDuType(t as TypeRisque, FAMILLES_ICPE_SEED));
  if (types.includes('non_precise')) n.push(NATURE_NON_PRECISEE);
  return n;
}
```

**Pièges :** la route enfant NE DOIT PAS recréer `CartePage` (même instance avant/après ouverture et fermeture du module — spec) ; l'outlet est en `absolute`, jamais `fixed` ; la carte permanente du module (lot 3) et la carte principale coexistent : vérifier la mémoire (Gestionnaire de tâches Chrome) et noter la mesure ; Échap dans le module ferme le MODULE (son hôte gère Échap, lot 3) et ne doit pas fermer en plus le panneau de la carte — `preventDefault` + test ; `redirectTo` garde les paramètres de requête (spec) ; « Voir sur la carte » passe `natures` (défaut React corrigé, B3) et réclame `zones-risque` (défaut React corrigé : `ZonesRisqueLayer` ne le réclamait jamais, la légende ne pouvait pas le montrer) ; profil sans anneau → bouton désactivé avec le `title` React ; `preparer` rend `classes: 0` → message React.

- [ ] **Step 1: Specs (échec)** — `naturesDesTypes(['toxique','non_precise'])` = libellés du seed + `Nature non précisée` ; Calques « Analyser » avec `?risque=etape%3Drayon` dans l'URL → navigation `carte/risques?risque=etape%3Drayon%26natures%3D…` (encodage `ecrireEtatUrl`) ; ouvrir puis fermer le module → `CartePage` même instance, fabrique de carte principale appelée 1 fois ; `/app/risques?risque=etape%3Dzones` → redirigé vers `/app/carte/risques?risque=etape%3Dzones` ; dans `RisquePage` sous la carte : bouton présent ; sous un injecteur sans pont : absent ; clic → `preparer(code, natures)` puis `afficherZonesRisque` puis navigation `['..']` ; `ZonesRisqueService` : `addSource` avec `urlTuilesZones(code, natures)`, dégradé `zones-risque` réclamé (IRIS évincé), `null` → couches retirées ; jeux de zones : liste de `/api/zones/jeux`, clic → `carte/risques?risque=etape%3Dzones%26jeu%3D<id>`.
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; build ; specs du lot 3 TOUTES vertes.**
- [ ] **Step 5: Navigateur** — parcours : Calques › cocher « Toxique » › Analyser → module ouvert, `natures` dans l'URL, mêmes chiffres que React avec le même type coché (React passe `typesRisque` en prop : comparer le bandeau KPI) ; « Voir sur la carte » → module fermé, zones peintes sur `/map`, légende « Zones de risque » ; « Retour » du navigateur : une seule entrée par geste ; Zones › Jeux de zones › jeu `0b7ece33…` → étape ④ ; légende du module « N sites affichés » : relever si l'écart « 54 contre 55 » du lot 3 (A6) a disparu. Captures `T13-{module-sur-carte,zones-sur-carte,jeux}-{theme}-…`.
- [ ] **Step 6: Doc + commit** — `ARCHITECTURE.md` : B2, B3, B4, route enfant ; feuille de route : A6 et A7 du lot 3 levés. Commit `feat(angular): module risque intégré à la carte — route enfant, natures, « Voir sur la carte », jeux de zones (lot 4, T13)`.

---

### Task 14: Panneau Zones — mes zones, opérations, lien `customZone`, script DV360

**Files:**
- Create: `C/panneaux/zones/{panneau-zones,mes-zones,operations-zones}.component.ts` (+ specs), `C/couches/zones-custom.service.ts` (+ spec)
- Modify: `C/data/zones-custom.api.ts` (`stats`, `geometrie`, `renommer`, `supprimer`, `intersection`, `difference`, `composite`, `exporter`), `C/carte.page.{ts,html}` (lecture de `customZone`, bouton « Script bidding DV360 »)

**Sources React :** `panneaux/PanneauZones.tsx:1-161`, `components/map/overlays/ZonesOverlay.tsx:1-624`, `ZonesOperations.tsx:1-219`, `page.tsx:771-839` (`?customZone=` : géométrie, `fitBounds` padding 60, alimentation du créneau de bataille), `:1377-1400` (bouton script DV360 quand `battleCacheKey` commence par `cg__`), `lib/custom-geo/download-export.ts`, `page.tsx:700-716` (« Tout effacer » retire les couches `custom-zone-*`).

**API :** `/api/custom-geo/list`, `/stats`, `/[id]/geometry`, `PATCH /api/custom-geo/[id]` (renommer — lire la route), `DELETE` (lire), `/source/intersection`, `/source/difference`, `/source/composite`, `/[id]/export?…` (blob, `enregistrerFichier` du lot 3).

**Pièges :** sources `custom-zone-<id>` créées dynamiquement : « Tout effacer » les retire toutes ; afficher une zone notifie le plan média (T15) — exposer `zonesAffichees: Signal<{id,name}[]>` ; 409 sur une intersection vide → message React, aucune zone créée ; les opérations ÉCRIVENT : sur zones jetables `[ESSAI lot 4]` seulement ; le lien `customZone` est lu UNE fois, quand la carte est prête (garde `customZoneLoadedRef`).

- [ ] **Step 1: Specs (échec)** — afficher deux zones → deux sources, `zonesAffichees` de longueur 2 ; masquer → retirées ; Tout effacer → aucune source `custom-zone-` ; intersection 409 → message, aucune requête de sauvegarde ; `?customZone=<id>` → `geometry` appelé une fois, `fitBounds` avec la bbox calculée ; bouton DV360 présent seulement si la zone vient du lien.
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; build.**
- [ ] **Step 5: Navigateur** — liste égale à React (org active), afficher « CIRFA BRETAGNE », intersection et différence sur deux zones jetables (créées en T16 ou par SQL), `?customZone=` d'une zone existante, export DV360 (fichier ouvert). Nettoyer les jetables, vérifier par SQL. Captures `T14-{liste,zone-affichee,operations}-{theme}-…`.
- [ ] **Step 6: Commit** — `feat(angular): panneau Zones — mes zones, opérations booléennes, lien customZone et script DV360 (lot 4, T14)`.

---

### Task 15: Plan média des zones affichées

**Files:**
- Create: `C/panneaux/zones/plan-media.component.ts` (+ spec), `C/logique/zones/plan-media.ts` (+ spec, logique de calcul extraite du composant React si elle y vit — LIRE)
- Modify: `C/data/zones-custom.api.ts` (`totauxNationaux`, `audienceItems`, `planMedia` GET/POST/DELETE, `instantane`), `C/carte.page.html` (panneau droit 600 px, bouton « Plan média (n) » quand replié, décalage des boutons flottants `page.tsx:1121-1126`)

**Sources React :** `ZoneMediaPlanPanel.tsx:1-669`, `lib/custom-geo/media-plan.ts:1-46`, `page.tsx:395-406` (ouverture automatique à la première zone, fermeture quand plus rien), `:1215-1243` (panneau et bouton de réouverture).

**API :** `/api/custom-geo/national-totals` (une fois), `/api/custom-geo/[id]/items-audience`, `/api/custom-geo/media-plan` (GET/POST/DELETE), `/api/custom-geo/media-plan/snapshot`, `/api/digital/campaigns` (si le panneau rattache à une campagne — lire).

**Pièges :** largeur `PANEL_WIDTH` (lire la constante), en `absolute` à droite ; les boutons flottants s'écartent du panneau (`min(…, calc(100% - 60px))` — en `%` de l'hôte et non `vw`, l'hôte n'est pas la fenêtre dans un shell : écart d'unité justifié) ; budget/CPM/cible : champs numériques, calcul client recopié et testé ; rattacher à une campagne ÉCRIT : sur une campagne de démonstration seulement, défait en fin de tâche.

- [ ] **Step 1: Specs (échec)** — première zone affichée → panneau ouvert ; zéro zone → fermé ; budget 10 000 €, CPM 5 € → impressions affichées égales au calcul React (recopier la formule et ses arrondis) ; « % France » depuis les totaux nationaux, appelés une fois.
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; build.**
- [ ] **Step 5: Navigateur** — deux zones affichées, même budget/CPM/cible que React : chaque cellule égale. Captures `T15-plan-media-{theme}-{react,angular}.png`.
- [ ] **Step 6: Commit** — `feat(angular): plan média des zones affichées (lot 4, T15)`.

---

### Task 16: Créer une zone — codes postaux, rayon, dessin, capture des couches

**Files:**
- Create: `C/panneaux/zones/{creer-codes-postaux,creer-rayon,creer-dessin,capture}.component.ts` (+ specs), `C/couches/dessin.service.ts` (+ spec), `C/etat/capture.service.ts` (+ spec)
- Modify: `C/data/zones-custom.api.ts` (`depuisCodesPostaux` JSON et multipart via `FormData`, `depuisRayon`, `depuisDessin`, `enregistrer`, `capturer`, `source(type, corps)`), les services de couche des tâches 6-12 et 17 (chacun DÉCLARE sa source contributive au `CaptureService`, comme `useCustomGeoCaptureContext`)

**Sources React :** `panneaux/CreerZoneCodesPostaux.tsx:1-237`, `CreerZoneRayon.tsx:1-315`, `CreerZoneDessin.tsx:1-180`, `DessinLibre.tsx:1-215`, `components/custom-geo/CustomGeoCaptureModal.tsx:1-615`, `CustomGeoCaptureButton.tsx:1-85`, `lib/custom-geo/{CustomGeoCaptureContext.tsx,composition.ts,cibles.ts,source-type-labels.ts,useCustomGeoLayer.ts}`, `app/map/_components/CaptureLayers.tsx:1-315`.

**API :** `/api/custom-geo/source/{codes-postaux,rayon,dessin,carreaux,iris,radio,tmja,battle,voronoi,indicator-threshold,score,composite}`, `/api/custom-geo/save`, `/api/custom-geo/capture`.

**Dessin (B8)** — service maison sur MapLibre : modes `polygone` (clic = sommet, double-clic ou clic à moins de 8 px du premier sommet = fermer, `Backspace` = retirer le dernier), `rectangle` (deux clics opposés), `effacer` ; source GeoJSON `dessin-trace` + couches ligne/point/remplissage, couleurs par `CouleursService` (`brand-teal`) ; `dragPan` désactivé pendant le tracé, réactivé à la fin ; le tracé fini part tel quel à `/source/dessin`, qui le répare (`ST_MakeValid`) et rend `corrige` / `part_retenue` — affichés comme React.

**Pièges :** le dépôt de fichier de codes postaux passe en multipart (`FormData`) par `HttpClient` — sans fixer `Content-Type` à la main ; jusqu'à 2 000 CP, rejetés et inconnus listés SÉPARÉMENT (texte React) ; rayon borné à 100 km, `part_retenue` affichée avant enregistrement ; la capture énumère les couches ACTIVES (jusqu'à 11 sources) — chaque service de couche la déclare, aucune liste en dur ; tout enregistrement ÉCRIT : noms `[ESSAI lot 4] …`, supprimés en fin de tâche, vérifiés par SQL.

- [ ] **Step 1: Specs (échec)** — CP collés `13001, 13002, 99999, abc` → requête JSON, affichage « 2 retenus, 1 inconnu, 1 rejeté » à partir d'une réponse factice ; fichier → `FormData` avec le champ attendu par la route ; rayon 20 km à Marseille → `{lon,lat,rayon_m:20000}` ; dessin : 3 clics + double-clic → polygone fermé de 4 positions, `Backspace` retire un sommet, rectangle → 5 positions ; capture : carreaux et IRIS allumés → deux sources proposées.
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; build.**
- [ ] **Step 5: Navigateur** — créer une zone par CP, par rayon (Marseille 20 km : `part_retenue` 60,5 % comme la doc et React), par dessin (polygone croisé → `corrige`), par capture des carreaux ; enregistrer ; supprimer ; SQL de contrôle. Captures `T16-{cp,rayon,dessin,capture}-{theme}-…`.
- [ ] **Step 6: Commit** — `feat(angular): créer une zone — codes postaux, rayon, dessin maison et capture des couches (lot 4, T16)`.

---

### Task 17: Panneau Analyse I — garde de périmètre, batailles d'isochrones, Voronoï inerte

**Files:**
- Create: `C/panneaux/analyse/{panneau-analyse,outil-isochrones,outil-bataille-v2,intro-analyse}.component.ts` (+ specs), `C/couches/bataille.service.ts` (+ spec), `C/data/isochrones.api.ts` (+ spec), `tests/unit/angular/panneau-analyse-garde.test.ts`
- Modify: `C/legende/legende-carte.component.ts` (isochrones, bataille, palier max), `app.routes.ts`

**Sources React :** `panneaux/PanneauAnalyse.tsx:1-472`, `filter-panel/SpatialAnalysisIntro.tsx:1-66`, `IsochronesTool.tsx:1-288`, `BattleV2Tool.tsx:1-276`, `VoronoiTool.tsx:1-69` (rendu à l'identique, INERTE — B5), `use-isochrone-battle.ts:1-354`, `use-territory-selection.ts` (dérivation `filtreVilleBattle`/`filtreRegionsBattle`/`filtreDeptsBattle`), `_hooks/useMapDirectActions.ts` (batailles), `useMapInit.ts:735-741,978-1060`, `useMapLayers.ts:1029-1186`, `tests/unit/carte/panneau-analyse-garde.test.ts` (modèle du test structurel).

**API :** `POST /api/isochrone-battle` (route PROTÉGÉE — appelée, jamais modifiée ; flux : lire le corps de réponse React), `POST /api/isochrone-battle-v2`, `POST /api/isochrone-battle/apply-battle`, `GET/POST /api/isochrone-cache-check`.

**Pièges :** SIX points de lancement gardés (`messageGardeOutil`) — `bataille_v1`, `bataille_v2`, `application_bataille` ici, `voronoi` inerte (garde quand même écrite), `clustering` en T19-T20, `score_composite` en T18 ; le test structurel lit le SOURCE Angular (`readFileSync`) et vérifie que chaque gestionnaire de lancement appelle `verifierPerimetreOutil('<outil>')` AVANT son appel d'API — un test qui exercerait une façade ne verrait pas un câblage nu (en-tête de `garde-perimetre.ts`) ; exclusion mutuelle des trois outils (chacun ferme les deux autres) ; palettes et opacités de bataille = B12 ; « Périmètre national » → refus qui NOMME l'outil ; un flux de bataille occupe une place du limiteur : voulu.

- [ ] **Step 1: Specs (échec)** — `panneau-analyse-garde.test.ts` (racine) : pour chaque outil de `HANDLERS_GARDE_OUTIL`, le gestionnaire nommé contient `verifierPerimetreOutil('<outil>')` avant `this.api.` ; sans filtre → message `Choisissez un périmètre (filtre ou zone) avant de lancer un calcul`, zéro requête ; filtre `france` → « La bataille isochrone ne peut pas être calculée sur la France entière — choisissez une région ou un département. », zéro requête ; filtre département 13 + 2 POI → requête avec le territoire dérivé ; bataille rendue → sources `battle-rings`/`battle-borders`/`battle-pois` peintes, palier max réglable ; Voronoï `aria-disabled`.
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; build.**
- [ ] **Step 5: Navigateur** — filtre département 13, deux CIRFA : bataille V1 depuis le cache (relever `isochrones_cache` = 1 877) puis V2, application ; mêmes anneaux, couleurs, légende que React. Captures `T17-{garde,bataille-v1,bataille-v2,application}-{theme}-…`.
- [ ] **Step 6: Commit** — `feat(angular): panneau Analyse — garde de périmètre et batailles d'isochrones (lot 4, T17)`.

---

### Task 18: Panneau Analyse II — score composite, corrélation, mes analyses

**Files:**
- Create: `C/panneaux/analyse/{outil-score,outil-correlation}.component.ts` (+ specs), `C/couches/score.service.ts` (+ spec), `C/panneaux/calques/mes-analyses.component.ts` (+ spec), `C/data/analyses.api.ts` (+ spec)
- Modify: `C/legende/legende-carte.component.ts` (`score`), `C/panneaux/calques/panneau-calques.component.ts` (groupe « Mes analyses », chargé au premier dépliage), `app.routes.ts`

**Sources React :** `filter-panel/ScoreCompositeTool.tsx:1-439`, `ScoreMapLayer.tsx:1-304` (`SCORE_MAP_EVENT` remplacé par un appel de service — même règle « transition seulement » que `page.tsx:597-608`), `CorrelationTool.tsx:1-305`, `use-analyses.ts:1-73`, `PanneauCalques.tsx:642-715`.

**API :** `/api/cibles/indicators` (une fois), `POST /api/analyses/score` (périmètre `FiltreActif` complet, `france` ADMIS), `GET /api/analyses/correlation?campaignId=&variable=`, `/api/digital/campaigns` (liste, sans les simulations), `GET /api/analyses`, `GET/DELETE /api/analyses/[id]`, `POST /api/analyses/[id]/rejouer`, `POST /api/custom-geo/source/score` (« Créer une zone » depuis un score).

**Pièges :** le score évince le dégradé actif et s'éteint par `basculerDegrade('score', false)` (le défaut de pile synchrone de `page.tsx:545-568` disparaît avec les signaux — le DIRE au rapport, pas de ref à recopier) ; « scores sur N » doit valoir 6 187 en national (troncature PostgREST corrigée côté serveur, vérifier) et **127** sur le département 13 ; la couverture de la corrélation est affichée (CP appariés / touchés) ; supprimer une analyse ÉCRIT : jetables seulement.

- [ ] **Step 1: Specs (échec)** — score sur département 13 avec 2 indicateurs → corps exact, couche peinte, dégradé `score` ; filtre `france` → admis ; sans filtre → message de garde ; corrélation : `r`, `n`, couverture rendus ; mes analyses : premier dépliage → un appel, second → aucun ; « rejouer » d'un score → relance `POST /api/analyses/score` avec les paramètres rendus.
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; build.**
- [ ] **Step 5: Navigateur** — score `rev_median` + `part_15_29` sur le 13 (127 CP) et en national (6 187) : mêmes couleurs, même légende ; corrélation sur la campagne élections ; les 2 analyses listées. Captures `T18-{score-13,score-france,correlation,mes-analyses}-{theme}-…`.
- [ ] **Step 6: Commit** — `feat(angular): score composite, corrélation et mes analyses (lot 4, T18)`.

---

### Task 19: Clustering I — section, modèles, couche des clusters, panneau de résultats

**Files:**
- Create: `C/panneaux/analyse/clustering/{section-clustering,panneau-clusters}.component.ts` (+ specs), `C/couches/clusters.service.ts` (+ spec), `C/data/clustering.api.ts` (+ spec)
- Modify: `app.routes.ts`, `ui/icone/icones.ts` (icônes de `ClusterPanel.tsx`)

**Sources React :** `filter-panel/ClusteringSection.tsx:1-223`, `ClusterPanel.tsx:1-1075`, `page.tsx:438-470` (chargement à la première ouverture, durée), `:366-400` (trois effets séparés : aperçu, données, visibilité), `useMapInit.ts:762-830` (`clusters-source`, popup).

**API :** `/api/poi-clusters?duration=`, `/models`, `/models/[version]` (GET/DELETE), `/models/[version]/analysis`, `/generate-analysis`, `/[clusterId]`, `/poi/[poiId]`, `/history/[poiId]`, `/count`, `/france-averages`, `/model`.

**Pièges :** les trois synchronisations restent SÉPARÉES (une bascule de visibilité ne doit pas rejouer un `setData` de milliers de points) ; le radar de comparaison (moyennes France) : si `ClusterPanel` dessine un graphique, l'écrire sur `mg-courbe`/ECharts ou en SVG — LIRE d'abord, et le dire ; la relecture GET d'un modèle est gardée par `verifierPerimetre` générique (pas le refus national, `PanneauAnalyse.tsx` l'explique) ; supprimer un modèle ÉCRIT : jamais sur les 2 modèles existants.

- [ ] **Step 1: Specs (échec)** — première ouverture → `?duration=60` une fois, couche visible ; changer de durée → nouvelle requête ; bascule → `setLayoutProperty` seulement ; liste de 2 modèles ; détail d'un cluster.
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; build.**
- [ ] **Step 5: Navigateur** — les 2 modèles, clusters affichés, un cluster ouvert : mêmes valeurs que React. Captures `T19-{clusters,panneau,cluster}-{theme}-…`.
- [ ] **Step 6: Commit** — `feat(angular): clustering — modèles, couche et panneau de résultats (lot 4, T19)`.

---

### Task 20: Clustering II — assistant de calcul

**Files:**
- Create: `C/panneaux/analyse/clustering/assistant-clustering.component.ts` (+ spec)
- Modify: `C/data/clustering.api.ts` (`lancer`, `statut`, `typesPoi`), `C/couches/clusters.service.ts` (aperçu `wizard-highlight`)

**Sources React :** `ClusteringWizard.tsx:1-846`, `page.tsx:405-436` (aperçu des POI par `POST /api/map/pois`, best effort), `PanneauAnalyse.tsx` (relais de `verifierPerimetreClustering`).

**API :** `POST /api/poi-clusters/run` (corps validé Zod côté serveur — recopier le corps EXACT), `GET /api/poi-clusters/run?job=` (sondage : intervalle EXACT de React), `/api/poi-clusters/poi-types`.

**Pièges :** le lancement passe par `verifierPerimetreOutil('clustering')` (refus national) juste avant le POST — ajouter ce gestionnaire à `HANDLERS_GARDE_OUTIL` du test structurel de T17 ; 503 « script absent » affiché tel quel ; le sondage s'arrête à la destruction du composant (`DestroyRef`) et sur `done`/`failed` ; un run ÉCRIT des modèles : ne le lancer qu'avec accord explicite, sur un petit jeu (une catégorie, un département) et supprimer le modèle produit.

- [ ] **Step 1: Specs (échec)** — filtre `france` → refus nommé, zéro POST ; filtre département → POST au corps attendu ; sondage factice `pending → running → done` → arrêt et rechargement des modèles ; 503 → message ; destruction en cours → plus aucun sondage.
- [ ] **Step 2: FAIL. Step 3: Implémenter. Step 4: PASS ; build ; `panneau-analyse-garde.test.ts` vert avec le nouveau gestionnaire.**
- [ ] **Step 5: Navigateur** — assistant ouvert, aperçu des POI, refus national ; lancement seulement sur accord (sinon capturer l'état « prêt à lancer »). Captures `T20-{assistant,apercu,refus}-{theme}-…`.
- [ ] **Step 6: Commit** — `feat(angular): clustering — assistant de calcul et sondage du job (lot 4, T20)`.

---

### Task 21: Parcours complet du rail, parité finale, épreuve AIDA, documentation

**Files:**
- Modify: `ARCHITECTURE.md` (§ Application Angular : « Carte principale (lot 4) »), `docs/superpowers/plans/2026-09-29-transition-angular-feuille-de-route.md` (ligne lot 4 ✅ + section « À savoir pour les lots suivants (revue finale du lot 4) »)

- [ ] **Step 1: Parcours complet du rail, React et Angular côte à côte**, 1440 × 900, deux thèmes : (1) arrivée sur la carte ; (2) Filtre › département 13 ; (3) Calques › carreaux puis IRIS (éviction + annonce) ; (4) POI lycées + transport ; (5) TMJA + radio ; (6) santé env. pollen département ; (7) météo ; (8) risque industriel + PPRT + « Analyser » → module → « Voir sur la carte » → Fermer ; (9) Analyse › bataille V2 puis score composite ; (10) Zones › créer par rayon (jetable), afficher, plan média, supprimer ; (11) Réglages › fond « Clair » (tous les calques encore là) ; (12) Aide ; (13) mode immersif + Échap ; (14) Tout effacer. Tableau final « étape → chiffre React → chiffre Angular » (tous égaux) ; liste des défauts React corrigés (B3 ×2, et ceux trouvés en route) ; écarts restants justifiés (B5, B6, B8, B10, unités `%` au lieu de `vw` de T15, B12 violet) ; 375 × 812 sur (1) pour constater (React n'a pas de mise en page mobile : parité).
- [ ] **Step 2: Mesures d'I/O** — onglet Réseau sur le parcours : au plus 3 requêtes `/api` simultanées à tout instant ; aucune requête au changement d'indicateur carreaux/IRIS ; aucune requête France entière au premier chargement ; bornes IRIS, catégories, référentiel, options radio, totaux nationaux : une fois chacun.
- [ ] **Step 3: Épreuve AIDA** (hôte jetable PAR DÉFAUT, `ignoreUnusedDeps: true`, remote en `ng serve` PUIS en build de production — procédure de `ARCHITECTURE.md` § « Épreuve dans un shell hôte jetable ») : `/outils/magelian/carte` stylé ; raccourcis `Alt+1..4` avec le focus dans MAGELIAN, inactifs avec le focus dans l'hôte (B10) ; dialogues météo et capture dans la racine d'ombre ; tuiles 200 (carreaux, IRIS, TMJA, zones de risque) ; flux NDJSON santé/météo qui progressent ; `carte/risques` dans l'URL de l'hôte ; thème piloté par l'hôte ; tableau de fuite = 0 différence ; aucune erreur console ; limiteur.
- [ ] **Step 4: Gardes** — `npm run test:unit` (dont `portails-hors-ombre`, `gardes-styles`, `imports-partages`, `modele-aida`, `isolement`, les trois tests de parité du lot) ; `cd angular && npx ng test --watch=false` ; `npm run build` ; `npx tsc --noEmit` à la racine.
- [ ] **Step 5: Documentation** — `ARCHITECTURE.md` : route `carte` et son enfant `risques`, registre des couches (B11), pont carte (B3), clavier (B10), I/O ; feuille de route : ligne « 4 — Carte principale » ✅ avec la date, écarts restants, et « À savoir pour les lots suivants (revue finale du lot 4) » — au minimum : le lot 5 monte l'overlay MAGELIAN comme route enfant de `carte` (patron B2) et câble l'entrée Campagne, `Alt+C`, la bascule de la top bar, le groupe « Campagne active », `SuiviMapLayer`/`DiffusionMapLayer` comme services de couche (patron T4) réclamant leurs dégradés ; l'Assistant reste à arbitrer (B5).
- [ ] **Step 6: Commit** — `feat(angular): parcours complet du rail, parité finale et épreuve AIDA (lot 4, T21)`.

---

## Auto-relecture (faite)

- **Couverture de la spec** : rail des cinq thèmes (T3, entrées inertes justifiées B5/B6), panneaux Filtre (T5), Calques (T6-T13, T18), Analyse (T17-T20), Zones (T13-T16), « parcours complet du rail » (T21). Exigences du lot 3 : `natures` → `risque=` (T13, B4), « Voir sur la carte » + `ZonesRisqueLayer` (T13, B3), Fermer → carte (T13, B2). Réglages et Aide : T4.
- **Placeholders** : aucune tâche ne renvoie à « similaire à » ; les tests sont décrits cas par cas avec les valeurs attendues ; les valeurs qui ne se mesurent qu'à l'écran React sont marquées « à relever » avec la façon de les relever.
- **Types** : `EtatCarteService.basculerDegrade` (T3) est celui qu'appellent T6, T7, T10, T11, T13, T18 ; `CouchesCarteService.carteCourante` / `inscrireEffacement` (T3-T4) sont ceux du patron de couche ; `PONT_CARTE` / `PontCarte.afficherZonesRisque` (T13) ; `messageGardeOutil` / `verifierPerimetreOutil` (T1, T17-T20) ; `naturesDesTypes` (T13) s'appuie sur `librellesDuType` et `FAMILLES_ICPE_SEED` (T2).
- **Review Focus** : chaque ligne a son test dans la tâche qui possède le code (T4 et chaque couche ; T3/T7/T13 ; T17/T18 ; T8/T10/T20 ; T13).

## Questions au propriétaire

1. **Assistant (copilote IA)** — le porter dans un lot dédié (~2 500 lignes, flux `/api/chat` au protocole Vercel AI SDK), ou jamais, vu la direction « IA externe Dentsu » ? Défaut : hors lot 4, entrée inerte, Voronoï inerte (B5).
2. **Dessin libre** — tracé maison sans édition de sommets (défaut, B8), ou autoriser `terra-draw` comme dépendance d'exécution (épreuve d'hôte à rejouer) ?
3. **Clustering** — dans le lot 4 (T19-T20, défaut) ou reporté en lot 4b ?
