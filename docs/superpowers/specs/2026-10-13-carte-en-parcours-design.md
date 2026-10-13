# La carte en parcours — design

Date : 2026-10-13 · Décideur : Vincent · Statut : **à valider** (spec + maquette
`.superpowers/sdd/2026-10-12-parcours-carte/maquette-parcours.html`).
Suite de : `2026-10-12-droits-sur-la-carte-design.md` (droits par espace, deux
groupes), `2026-10-08-espaces-de-travail-design.md` (page Accès), et de la
vision du convertisseur zones → CP (mémoire `project_convertisseur_zones_plan`,
24-25/09) qui **prime** sur toute idée neuve de ce document.

## 1. Objectif

La carte Angular (`angular/src/app/features/carte/`) est aujourd'hui un rail de
cinq panneaux indépendants (Filtre, Calques, Analyse, Zones, Campagne —
`features/carte/logique/navigation.ts`) plus un module risque à part
(`features/risques/`, route `carte/risques`). On ne sait pas par où commencer
ni ce qui mène à quoi, et la campagne n'existe qu'en React
(`components/magelian/MagelianOverlay.tsx`).

Le chantier transforme la carte en **un seul parcours de sept étapes**, du
périmètre à la campagne en live, sur une carte qui ne change pas. Il ne
crée presque aucune fonction neuve : il **range** ce qui existe, généralise
le moteur de conversion du module risque, et porte la campagne React.

## 2. Décisions de Vincent (12/10/2026) — non rediscutées ici

| # | Décision |
|---|---|
| V1 | La carte devient un **parcours** sur le modèle du module risque Angular : fil d'étapes horizontal en haut ; le panneau ne montre que l'étape courante ; la carte reste la même du début à la fin. Le rail et ses 5 panneaux disparaissent. |
| V2 | **① Périmètre › ② Données › ③ Analyse › ④ Zones › ⑤ Plan › ⑥ Activation › ⑦ Live.** Entrée par n'importe quelle étape, pastille « renseignée ». Une **boîte à outils** hors du fil (Mes analyses, Mes zones, fond de carte, légende, Aide, Réglages, fiches de détail). |
| V3 | **⑦ = la campagne en live** (le Suivi V2 React). |
| V4 | **Les risques industriels sont de simples POI.** Sites/Rayon/Couverture → une analyse de ③ (couverture par rayon autour de POI) ; l'étape Zones du risque → l'étape ④ GÉNÉRALE. |
| V5 | **Natures de zones** (liste de CP, liste d'IRIS, polygone, point + rayon, ciblage TikTok) : ④ garde la nature, ⑥ envoie à chaque plateforme la nature qu'elle accepte. |
| V6 | ② sépare **Données de l'espace** et **Données communes** ; **sélection recommandée par espace** (réglée dans Accès › fiche espace › Données) ; « Autres données communes » en repli ; un espace sans sélection voit tout. Rien n'est caché, seulement rangé. |
| V7 | **Catalogue des données** : une fiche par jeu (nom, nature, maille, propriétaire, niveau socle/privé/partagé), POI ET indicateurs ; on peut rendre privé un indicateur (abstention → Bercy). |
| V8 | **Droits par espace, jamais par utilisateur.** Super admin = l'espace choisi. « dentsu.explore (interne) » = un espace comme un autre. Ce qui est produit dans un espace y reste. |
| V9 | **Groupes d'espaces = dossiers** (BMW : BMW Auto, BMW Moto, MINI, BMW Réseau ; Armée : Marine nationale, Armée de l'air). Cloisonnement total entre membres d'un groupe ; le groupe ne porte rien et ne se choisit pas sur la carte ; il sert à ranger dans Accès. |
| V10 | **Aucune IA** dans l'app (AIDA est l'IA). |
| V11 | Design system `DESIGN_SYSTEM.md`, interface Angular (racine d'ombre, routes relatives, état dans l'URL). |

Et, de la vision du convertisseur (25/09) : **une zone → un plan PAR
PLATEFORME dans sa maille native**, comparés côte à côte ; toujours au plus
fin ; l'utilisateur choisit quand une plateforme accepte plusieurs mailles ;
registre OUVERT de sources de poids ; le choix des plateformes se fait dans la
campagne, APRÈS la conversion. → **④ EST le convertisseur, ⑥ applique « une
plateforme = sa maille ».**

## 3. L'écran commun

```
┌ barre du parcours ─────────────────────────────────────────────────────────────────┐
│ ● Carte  France › Bretagne    ① Périmètre › ② Données › ③ Analyse › ④ Zones ›     │
│                               ⑤ Plan › ⑥ Activation › ⑦ Live        [outils ▾] ✕ │
├ barre de progression (mg-barre-progression) ───────────────────────────────────────┤
├ bandeau de l'étape (4-6 chiffres, mg-kpi) ─────────────────────────────────────────┤
│ panneau de l'étape (320-900 px, poignée) ║ carte MapLibre permanente   [boîte à    │
│                                          ║                              outils]    │
│                                          ║                     légende unique ↘    │
└──────────────────────────────────────────╨─────────────────────────────────────────┘
```

Repris tel quel du module risque (`features/risques/risque.page.html`) :

- **`mg-fil-etapes`** (`ui/fil-etapes/fil-etapes.component.ts`) : chaque étape
  cliquable dans les deux sens, flèches/Début/Fin, point teal « renseignée »,
  jamais « validée ». Pas un tunnel.
- **`mg-fil-ariane`** (`ui/fil-ariane/`) : « où je regarde » (le périmètre de
  ①), à côté de « où j'en suis » (le fil d'étapes) — deux fils, pas un doublon.
- **Panneau à poignée** (320-900 px, défaut 480), repli « Carte seule » ;
  **le panneau d'une étape reste MONTÉ** quand on en change (`visibility`,
  jamais `@if` sur l'étape qu'on quitte avec un calcul en cours) — patron
  `RisquePage`, commentaire « RIEN NE SE DÉMONTE ENTRE LES ÉTAPES ».
- **Services d'état fournis par la page** (patron A13 du risque, et
  § 4.1 de la spec droits : un changement d'espace recrée la page).
- **`mg-barre-progression` + `ChargementService`** pour tout calcul.
- **Bandeau KPI** (`mg-kpi`) : même emplacement à chaque étape, il change de
  question comme le bandeau du risque change à ⑤ (`bandeau-campagne`).

Nouveau : le **bandeau change par étape** (§ 4), la **boîte à outils** (§ 6),
et un **sélecteur de campagne** dans la barre aux étapes ⑤-⑦ (§ 4.5).

L'espace actif n'est PAS dans le parcours : il se choisit dans la coquille
(badge de session existant, `/api/user/switch-org`). Changer d'espace recrée la
page carte (spec droits § 4.1) et remet le parcours à ①.

## 4. Les sept étapes

Convention : **Entrée → Sortie** = ce que l'étape lit de l'état et ce qu'elle
y dépose. « Repris » = chemin réel vérifié le 2026-10-12. CA =
`angular/src/app/features/carte`, RQ = `angular/src/app/features/risques`.

### ① Périmètre — où je regarde

- **Écran** : France métro / + DROM ; régions et départements (listes
  multiples) ; recherche ville / CP ; « Partir d'une zone enregistrée ». Le
  masque du territoire assombrit le reste de la carte. Bandeau : population,
  IRIS, codes postaux, communes du périmètre.
- **Gestes** : cocher, chercher, choisir une zone enregistrée ; la carte cadre
  le périmètre.
- **Entrée → Sortie** : rien → `perimetre` (codes région/département ou id de
  zone). Il sert de **garde** à tous les calculs de ③ et ④ (déjà le cas :
  `CA/logique/garde-perimetre.ts`).
- **Repris** : panneau Filtre (`CA/panneaux/filtre/*`, `CA/logique/filtre.ts`,
  `CA/etat/sections-filtre.ts`), `POST /api/map/territory-mask`,
  `/api/meteo-geo/zones?scale=`, `/api/custom-geo/list`.
- **Nouveau** : les quatre chiffres du bandeau (lus du référentiel déjà
  chargé, pas de requête de comptage) ; `mg-fil-ariane` alimenté par ①.

### ② Données — ce que je vois

- **Écran** : deux blocs, dans cet ordre.
  1. **Données de l'espace** — POI importés (ex. 177 concessions pour BMW
     GROUP, 101 CIRFA pour Marine nationale), indicateurs privés (ex.
     abstention 2022 pour Bercy), zones, isochrones, campagnes de l'espace.
  2. **Données communes** — s'ouvre sur la **sélection recommandée** de
     l'espace ; le reste dans un repli **« Autres données communes (n) »**.
     Un espace sans sélection voit tout déplié.
  Chaque ligne : nom, nature (POI / carreau / IRIS / indicateur CP / ligne /
  à la demande), maille, interrupteur « afficher », réglages dépliables (là
  où ils existent : indicateur, palette, opacité, relief). Un clic sur le
  nom ouvre la **fiche du catalogue** (§ 7) dans la boîte à outils.
  Bandeau : calques actifs, jeux de l'espace, jeux communs visibles.
- **Gestes** : allumer/éteindre un calque, le régler, chercher un jeu par
  nom.
- **Entrée → Sortie** : `perimetre` → `calques` (liste des jeux affichés et
  leurs réglages).
- **Repris** : panneau Calques entier (`CA/panneaux/calques/*`) — IRIS
  choroplèthe (`/api/iris/bornes`, tuiles), carreaux Filosofi
  (`/api/tiles/{z}/{x}/{y}`, paliers 1/2/5 km), indicateurs civiques
  (`/api/insee-variables/<code>/geojson`), POI (`POST /api/map/pois`,
  `/api/map/categories` avec `origine` espace/commune — livré le 12/10),
  transport, TMJA, panneaux OOH (`POST /api/map/ooh`), radio, météo, santé,
  **sites à risque industriel comme un POI parmi d'autres**
  (`/api/map/risques-industriels`), PPRT (`/api/map/pprt`). Groupes visuels
  `mg-groupe-calques`.
- **Nouveau** : le rangement espace/commun appliqué à TOUS les jeux (pas
  seulement les types de POI) ; la sélection recommandée et son repli ; la
  ligne de jeu uniforme ; « Mes analyses » sort des calques pour la boîte à
  outils.

### ③ Analyse — ce que je calcule

- **Écran** : une liste de cinq analyses (cartes-titres), une seule ouverte à
  la fois ; en bas, « Mes analyses » récentes de l'espace.
  | Analyse | Entrée | Résultat sur la carte | Repris |
  |---|---|---|---|
  | **Couverture par rayon** autour d'un type de POI (NOUVELLE forme de RQ ①-③) | un type de POI de ② (lycées, concessions, sites Seveso…), un profil d'anneaux | anneaux, courbe population/rayon, tableau par territoire | `RQ/etapes/{sites,rayon,couverture}`, `RQ/commandes/{reglette-rayons,panneau-profil,resume-profil}`, `RQ/etapes/rayon/courbe-rayon.component.ts` |
  | Isochrones / bataille V1-V2 | un type de POI, temps | polygones, Voronoï | `CA/panneaux/analyse/outil-isochrones`, `outil-bataille-v2`, `/api/isochrone-battle` (protégé, inchangé) |
  | Clustering | types de POI | grappes, rapport 7 onglets | `CA/panneaux/analyse/clustering/*`, `/api/poi-clusters/*` |
  | Score composite | ≤ 6 indicateurs pondérés | note 0-100 par CP | `outil-score`, `/api/analyses/score` |
  | Corrélation | une campagne, un indicateur | r de Pearson par CP | `outil-correlation`, `/api/analyses/correlation` — voir Q1 |
  Bandeau : selon l'analyse ouverte (ex. couverture : POI, rayon max,
  population couverte, part du périmètre).
- **Gestes** : choisir l'analyse, régler, lancer (barre de progression),
  rejouer une analyse enregistrée, **« Faire une zone de ce résultat » → ④**.
- **Entrée → Sortie** : `perimetre` + `calques` → `analyse` (type + id
  enregistré, `/api/analyses`). Le résultat est un calque ; « Faire une
  zone » le capture (§ ④).
- **Nouveau** : la couverture par rayon **sur n'importe quel type de POI** ;
  la gravité Seveso devient un filtre de nature du type de POI « sites
  industriels », plus une dimension du module (voir Q3).

### ④ Zones — ce que je fabrique, et ce que j'achèterais (le convertisseur)

C'est l'étape RQ ④ rendue générale, telle que décidée le 25/09.

- **Écran**, de haut en bas :
  1. **Source** — d'où vient la zone : capture d'un résultat de ③ ou d'un
     calque de ② (seuil d'indicateur, score, bataille, Voronoï, radio,
     TMJA, carreaux), import d'une liste de CP, liste d'IRIS, dessin
     polygone/rectangle, point + rayon. **La nature est affichée et
     conservée** (§ 8).
  2. **Conversion** — maille d'achat (CP par défaut, IRIS en option
     d'analyse), **seuil de couverture** (curseur, rejoué en ~22 ms sur un
     jeu déjà construit), **Pondéré / Exclusif**, **source de poids**
     (uniforme par défaut, registre ouvert : indicateur, cible carreaux,
     score…). Chiffres : CP touchés, CP retenus, **taux d'utile**, population
     en zone.
  3. **Par plateforme**, côte à côte (une colonne par plateforme) : maille
     native, nombre d'unités, paliers, taux d'utile — ex. DV360 « 1 113 CP
     pondérés, 75,9 % d'utile », TikTok « 14 départements, 3 paliers,
     31 % d'utile ». Quand une plateforme accepte plusieurs mailles (TTD :
     CP ou polygone ; Meta : CP ou point + rayon), un sélecteur.
  4. **Enregistrer le jeu de zones** puis **Extraire** → extraction
     versionnée immuable (v1, v2 « recalage »…), classeur Excel.
  Carte : la double vue de RQ ④ (zone exacte | CP retenus colorés par
  part en zone), bascule. Bandeau : CP retenus, taux d'utile, population en
  zone, part du plan en zone, version.
- **Gestes** : créer depuis une source, combiner (union/intersection/
  différence), régler le seuil, comparer les plateformes, enregistrer,
  extraire.
- **Entrée → Sortie** : `perimetre` + résultat ou calque → `jeu` (id
  `zone_sets`) + `extraction` (id `zone_set_extractions`, version).
- **Repris** : `CA/panneaux/zones/*` (capture, `creer-codes-postaux`,
  `creer-dessin`, `creer-rayon`, `operations-zones`, `mes-zones`),
  `POST /api/custom-geo/save`, `/api/custom-geo/capture`,
  `/api/custom-geo/[id]/export` ; `RQ/etapes/zones/*` et
  `RQ/etat/atelier-jeux.service.ts` ; `/api/zones/jeux` et
  `/api/zones/jeux/[id]/{extractions,cp-geo,grappes,export}` ;
  `lib/zones/{plan,groupes,jeu}.ts` (`plierParCodePostal`, `tauxUtile`,
  groupes de CP indiscernables) ; sql/231 (extractions).
- **Nouveau** :
  - côté base, la **couture minimale** déjà identifiée le 24/09 : une fonction
    générique `cp_couverture_geometrie(geom, cible)` (carreaux dont le
    centroïde est dans la zone, `ST_Subdivide`, CP via `cp_des_points`),
    rendant **`jsonb`** (6 187 CP possibles > 1 000 lignes PostgREST) ;
    `genererPlanCp` prenant « poids d'un carreau » + mode ;
    `zone_set_cp.classe/cluster_id` rendus facultatifs pour une zone sans
    classe de risque ;
  - le **résolveur actuel** `resolve_custom_geo_zone_codes` (`ST_Intersects`,
    « 2 % compte comme 100 % », présent en base seulement) **n'achète plus
    rien** : il reste pour l'affichage historique ;
  - la **colonne `nature`** sur `custom_geo_zones` (cp, iris, polygone,
    point_rayon, tiktok) et la géométrie d'origine conservée ;
  - le tableau **par plateforme** (sorties dans la maille native, paliers
    pour Meta et TikTok, fusion des paliers trop petits sous le seuil TikTok
    de 1 000 personnes, jamais grossir la maille) ;
  - **capacités des plateformes en base** (table `plateformes_geo`), pas en dur.
  - ⚠ refactor du risque **sans changer un chiffre** : tests de
    caractérisation d'abord (« Seveso France » : 1 102 CP retenus, 73,1 %
    d'utile ; simulation 62 → 89).

### ⑤ Plan — ce que je compte acheter

Le wizard React Cible › Canaux › Pression › Stratégie › Lancement, replié en
UNE étape à sections (il n'y a pas de fil dans le fil).

- **Écran** : en tête, le **sélecteur de campagne** (créer / choisir — le
  « hall » React) ; puis quatre sections à bandeau (`mg-entete-section`) :
  1. **Cible** = une **extraction** de ④ (jeu + version), ou « national »,
     ou un indicateur INSEE à seuil (comportement React conservé). Une
     campagne n'a **qu'un** plan (`refresh_campaign_rollups` ne lit qu'une
     stratégie).
  2. **Plateformes et budget** — cocher DV360, The Trade Desk, Meta,
     TikTok, ad server ; budget et période par canal ; chaque plateforme
     reprend sa ligne du tableau de ④ (maille, taux d'utile). C'est ICI que
     se fait le choix des plateformes (décision 25/09).
  3. **Pression** — ×1 à ×3, CPM min/max, stricte ou nationale surpondérée ;
     toujours chiffrée (×M + CPM €).
  4. **Stratégie** — objectif, KPI, capping, rythme.
  Pied : prévision d'impressions, bouton **Préparer l'activation → ⑥**.
  Optionnel : « Simuler une diffusion » (RQ ⑤ généralisé).
  Bandeau : budget, impressions prévues, CPM moyen, plateformes, CP au plan.
- **Entrée → Sortie** : `extraction` → `campagne` (id `dsp_campaigns`) +
  stratégie (`/api/bidding/strategies`, brouillon auto
  `/api/bidding/strategies/drafts`).
- **Repris** : `components/campaign/wizard/steps/{StepCible,StepCanaux,
  StepPression,StepStrategie,StepLancement,SourcePlan,PressureControl,
  ForecastStrip}.tsx` (React, à **porter**, skill
  `porting-react-to-angular`) ; `/api/zones/jeux/[id]/rattacher` ;
  `CA/panneaux/zones/plan-media.component.ts` (plan média des zones) ;
  `RQ/etapes/campagne/*` + `/api/zones/jeux/[id]/simulation` pour la
  simulation.
- **Nouveau** : le portage Angular ; le wizard en sections ; le plan média
  des zones fusionné dans la section Plateformes (plus de bouton flottant).

### ⑥ Activation — ce que j'envoie, plateforme par plateforme

- **Écran** : une carte par plateforme cochée en ⑤. Chacune dit : **la
  nature envoyée** (ex. TTD « 3 polygones exacts » ; DV360 « 1 113 CP
  pondérés — conversion de la zone dessinée »), le mode (**API** ou
  **fichier**), le pré-vol (contrôles), le bouton **Pousser** (DV360) ou
  **Télécharger** (fichier), l'historique, l'annulation. En bas : publier la
  campagne.
  Bandeau : plateformes prêtes, poussées, en erreur ; dernière poussée.
- **Gestes** : lancer le pré-vol, pousser (journal NDJSON en direct, barre
  de progression), télécharger, annuler une poussée, publier.
- **Entrée → Sortie** : `campagne` + `extraction` → envois (historique
  d'activation) ; statut de la campagne.
- **Repris** : `components/campaign/ActivationPanel.tsx` (à porter) ;
  `/api/campaigns/[id]/activation/{prevol,pousser,historique,rollback}` ;
  `lib/dsp/push/dv360.ts`, `lib/digital/dv360-geo.ts` ; exports
  `csv_cp`, `csv_iris`, `geojson`, `dv360_cp`, `dv360_sdf`,
  `bidding_script`, `tiktok_geo` (`/api/custom-geo/[id]/export`) ;
  `/api/zones/jeux/[id]/export`.
- **Nouveau** : la règle « une plateforme = sa maille » appliquée à l'envoi
  (choix automatique de la nature acceptée, conversion annoncée) ; exports
  **TTD polygone/cercle (GeoJSON) et liste d'enchères CP**, **Meta en
  paliers** (un ensemble par palier), **TikTok en paliers** (département ou
  commune) — aujourd'hui seuls DV360 et `tiktok_geo` existent.

### ⑦ Live — la campagne en vol

- **Écran** : le Suivi V2, porté. Barre de contexte et maille France ›
  région › département › CP ; **score d'alignement géographique** ; pacing
  temps / budget / volume ; écart plan vs réel ; trois vignettes carte
  (Impressions, Variable du plan, Alignement — échelles séquentielle et
  divergente du design system) ; part conforme / sous / sur-pression en € ;
  **« Ce qu'il faut corriger »** (≤ 3 constats) ; coût et rythme (CPM réel vs
  prévu) ; territoires déréglés ; « Qui a diffusé » (partenaire × canal) ;
  pression par classe ; réconciliation DSP ⇔ mesure. La grande carte
  montre l'alignement (divergente) au CP. Bandeau : alignement, pacing,
  dépensé, impressions, CPM réel, jours restants.
- **Gestes** : changer de maille, descendre dans un territoire, filtrer par
  acteur, ouvrir un constat (il centre la carte), **« Recaler »** → retour à
  ④ avec la version suivante de l'extraction.
- **Entrée → Sortie** : `campagne` → rien (lecture) ; « Recaler » crée une
  extraction v+1 (origine `recalage`).
- **Repris** : `components/campagne/suivi-v2/*` (`SuiviV2.tsx`,
  `ScoreAlignement`, `ConstatsCorrection`, `CoutEtRythme`, `TrioCartes`,
  `QuiADiffuse`, `PressionParClasse`, `TableauDeregles`…) à porter ;
  `/api/campaigns/[id]/alignement` (+ `/constats`, `/dispersion`,
  `/maille`, `/maille/map`), `/api/campaigns/[id]/pression-classes`,
  `/api/digital/[id]/{suivi,actors,reconcile}` ; rollups
  `campaign_cp_rollup` (déjà calculés, aucun calcul lourd en lecture).
- **Retiré au portage** : `ai-analysis`, `campaign-chat` (V10).

## 5. L'état dans l'URL

Même patron que `RQ/logique/etat-url.ts` (`?risque=`) : un état sérialisé,
relu au chargement, réécrit à chaque geste (`replaceUrl`), sans recréer la
page. Paramètres lisibles et indépendants, pour qu'un lien partagé rouvre la
même étape sur le même objet :

| Paramètre | Contenu | Écrit par |
|---|---|---|
| `etape` | `perimetre` · `donnees` · `analyse` · `zones` · `plan` · `activation` · `live` | le fil |
| `perimetre` | `metro`, `metro+drom`, `r:53`, `d:29,d:56`, `z:<id zone>` | ① |
| `calques` | liste courte des jeux affichés + réglage clé (ex. `iris:men_pauv,poi:lycee`) | ② |
| `analyse` | `<type>:<id>` d'une analyse enregistrée | ③ |
| `jeu`, `x` | id du jeu de zones, id/version de l'extraction | ④ |
| `campagne` | id de campagne | ⑤ ⑥ ⑦ |
| `vue` | centre, zoom, fond (existant) | carte |

Ne vont **pas** dans l'URL (comme le risque) : largeur du panneau, repli,
aperçus de glissement, sections dépliées. La « pastille renseignée » d'une
étape se déduit de l'URL (paramètre présent), sans état caché.
`?customZone=` (`CA/etat/lien-zone.service.ts`) et les anciens `?risque=`
**redirigent** vers `etape=zones&jeu=…` / `etape=analyse&analyse=couverture:…`.

## 6. La boîte à outils

Un groupe de boutons-icônes en haut à droite de la carte, hors du fil, qui
ouvrent un **tiroir** à droite (dans le flux, jamais `position: fixed` —
racine d'ombre). Un seul tiroir ouvert à la fois ; Échap le ferme (pile
`CA/etat/pile-echap.service.ts`).

| Outil | Contenu | Repris |
|---|---|---|
| Mes analyses | analyses de l'espace, rejouer, supprimer → ouvre ③ | `/api/analyses`, section Calques actuelle |
| Mes zones | zones et jeux de l'espace, afficher, exporter → ouvre ④ | `CA/panneaux/zones/mes-zones.component.ts`, `jeux-de-zones.component.ts` |
| Fond de carte | dentsu / clair / satellite, relief | `CA/etat/fond-carte.ts`, `CA/commun/fond-compact.component.ts` |
| Légende | la légende unique, toujours celle des calques actifs | `CA/legende/*` |
| Fiche | fiche du point/IRIS cliqué, fiche catalogue d'un jeu (§ 7) | `CA/couches/detail-iris.component.ts`, popups |
| Aide | aide contextuelle **de l'étape courante** | `CA/panneaux/aide.component.ts` |
| Réglages | préférences de carte, lien vers Accès (super_admin) | `CA/panneaux/reglages.component.ts` |

Retirés : les boutons flottants « Plan média » et « Script bidding DV360 »
(`CA/commun/boutons-flottants.component.ts`) → leurs fonctions vivent en ⑤
et ⑥. « Tout effacer » reste, dans la barre du parcours.

## 7. Catalogue, sélection recommandée, groupes d'espaces

### 7.1 Le catalogue — une fiche par jeu

Aujourd'hui, seuls les jeux importés ont un niveau de droit
(`data_sources.visibilite` socle/privée + `shared_with`, sql/234). Les
indicateurs (`cible_indicator_registry`, 19 lignes ;
`iris_indicator_registry` ; `indicator_cp_values`) et les référentiels
(carreaux, transport, ICPE, radio, TMJA, PPRT, santé, météo) n'en ont pas :
on ne peut donc pas rendre l'abstention privée à Bercy.

**Nouveau** : table `catalogue_jeux` — une ligne par jeu affichable :

| Colonne | Exemple |
|---|---|
| `cle` | `poi:concessions-bmw`, `indicateur:abstention_2022`, `carreaux:filosofi_200m` |
| `nom` | « Taux d'abstention 2022 » |
| `nature` | poi · polygone · carreau · indicateur_iris · indicateur_cp · ligne · a_la_demande |
| `maille` | point · IRIS · carreau 200 m · CP · commune · département |
| `organization_id` | propriétaire (Bercy) |
| `visibilite` | socle · privee (le « partagé » = `shared_with`, comme sql/234) |
| `source_id` | `data_sources.id` quand le jeu en a un — **un seul endroit de vérité** : pour ces jeux, la visibilité reste celle de `data_sources`, le catalogue la lit |
| `mise_a_jour`, `origine` | millésime, fournisseur (INSEE, Géorisques…) |

Règle de lecture : **une seule fonction** décide si l'espace actif voit un jeu
(extension de `sourcesVisiblesDeLaRequete`, `lib/auth/perimetre-donnees.ts`),
et toute route qui sert un indicateur (`/api/insee-variables/<code>/geojson`,
`/api/analyses/score`, `/api/cibles/indicators`) passe par elle. Écran :
fiche dans la boîte à outils (lecture) ; édition dans **Accès** (page Données
de l'admin pour le catalogue entier ; fiche Socle pour socle ↔ privé).
Effectifs : `data_sources.valid_count` ou une colonne figée — jamais de
`COUNT` sur `poi_france`.

### 7.2 La sélection recommandée

**Nouveau** : table `espace_jeux_recommandes (organization_id, cle_jeu)`.
Dans **Accès › fiche espace › onglet Données**
(`angular/src/app/features/admin/espaces/onglet-donnees.component.ts`), une
colonne « Recommandé » (case à cocher) sur les jeux **communs**. À ②, le bloc
« Données communes » montre ces jeux, puis le repli « Autres données
communes ». Aucune sélection = tout déplié. Une recommandation ne donne ni ne
retire aucun droit : elle range.

### 7.3 Les groupes d'espaces

**Nouveau** : table `groupes_espaces (id, nom)` et
`organizations.groupe_id` (facultatif). Dans Accès, la colonne des espaces
(`espaces.page.ts`) les range en dossiers repliables (« BMW » : BMW Auto, BMW
Moto, MINI, BMW Réseau). Le groupe **ne porte rien** : pas de données, pas de
membres, pas de campagnes, aucune règle de droit ne le lit (un test le
verrouille : `grep groupe_id` hors admin = 0). Le sélecteur d'espace de la
coquille peut l'afficher en en-tête de liste, il n'est jamais sélectionnable.

## 8. Natures de zones × plateformes

④ garde la nature ; ⑥ envoie à chaque plateforme celle qu'elle accepte, au
plus fin, et **dit** quand il convertit. Source : doc « Ciblage géographique
des plateformes en France » (25/09,
https://claude.ai/code/artifact/74c6a01c-7782-4372-a9d5-5aadff414c9b).

| Nature de zone | DV360 | The Trade Desk | Meta | TikTok |
|---|---|---|---|---|
| Liste de CP | **natif**, poids par CP (script custom bidding), API branchée | natif **probable** (segments CP FR non confirmés), facteur par ligne | natif, ≤ 50 000 CP, **sans poids** → paliers | **non** → département (ou commune) en paliers |
| Liste d'IRIS | → CP | → **polygones IRIS** (exact) ou CP | → CP en paliers | → département en paliers |
| Polygone | → CP | **natif** (GeoJSON, facteur par groupe de formes) | → CP en paliers | → département en paliers |
| Point + rayon | → CP (rayon de proximité DV360 : non branché) | natif (cercles) | **natif** (≤ 200 points, 1-80 km ; ≥ 15 km en catégorie sensible) | **non** (aucun rayon dans l'API) → département |
| Ciblage TikTok (communes / départements en paliers) | — | — | — | **natif**, ≤ 3 000 zones par groupe, ≥ 1 000 personnes par groupe (UE) |
| Mode d'envoi aujourd'hui | API | fichier | fichier | fichier (OAuth prêt) |

⚠ **Colonne par colonne, À VÉRIFIER dans de vrais comptes** avant d'en faire
une règle (table `plateformes_geo` en base, modifiable sans livraison) :
segments CP FR et borne du facteur chez TTD ; format de clé `FR:75001` chez
Meta ; communes et arrondissements Paris/Lyon/Marseille chez TikTok ; rayon
de proximité DV360. Contraintes réglementaires à porter dans le pré-vol de
⑥ : publicité politique interdite chez Meta et TikTok dans l'UE ;
catégories sensibles Meta sans CP ; facteurs TTD multiplicatifs entre
niveaux (ne pas empiler pays × région × CP).

## 9. Ce qui est retiré

| Retiré | Remplacé par |
|---|---|
| Rail des thèmes et ses 5 panneaux (`CA/rail/*`, `CA/logique/navigation.ts`) | le fil ① → ⑦ |
| Le module risque comme écran à part (route `carte/risques`, `RisquePage`) | ③ couverture par rayon + ④ général ; la route redirige |
| Section « Zones à risque » des calques et son lien vers le module | les sites ICPE sont un POI de ② |
| Boutons flottants Plan média / Script bidding | ⑤ / ⑥ |
| Overlay campagne React (Stratégie, Activation, Suivi, Aperçu) | ⑤ ⑥ ⑦ en Angular ; React gelé puis retiré (Q5) |
| Entrée Assistant, `ai-analysis`, `campaign-chat` | rien (V10) |
| Achat par `ST_Intersects` (`resolve_custom_geo_zone_codes`) | le convertisseur de ④ |

## 10. Hors champ

- Poussée par API vers TTD, Meta, TikTok (fichiers d'abord ; plomberie
  DV360 seule branchée).
- Zones **dynamiques** re-versionnées automatiquement (météo, pollen) : le
  modèle le permet (nouvelle extraction par cycle), pas ce chantier.
- Droits par utilisateur ou par module ; partage d'un objet produit entre
  espaces.
- Écran mobile (< 768 px) au-delà de « le panneau passe sous la carte ».
- Refonte des analyses elles-mêmes (clustering, bataille) : déplacées, pas
  réécrites.
- La 3D, les fonds de carte nouveaux.

## 11. Risques

**I/O (CLAUDE.md § Disk I/O)**
- Changer d'étape **ne relit rien** : services fournis par la page, panneaux
  montés (mesure attendue : zéro appel sur cinq bascules, comme le risque).
- ② : catalogue et sélection = petites tables ; aucun calque n'est chargé
  parce qu'il est « recommandé » — **la recommandation ne précharge pas**.
  Un calque à la fois, à la demande, bbox = viewport, cache `useRef`/signal
  vérifié avant fetch, ≤ 3 appels simultanés.
- ④ : `cp_couverture_geometrie` sur les carreaux 200 m (2,3 M lignes) —
  `EXPLAIN ANALYZE` obligatoire, index GIST, `ST_Subdivide`, garde du
  périmètre de ①, et la construction **sous 60 s** (Kong) ; au-delà,
  brouillon + Inngest. Le seuil se rejoue sans reconstruire (22 ms).
- **Troncature PostgREST à 1 000 lignes** : listes de CP (6 187), d'IRIS
  (49 448), d'extractions → **jumelles `jsonb`** ou `lireTout`, jamais une
  RPC tabulaire ; compléter `tests/unit/db/troncature-postgrest.test.ts`.
- ⑦ : lit des rollups déjà calculés ; ne pas déclencher
  `refresh_campaign_rollups` à l'ouverture.
- Quotas : `lib/api/rate-limit.ts` sur les nouvelles routes de conversion.

**Produit**
- Le parcours peut se lire comme un tunnel : le fil ne bloque jamais, chaque
  panneau dit en une ligne ce qu'il attend (« Aucune zone : partez d'une
  analyse ou dessinez-en une »).
- Refactor du moteur de ④ : tests de caractérisation AVANT (chiffres de
  Seveso France figés).
- Le portage du wizard et du Suivi V2 (React, ~30 composants) est le plus
  gros du chantier : skill `porting-react-to-angular`, preuve navigateur
  dans les deux thèmes, parité verrouillée.
- `app/api/isochrone-battle/route.ts` et `middleware.ts` (protégés) : non
  touchés par ce chantier.

## 12. Découpage en lots — de la valeur tôt

| Lot | Contenu | Valeur livrée | Dépend de |
|---|---|---|---|
| **1. Squelette du parcours** | fil ① → ⑦ sur `CartePage`, panneaux existants rebranchés (Filtre → ①, Calques → ②, Analyse → ③, Zones → ④), boîte à outils, état URL `etape`, rail retiré ; ⑤-⑦ affichent « bientôt » + lien vers la campagne React | la nouvelle navigation, sans aucune perte | — |
| **2. Données rangées** | ② en deux blocs pour tous les jeux, ligne uniforme, sélection recommandée (table + case dans Accès › Données) | chaque client voit d'abord SES données | spec droits (feat/droits-carte) |
| **3. ⑦ Live** | portage du Suivi V2 en Angular, sélecteur de campagne | la démo « pilotage » sans React ; lecture seule, rollups existants, risque I/O faible | 1 |
| **4. Couverture par rayon** | RQ ①-③ généralisé à tout type de POI dans ③ ; ICPE = POI ; redirection `carte/risques` | le module risque disparaît sans perte, l'analyse sert BMW (concessions) ou la Marine (CIRFA) | 1 |
| **5. ④ Convertisseur général** | `cp_couverture_geometrie` jsonb, nature des zones, jeux de zones pour toute zone, tableau par plateforme, extractions ; caractérisation du risque d'abord | le cœur produit : toute zone → plan d'achat honnête | 4 |
| **6. ⑤ Plan** | portage du wizard en sections, cible = extraction, plateformes + budget, pression, stratégie, simulation | créer une campagne dans le parcours | 5 |
| **7. ⑥ Activation** | portage ActivationPanel, une carte par plateforme, exports TTD/Meta/TikTok en maille native, pré-vol réglementaire | la boucle complète ① → ⑦ en Angular | 6 |
| **8. Catalogue et groupes** | `catalogue_jeux`, droits sur les indicateurs (abstention → Bercy), fiche catalogue, groupes d'espaces dans Accès | données privées au-delà des POI ; administration rangée | 2 |

Le lot 8 peut passer avant le 3 si l'abstention Bercy est attendue pour une
démo : il ne dépend que du lot 2. Chaque lot se termine par la mise à jour
d'`ARCHITECTURE.md` (routes, tables, RPC) dans le même commit.

## 13. Questions ouvertes pour Vincent

| # | Question | Recommandation |
|---|---|---|
| Q1 | La **corrélation** (impressions × indicateur) reste-t-elle en ③, ou va-t-elle en ⑦, puisqu'elle lit une campagne diffusée ? | **⑦**, comme bloc « Ce qui explique la diffusion » ; ③ ne garde que des analyses qui précèdent l'achat. |
| Q2 | La **campagne courante** : sélecteur dans la barre aux étapes ⑤-⑦ (une campagne à la fois dans l'URL), ou un hall plein panneau à chaque entrée en ⑤ ? | **Sélecteur dans la barre**, hall seulement quand l'espace n'a aucune campagne ; ⑦ s'ouvre sur la dernière campagne en vol. |
| Q3 | La couverture par rayon généralisée garde-t-elle le **profil d'anneaux par niveau** (Seveso haut/bas) ? | **Oui, mais par valeur d'un champ du type de POI** (gravité pour l'ICPE, aucune pour les lycées → un seul niveau) : on garde la puissance, on perd le cas particulier. |
| Q4 | Une campagne = **un seul plan** aujourd'hui. Faut-il plusieurs extractions par campagne (une par zone, ex. Marseille + Lille) ? | **Non en v1** : un jeu de zones peut déjà contenir plusieurs zones ; plusieurs plans exigeraient de réécrire `refresh_campaign_rollups`. |
| Q5 | Quand **retirer la campagne React** (`MagelianOverlay`) et `/map` React ? | **Geler dès le lot 3, retirer après le lot 7**, une fois la boucle ① → ⑦ prouvée en navigateur sur BMW GROUP et Marine nationale. |

## 14. Décisions (2026-10-13)

Vincent, à la lecture de la maquette (https://claude.ai/artifact/TXJjsdhCEnzrDZwVsCThK1) :
« ah oui il faut sélectionner une campagne, je te laisse faire ». Les cinq
recommandations du § 13 sont donc retenues telles quelles : corrélation en ⑦ ;
sélecteur de campagne dans la barre aux étapes ⑤-⑦ (création seulement si
l'espace n'en a aucune) ; anneaux par valeur d'un champ du type de POI ; un
plan par campagne en v1 ; React gelé au lot 3, retiré après le lot 7. La spec
est validée ; les arbitrages de détail sont délégués au chef de projet.

## 15. Décisions (2026-10-13, après-midi) — le fil suit le module risque

Vincent, après avoir manipulé le lot 1 sur :4202 : « le fil d'Ariane devait
suivre la logique des zones à risque […] on doit définir un type de zones, soit
des rayons, des isochrones, etc […] l'onglet couverture doit être intégré dans
analyses […] garder la logique de ce qu'on a fait pour les zones Seveso à
partir de couverture ». Proposition retenue (8 étapes) :

| # | Étape | Contenu | Équivalent risque |
|---|---|---|---|
| ① | Périmètre | inchangé | — |
| ② | Données | inchangé ; les POI y jouent le rôle des « sites » | Sites |
| ③ | Zones | on choisit un **type de zone** : rayons autour d'un type de POI, isochrones, dessin, codes postaux, seuil d'indicateur | Rayon |
| ④ | Analyse | sur ces zones : **couverture par territoire**, clustering, score | Couverture |
| ⑤ | Jeu de zones | la logique Seveso telle quelle : seuil de couverture, CP retenus, taux d'utile, extraction (le convertisseur du § 4 ④) | Zones |
| ⑥ | Plan | ex-⑤ | Campagne |
| ⑦ | Activation | ex-⑥ | — |
| ⑧ | Live | ex-⑦ | — |

Ce qui change par rapport aux §§ 4 et 12 :

- **Ordre** : Zones passe AVANT Analyse ; l'analyse porte sur des zones déjà
  définies, comme la couverture porte sur un rayon dans le module risque.
- **Couverture par rayon** (lot 4) se découpe en deux : le rayon devient un
  *type de zone* de ③ (avec les isochrones, qui quittent ③ Analyse), la
  couverture par territoire devient une analyse de ④.
- **Convertisseur** (lot 5) devient l'étape ⑤ Jeu de zones à part entière, au
  lieu du bas de l'étape Zones.
- Le lot 1 est réordonné tout de suite (8 étapes, ⑤ « bientôt » jusqu'au
  lot 5, Alt+1…8) ; le déplacement des outils entre ③ et ④ se fait aux lots 4-5.
