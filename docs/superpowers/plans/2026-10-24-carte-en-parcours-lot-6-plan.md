# La carte en parcours — lot 6 « ⑥ Plan » — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (ou superpowers:executing-plans). Skill `porting-react-to-angular` chargé AVANT chaque tâche Angular. Cases à cocher (`- [ ]`) pour le suivi.

**Mode accéléré (Vincent, 24/10, « accélère ») — il fait foi sur tout le reste de ce plan :** ⑥ est un **PORTAGE quasi tel quel** du wizard de campagne React (Cible › Canaux › Pression › Stratégie › Lancement), replié en UNE étape à sections, sans le repenser ; on améliore après la bascule. 8 tâches groupées par écran, **une relecture par groupe** (4 groupes), seuls les défauts Critiques/Importants partent en correction (les mineurs vont à la revue finale), **preuve navigateur une seule fois**, en T8. Cible : **2,5 à 3 jours**.

**Goal :** à l'étape ⑥ de la carte Angular, choisir (ou créer) une campagne, lui donner pour cible une **extraction** de ⑤ (ou le national, ou le panier de zones / indicateur à seuil de React), cocher les plateformes et leurs budgets, régler la pression (×M + CPM €), la stratégie, et **lancer** : la stratégie et le plan CP sont écrits par les routes EXISTANTES.

**Architecture :** un panneau `mg-panneau-plan` à quatre sections à bandeau (`mg-entete-section`) + un pied « Lancement » ; un état `PlanCampagneService` fourni par la page (brouillon = `ProgDraft` porté, autosauvé côté serveur comme React) ; la campagne courante dans `?campagne=` ; la logique pure de `components/campaign/wizard/steps/types.ts` et `lib/campaigns/{channels,platform-links}.ts` COPIÉE en Angular et verrouillée par un test de parité. **Une seule modification serveur** : `POST /api/zones/jeux/[id]/rattacher` accepte une `extraction` (aujourd'hui il refuse tout jeu de type `zone` — lot 5, A-3/A-15 renvoyaient précisément ce point au lot ⑥).

**Tech Stack :** Angular 21.2 standalone zoneless signals, Tailwind 4, Vitest (`cd angular && npx ng test --watch=false`) ; Next.js 15, supabase-js, Zod, Vitest racine (`npm run test:unit`, `npm run test:integration`).

**Spec :** `docs/superpowers/specs/2026-10-13-carte-en-parcours-design.md` — § 16.1 ligne ⑥ (« le jeu de zones devient le plan média : budget, pression, CPM »), § 4 « ⑤ Plan » (ex-numérotation : écran à sections, sélecteur de campagne, cible = extraction, plateformes + budget, pression, stratégie), § 5 (`campagne` dans l'URL), § 13-14 **Q2 et Q4 TRANCHÉES** (« sélecteur de campagne dans la barre aux étapes ⑥-⑧, création seulement si l'espace n'en a aucune » ; « un plan par campagne en v1 », `refresh_campaign_rollups` ne lit qu'une stratégie). Lot 5 : `docs/superpowers/plans/2026-10-24-carte-en-parcours-lot-5.md` (extraction immuable, A-2, A-11, A-15). Mémoires : `feedback_mode_accelere`, `project_pression_cible` (toujours chiffré), `project_wizard_completion`, `feedback_agents_frugaux`, `feedback_angular_vigilance`, `feedback_no_hardcoded_colors`.

---

## Pré-vol : ce qui existe vraiment (reconnaissance du 24/10, worktree `carte-jeu-de-zones` = `c09c3542` + travail en cours du lot 5)

### L'existant React à porter (≈ 3 700 lignes)

Orchestrateur : `components/campaign/CampaignCockpit.tsx` (286 l., vue `prog` : cinq étapes, brouillon `ProgDraft`, préremplissage depuis la campagne puis depuis la stratégie existante, bannière « Brouillon restauré · Repartir de zéro »). Monté par `components/magelian/MagelianOverlay.tsx` (704 l.) onglet « Stratégie » : `CreationHall` (178 l.) tant qu'aucune campagne n'est ouverte, sinon « ← Choisir une autre campagne » + note « un filtre de carte ne s'applique pas à cette stratégie » + le cockpit `wizardOnly`.

| Écran / section React | Fichiers (lignes) | Routes appelées | Sort au lot 6 |
|---|---|---|---|
| Hall de création | `magelian/CreationHall.tsx` (178), parties de `MagelianOverlay.tsx` (listes, créer, supprimer une coquille, mode démo) | `GET/POST /api/admin/campaigns`, `DELETE /api/admin/campaigns/[id]`, `GET /api/bidding/strategies`, `GET /api/bidding/strategies/drafts`, `GET/POST /api/user/demo-mode` | **Porté** : hall dans le panneau ⑥ quand `?campagne=` est vide ; sélecteur dans la barre (T3) |
| ① Cible | `steps/StepCible.tsx` (423) : identité (nom, annonceur, produit), panier de zones enregistrées, zone par indicateur à seuil | `GET /api/cibles/indicators`, `GET /api/admin/campaigns/[id]/organizations`, `GET /api/custom-geo/list`, `POST /api/custom-geo/source/indicator-threshold`, `POST /api/custom-geo/save` | **Porté tel quel** (spec : « comportement React conservé ») + **source Extraction** en tête (T4) |
| Source du plan (jeu de zones) | `steps/SourcePlan.tsx` (200) — affichée DANS l'étape Pression en React | `GET /api/zones/jeux` | **Déplacé en section Cible** et généralisé aux extractions (T4) |
| ② Canaux & budgets | `StepCanaux.tsx` (285), `ChannelLinkAccordion.tsx` (66), `Dv360LinkPanel.tsx` (206), `PlatformLinkPanel.tsx` (96), `AbsorbPanel.tsx` (90), `ChannelHubRecap.tsx` (68), `ForecastStrip.tsx` (74) | `GET /api/campaigns/[campaignId]/channels`, `GET /api/dsp/dv360/resources`, `GET /api/admin/campaigns/attachable`, `POST /api/admin/campaigns/[id]/absorb`, `GET /api/custom-geo/national-totals` | **Porté tel quel** (T5) |
| ③ Pression | `StepPression.tsx` (111), `PressureControl.tsx` (171, bidirectionnel ×M ↔ CPM max/min) | aucune | **Porté tel quel** (T6), moins `SourcePlan` (passé en Cible) |
| ④ Stratégie | `StepStrategie.tsx` (152) : objectif, KPI, capping, rythme, mode d'exécution | `GET /api/bidding/objectives` — **⚠ ROUTE ABSENTE** (retirée par `113940f2`, « dépendance morte ») : React affiche une liste d'objectifs VIDE depuis | **Porté** ; objectif : Q-2 (T6) |
| ⑤ Lancement | `StepLancement.tsx` (527) : récap, validation, deux chemins (jeu → `rattacher` ; sinon stratégie POST/PATCH + activation), téléchargements custom bidding par canal | `PATCH /api/admin/campaigns/[id]`, `POST /api/zones/jeux/[id]/rattacher`, `PUT /api/campaigns/[campaignId]/channels`, `POST /api/bidding/strategies`, `GET/PATCH /api/bidding/strategies/[id]`, `GET /api/bidding/strategies/[id]/export?channel=`, `POST /api/custom-geo/source/composite` + `save` (zone composite, `lib/campaigns/resolve-zone.ts`) | **Porté** en pied du panneau (T7), + correction E2 |
| Autosave | `wizard/useDraftAutosave.ts` | `POST /api/bidding/strategies/drafts`, `GET/DELETE /api/bidding/strategies/drafts/[id]` | **Porté** dans `PlanCampagneService` (T2) |
| Logique pure | `steps/types.ts` (316 : `ProgDraft`, `pressureCurve`, `buildInZoneWeights`, `diffusionOutZoneWeights`, `draftTotalBudget`, `strategyFieldsFromDraft`, `linksSelectionHash`, `pressureFromCurve`, formats), `lib/campaigns/channels.ts` (96), `lib/campaigns/platform-links.ts` (76), `lib/cibles/draft.ts` (20), `lib/campaigns/resolve-zone.ts` (40) | — | **Copiée** + test de parité (T2) |
| Habillage | `steps/ui.tsx` (280 : `StepShell`, `Lead`, `OptionRow`, `FieldBlock`, `StandardFooter`…), `wizard/FilAriane.tsx` (209), `wizard/StepMemo.tsx` (95) | — | `StepShell`/`FilAriane`/`StepMemo` **non portés** (les sections remplacent le fil ; les mémos deviennent le `Lead` de chaque section, A-6) ; primitives → briques `angular/src/app/ui/*` existantes |

**Laissé en React jusqu'à la bascule (Q5 tranchée : React gelé, retiré après la boucle prouvée) :** `ActivationPanel.tsx` (⑦), `SuiviV2` et `CampaignOverview` (Aperçu → ⑧), le chemin « jeu risque VIVANT » de `rattacher` (sans extraction) utilisé par le wizard React, la simulation du module risque (`RQ/etapes/campagne`), le plan média des zones (`CA/panneaux/zones/plan-media.component.ts`, boîte à outils, inchangé), l'overlay `MagelianOverlay` entier (il continue de marcher en parallèle). Le bouton « Préparer l'activation → ⑦ » mène à ⑦ qui reste `mg-etape-bientot` avec son lien vers l'onglet React (`ONGLET_REACT`, `logique/parcours.ts:60`).

### Côté Angular

- `logique/parcours.ts:19` : l'étape `'plan'` existe ; `carte.page.html:46` la rend par `@default { <mg-etape-bientot> }` ; `ONGLET_REACT.plan = 'strategie'` (à retirer pour `plan` en T3).
- `carte.page.ts` = **375/400** lignes (plafond `tests/unit/angular/taille-fichiers.test.ts`) : rien n'y entre ; fournisseurs dans `carte.fournisseurs.ts` (44 l.), le `@case ('plan')` dans `carte.page.html`.
- Briques UI : `ui/{entete-section, champ, reglette, confirmation, notifications, tuile-chiffre, bandeau-kpi, kpi, pastille, icone, tableau}`. Écrivain d'URL unique : `etat/ecrire-parametres.ts`. Patron d'état reflété dans l'URL : `etat/zone-analysee.service.ts` / `etat/jeu-zones.service.ts` (lot 5). HTTP : `core/http/http-base.service.ts` (`baseUrl`), `core/http/telecharger.ts` (téléchargement Bearer).
- Lot 5 : `data/jeux.api.ts` (`lister`, `extractions(id)`, type `Extraction` partagé avec `risques/data/jeux-zones.api.ts:81` — **sans `plateformes`**).
- Aucune brique Angular de campagne/stratégie n'existe (seuls `admin/sources` lit `GET /api/admin/campaigns` pour l'import DSP — ne pas la réutiliser, autre besoin).

### Côté serveur

- `rattacher` (321 l.) : `chargerJeu(…, { type: 'risque' })` → **409 pour un jeu de zone** ; relit `zone_set_cp` VIVANT puis `genererPlanCp` ; écrit la stratégie `algorithm_code: 'zone_set'`, `weighting_mode: 'by_zone_set'`, `in_zone_weights.mode = 'zone_set'`, **sans `total_budget`, dates, `forecast_cpm`, objectif ni capping** ; lots de 50 dans `bidding_zone_configs` ; archive les stratégies précédentes APRÈS ; `refresh_campaign_rollups`.
- `zone_set_extraction_cp` (immuable) porte déjà `multiplicateur numeric(6,3)` et `retenu` par CP : le plan d'une extraction EST écrit, il suffit de le recopier.
- `GET /api/zones/jeux/[id]/extractions` : le `select` ne rend pas `plateformes` (colonne `jsonb`, résumé par plateforme du lot 5).
- `PATCH /api/bidding/strategies/[id]` : schéma partiel ; ne régénère `bidding_zone_configs` QUE si `weighting_mode`/`in_zone_weights`/`out_zone_weights` changent (`route.ts:7-8, 258`) — on peut donc lui confier budget, dates, CPM, objectif, capping sans toucher au plan.

### Écarts relevés (corrigés par ce plan)

| # | Constat | Ce que fait ce plan |
|---|---|---|
| E1 | La spec dit « cible = extraction », mais `rattacher` refuse tout jeu de zone (lot 5, A-3, A-15 : « lot ⑥ ») et ne sait pas lire une extraction. | T1 : `rattacher` accepte `{ campagne, extraction }` ; sans `extraction`, comportement INCHANGÉ (React). |
| E2 | **Défaut React** : sur le chemin « jeu de zones », le Lancement n'écrit ni budget, ni dates, ni CPM, ni pression, ni objectif — seuls les canaux (et leurs budgets) partent, alors que l'écran Pression dit « le multiplicateur reste utile ». Le pacing de ⑧ lit `total_budget`. | T7 : après `rattacher`, `PATCH /api/bidding/strategies/[id]` avec les champs NON-plan (route existante). Correction listée au rapport, conforme au skill (défaut objectif). |
| E3 | `GET /api/bidding/objectives` n'existe plus ; React montre une liste vide et envoie `maximize_leads` par défaut. Le catalogue `bidding_objectives` (8 lignes, toutes `is_enabled`) existe en base. | Q-2. |
| E4 | `pression-classes` (Suivi React) refuse un jeu de zone (409) : une campagne rattachée à une extraction de jeu de zone affichera une erreur dans ce bloc du Suivi React. | Hors lot (⑧) ; noté dans `ARCHITECTURE.md` et au rapport final. |

---

## Routes API : réutilisées sans changement

**Zéro route nouvelle** (sauf réponse « oui » à Q-2). Une route étendue (`rattacher`), un `select` élargi (`extractions` GET).

`GET/POST /api/admin/campaigns` · `GET/PATCH/DELETE /api/admin/campaigns/[id]` · `GET /api/admin/campaigns/[id]/organizations` · `GET /api/admin/campaigns/attachable` · `POST /api/admin/campaigns/[id]/absorb` · `GET/PUT /api/campaigns/[campaignId]/channels` · `GET/POST /api/bidding/strategies` · `GET/PATCH /api/bidding/strategies/[id]` · `GET /api/bidding/strategies/[id]/export` · `GET/POST /api/bidding/strategies/drafts` · `GET/DELETE /api/bidding/strategies/drafts/[id]` · `GET /api/dsp/dv360/resources` · `GET /api/custom-geo/national-totals` · `GET /api/cibles/indicators` · `GET /api/custom-geo/list` · `POST /api/custom-geo/source/indicator-threshold` · `POST /api/custom-geo/source/composite` · `POST /api/custom-geo/save` · `GET /api/user/demo-mode`, `POST` idem · `GET /api/zones/jeux` · `GET /api/zones/jeux/[id]/extractions` (select élargi) · `POST /api/zones/jeux/[id]/rattacher` (étendue).

Charge I/O : aucune requête lourde neuve. La recopie d'une extraction lit ≤ 7 000 lignes indexées par `(extraction_id, code_postal)` par `lireTout` (moins que le chemin vivant actuel, qui relit `zone_set_cp` ET rejoue `genererPlanCp`). Lectures Angular à la demande (liste des campagnes au 1er clic du sélecteur, comme `choix-zone-analysee`), jamais > 3 appels simultanés : le préremplissage (campagne, stratégie, brouillon, canaux) est SÉQUENTIEL.

---

## Arbitrages (tranchés ; coût si faux)

Ceux de la spec § 16.8, des lots 3, 4 et 5 s'appliquent. Ajoutés :

| # | Point | Tranché | Coût si faux |
|---|---|---|---|
| A-1 | Campagne courante | `?campagne=<uuid>` (spec § 5), écrit par `ecrire-parametres.ts` seul. Sélecteur dans la barre du parcours aux étapes `plan`, `activation`, `live` (Q2 tranchée) : liste lue au 1er clic, « Nouvelle campagne » en tête. Sans `?campagne=`, le panneau ⑥ montre le hall porté (créer / reprendre une création / modifier une campagne lancée). Campagne d'un autre espace collée → « Campagne introuvable dans cet espace. », paramètre retiré (patron lot 5). | un composant |
| A-2 | Brouillon | `ProgDraft` à l'identique, en signal dans `PlanCampagneService` ; autosave serveur (`bidding_strategy_drafts`) au même débit que `useDraftAutosave` ; PAS dans l'URL (comme React, comme le § 5 : les réglages fins ne vont pas dans l'URL). Le numéro d'« étape » envoyé au brouillon = la section dépliée la plus basse (compat React : un brouillon repris d'un côté se rouvre de l'autre). | un champ |
| A-3 | Cible « extraction » | Nouvelle source en tête de la section Cible, à côté de « national » et du panier React : **jeu (les deux types) + version d'extraction**. `ProgDraft.jeuZones` gagne `extraction: { id, version }` (champ facultatif ajouté côté Angular SEULEMENT ; le brouillon reste lisible par React qui l'ignore). Un jeu sans extraction est listé grisé : « Aucune extraction : figez-la à l'étape ⑤ » (risque : « dans le module risque »). Si `?jeu=&x=` est posé en entrant en ⑥, il est PROPOSÉ, pas pris (patron lot 5, A-13). | une liste |
| A-4 | Plan d'une extraction | `rattacher` avec `extraction` recopie `zone_set_extraction_cp.multiplicateur > 0` tel quel (aucun recalcul : l'extraction est figée), `in_zone_weights` gagne `extraction_id`, `extraction_version`, `plateformes` (le résumé) en plus des clés actuelles ; sans `extraction`, rien ne change. | — |
| A-5 | Plateformes pré-cochées | Choisir une extraction de jeu de zone PRÉ-COCHE dans la section 2 les plateformes de son résumé (`plateformes`) et affiche en face de chacune sa maille et son taux d'utile (lecture seule) ; l'utilisateur peut décocher. Codes : correspondance `plateformes_geo.plateforme` → codes de canaux de `lib/campaigns/channels.ts` dans UNE table pure testée ; un code sans correspondance est affiché « non relié » et n'est pas coché. | une table |
| A-6 | Habillage | Pas de fil interne, pas de `StepMemo` : quatre `mg-entete-section` repliables (bandeau `--bg-level-2`, point teal) ; le paragraphe principal de chaque mémo React devient le `Lead` de la section ; le pied (récap + « Créer la campagne ») est toujours visible. Textes React repris À LA LETTRE (sentence case déjà respecté), tutoiement compris. | du texte |
| A-7 | Mode démo | Interrupteur porté dans le hall (comme l'overlay React), même route. | — |
| A-8 | Note « filtre de carte » | Portée telle quelle en tête du panneau quand un filtre de ① est actif (lu depuis l'état de la carte, aucun fetch). | — |

---

## Questions pour Vincent (produit seulement ; recommandation entre crochets)

| # | Question | Ce qui en dépend | Recommandation |
|---|---|---|---|
| Q-1 | **Un jeu RISQUE en ⑥ : on rattache sa dernière extraction (figée), ou ses codes postaux VIVANTS comme le fait React aujourd'hui ?** Le vivant suit le seuil actuel du jeu ; l'extraction est ce qui a été validé et versionné. Les deux peuvent différer après un réglage du seuil. | T1, T4 | **L'extraction, pour les deux types** : la spec dit « cible = extraction », c'est la seule chose versionnée et c'est ce que ⑦ exportera. Le chemin vivant reste dans React jusqu'à la bascule, puis disparaît. |
| Q-2 | **Objectif de la stratégie : la route qui liste les objectifs a été retirée en septembre (retrait Pilotage ML) ; React affiche une liste vide et envoie « Maximiser les leads » d'office. On rétablit la lecture du catalogue (une petite route en lecture seule, 8 objectifs en base), ou on masque objectif + KPI en ⑥ ?** | T6 | **Rétablir `GET /api/bidding/objectives`** (≈ 30 lignes, lecture de `bidding_objectives where is_enabled`) : c'est la seule route neuve du lot, et elle répare aussi React. Sans elle, la section Stratégie est à moitié vide dans les deux applications. |

Q2 et Q4 de la spec sont **tranchées** (§ 14) et appliquées (A-1 ; une extraction = le plan unique de la campagne).

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `app/api/zones/jeux/[id]/rattacher/route.ts` (modifié), `app/api/zones/jeux/[id]/extractions/route.ts` (select), `tests/integration/rattacher-extraction.test.ts` (créé) | T1 |
| `angular/.../carte/logique/plan/brouillon.ts`, `canaux.ts`, `liens-plateformes.ts`, `plateformes-canaux.ts` (créés) ; `tests/unit/angular/plan-logique-paritaire.test.ts` (créé) | T2 : logique pure + parité |
| `angular/.../carte/data/plan.api.ts` (créé), `carte.fournisseurs.ts` (modifié), `etat/plan-campagne.service.ts` (créé) | T2 : API + état |
| `angular/.../carte/parcours/choix-campagne.component.ts` (créé), `barre-parcours.component.ts` (modifié), `panneaux/plan/panneau-plan.component.ts`, `hall-campagnes.component.ts` (créés), `carte.page.html`, `logique/parcours.ts` (modifiés) | T3 |
| `angular/.../carte/panneaux/plan/section-cible.component.ts`, `source-plan.component.ts` (créés) | T4 |
| `angular/.../carte/panneaux/plan/section-plateformes.component.ts`, `liaison-canal.component.ts`, `liaison-dv360.component.ts`, `liaison-manuelle.component.ts`, `absorption.component.ts`, `recap-canaux.component.ts`, `prevision.component.ts` (créés) | T5 |
| `angular/.../carte/panneaux/plan/section-pression.component.ts`, `controle-pression.component.ts`, `section-strategie.component.ts` (créés) | T6 |
| `angular/.../carte/panneaux/plan/pied-lancement.component.ts` (créé), `etat/lancement-campagne.ts` (créé, fonction de lancement séquentielle) | T7 |
| `ARCHITECTURE.md`, `angular/src/app/features/carte/README.md` | T1, T8 |

Chaque fichier `.ts` < 400 lignes : `StepCible` (423) et `StepLancement` (527) se coupent en composant + logique pure (`logique/plan/*`).

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

---

## Groupe A — socle (relecture 1)

### Task 1 : `rattacher` accepte une extraction

**Files :** `app/api/zones/jeux/[id]/rattacher/route.ts`, `app/api/zones/jeux/[id]/extractions/route.ts`, `tests/integration/rattacher-extraction.test.ts`, `ARCHITECTURE.md`.

- [ ] Corps : `{ campagne: uuid, extraction?: uuid }` (Zod, `lireCorps`). Sans `extraction` : code actuel INCHANGÉ (jeu risque seul, vivant). Avec : `chargerJeu(…)` **sans** filtre de type (espace vérifié par le chargeur), l'extraction doit appartenir au jeu (sinon 404 « Extraction introuvable pour ce jeu. ») ; lecture `zone_set_extraction_cp` (`code_postal, multiplicateur`) par `lireTout` plafond 7 000, `multiplicateur > 0` ; zéro ligne → 409 (message actuel). Stratégie : mêmes champs qu'aujourd'hui, nom `Jeu de zones — <nom> (extraction v<n>)`, `in_zone_weights` + `extraction_id`, `extraction_version`, `taux_utile` et `part_plan_en_zone` LUS de l'extraction, `plateformes`. Lots de 50, rollback de la stratégie si un lot échoue, archivage après, `refresh_campaign_rollups` : réutiliser les blocs existants (extraire une fonction locale `ecrirePlan(lignes)` partagée par les deux chemins, pas de copie).
- [ ] `extractions` GET : ajouter `plateformes` au `select` (chaîne littérale, cf. commentaire supabase-js) ; type `Extraction` Angular (`risques/data/jeux-zones.api.ts`) : `plateformes?: unknown[] | null`.
- [ ] Tests d'intégration (base locale) : extraction d'un jeu de zone → 201, `bidding_zone_configs` = les CP à multiplicateur > 0 de l'extraction, à l'unité près ; extraction d'un autre jeu → 404 ; jeu d'un autre espace → 404/403 du chargeur ; sans `extraction` sur un jeu de zone → 409 (inchangé) ; jeu risque sans extraction → chiffres actuels (caractérisation du lot 5 verte).
- [ ] `ARCHITECTURE.md` (section de la route, par `Grep "rattacher"`) + E4 noté. `npx tsc --noEmit`, `npm run test:unit`, `npm run test:integration` (codes de retour lus sans pipe).
- [ ] Commit `feat(api): ⑥ rattacher une extraction de jeu de zones à une campagne (lot 6, T1)`.

### Task 2 : Angular — logique pure, API, état de la campagne

**Files :** `logique/plan/{brouillon,canaux,liens-plateformes,plateformes-canaux}.ts` (+ specs), `tests/unit/angular/plan-logique-paritaire.test.ts`, `data/plan.api.ts` (+ spec), `carte.fournisseurs.ts`, `etat/plan-campagne.service.ts` (+ spec).

- [ ] Copier À L'IDENTIQUE les fonctions pures de `steps/types.ts`, `lib/campaigns/channels.ts`, `lib/campaigns/platform-links.ts`, `lib/cibles/draft.ts`, et la composition de `lib/campaigns/resolve-zone.ts` (l'appel HTTP passe par `plan.api.ts`, la décision national / directe / composite reste pure). Test de parité sur le patron de `carte-logique-paritaire.test.ts` (mêmes entrées → mêmes sorties, React importé côté Vitest racine). `plateformes-canaux.ts` : la table A-5.
- [ ] `plan.api.ts` : une méthode par route de la liste « réutilisées », typée d'après la route LUE (pas devinée) ; `rattacher(jeu, { campagne, extraction })`.
- [ ] `PlanCampagneService` (fourni par la page via `carte.fournisseurs.ts`) : `campagne` ↔ `?campagne=` ; `brouillon` signal ; préremplissage séquentiel annulable (campagne → stratégie existante → brouillon serveur, le brouillon prime : règle `restoredAppliedRef`) ; autosave débouncé ; `repartirDeZero()` ; `strategieExistante` (id + statut). Specs : changement de campagne en cours de lecture (réponse tardive ignorée), brouillon prioritaire, autosave n'écrit pas pendant le préremplissage.
- [ ] `cd angular && npx ng test --watch=false`, `npx tsc --noEmit` racine, `npm run test:unit`. Commit `feat(angular): ⑥ logique du plan, API et campagne courante (lot 6, T2)`.

**Relecture 1** (T1 + T2, une passe, modèle le plus capable) : le chemin sans `extraction` est-il strictement inchangé ? la parité couvre-t-elle `buildInZoneWeights` (trois branches) et `pressureCurve` (avec et sans `floor`) ? aucun `effect` qui recopie ?

## Groupe B — campagne et cible (relecture 2)

### Task 3 : sélecteur de campagne, hall, squelette du panneau ⑥

**Files :** `parcours/choix-campagne.component.ts`, `parcours/barre-parcours.component.ts`, `panneaux/plan/panneau-plan.component.ts`, `panneaux/plan/hall-campagnes.component.ts`, `carte.page.html`, `logique/parcours.ts` (+ specs).

- [ ] `mg-choix-campagne` dans la barre aux étapes `plan`/`activation`/`live` (A-1) : liste au 1er clic (`GET /api/admin/campaigns`), « Nouvelle campagne » (`POST`), campagne courante affichée par son nom. Aux étapes `activation`/`live` encore « bientôt », il écrit seulement `?campagne=`.
- [ ] `mg-hall-campagnes` = port de `CreationHall` (trois blocs, badge brouillon d'après `drafts`, suppression d'une coquille avec `mg-confirmation`, interrupteur mode démo A-7) ; affiché par le panneau quand `?campagne=` est vide.
- [ ] `mg-panneau-plan` : note filtre (A-8), en-tête « Création / Modification — <nom> », bannière « Brouillon restauré (date) · Repartir de zéro », quatre `mg-entete-section` vides (remplies en T4-T7) et le pied. `@case ('plan') { <mg-panneau-plan /> }` ; `ONGLET_REACT` perd `plan` ; pastille « renseignée » de l'étape = une stratégie existe pour la campagne courante.
- [ ] Specs (sélecteur, hall, `?campagne=` d'un autre espace). Commit `feat(angular): ⑥ sélecteur de campagne, hall et panneau du plan (lot 6, T3)`.

### Task 4 : section Cible (identité, extraction, national, panier)

**Files :** `panneaux/plan/section-cible.component.ts`, `panneaux/plan/source-plan.component.ts`, éventuellement `logique/plan/cible.ts` (+ specs).

- [ ] Port de `StepCible` tel quel (identité ; panier de zones `custom-geo/list` filtré par l'organisation propriétaire ; zone par indicateur à seuil `indicator-threshold` + `save`), coupé sous 400 lignes.
- [ ] `mg-source-plan` = port de `SourcePlan`, déplacé ici et étendu (A-3) : jeux des deux types (`GET /api/zones/jeux`, badge « Risque » / « Zone »), puis versions d'extraction du jeu choisi (`extractions(id)`, au clic), chiffres de l'extraction (CP retenus, taux d'utile, part du plan en zone). Source « extraction » et panier s'excluent (règle React, commentaire `types.ts:34-43` repris). Proposition `?jeu=&x=`.
- [ ] Specs : exclusion extraction/panier, jeu sans extraction grisé, proposition non prise d'office. Commit `feat(angular): ⑥ section Cible — extraction de ⑤, national, panier (lot 6, T4)`.

**Relecture 2** (T3 + T4).

## Groupe C — plateformes, pression, stratégie (relecture 3)

### Task 5 : section Plateformes et budget

**Files :** `section-plateformes`, `liaison-canal`, `liaison-dv360`, `liaison-manuelle`, `absorption`, `recap-canaux`, `prevision` (+ specs).

- [ ] Port tel quel de `StepCanaux` (canaux filtrés aux connexions de l'organisation, tout disponible en démo ; une ligne € par canal coché ; budget global = somme en lecture seule ; période), `ChannelLinkAccordion` (cascade DV360 annonceur → campagne → IO si connecté, saisie manuelle sinon), `AbsorbPanel`, `ChannelHubRecap`, `ForecastStrip` (`national-totals` lu UNE fois, cache du service), coche de confirmation réinitialisée par `linksSelectionHash`.
- [ ] A-5 : pré-coche + ligne maille/taux d'utile depuis l'extraction choisie.
- [ ] Commit `feat(angular): ⑥ section Plateformes et budget (lot 6, T5)`.

### Task 6 : sections Pression et Stratégie

**Files :** `section-pression`, `controle-pression`, `section-strategie` (+ specs).

- [ ] Port de `StepPression` sans `SourcePlan` (texte « Le plan vient du jeu de zones… » repris quand une extraction est choisie) et de `PressureControl` (réglette `mg-reglette` ×1-×3 pas 0,05, CPM max = base×M, CPM min = base÷M, saisie de l'un recale la réglette) ; diffusion « Zones strictes / National avec surpression » si panier non vide. Toujours chiffré (×M + €).
- [ ] Port de `StepStrategie` (objectif, KPI dans l'unité de l'objectif, capping X imp. / Y jours — les deux ou rien —, rythme, mode d'exécution). Objectifs : selon Q-2 (route rétablie et lue par `plan.api.ts`, ou bloc objectif + KPI masqué).
- [ ] Commit `feat(angular): ⑥ sections Pression et Stratégie (lot 6, T6)`.

**Relecture 3** (T5 + T6) : chiffres de la prévision et des CPM identiques à React sur le même brouillon.

## Groupe D — lancement (relecture 4)

### Task 7 : pied « Lancement »

**Files :** `panneaux/plan/pied-lancement.component.ts`, `etat/lancement-campagne.ts` (+ specs).

- [ ] Récap (identité, cible, canaux et budgets, période, pression ×M + CPM, diffusion, stratégie) et règle de validité de React (`invalid`, `StepLancement.tsx:209-211`) en `computed`.
- [ ] `lancer()` séquentiel, port fidèle des deux chemins : (a) extraction → `PATCH` identité si changée → `rattacher({ campagne, extraction })` → **`PATCH /api/bidding/strategies/[id]` champs non-plan** (`total_budget`, `forecast_cpm`, dates, `execution_mode`, `strategyFieldsFromDraft`) — E2 → `PUT channels` → message « N codes postaux · X % du plan en zone · Y % d'utile » ; (b) sinon : zone finale (national / directe / composite) → `POST` ou `PATCH` (stratégie existante) → `PUT channels` → `PATCH status: active`. Brouillon jeté après succès. Toute erreur s'affiche en `mg-notifications` avec le message de la route.
- [ ] Après lancement : téléchargements custom bidding par canal (`/api/bidding/strategies/[id]/export?channel=`, `telecharger.ts`, `resolveDownloadStrategyId`) et bouton « Préparer l'activation → ⑦ ».
- [ ] Specs : ordre des appels de chaque chemin (HTTP de test), échec de `rattacher` → aucun `PATCH` ni `PUT`, re-programmation d'une stratégie existante → `PATCH` et non `POST`. Commit `feat(angular): ⑥ lancement de la campagne (lot 6, T7)`.

**Relecture 4** (T7).

## Task 8 : revue finale, factorisation, preuve navigateur

- [ ] Revue finale du lot : mineurs accumulés, passe de factorisation inter-tâches (dire ce qui reste dupliqué : la logique pure EST dupliquée par construction, verrouillée par parité — à retirer côté React à la bascule).
- [ ] **Preuve navigateur, une seule fois, deux thèmes** (`L6-T8-*`), sur :4200 + :3000 : espace BMW GROUP — nouvelle campagne depuis le sélecteur ; cible = extraction v1 du jeu de zone du lot 5 (lycées BdR) ; plateformes pré-cochées, budgets, période ; pression ×2,2 → CPM recalé ; stratégie ; Lancer → message chiffré ; la même campagne ouverte dans l'overlay React (Aperçu / Suivi) montre le plan, le budget et les dates (E2 corrigé) ; brouillon : quitter à mi-chemin, recharger `?etape=plan&campagne=…` → « Brouillon restauré » ; campagne collée dans Marine nationale → message et paramètre retiré ; chemin « panier + indicateur » identique à React (chiffres de la prévision côte à côte).
- [ ] `ARCHITECTURE.md` (§ carte Angular : étape ⑥, `?campagne=`, services), `angular/src/app/features/carte/README.md`. Tests complets (`npm test`, `cd angular && npx ng test --watch=false`, `npx tsc --noEmit`, `npm run build` avec les variables locales explicites).
- [ ] Commit `docs: ⑥ Plan — revue finale et preuve navigateur (lot 6, T8)`.

---

## Estimation

| Groupe | Tâches | Charge |
|---|---|---|
| A socle | T1, T2 | 0,75 j |
| B campagne + cible | T3, T4 | 0,8 j |
| C plateformes, pression, stratégie | T5, T6 | 0,8 j |
| D lancement | T7 | 0,4 j |
| Fin | T8 | 0,3 j |
| **Total** | **8 tâches, 4 relectures, 1 preuve** | **≈ 3 jours** (2,5 si Q-2 = masquer) |
