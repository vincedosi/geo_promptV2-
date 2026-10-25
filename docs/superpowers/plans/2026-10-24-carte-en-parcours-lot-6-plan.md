# La carte en parcours — lot 6 « ⑥ Plan » — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (ou superpowers:executing-plans). Skill `porting-react-to-angular` chargé AVANT chaque tâche Angular. Cases à cocher (`- [ ]`) pour le suivi.

**Révisé le 25/10 — V1 = contrôle des impressions et du budget dépensé (Vincent ; spec § 19, qui fait foi).** ⑥ ne porte plus que : la campagne, l'**extraction figée** d'un jeu (Q-1), les plateformes et leurs liaisons, la période, le **budget prévu** et les **impressions prévues** par plateforme (et par CP quand la plateforme achète au CP). Sortent du lot : la section **Stratégie** (objectif, KPI, capping, rythme, autonomie — Q-2), la section **Pression** (multiplicateur d'enchère, CPM min/max, diffusion), l'**ad server** et l'absorption de coquilles, les **fichiers custom bidding**, et le chemin « panier de zones / indicateur à seuil / national » (A-9). L'ancienne T6 (Pression + Stratégie) est **retirée** ; les anciennes T7 et T8 deviennent T6 et T7.

**Mode accéléré (Vincent, 24/10, « accélère ») — il fait foi sur tout le reste de ce plan :** ⑥ est un **PORTAGE quasi tel quel** du wizard de campagne React, réduit au périmètre V1 ci-dessus, replié en UNE étape à sections, sans le repenser ; on améliore après la bascule. 7 tâches groupées par écran, **une relecture par groupe** (3 groupes), seuls les défauts Critiques/Importants partent en correction (les mineurs vont à la revue finale), **preuve navigateur une seule fois**, en T7. Cible : **≈ 2,25 jours**.

**Goal :** à l'étape ⑥ de la carte Angular, choisir (ou créer) une campagne, lui donner pour cible une **extraction** de ⑤, cocher les plateformes, saisir période, budget et CPM prévus par plateforme, lire les **impressions prévues** (par plateforme, par CP pour les plateformes au CP), et **lancer** : le plan CP et la stratégie-conteneur sont écrits par les routes EXISTANTES.

**Architecture :** un panneau `mg-panneau-plan` à trois sections à bandeau (`mg-entete-section`) — Cible, Plateformes et budget, Impressions prévues — + un pied « Lancement » ; un état `PlanCampagneService` fourni par la page (brouillon = `ProgDraft` porté, autosauvé côté serveur comme React) ; la campagne courante dans `?campagne=` ; la logique pure UTILE à la V1 de `components/campaign/wizard/steps/types.ts` et `lib/campaigns/{channels,platform-links}.ts` COPIÉE en Angular et verrouillée par un test de parité. **Trois modifications serveur, toutes en T1** : `POST /api/zones/jeux/[id]/rattacher` accepte une `extraction` (aujourd'hui il refuse tout jeu de type `zone` — lot 5, A-3/A-15 renvoyaient précisément ce point au lot ⑥) ; `PUT /api/campaigns/[campaignId]/channels` accepte `cpm_prevus` (A-10) ; une lecture des CP d'une extraction (A-11).

**Tech Stack :** Angular 21.2 standalone zoneless signals, Tailwind 4, Vitest (`cd angular && npx ng test --watch=false`) ; Next.js 15, supabase-js, Zod, Vitest racine (`npm run test:unit`, `npm run test:integration`).

**Spec :** `docs/superpowers/specs/2026-10-13-carte-en-parcours-design.md` — **§ 19 (V1, 25/10) fait foi** ; § 16.1 ligne ⑥ ; § 4 « ⑤ Plan » (ex-numérotation : écran à sections, sélecteur de campagne, cible = extraction, plateformes + budget ; Pression et Stratégie caduques) ; § 5 (`campagne` dans l'URL) ; § 13-14 **Q2 et Q4 TRANCHÉES** (« sélecteur de campagne dans la barre aux étapes ⑥-⑧, création seulement si l'espace n'en a aucune » ; « un plan par campagne en v1 », `refresh_campaign_rollups` ne lit qu'une stratégie). Lot 5 : `docs/superpowers/plans/2026-10-24-carte-en-parcours-lot-5.md` (extraction immuable, A-2, A-11, A-15). Mémoires : `feedback_mode_accelere`, `project_wizard_completion`, `feedback_agents_frugaux`, `feedback_angular_vigilance`, `feedback_no_hardcoded_colors`.

---

## Pré-vol : ce qui existe vraiment (reconnaissance du 24/10, revue le 25/10, worktree `carte-jeu-de-zones`)

### L'existant React (≈ 3 700 lignes, dont ≈ 1 900 portées en V1)

Orchestrateur : `components/campaign/CampaignCockpit.tsx` (286 l., vue `prog` : cinq étapes, brouillon `ProgDraft`, préremplissage depuis la campagne puis depuis la stratégie existante, bannière « Brouillon restauré · Repartir de zéro »). Monté par `components/magelian/MagelianOverlay.tsx` (704 l.) onglet « Stratégie » : `CreationHall` (178 l.) tant qu'aucune campagne n'est ouverte, sinon « ← Choisir une autre campagne » + note « un filtre de carte ne s'applique pas à cette stratégie » + le cockpit `wizardOnly`.

Relu le 25/10 pour trier ce qui relève de la stratégie, du KPI ou de l'enchère : `StepStrategie` = objectif (`bidding_objectives`), KPI, capping, rythme de dépense, « autonomie de l'agent » → **tout est stratégie** ; `StepPression` + `PressureControl` = « multiplicateur d'enchère appliqué aux zones cibles », CPM max = base × M, CPM min = base ÷ M → **levier d'enchère**, qui ne s'exprime PAS en impressions ; le panier + indicateur et le national construisent une **courbe d'enchère** par indicateur INSEE (`buildInZoneWeights`, `pressureCurve`) → **enchère** ; `StepLancement` = récap + deux chemins + **fichiers custom bidding** ; `ForecastStrip` = impressions estimées (budget ÷ CPM × 1 000) → **gardé**, c'est le cœur de la V1. Sur le chemin extraction, la pondération par CP vient de l'extraction (`zone_set_extraction_cp.multiplicateur`) : elle se lit en **part des impressions prévues** (`planned_share` de `refresh_campaign_rollups` = multiplicateur ÷ somme).

| Écran / section React | Fichiers (lignes) | Routes appelées | Sort au lot 6 |
|---|---|---|---|
| Hall de création | `magelian/CreationHall.tsx` (178), parties de `MagelianOverlay.tsx` (listes, créer, supprimer une coquille, mode démo) | `GET/POST /api/admin/campaigns`, `DELETE /api/admin/campaigns/[id]`, `GET /api/bidding/strategies`, `GET /api/bidding/strategies/drafts`, `GET/POST /api/user/demo-mode` | **Porté** : hall dans le panneau ⑥ quand `?campagne=` est vide ; sélecteur dans la barre (T3) |
| ① Cible | `steps/StepCible.tsx` (423) : identité (nom, annonceur, produit), panier de zones enregistrées, zone par indicateur à seuil | `GET /api/cibles/indicators`, `GET /api/admin/campaigns/[id]/organizations`, `GET /api/custom-geo/list`, `POST /api/custom-geo/source/indicator-threshold`, `POST /api/custom-geo/save` | **Identité portée** ; panier et indicateur à seuil **non portés** (A-9 : ils n'existent que pour la courbe d'enchère ; la même zone se fait en ③ puis ⑤) (T4) |
| Source du plan (jeu de zones) | `steps/SourcePlan.tsx` (200) — affichée DANS l'étape Pression en React | `GET /api/zones/jeux` | **Déplacé en section Cible** et généralisé aux extractions ; seule source de la V1 (T4) |
| ② Canaux & budgets | `StepCanaux.tsx` (285), `ChannelLinkAccordion.tsx` (66), `Dv360LinkPanel.tsx` (206), `PlatformLinkPanel.tsx` (96), `AbsorbPanel.tsx` (90), `ChannelHubRecap.tsx` (68), `ForecastStrip.tsx` (74) | `GET /api/campaigns/[campaignId]/channels`, `GET /api/dsp/dv360/resources`, `GET /api/admin/campaigns/attachable`, `POST /api/admin/campaigns/[id]/absorb`, `GET /api/custom-geo/national-totals` | **Porté** sans le bloc « Ad server (mesure) » ni `AbsorbPanel` (affiché seulement avec un ad server) ; `ForecastStrip` devient la section **Impressions prévues** (sans audience ni « % France », qui reposaient sur le panier) (T5) |
| ③ Pression | `StepPression.tsx` (111), `PressureControl.tsx` (171) | aucune | **Non porté** (V1, § 19) — la phrase « Le plan vient du jeu de zones… » est reprise en section Cible, sans sa fin sur le multiplicateur |
| ④ Stratégie | `StepStrategie.tsx` (152) : objectif, KPI, capping, rythme, mode d'exécution | `GET /api/bidding/objectives` — **ROUTE ABSENTE** (retirée par `113940f2`) | **Non porté** (Q-2 tranchée le 25/10) |
| ⑤ Lancement | `StepLancement.tsx` (527) : récap, validation, deux chemins (jeu → `rattacher` ; sinon stratégie POST/PATCH + activation), téléchargements custom bidding par canal | `PATCH /api/admin/campaigns/[id]`, `POST /api/zones/jeux/[id]/rattacher`, `PUT /api/campaigns/[campaignId]/channels`, `POST /api/bidding/strategies`, `GET/PATCH /api/bidding/strategies/[id]`, `GET /api/bidding/strategies/[id]/export?channel=`, `POST /api/custom-geo/source/composite` + `save` | **Porté** en pied du panneau, **chemin extraction seul**, sans téléchargements custom bidding (T6), + correction E2 |
| Autosave | `wizard/useDraftAutosave.ts` | `POST /api/bidding/strategies/drafts`, `GET/DELETE /api/bidding/strategies/drafts/[id]` | **Porté** dans `PlanCampagneService` (T2) |
| Logique pure | `steps/types.ts` (316), `lib/campaigns/channels.ts` (96), `lib/campaigns/platform-links.ts` (76), `lib/cibles/draft.ts` (20), `lib/campaigns/resolve-zone.ts` (40) | — | **Copiée en partie** + test de parité (T2) : `ProgDraft` (forme complète, A-2), `DEFAULT_PROG_DRAFT`, `draftTotalBudget`, `linksSelectionHash`, formats ; `computeForecast` (`ForecastStrip.tsx`) ; `channels.ts` et `platform-links.ts` entiers. **Non copiés** : `pressureCurve`, `clampPressure`, `buildInZoneWeights`, `diffusion*`, `resolvePressureIndicators`, `strategyFieldsFromDraft`, `pressureFromCurve`, `INTENSITY_*`, `*_META` de stratégie, `resolveDownloadStrategyId`, `resolve-zone.ts`, `cibles/draft.ts` |
| Habillage | `steps/ui.tsx` (280), `wizard/FilAriane.tsx` (209), `wizard/StepMemo.tsx` (95) | — | `StepShell`/`FilAriane`/`StepMemo` **non portés** (A-6) ; primitives → briques `angular/src/app/ui/*` existantes |

**Laissé en React jusqu'à la bascule (Q5 tranchée : React gelé, retiré après la boucle prouvée) :** tout ce que la V1 ne porte pas (Pression, Stratégie, panier/indicateur, ad server, custom bidding), `ActivationPanel.tsx` (⑦), `SuiviV2` et `CampaignOverview` (Aperçu → ⑧), le chemin « jeu risque VIVANT » de `rattacher` (sans extraction) utilisé par le wizard React, la simulation du module risque (`RQ/etapes/campagne`), le plan média des zones (`CA/panneaux/zones/plan-media.component.ts`, boîte à outils, inchangé), l'overlay `MagelianOverlay` entier (il continue de marcher en parallèle). Le bouton « Préparer l'activation → ⑦ » mène à ⑦ qui reste `mg-etape-bientot` avec son lien vers l'onglet React (`ONGLET_REACT`, `logique/parcours.ts:60`).

### Côté Angular

- `logique/parcours.ts:19` : l'étape `'plan'` existe ; `carte.page.html:46` la rend par `@default { <mg-etape-bientot> }` ; `ONGLET_REACT.plan = 'strategie'` (à retirer pour `plan` en T3).
- `carte.page.ts` = **375/400** lignes (plafond `tests/unit/angular/taille-fichiers.test.ts`) : rien n'y entre ; fournisseurs dans `carte.fournisseurs.ts` (44 l.), le `@case ('plan')` dans `carte.page.html`.
- Briques UI : `ui/{entete-section, champ, reglette, confirmation, notifications, tuile-chiffre, bandeau-kpi, kpi, pastille, icone, tableau}`. Écrivain d'URL unique : `etat/ecrire-parametres.ts`. Patron d'état reflété dans l'URL : `etat/zone-analysee.service.ts` / `etat/jeu-zones.service.ts` (lot 5). HTTP : `core/http/http-base.service.ts` (`baseUrl`), `core/http/telecharger.ts` (téléchargement Bearer).
- Lot 5 : `data/jeux.api.ts` (`lister`, `extractions(id)`, type `Extraction` partagé avec `risques/data/jeux-zones.api.ts:81` — **sans `plateformes`**).
- Aucune brique Angular de campagne/stratégie n'existe (seuls `admin/sources` lit `GET /api/admin/campaigns` pour l'import DSP — ne pas la réutiliser, autre besoin).

### Côté serveur

- `rattacher` (321 l.) : `chargerJeu(…, { type: 'risque' })` → **409 pour un jeu de zone** ; relit `zone_set_cp` VIVANT puis `genererPlanCp` ; écrit la stratégie `algorithm_code: 'zone_set'`, `objective_code: 'maximize_impressions'`, `status: 'active'`, `weighting_mode: 'by_zone_set'`, `in_zone_weights.mode = 'zone_set'`, **sans `total_budget`, dates, `forecast_cpm` ni `kpi_target`** ; lots de 50 dans `bidding_zone_configs` ; archive les stratégies précédentes APRÈS ; `refresh_campaign_rollups`.
- `get_campaign_expected` (sql/113, vérifié en base le 25/10) : avec `objective_code = 'maximize_impressions'` et `kpi_target > 0`, le volume attendu de ⑧ = `kpi_target` × temps écoulé ; sinon `total_budget ÷ forecast_cpm × 1 000` × temps. **Le total des impressions prévues a donc déjà sa place : `kpi_target`.**
- `zone_set_extraction_cp` (immuable) porte déjà `multiplicateur numeric(6,3)` et `retenu` par CP : le plan d'une extraction EST écrit, il suffit de le recopier. `zone_set_extraction_unites` (sql/278) porte la liste par plateforme.
- `GET /api/zones/jeux/[id]/extractions` : le `select` ne rend pas `plateformes` (colonne `jsonb`, résumé par plateforme du lot 5), ni les CP.
- `PUT /api/campaigns/[campaignId]/channels` : écrit `dsp_campaigns.geo_strategy` par fusion non destructive (`budgets`, `links`, `pruneBudgets` au retrait d'un canal) ; ne connaît pas de CPM par canal.
- `PATCH /api/bidding/strategies/[id]` : schéma partiel (dont `kpi_target`, `total_budget`) ; ne régénère `bidding_zone_configs` QUE si `weighting_mode`/`in_zone_weights`/`out_zone_weights` changent (`route.ts:7-8, 258`) — on peut donc lui confier budget, dates, CPM et impressions prévues sans toucher au plan.

### Écarts relevés (corrigés par ce plan)

| # | Constat | Ce que fait ce plan |
|---|---|---|
| E1 | La spec dit « cible = extraction », mais `rattacher` refuse tout jeu de zone (lot 5, A-3, A-15 : « lot ⑥ ») et ne sait pas lire une extraction. | T1 : `rattacher` accepte `{ campagne, extraction }` ; sans `extraction`, comportement INCHANGÉ (React). |
| E2 | **Défaut React** : sur le chemin « jeu de zones », le Lancement n'écrit ni budget, ni dates, ni CPM — seuls les canaux (et leurs budgets) partent. Le rythme de ⑧ lit `total_budget` et le volume attendu. | T6 : après `rattacher`, `PATCH /api/bidding/strategies/[id]` avec `total_budget`, `forecast_cpm` (CPM moyen pondéré), `start_date`, `end_date`, **`kpi_target` = total des impressions prévues** (route existante). Correction listée au rapport, conforme au skill (défaut objectif). |
| E3 | `GET /api/bidding/objectives` n'existe plus ; React montre une liste vide et envoie `maximize_leads` par défaut. | **Sans objet en V1** (Q-2 : la Stratégie n'est pas portée). React garde son défaut jusqu'à la bascule. |
| E4 | `pression-classes` (Suivi React) refuse un jeu de zone (409) : une campagne rattachée à une extraction de jeu de zone affichera une erreur dans ce bloc du Suivi React. | Hors lot ; le bloc n'est pas porté en ⑧ (spec § 19.4). Noté dans `ARCHITECTURE.md` et au rapport final. |
| E5 | Aucun CPM par plateforme n'est stocké : `forecast_cpm` est global, alors que la V1 compare le prévu au livré **par plateforme**. | T1 : `cpm_prevus` dans `channels` (A-10). |

---

## Routes API

**Une route neuve** (lecture des CP d'une extraction, A-11), deux étendues (`rattacher`, `channels` PUT), un `select` élargi (`extractions` GET). Réutilisées sans changement :

`GET/POST /api/admin/campaigns` · `GET/PATCH/DELETE /api/admin/campaigns/[id]` · `GET /api/admin/campaigns/[id]/organizations` · `GET /api/campaigns/[campaignId]/channels` · `GET/PATCH /api/bidding/strategies/[id]` · `GET /api/bidding/strategies` · `GET/POST /api/bidding/strategies/drafts` · `GET/DELETE /api/bidding/strategies/drafts/[id]` · `GET /api/dsp/dv360/resources` · `GET /api/user/demo-mode`, `POST` idem · `GET /api/zones/jeux` · `GET /api/zones/jeux/[id]/extractions` (select élargi) · `POST /api/zones/jeux/[id]/rattacher` (étendue) · `PUT /api/campaigns/[campaignId]/channels` (étendue).

**Plus appelées par ⑥ (V1)** : `POST /api/bidding/strategies`, `GET /api/bidding/strategies/[id]/export`, `GET /api/cibles/indicators`, `GET /api/custom-geo/list`, `POST /api/custom-geo/source/{indicator-threshold,composite}`, `POST /api/custom-geo/save`, `GET /api/admin/campaigns/attachable`, `POST /api/admin/campaigns/[id]/absorb`, `GET /api/custom-geo/national-totals`. Toutes restent, React s'en sert.

Charge I/O : aucune requête lourde neuve. La recopie d'une extraction lit ≤ 7 000 lignes indexées par `(extraction_id, code_postal)` par `lireTout` (moins que le chemin vivant actuel, qui relit `zone_set_cp` ET rejoue `genererPlanCp`) ; la lecture des CP pour l'affichage (A-11) est la même lecture, au clic, mise en cache par le service. Lectures Angular à la demande (liste des campagnes au 1er clic du sélecteur, comme `choix-zone-analysee`), jamais > 3 appels simultanés : le préremplissage (campagne, stratégie, brouillon, canaux) est SÉQUENTIEL.

---

## Arbitrages (tranchés ; coût si faux)

Ceux de la spec § 16.8, des lots 3, 4 et 5 s'appliquent. Ajoutés :

| # | Point | Tranché | Coût si faux |
|---|---|---|---|
| A-1 | Campagne courante | `?campagne=<uuid>` (spec § 5), écrit par `ecrire-parametres.ts` seul. Sélecteur dans la barre du parcours aux étapes `plan`, `activation`, `live` (Q2 tranchée) : liste lue au 1er clic, « Nouvelle campagne » en tête. Sans `?campagne=`, le panneau ⑥ montre le hall porté (créer / reprendre une création / modifier une campagne lancée). Campagne d'un autre espace collée → « Campagne introuvable dans cet espace. », paramètre retiré (patron lot 5). | un composant |
| A-2 | Brouillon | `ProgDraft` à l'identique **dans sa forme** (compat React : un brouillon repris d'un côté se rouvre de l'autre), en signal dans `PlanCampagneService` ; ⑥ n'édite pas les champs hors V1 (`pressure`, `cibles`, `pressureVariable`, `diffusion`, `objective`, `kpiTarget`, `freqCap*`, `pacing`, `executionMode`) et les laisse à leur valeur lue. Autosave serveur (`bidding_strategy_drafts`) au même débit que `useDraftAutosave` ; PAS dans l'URL. Le numéro d'« étape » envoyé au brouillon = la section dépliée la plus basse. `ProgDraft` gagne côté Angular seulement `cpmPrevus: Record<string, number>` et `jeuZones.extraction` (champs facultatifs, ignorés par React). | un champ |
| A-3 | Cible « extraction » | Source unique de la section Cible : **jeu (les deux types) + version d'extraction**. Un jeu sans extraction est listé grisé : « Aucune extraction : figez-la à l'étape ⑤ » (risque : « dans le module risque »). Si `?jeu=&x=` est posé en entrant en ⑥, il est PROPOSÉ, pas pris (patron lot 5, A-13). | une liste |
| A-4 | Plan d'une extraction | `rattacher` avec `extraction` recopie `zone_set_extraction_cp.multiplicateur > 0` tel quel (aucun recalcul : l'extraction est figée), `in_zone_weights` gagne `extraction_id`, `extraction_version`, `plateformes` (le résumé) en plus des clés actuelles ; sans `extraction`, rien ne change. | — |
| A-5 | Plateformes pré-cochées | Choisir une extraction PRÉ-COCHE dans la section 2 les plateformes de son résumé (`plateformes`) et affiche en face de chacune sa maille et son taux d'utile (lecture seule) ; l'utilisateur peut décocher. Codes : correspondance `plateformes_geo.plateforme` → codes de canaux de `lib/campaigns/channels.ts` dans UNE table pure testée ; un code sans correspondance est affiché « non relié » et n'est pas coché. | une table |
| A-6 | Habillage | Pas de fil interne, pas de `StepMemo` : trois `mg-entete-section` repliables (bandeau `--bg-level-2`, point teal) ; le paragraphe principal de chaque mémo React devient le `Lead` de la section ; le pied (récap + « Créer la campagne ») est toujours visible. Textes React repris À LA LETTRE (sentence case déjà respecté), tutoiement compris, sauf les phrases qui parlent d'enchère, de multiplicateur ou de pilotage par l'agent (retirées). | du texte |
| A-7 | Mode démo | Interrupteur porté dans le hall (comme l'overlay React), même route. | — |
| A-8 | Note « filtre de carte » | Portée telle quelle en tête du panneau quand un filtre de ① est actif (lu depuis l'état de la carte, aucun fetch). | — |
| A-9 | **Cible V1 = extraction seule** | Le panier de zones, la zone par indicateur à seuil et le « national » de React ne sont pas portés : les trois n'existent que pour écrire une **courbe d'enchère** (`buildInZoneWeights` — `by_insee_variable`, `uniform` ×M, abstention historique pour le national), hors V1. La même géographie se fait en ③ (liste de CP, seuil IRIS/CP) puis ⑤. Un seul chemin de lancement (`rattacher`). Voir Q-3 pour le national. | rouvrir le chemin (b) de `StepLancement` sans courbe : ≈ 0,4 j |
| A-10 | **Budget, CPM et impressions prévus** | Par plateforme cochée (DSP et social) : budget € (déjà `channelBudgets`) + **CPM prévu €** ; impressions prévues = `computeForecast` (budget ÷ CPM × 1 000), arrondi à l'unité. Stockage : `cpm_prevus` dans `dsp_campaigns.geo_strategy` à côté de `budgets`, même schéma (`ChannelBudgetsSchema`), même élagage (`pruneBudgets`) ; les impressions ne sont PAS stockées (dérivées, une seule formule). Stratégie : `kpi_target` = Σ impressions prévues, `forecast_cpm` = Σ budgets ÷ Σ impressions × 1 000 (CPM moyen pondéré), `total_budget` = Σ budgets. Une plateforme sans CPM n'a pas d'impressions prévues et bloque le lancement (« CPM prévu manquant : <plateforme> »). | une colonne si ⑧ veut les impressions par plateforme en SQL |
| A-11 | **Impressions prévues par CP** | Pour une plateforme dont la maille d'achat dans l'extraction est le CP : impressions du CP = impressions de la plateforme × multiplicateur du CP ÷ Σ multiplicateurs **de ses CP** (`zone_set_extraction_unites` de cette plateforme), formule pure testée, alignée sur `planned_share`. Lu au clic « Voir par CP » par `GET /api/zones/jeux/[id]/extractions/[version]/cp?plateforme=` (route neuve, T1, `lireTout` ≤ 7 000, `jsonb` simple) ; affiché en `mg-tableau` trié par impressions, 50 lignes + « Voir tout ». Les plateformes à une autre maille (cercles, communes, départements) affichent leur nombre d'unités et le total, sans répartition (§ 19.2 : « par CP quand la plateforme le permet »). | une colonne ou une RPC si l'affichage par CP doit aller sur la carte |

---

## Questions pour Vincent (produit seulement ; recommandation entre crochets)

| # | Question | Ce qui en dépend | Recommandation |
|---|---|---|---|
| Q-1 | **Un jeu RISQUE en ⑥ : on rattache sa dernière extraction (figée), ou ses codes postaux VIVANTS comme le fait React aujourd'hui ?** | T1, T4 | **L'extraction, pour les deux types.** |
| Q-2 | **Objectif de la stratégie : rétablir la lecture du catalogue, ou masquer objectif + KPI en ⑥ ?** | ex-T6 | Rétablir `GET /api/bidding/objectives`. |
| Q-3 | **Une campagne nationale sans zone (React : « national ») a-t-elle sa place en V1 ?** Elle n'a pas de plan géographique : ⑧ ne comparerait que le total et la région. | A-9, T4, T6 | **Non en V1** ; si oui, la faire passer par une zone « France entière » de ③ → extraction, plutôt que rouvrir un second chemin de lancement. |

Q2 et Q4 de la spec sont **tranchées** (§ 14) et appliquées (A-1 ; une extraction = le plan unique de la campagne).

**Tranché par Vincent le 2026-10-25** : **Q-1 → l'extraction figée**, pour les deux types de jeu (recommandation adoptée). **Q-2 → ni rétablir ni porter : la section Stratégie (objectif + KPI) n'entre PAS dans ⑥** — « on est juste dans le suivi et contrôle des impressions ». Pas de route `GET /api/bidding/objectives`. Puis, le même jour : **V1 = contrôle des impressions et du budget dépensé** (spec § 19) — la Pression (levier d'enchère), l'ad server et les fichiers custom bidding sortent aussi ; l'ancienne T6 est retirée. React garde ses sections telles quelles jusqu'à la bascule. Q-3 ouverte, A-9 appliqué en attendant.

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `app/api/zones/jeux/[id]/rattacher/route.ts` (modifié), `app/api/zones/jeux/[id]/extractions/route.ts` (select), `app/api/zones/jeux/[id]/extractions/[version]/cp/route.ts` (créé), `app/api/campaigns/[campaignId]/channels/route.ts` + `lib/campaigns/channels.ts` (`cpm_prevus`), `tests/integration/rattacher-extraction.test.ts` (créé) | T1 |
| `angular/.../carte/logique/plan/brouillon.ts`, `canaux.ts`, `liens-plateformes.ts`, `plateformes-canaux.ts`, `impressions.ts` (créés) ; `tests/unit/angular/plan-logique-paritaire.test.ts` (créé) | T2 : logique pure + parité |
| `angular/.../carte/data/plan.api.ts` (créé), `carte.fournisseurs.ts` (modifié), `etat/plan-campagne.service.ts` (créé) | T2 : API + état |
| `angular/.../carte/parcours/choix-campagne.component.ts` (créé), `barre-parcours.component.ts` (modifié), `panneaux/plan/panneau-plan.component.ts`, `hall-campagnes.component.ts` (créés), `carte.page.html`, `logique/parcours.ts` (modifiés) | T3 |
| `angular/.../carte/panneaux/plan/section-cible.component.ts`, `source-plan.component.ts` (créés) | T4 |
| `angular/.../carte/panneaux/plan/section-plateformes.component.ts`, `liaison-canal.component.ts`, `liaison-dv360.component.ts`, `liaison-manuelle.component.ts`, `recap-canaux.component.ts`, `section-impressions.component.ts` (créés) | T5 |
| `angular/.../carte/panneaux/plan/pied-lancement.component.ts` (créé), `etat/lancement-campagne.ts` (créé, fonction de lancement séquentielle) | T6 |
| `ARCHITECTURE.md`, `angular/src/app/features/carte/README.md` | T1, T7 |

Chaque fichier `.ts` < 400 lignes : `StepLancement` (527) se coupe en composant + logique pure (`logique/plan/*`) ; `StepCible` n'est plus porté qu'en partie (identité + source).

---

## Pièges Angular / AIDA (à recopier dans CHAQUE brief de tâche Angular)

- Contrat AIDA : aucun `position: fixed`, aucun écouteur `window`/`document`, aucun `localStorage` neuf, aucun portail hors de l'arbre (menus = `<dialog>`/popover dans l'arbre, cf. `portails-hors-ombre.test.ts`), services d'état **fournis par la page** (jamais `providedIn: 'root'`), services d'API dans `FOURNISSEURS_DISTANTS`, adresses par `HttpBaseService.baseUrl` uniquement, pas de `@angular/core/rxjs-interop`.
- Couleurs par jetons uniquement (`var(--…)`), jamais de hex (React a un `rgba(78,205,196,0.07)` dans `FilAriane` : non porté). Texte teal/statut sur fond clair : contraste à vérifier dans les deux thèmes (le cadre admin a `--teal-texte`, pas la carte : utiliser `--text-primary` pour le texte, le teal pour les bordures et points).
- `ProgDraft` est un objet : `update(d => ({ ...d, x }))`, jamais muter ; valeurs dérivées (`draftTotalBudget`, validité du lancement, indicateurs de pression) en `computed`, jamais un `effect` qui recopie.
- Préremplissage campagne → stratégie → brouillon : React l'enchaîne par trois `useEffect` avec un drapeau `restoredAppliedRef` (le brouillon prime sur la stratégie). Le porter en UNE fonction séquentielle annulable (jeton, patron `lecture-annulable.ts`), pas en trois `effect`.
- Changer de campagne pendant une lecture : annuler et ignorer la réponse tardive (jeton) — sinon le brouillon d'A s'écrit dans B.
- `PressureControl` bidirectionnel : la réglette écrit `pressure`, les champs CPM écrivent `pressure` recalculé ; pas d'`effect` croisé (boucle) — deux gestionnaires d'événement.
- `inject()` jamais après un `await` (NG0203) ; zoneless : un `setTimeout` (debounce de l'autosave) n'actualise la vue que s'il écrit un signal.
- Nom d'`input()` qui masque un attribut natif (`title`, `id`) : préfixer.
- Téléchargements custom bidding : `core/http/telecharger.ts` (Bearer), jamais un `<a href>` (même défaut que React corrigé au lot risque, A8).
- Nombres : `core/format/nombre` (`formaterNombre`…), jamais un `fmtEUR` local recopié ; les formats de `types.ts` (`fmtMult`, `fmtEUR`, `fmtDateShort`) sont portés UNE fois dans `logique/plan/brouillon.ts` en s'appuyant dessus.

> Note du 25/10 : les pièges `PressureControl` et « téléchargements custom bidding » sont **sans objet en V1** (non portés) ; ils restent ici pour le temps 2. Le piège « deux gestionnaires, pas d'`effect` croisé » vaut aussi pour le couple budget ↔ CPM ↔ impressions de la section Impressions prévues (A-10 : on saisit budget et CPM, les impressions sont un `computed`).

---

## Groupe A — socle (relecture 1)

### Task 1 : serveur — `rattacher` accepte une extraction, CPM prévus, CP d'une extraction

**Files :** `app/api/zones/jeux/[id]/rattacher/route.ts`, `app/api/zones/jeux/[id]/extractions/route.ts`, `app/api/zones/jeux/[id]/extractions/[version]/cp/route.ts`, `app/api/campaigns/[campaignId]/channels/route.ts`, `lib/campaigns/channels.ts`, `tests/integration/rattacher-extraction.test.ts`, `ARCHITECTURE.md`.

- [ ] `rattacher` — corps : `{ campagne: uuid, extraction?: uuid }` (Zod, `lireCorps`). Sans `extraction` : code actuel INCHANGÉ (jeu risque seul, vivant). Avec : `chargerJeu(…)` **sans** filtre de type (espace vérifié par le chargeur), l'extraction doit appartenir au jeu (sinon 404 « Extraction introuvable pour ce jeu. ») ; lecture `zone_set_extraction_cp` (`code_postal, multiplicateur`) par `lireTout` plafond 7 000, `multiplicateur > 0` ; zéro ligne → 409 (message actuel). Stratégie : mêmes champs qu'aujourd'hui (dont `objective_code: 'maximize_impressions'`, que `get_campaign_expected` lit), nom `Jeu de zones — <nom> (extraction v<n>)`, `in_zone_weights` + `extraction_id`, `extraction_version`, `taux_utile` et `part_plan_en_zone` LUS de l'extraction, `plateformes`. Lots de 50, rollback de la stratégie si un lot échoue, archivage après, `refresh_campaign_rollups` : réutiliser les blocs existants (extraire une fonction locale `ecrirePlan(lignes)` partagée par les deux chemins, pas de copie).
- [ ] `extractions` GET : ajouter `plateformes` au `select` (chaîne littérale, cf. commentaire supabase-js) ; type `Extraction` Angular (`risques/data/jeux-zones.api.ts`) : `plateformes?: unknown[] | null`.
- [ ] `extractions/[version]/cp` GET (A-11) : `?plateforme=` facultatif ; rend `{ cp: [{ code_postal, multiplicateur }], total }` des CP retenus (de `zone_set_extraction_unites` pour la plateforme si donnée, sinon `zone_set_extraction_cp`), `lireTout` plafond 7 000, espace vérifié par `chargerJeu`. `force-dynamic`, `getSession`, Zod sur les paramètres.
- [ ] `channels` PUT : `cpm_prevus: ChannelBudgetsSchema.optional()` à côté de `budgets`, fusion non destructive et `pruneBudgets` identiques ; GET le rend. Test unitaire du schéma (clé inconnue, valeur négative refusée).
- [ ] Tests d'intégration (base locale) : extraction d'un jeu de zone → 201, `bidding_zone_configs` = les CP à multiplicateur > 0 de l'extraction, à l'unité près ; extraction d'un autre jeu → 404 ; jeu d'un autre espace → 404/403 du chargeur ; sans `extraction` sur un jeu de zone → 409 (inchangé) ; jeu risque sans extraction → chiffres actuels (caractérisation du lot 5 verte) ; `cp` d'une extraction = même compte que `bidding_zone_configs` ; `cpm_prevus` relu après PUT, élagué au retrait du canal.
- [ ] `ARCHITECTURE.md` (sections des routes, par `Grep "rattacher"` et `Grep "channels"`) + la route neuve + E4 noté. `npx tsc --noEmit`, `npm run test:unit`, `npm run test:integration` (codes de retour lus sans pipe).
- [ ] Commit `feat(api): ⑥ rattacher une extraction, CPM prévus par plateforme, CP d'une extraction (lot 6, T1)`.

### Task 2 : Angular — logique pure, API, état de la campagne

**Files :** `logique/plan/{brouillon,canaux,liens-plateformes,plateformes-canaux,impressions}.ts` (+ specs), `tests/unit/angular/plan-logique-paritaire.test.ts`, `data/plan.api.ts` (+ spec), `carte.fournisseurs.ts`, `etat/plan-campagne.service.ts` (+ spec).

- [ ] Copier À L'IDENTIQUE les fonctions pures de la ligne « Logique pure » du pré-vol (sous-ensemble V1 seulement) : `ProgDraft` + `DEFAULT_PROG_DRAFT`, `draftTotalBudget`, `linksSelectionHash`, formats ; `computeForecast` ; `lib/campaigns/channels.ts`, `lib/campaigns/platform-links.ts`. Test de parité sur le patron de `carte-logique-paritaire.test.ts` (mêmes entrées → mêmes sorties, React importé côté Vitest racine). `plateformes-canaux.ts` : la table A-5. `impressions.ts` (neuf, pas de parité) : impressions par plateforme, totaux et CPM moyen pondéré (A-10), répartition par CP (A-11) — specs : arrondis, CPM nul ou absent, plateforme sans CP.
- [ ] `plan.api.ts` : une méthode par route de la liste « réutilisées » + les trois de T1, typée d'après la route LUE (pas devinée) ; `rattacher(jeu, { campagne, extraction })`, `cpExtraction(jeu, version, plateforme?)`.
- [ ] `PlanCampagneService` (fourni par la page via `carte.fournisseurs.ts`) : `campagne` ↔ `?campagne=` ; `brouillon` signal ; préremplissage séquentiel annulable (campagne → stratégie existante → brouillon serveur, le brouillon prime : règle `restoredAppliedRef`) ; autosave débouncé ; `repartirDeZero()` ; `strategieExistante` (id + statut) ; cache des CP d'extraction par `(jeu, version, plateforme)`. Specs : changement de campagne en cours de lecture (réponse tardive ignorée), brouillon prioritaire, autosave n'écrit pas pendant le préremplissage, champs hors V1 d'un brouillon React conservés à l'aller-retour.
- [ ] `cd angular && npx ng test --watch=false`, `npx tsc --noEmit` racine, `npm run test:unit`. Commit `feat(angular): ⑥ logique du plan, API et campagne courante (lot 6, T2)`.

**Relecture 1** (T1 + T2, une passe, modèle le plus capable) : le chemin sans `extraction` est-il strictement inchangé ? `cpm_prevus` est-il élagué comme `budgets` ? la répartition par CP retombe-t-elle sur le total de la plateforme (somme = total, à l'arrondi près, dit dans le test) ? aucun `effect` qui recopie ?

## Groupe B — campagne et cible (relecture 2)

### Task 3 : sélecteur de campagne, hall, squelette du panneau ⑥

**Files :** `parcours/choix-campagne.component.ts`, `parcours/barre-parcours.component.ts`, `panneaux/plan/panneau-plan.component.ts`, `panneaux/plan/hall-campagnes.component.ts`, `carte.page.html`, `logique/parcours.ts` (+ specs).

- [ ] `mg-choix-campagne` dans la barre aux étapes `plan`/`activation`/`live` (A-1) : liste au 1er clic (`GET /api/admin/campaigns`), « Nouvelle campagne » (`POST`), campagne courante affichée par son nom. Aux étapes `activation`/`live` encore « bientôt », il écrit seulement `?campagne=`.
- [ ] `mg-hall-campagnes` = port de `CreationHall` (trois blocs, badge brouillon d'après `drafts`, suppression d'une coquille avec `mg-confirmation`, interrupteur mode démo A-7) ; affiché par le panneau quand `?campagne=` est vide.
- [ ] `mg-panneau-plan` : note filtre (A-8), en-tête « Création / Modification — <nom> », bannière « Brouillon restauré (date) · Repartir de zéro », trois `mg-entete-section` vides (remplies en T4-T5) et le pied. `@case ('plan') { <mg-panneau-plan /> }` ; `ONGLET_REACT` perd `plan` ; pastille « renseignée » de l'étape = une stratégie existe pour la campagne courante.
- [ ] Specs (sélecteur, hall, `?campagne=` d'un autre espace). Commit `feat(angular): ⑥ sélecteur de campagne, hall et panneau du plan (lot 6, T3)`.

### Task 4 : section Cible (identité, extraction)

**Files :** `panneaux/plan/section-cible.component.ts`, `panneaux/plan/source-plan.component.ts` (+ specs).

- [ ] Port de la partie identité de `StepCible` (nom, annonceur, produit ; organisations de la campagne). Panier de zones et indicateur à seuil **non portés** (A-9).
- [ ] `mg-source-plan` = port de `SourcePlan`, déplacé ici et étendu (A-3) : jeux des deux types (`GET /api/zones/jeux?type=tous`, badge « Risque » / « Zone »), puis versions d'extraction du jeu choisi (`extractions(id)`, au clic), chiffres de l'extraction (CP retenus, taux d'utile, part du plan en zone, plateformes). Phrase reprise : « Le plan vient du jeu de zones <nom> : ce sont ses poids par classe qui répartissent le budget. » (sans la phrase sur le multiplicateur d'enchère). Proposition `?jeu=&x=`.
- [ ] Specs : jeu sans extraction grisé, proposition non prise d'office, changement d'extraction → plateformes re-pré-cochées (A-5) sans perdre les budgets saisis des plateformes restantes. Commit `feat(angular): ⑥ section Cible — extraction de ⑤ (lot 6, T4)`.

**Relecture 2** (T3 + T4).

## Groupe C — plateformes, impressions prévues, lancement (relecture 3)

### Task 5 : sections Plateformes et budget, Impressions prévues

**Files :** `section-plateformes`, `liaison-canal`, `liaison-dv360`, `liaison-manuelle`, `recap-canaux`, `section-impressions` (+ specs).

- [ ] Port de `StepCanaux` **sans** le bloc « Ad server (mesure) » ni `AbsorbPanel` (canaux DSP et social filtrés aux connexions de l'organisation, tout disponible en démo ; une ligne € par canal coché ; budget global = somme en lecture seule ; période), `ChannelLinkAccordion` (cascade DV360 annonceur → campagne → IO si connecté, saisie manuelle sinon — gardée : ⑦ pousse le ciblage et ⑧ lit les rapports par ces liaisons), `ChannelHubRecap`, coche de confirmation réinitialisée par `linksSelectionHash`. A-5 : pré-coche + ligne maille/taux d'utile depuis l'extraction choisie.
- [ ] `mg-section-impressions` (remplace `ForecastStrip`, A-10, A-11) : par plateforme cochée — budget (repris de la section 2), **CPM prévu** (champ €), **impressions prévues** (`computed`), maille et nombre d'unités de l'extraction ; « Voir par CP » pour les plateformes au CP (tableau A-11, lu au clic) ; ligne de total (budget, impressions, CPM moyen pondéré). Bandeau de l'étape : budget, impressions prévues, CPM moyen, plateformes, CP au plan.
- [ ] Specs : impressions = budget ÷ CPM × 1 000 ; CPM manquant → pas d'impressions et lancement bloqué ; répartition par CP qui retombe sur le total ; décocher une plateforme retire son budget et son CPM. Commit `feat(angular): ⑥ plateformes, budgets et impressions prévues (lot 6, T5)`.

### Task 6 : pied « Lancement »

**Files :** `panneaux/plan/pied-lancement.component.ts`, `etat/lancement-campagne.ts` (+ specs).

- [ ] Récap (identité, extraction, plateformes avec budget / CPM / impressions prévues, période, totaux) et règle de validité de React (`invalid`, `StepLancement.tsx:209-211`) restreinte au chemin extraction + CPM prévus complets (A-10), en `computed`.
- [ ] `lancer()` séquentiel, **un seul chemin** (A-9) : `PATCH` identité si changée → `rattacher({ campagne, extraction })` → **`PATCH /api/bidding/strategies/[id]`** (`total_budget`, `forecast_cpm` pondéré, `start_date`, `end_date`, `kpi_target` = Σ impressions prévues) — E2 → `PUT channels` (sélection, `budgets`, `links`, `cpm_prevus`) → message « N codes postaux · X % du plan en zone · Y % d'utile · Z impressions prévues ». Brouillon jeté après succès. Toute erreur s'affiche en `mg-notifications` avec le message de la route. Re-lancer une campagne déjà rattachée = même chemin (`rattacher` archive l'ancienne stratégie).
- [ ] Après lancement : bouton « Préparer l'activation → ⑦ » (pas de téléchargements custom bidding — § 19).
- [ ] Specs : ordre des appels (HTTP de test), échec de `rattacher` → aucun `PATCH` ni `PUT`, `kpi_target` et `forecast_cpm` envoyés égaux aux totaux de la section Impressions. Commit `feat(angular): ⑥ lancement de la campagne (lot 6, T6)`.

**Relecture 3** (T5 + T6) : impressions prévues identiques entre l'écran, le `PATCH` et `get_campaign_expected` relu en base (même campagne, fin de période) ?

## Task 7 : revue finale, factorisation, preuve navigateur

- [ ] Revue finale du lot : mineurs accumulés, passe de factorisation inter-tâches (dire ce qui reste dupliqué : la logique pure EST dupliquée par construction, verrouillée par parité — à retirer côté React à la bascule).
- [ ] **Preuve navigateur, une seule fois, deux thèmes** (`L6-T7-*`), sur :4200 + :3000 : espace BMW GROUP — nouvelle campagne depuis le sélecteur ; cible = extraction v1 du jeu de zone du lot 5 (lycées BdR) ; plateformes pré-cochées, budgets, CPM prévus, période ; impressions prévues par plateforme et « Voir par CP » pour DV360 ; Lancer → message chiffré ; la même campagne ouverte dans l'overlay React (Aperçu / Suivi) montre le plan, le budget, les dates et le volume attendu (E2 corrigé) ; brouillon : quitter à mi-chemin, recharger `?etape=plan&campagne=…` → « Brouillon restauré » ; campagne collée dans Marine nationale → message et paramètre retiré.
- [ ] `ARCHITECTURE.md` (§ carte Angular : étape ⑥, `?campagne=`, services, `cpm_prevus`), `angular/src/app/features/carte/README.md`. Tests complets (`npm test`, `cd angular && npx ng test --watch=false`, `npx tsc --noEmit`, `npm run build` avec les variables locales explicites).
- [ ] Commit `docs: ⑥ Plan — revue finale et preuve navigateur (lot 6, T7)`.

---

## Estimation

| Groupe | Tâches | Charge |
|---|---|---|
| A socle | T1, T2 | 0,75 j (T1 grossit d'une route et d'un champ ; T2 maigrit : parité réduite, plus de courbe ni de zone composite) |
| B campagne + cible | T3, T4 | 0,6 j (T4 sans panier ni indicateur) |
| C plateformes, impressions, lancement | T5, T6 | 0,6 j (ni ad server ni absorption ; un seul chemin de lancement, sans custom bidding) |
| Fin | T7 | 0,3 j |
| **Total** | **7 tâches, 3 relectures, 1 preuve** | **≈ 2,25 jours** (contre ≈ 3 avant la décision du 25/10) |

**Critères de fin du lot :** une campagne créée en ⑥ depuis une extraction porte en base son plan CP (`bidding_zone_configs` = l'extraction), `total_budget`, dates, `forecast_cpm` et `kpi_target` cohérents avec l'écran, et `cpm_prevus` par plateforme ; aucune trace de stratégie, de pression, d'ad server ni de custom bidding dans l'écran Angular ; React inchangé (le chemin sans `extraction` de `rattacher` passe sa caractérisation) ; tests et build verts ; preuve navigateur dans les deux thèmes.
