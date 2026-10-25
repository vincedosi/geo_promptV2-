# La carte en parcours — lot 7 « ⑦ Activation » — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (ou superpowers:executing-plans). Skill `porting-react-to-angular` chargé AVANT chaque tâche Angular. Cases à cocher (`- [ ]`) pour le suivi.

**Mode accéléré (Vincent, 24/10) :** ⑦ est un **PORTAGE quasi tel quel** d'`ActivationPanel` (pré-vol, poussée NDJSON, historique, annulation), élargi à une carte par plateforme et aux fichiers d'export de l'extraction, sans repenser l'écran. 6 tâches en 3 groupes, **un implémenteur et une relecture par groupe**, seuls les défauts Critiques et Importants corrigés au fil de l'eau (les mineurs vont à T6), **une seule preuve navigateur**, en T6. Cible : **≈ 2 jours**.

**Goal :** à l'étape ⑦ de la carte Angular, pour la campagne courante lancée en ⑥, montrer une carte par plateforme qui dit ce qui part (nature, nombre d'unités, mode API, simulé ou fichier) et ce qui l'empêche, **pousser le ciblage géographique DV360** (réel ou simulé, journal NDJSON, historique, annulation), et **télécharger le fichier de chaque plateforme** dans sa maille, lu dans l'extraction figée.

**Architecture :** un panneau `mg-panneau-activation` monté par `carte.page.html` (`@case ('activation')`), un état `ActivationCampagneService` fourni par la page, qui lit la campagne courante dans `PlanCampagneService` (lot 6) et ne fait AUCUNE lecture avant que ce dernier ait validé l'espace. Côté serveur : les routes `activation/*` existantes, étendues pour lire leurs codes postaux dans l'**extraction** (une stratégie écrite par `rattacher` n'a pas de `zone_id`, voir E1) et pour simuler la poussée ; une route de fichiers neuve sur l'extraction ; deux fonctions extraites pour ne rien recopier (`lireCpPlateforme`, `pousserCiblageDv360`).

**Tech Stack :** Angular 21.2 standalone, zoneless, signals ; Tailwind 4 ; Vitest (`cd angular && npx ng test --watch=false`). Next.js 15, supabase-js, Zod, Vitest racine (`npm run test:unit`, `npm run test:integration`). Postgres 17.6 local (`docker exec supabase_db_genesis_app psql -U postgres`).

**Spec :** `docs/superpowers/specs/2026-10-13-carte-en-parcours-design.md` — **§ 19 fait foi** (19.2 ligne ⑦, 19.4 « porter / ne pas porter ») ; § 4 « ⑥ Activation » (numérotation d'origine : une carte par plateforme, nature envoyée, mode, pré-vol, Pousser ou Télécharger, historique, annulation ; bandeau) ; § 8 (natures × plateformes, contraintes réglementaires) ; § 16.2 règles 3 et 4 ; § 16.4 (poussée API vers TTD, Meta, TikTok hors champ). Plan précédent : `docs/superpowers/plans/2026-10-24-carte-en-parcours-lot-6-plan.md`. Registre de ⑥ : `.superpowers/sdd/2026-10-24-carte-en-parcours-lot-6-plan/progress.md` (worktree `carte-plan`). Mémoires : `feedback_mode_accelere`, `feedback_angular_vigilance`, `feedback_agents_frugaux`, `feedback_no_hardcoded_colors`, `project_dv360_parked`, `project_tiktok_connexion`, `feedback_api_first_no_file_imports`, `reference_dsp_maille_geo`.

## Global Constraints

- V1 = **contrôle des impressions et du budget dépensé**. ⑦ envoie des zones, rien d'autre : aucun script de custom bidding, aucun pacing, aucun multiplicateur d'enchère, aucun ad server (§ 19.2).
- Poussée API : **DV360 seul**, ciblage géographique seul. TTD, Meta et TikTok : fichiers (§ 16.4, § 19.2).
- Campagnes réservées au **super_admin** en V1 (Vincent, 25/10) ; `pousser` le vérifie déjà (403 avant toute écriture).
- **Contrôle d'espace côté Angular** (ruling de la preuve du lot 6) : les routes admin ne filtrent pas l'espace pour le super_admin ; ⑦ n'appelle rien tant que `PlanCampagneService` n'a pas validé la campagne dans l'espace actif.
- **Vouvoiement** sur tout le parcours (revue finale du lot 6, V-2).
- Une extraction **sans plateforme au CP** (Meta ou TikTok seuls) est légitime : la carte DV360 dit « rien à pousser », jamais une erreur.
- Textes en sentence case, jetons `var(--…)` seulement, Inter + JetBrains Mono, bordures 0,5 px (DESIGN_SYSTEM.md).
- Routes : `force-dynamic`, Zod, `lireCorps()`, `requireAuth`, `createAdminClient()`, erreurs supabase-js lues, `lireTout` au-delà de 1 000 lignes, `fetchAvecDelai` pour tout appel sortant, quota par `lib/api/rate-limit.ts`.
- Aucun `DROP` ; migration additive rejouable ; base locale seulement, jamais le MCP Supabase.
- Fichiers `.ts` < 400 lignes (`tests/unit/angular/taille-fichiers.test.ts`) ; `carte.page.ts` est à 378/400 : rien n'y entre hors une ligne de pastille.
- Preuve sur **:3002 / :4202** (serveurs du worktree), jamais :3000 / :4200.

## Review Focus

1. **Extraction sans CP DV360** (Meta cercles et TikTok départements seuls) : la carte DV360 dit « Cette extraction n'achète pas DV360 au code postal : rien à pousser. », les cartes Meta et TikTok offrent leurs fichiers, aucune erreur rouge. Test en T3 (logique des cartes) et T1 (pré-vol : `n_cp_dv360 = 0`, motif `aucun_cp_dv360`, pas de 409).
2. **Jeu RISQUE** : son extraction n'a ni `plateformes` ni `zone_set_extraction_unites`. `lireCpPlateforme(…, 'dv360')` doit rendre le plan CP entier, pas une liste vide. Test d'intégration en T1, cas de carte en T3.
3. **Changement de campagne pendant une lecture ou une poussée** : une réponse tardive de A ne s'écrit jamais dans B ; une poussée en cours sur A continue (le flux reste lié à A), les boutons de B affichent « Une poussée est en cours sur une autre campagne. ». Spec en T3.
4. **Campagne relancée en ⑥** (nouvelle stratégie, non publiée) : le pré-vol bloque « Le plan n'a jamais été publié » avec le bouton « Publier le plan » ; l'historique garde les lots de l'ancienne version avec leur numéro. Test d'intégration en T1, spec en T4.
5. **CP sans geo ID Google et plafond de 2 000 geo IDs** : le mode simulé rend les MÊMES comptes que le réel (`pushed_geo_ids`, `cp_non_resolus`) et le même refus au-delà de 2 000, avec le renvoi au fichier SDF. Test unitaire de `pousserCiblageDv360` en T1.

---

## Pré-vol : ce qui existe vraiment (reconnaissance du 25/10, worktree `carte-activation`, HEAD `c8bcb325`)

### L'existant React (≈ 480 lignes d'écran, ≈ 800 de routes)

| Écran / brique | Fichiers (lignes) | Routes appelées | Sort au lot 7 |
|---|---|---|---|
| Panneau Activation | `components/campaign/ActivationPanel.tsx` (479), monté par `components/magelian/MagelianOverlay.tsx` onglet « Activation » | `GET …/activation/prevol` + `GET …/activation/historique` (en parallèle, 2 appels), `POST /api/bidding/strategies/[id]/publier`, `POST …/activation/pousser` (NDJSON), `POST …/activation/rollback` | **Porté** : pré-vol (dans la carte DV360), publication, poussée + flux, historique, annulation. Saisie annonceur + line items **gardée** (Q-3) |
| Pré-vol | `app/api/campaigns/[campaignId]/activation/prevol/route.ts` (182) | lit `bidding_strategies` (la plus récente), `strategie_versions`, RPC `empreinte_zones`, RPC `compte_cp_campagne` (rollups), `dsp_connections` de l'espace | **Étendu** (T1, E1-E3) |
| Poussée | `…/activation/pousser/route.ts` (393) | rejoue le pré-vol, écrit `activation_lots` puis `activation_cibles` AVANT chaque appel, ré-appelle en HTTP `/api/admin/dsp/dv360/targeting/push` par line item (≤ 50), lot clos dans un `finally` | **Étendu** (T1) |
| Push DV360 | `app/api/admin/dsp/dv360/targeting/push/route.ts` (≈ 150) | `custom_geo_zones` (espace), `dsp_connections`, `lireCodesDeZone`, `mapPostalCodesToGeoIds`, `bulkAssignGeoRegions`, `logDspEvent` ; plafond 2 000 geo IDs | **Corps extrait** dans `lib/dsp/dv360/pousser-ciblage.ts` ; contrat de la route inchangé (seul appelant : `pousser`) |
| Historique, annulation | `…/historique/route.ts` (79, ≤ 50 lots, compteurs en une requête), `…/rollback/route.ts` (140, marque `annule`, **ne retire rien du DSP**, le dit) | — | Historique **étendu** de `mode` ; annulation **inchangée** |
| Publication | `app/api/bidding/strategies/[id]/publier/route.ts` | RPC `publier_strategie` (idempotente) ; marche sans `zone_id` (empreinte `{}`) | Inchangée |
| Exports de zone | `app/api/custom-geo/[id]/export/route.ts` (319) : `csv_cp`, `csv_iris`, `geojson`, `dv360_cp`, `dv360_sdf`, `bidding_script`, `tiktok_geo` — sur une ZONE vivante | — | `dv360_cp` / `dv360_sdf` **extraits** dans `lib/digital/fichiers-dv360.ts` (réutilisés) ; `bidding_script` **non porté** (§ 19.4) |
| Export d'extraction | `app/api/zones/jeux/[id]/extractions/[version]/export/route.ts` : classeur XLSX, **jeu risque seul** (409 sur un jeu de zone) | — | Inchangé ; le fichier par plateforme est une route neuve (T2) |
| Plomberie bidding | `lib/dsp/push/{index,dv360,simulated,types}.ts` (script custom bidding + budget IO, **aucun appelant**), `/api/bidding/strategies/[id]/export` | — | **Non porté** (§ 19.4) ; seule la RÈGLE « démo → simulé » est reprise (Q-1) |
| Location list DV360 | `app/api/admin/dsp/dv360/zones/push/route.ts` + `app/map/custom-geo/_components/ZoneDv360Dialog.tsx` | — | **Non porté** (zone vivante, hors § 19.4) |

### Côté Angular

- `logique/parcours.ts` : l'étape `activation` existe ; `carte.page.html:47` la rend par `@default { <mg-etape-bientot> }` ; `ONGLET_REACT.activation` mène à l'overlay React avec `&campaign=` (m5 du lot 6) ; `CONSIGNE_ETAPE.activation` annonce « arrive dans le parcours » ; `RENSEIGNEE_PAR` n'a pas d'entrée pour ⑦.
- `etat/plan-campagne.service.ts` (385 l., fourni par la page) : `campagne()` (`?campagne=`), `detail()`, `strategieExistante()`, `canaux()` (`selected`, `budgets`, `cpm_prevus`, `links`), `brouillon().jeuZones` (jeu + extraction relus d'`in_zone_weights`, I-1), `extraction()`, `retenirExtractions()`, `prerempli()`, `erreur()`, `accesRefuse()`. Le préremplissage tourne à TOUTE étape dès que `?campagne=` est posé et refuse une campagne d'un autre espace (`verifierEspace`, `MESSAGE_CAMPAGNE_INTROUVABLE`).
- « Préparer l'activation → ⑦ » (`pied-lancement.component.ts`) appelle `parcours.choisir('activation')` : `?campagne=` voyage.
- Briques réutilisables : `ui/{entete-section, champ, confirmation, notifications, bandeau-kpi, kpi, pastille, tableau, barre-progression, icone}`, `ChargementService`, `core/http/ndjson.ts` (`lignesNdjson`, patron `features/admin/radio/data/radio-admin.api.ts:211`), `features/risques/exports/bouton-export.component.ts` (`mg-bouton-export`, téléchargement Bearer et message de la route), `data/jeux.api.ts` (`extractions(id)`, `plateformes()`), `logique/plan/plateformes-canaux.ts` (`CANAL_DE_PLATEFORME`, `resumeDuCanal`), `logique/jeu/plateformes.ts`.
- ⑤ : `panneaux/jeu/extractions-jeu.component.ts:77` affiche « Les fichiers par plateforme arrivent avec les exports. » (Q-4).

### Côté serveur et base (lu le 25/10)

- `zone_set_extraction_unites` (sql/277-278, immuable) : `(extraction_id, plateforme, maille, ordinal)`, `code`, `nom`, `centre geometry(Point,4326)`, `rayon_m`, `retenu`. `to_json(centre)` rend du GeoJSON : supabase-js le lit tel quel, **aucune RPC nécessaire**. Le polygone TTD est `zone_set_extractions.forme` (17 Ko de GeoJSON pour l'extraction de démonstration).
- Extraction v1 du jeu de zone `66061937-…` (lycées BdR, BMW GROUP) : dv360 CP 79 lignes (63 unités), meta 53 cercles de 5 km, tiktok 1 département retenu sur 2, ttd 1 polygone exact.
- `plateformes_geo` : 13 lignes, `limites` (Meta ≤ 200 cercles 1-80 km, TikTok ≤ 3 000 unités et ≥ 1 000 personnes par groupe, DV360 cercle ≥ 1 km et ≥ 1 000 hab.), `a_verifier` (TTD tout, Meta CP, TikTok commune).
- `dsp_connections` : **une seule ligne**, DV360 en `error` sur l'espace 00…01 ; BMW GROUP n'en a aucune. `activation_lots` : 0 ligne. `dsp_campaigns` : 3 campagnes de démo sur 10.
- `activation_lots.statut` ∈ (`en_cours`, `termine`, `partiel`, `echec`, `annule`), `activation_cibles.statut` ∈ (`en_attente`, `pousse`, `echec`, `annule`). Aucun test n'exerce les routes `activation/*` (seul `plafond-lectures-zones.test.ts` les cite).

### Écarts relevés (corrigés par ce plan)

| # | Constat | Ce que fait ce plan |
|---|---|---|
| E1 | **Une campagne lancée en ⑥ ne peut pas être poussée** : `rattacher` écrit une stratégie SANS `zone_id`, et `pousser` répond 409 `strategie_sans_zone`. Le CP du plan vit dans l'extraction (`in_zone_weights.extraction_id`). | T1 : `pousser` lit les CP DV360 de l'extraction quand la stratégie en porte une ; le chemin `zone_id` est inchangé. |
| E2 | Le pré-vol compte les CP par `compte_cp_campagne` (rollups, TOUTES plateformes, hors zone compris) : dès que deux plateformes achètent au CP, ou qu'un CP pondéré hors zone est au plan, il annonce plus de CP « poussés » que DV360 n'en achète. | T1 : `n_cp_dv360` lu dans l'extraction, à côté de `n_codes_postaux` (gardé pour React). |
| E3 | Sans connexion DV360 active, le pré-vol bloque tout ; aucune poussée ne peut être exercée tant que DV360 est en pause (`project_dv360_parked`). | T1 : mode `simule` sur une campagne de démo (Q-1), journalisé `activation_lots.mode = 'simule'`, rien ne part chez Google. |
| E4 | Les blocages sont des phrases qui parlent de « stratégie », vocabulaire que la V1 ne montre plus (§ 19.2 : la stratégie est un conteneur, pas un écran). | T1 : `motifs: [{ code, message }]` en plus de `blocages` (React inchangé) ; T3 : textes Angular par code. |
| E5 | Les fichiers par plateforme d'une extraction n'existent pas (le « lot 6 Exports natifs » du § 16.5 n'a jamais été fait) ; l'export d'extraction est un classeur du jeu risque seul. | T2 : route de fichiers par plateforme, lue dans l'extraction figée. |

---

## Routes API

**Une route neuve** : `GET /api/zones/jeux/[id]/extractions/[version]/fichier?plateforme=&format=` (T2). **Trois étendues** (T1) : `GET …/activation/prevol`, `POST …/activation/pousser`, `GET …/activation/historique`. **Un refactor sans changement de contrat** : `POST /api/admin/dsp/dv360/targeting/push`, `GET …/extractions/[version]/cp`, `GET /api/custom-geo/[id]/export` (formats `dv360_cp`, `dv360_sdf`).

Réutilisées sans changement : `POST /api/bidding/strategies/[id]/publier` · `POST …/activation/rollback` · `GET /api/zones/jeux/[id]/extractions` · `GET /api/zones/plateformes` (registre, via `JeuxApi.plateformes()`) · toutes les routes de ⑥ lues par `PlanCampagneService`.

**Plus appelées par ⑦ (V1)** : `/api/bidding/strategies/[id]/export`, `/api/admin/dsp/dv360/zones/push`, `GET /api/custom-geo/[id]/export?format=bidding_script`. Elles restent, React s'en sert.

**Charge I/O** : aucune requête lourde neuve. Pré-vol : + une lecture paginée des CP DV360 de l'extraction (≤ 7 000 lignes par la clé primaire). Fichier : une lecture paginée des unités d'UNE plateforme (≤ 7 000, préfixe de la clé primaire) ou une ligne `forme`. Côté Angular, lectures **séquentielles** à l'entrée dans ⑦ (pré-vol → historique → extractions du jeu si absentes du cache), jamais plus d'une à la fois, jamais avant la validation de l'espace ; relues après une poussée, une publication ou une annulation.

---

## Arbitrages (tranchés ; coût si faux)

Ceux de la spec § 16.8 et des lots 3 à 6 s'appliquent. Ajoutés :

| # | Point | Tranché | Coût si faux |
|---|---|---|---|
| A-1 | Source des CP poussés | `lireCpPlateforme(supabase, extraction, plateforme)` (extrait de la route `…/cp`) : les CP **achetés** par la plateforme (retenus et pondérés hors zone, ceux du tableau de ⑥), en codes bruts. Jeu **risque** (extraction sans `plateformes`) : le plan CP entier. La route `…/cp`, `pousser`, `prevol` et le fichier l'appellent tous. | un filtre `retenu` |
| A-2 | Appel DV360 | `pousserCiblageDv360({ supabase, orgId, cps, advertiserId, lineItemId, libelle, mode })` dans `lib/dsp/dv360/pousser-ciblage.ts` : le corps de `targeting/push` après la lecture des codes (mapping, plafond 2 000, token, `bulkAssignGeoRegions`, `logDspEvent`). `targeting/push` l'appelle avec `lireCodesDeZone` ; `pousser` l'appelle **directement** (plus d'aller-retour HTTP avec en-tête recopié). En `simule` : mêmes contrôles et mêmes comptes, aucun appel Google, `logDspEvent` avec `action: 'push_geo_targeting_simule'`. | remettre l'appel HTTP (une ligne) |
| A-3 | Mode de la poussée | `reel` si l'espace a une connexion DV360 ni `error` ni `revoked` ; sinon `simule` si la campagne est de démo (`dsp_campaigns.is_demo`) ; sinon `indisponible` (bouton Pousser désactivé, motif « Aucune connexion DV360 active dans cet espace : téléchargez le fichier SDF. »). Q-1. Colonne `activation_lots.mode text not null default 'reel' check (mode in ('reel','simule'))`, sql/281. | élargir `simule` aux campagnes non démo : une condition |
| A-4 | Une carte par plateforme | Les plateformes **cochées en ⑥** (`canaux().selected`), dans l'ordre de `plateformes_geo.ordre`. Chacune lit son résumé d'extraction (`resumeDuCanal`) : maille, unités retenues, exacte ou non, taux d'utile, avertissements. Plateforme cochée absente de l'extraction (V-6 du lot 6) : « Aucune unité dans l'extraction pour cette plateforme : rien à envoyer. » Jeu risque : CP pour DV360 et TTD, « Un jeu risque ne porte que des codes postaux : <plateforme> ne les achète pas en France. » pour TikTok, CP « à vérifier » pour Meta. | une règle de la logique pure |
| A-5 | Mode affiché | DV360 au CP : **API** (réel), **simulé** ou **fichier** (indisponible), + toujours ses fichiers en repli. DV360 en cercles, TTD, Meta, TikTok : **fichier**. La nature dit la conversion, en unités RETENUES du résumé d'extraction : « 63 CP — conversion de la zone (95 % d'utile) », « 1 polygone exact », « 53 cercles de 5 km », « 1 département ». | du texte |
| A-6 | Formats de fichier | Un format par (plateforme, maille), fonction pure `fichierPlateforme(…)` : DV360 CP → `dv360_cp` (un CP par ligne) **et** `dv360_sdf` (geo IDs Google, fonctions extraites de l'export de zone) ; DV360 cercle, TTD cercle, Meta cercle → CSV `nom;latitude;longitude;rayon_km` ; TTD CP, Meta CP → CSV `code_postal` (Meta : `FR:<cp>`, `a_verifier`) ; TTD polygone → GeoJSON de `forme` ; TikTok commune / département → CSV `code;nom`. Seules les unités **retenues**. En-tête de méthode (jeu, version, plateforme, maille, date du relevé, « à vérifier ») dans un commentaire `#` pour les CSV, une propriété `methode` pour le GeoJSON. Séparateur `;`, UTF-8 avec BOM (Excel FR). | un format par plateforme, sans toucher à l'écran |
| A-7 | Fichiers journalisés ? | Non : l'historique ne porte que les poussées (`activation_lots`). Un téléchargement est une lecture. | une table de journal |
| A-8 | Annonceur et line items DV360 | Annonceur **prérempli** depuis `canaux().links.dv360.advertiser_id` (cascade de ⑥), modifiable ; line items saisis à la main (parsing de React : chiffres séparés par espaces, virgules, points-virgules, retours ; ≤ 50). Q-3. | une liste lue sous l'IO (route `resources` + `listLineItems`) |
| A-9 | Publication | Bouton « Publier le plan » (« Republier (v1 → v2) ») à côté du motif qui le demande, comme React ; même route. Le mot « stratégie » n'apparaît pas dans l'écran Angular (E4). | du texte |
| A-10 | Poussée et changement de campagne | La poussée appartient au service de la page, liée à SA campagne : changer de campagne ou d'étape ne l'interrompt pas (le flux continue, il est affiché quand on revient sur A) ; sur une autre campagne, Pousser est désactivé avec « Une poussée est en cours sur une autre campagne. » Un changement d'espace recrée la page : la requête est abandonnée, le serveur s'arrête à la cible suivante et clôt le lot (`cancel()`, `finally`), c'est dit dans le commentaire du service. | un verrou à lever |
| A-11 | Pastille « renseignée » de ⑦ | Un lot `termine` ou `partiel`, non annulé, pour la campagne courante (lu dans l'historique déjà chargé ; aucune requête à part). | une règle |
| A-12 | Bandeau de l'étape | `mg-bandeau-activation` : plateformes (cochées), prêtes (une carte sans motif bloquant), poussées (canaux avec un lot `termine`/`partiel` non annulé), en erreur (canaux dont le dernier lot est `echec` ou `partiel`), dernière poussée (date `fr-FR`, sinon « — »). | du calcul pur |
| A-13 | Pré-vol réglementaire (§ 8) | Avertissement écrit sur les cartes Meta et TikTok : « Publicité politique interdite chez <plateforme> dans l'Union européenne. » ; Meta : « Catégorie sensible (emploi, logement, crédit) : pas de code postal, rayon ≥ 15 km. » ; les `avertissements` de l'extraction et les dépassements de `limites` (`max_unites`) affichés tels quels. Aucune case à déclarer. Q-2. | une case et un blocage par plateforme |
| A-14 | Fichiers en ⑤ | Le bloc `mg-fichiers-extraction` (entrées : jeu, version, plateforme, maille) ne dépend d'aucune campagne : il remplace le texte « Les fichiers par plateforme arrivent avec les exports. » dans la liste des extractions de ⑤. Q-4. | retirer trois lignes de ⑤ |

---

## Questions pour Vincent (produit seulement ; recommandation entre crochets)

| # | Question | Ce qui en dépend | Recommandation |
|---|---|---|---|
| Q-1 | **Sans connexion DV360 active, la poussée est-elle simulée (journalisée « simulée », rien ne part chez Google) pour toute campagne, ou pour les seules campagnes de démo ?** Simuler une vraie campagne inscrit dans l'historique une activation qui n'a pas eu lieu. | A-3, T1 | **[Campagnes de démo seulement ; une vraie campagne sans connexion n'a que le fichier SDF.]** |
| Q-2 | **Pré-vol réglementaire Meta et TikTok (publicité politique interdite dans l'UE, catégorie sensible Meta) : un avertissement écrit, ou une case « campagne politique / catégorie sensible » qui bloque l'export concerné ?** | A-13, T5 | **[Un avertissement écrit en V1, sans case.]** |
| Q-3 | **Line items DV360 : saisie manuelle des identifiants (comme aujourd'hui), ou liste lue sous l'insertion order lié en ⑥ ?** La liste ne peut pas être éprouvée tant que les droits Google sont bloqués. | A-8, T4 | **[Saisie manuelle, annonceur prérempli ; la liste quand DV360 sera débloqué.]** |
| Q-4 | **Les fichiers par plateforme se téléchargent-ils aussi depuis ⑤, sans campagne (étude, pitch) ?** | A-14, T5 | **[Oui, le même bloc dans la liste des extractions de ⑤.]** |

En attendant les réponses, le plan applique les recommandations ; chaque arbitrage dit son coût si la réponse est autre.

---

## File Structure

| Fichier | Responsabilité | Tâche |
|---|---|---|
| `sql/281_activation_mode_simule.sql` (créé) | `activation_lots.mode` (additif, rejouable) | T1 |
| `lib/zones/cp-plateforme.ts` (créé) ; `app/api/zones/jeux/[id]/extractions/[version]/cp/route.ts` (modifié) | `lireCpPlateforme` (A-1) | T1 |
| `lib/dsp/dv360/pousser-ciblage.ts` (créé) ; `app/api/admin/dsp/dv360/targeting/push/route.ts` (modifié) | `pousserCiblageDv360` (A-2) | T1 |
| `lib/campaigns/activation.ts` (créé) | `sourceDuPlan(strategie)`, `modePoussee(connexions, isDemo)`, `motifsPrevol(…)` — logique pure du pré-vol, partagée par `prevol` et `pousser` | T1 |
| `app/api/campaigns/[campaignId]/activation/{prevol,pousser,historique}/route.ts` (modifiés) | E1-E4 | T1 |
| `tests/unit/dsp/pousser-ciblage.test.ts`, `tests/unit/campaigns/activation.test.ts`, `tests/integration/activation-extraction.test.ts` (créés) | T1 | T1 |
| `lib/digital/fichiers-dv360.ts` (créé) ; `app/api/custom-geo/[id]/export/route.ts` (modifié) | `texteCpDv360`, `texteSdfDv360` extraits | T2 |
| `lib/zones/fichiers-plateformes.ts` (créé) ; `app/api/zones/jeux/[id]/extractions/[version]/fichier/route.ts` (créé) | A-6 | T2 |
| `tests/unit/zones/fichiers-plateformes.test.ts`, `tests/integration/fichier-extraction.test.ts` (créés) | T2 | T2 |
| `angular/.../carte/logique/activation/{cartes,motifs,line-items,bandeau}.ts` (+ specs) | logique pure de l'écran | T3 |
| `angular/.../carte/data/activation.api.ts` (+ spec) ; `app.routes.ts` (`FOURNISSEURS_DISTANTS`) | les routes de ⑦ | T3 |
| `angular/.../carte/etat/activation-campagne.service.ts` (+ spec) ; `carte.fournisseurs.ts` | état de ⑦, fourni par la page | T3 |
| `angular/.../carte/panneaux/activation/{panneau-activation,carte-plateforme,poussee-dv360,flux-poussee,historique-activation}.component.ts` (+ specs) ; `carte.page.html`, `logique/parcours.ts`, `carte.page.ts` (une ligne) | T4 | T4 |
| `angular/.../carte/panneaux/activation/{fichiers-extraction,bandeau-activation}.component.ts` (+ specs) ; `panneaux/jeu/extractions-jeu.component.ts` | T5 | T5 |
| `ARCHITECTURE.md`, `angular/src/app/features/carte/README.md` | T1, T2, T6 | — |

---

## Pièges Angular / AIDA (à recopier dans CHAQUE brief de tâche Angular)

- Contrat AIDA : aucun `position: fixed`, aucun écouteur `window`/`document`, aucun `localStorage` neuf, aucun portail hors de l'arbre (`portails-hors-ombre.test.ts`), services d'état **fournis par la page** (`carte.fournisseurs.ts`, jamais `providedIn: 'root'`), services d'API dans `FOURNISSEURS_DISTANTS`, adresses par `HttpBaseService.baseUrl`, pas de `@angular/core/rxjs-interop`.
- Couleurs par jetons seulement : React écrit `rgba(255,87,87,0.08)`, `rgba(247,183,49,0.08)`, `rgba(61,255,160,0.08)` en dur → `color-mix` sur `--danger`/`--warning`/`--success` ou les briques `mg-notifications`. Texte de statut sur fond clair : `--text-primary` pour le texte, la couleur de statut pour le point et la bordure (contraste dans les deux thèmes ; la carte n'a pas les `--*-texte` du cadre admin).
- **Aucune lecture avant la validation de l'espace** : le service de ⑦ attend `plan.prerempli() && plan.detail()?.id === plan.campagne()` ; jamais d'appel sur le seul `?campagne=`.
- Lectures en UN abonnement séquentiel annulable par jeton (patron `lecture-annulable.ts`, `PlanCampagneService.preremplir`) : pré-vol → historique → extractions ; une réponse arrivée après un changement de campagne est ignorée.
- Flux NDJSON par `lignesNdjson` (`observe: 'events'`, `responseType: 'text'`) : chaque ligne écrit un signal (zoneless) ; lignes ajoutées par `update(l => [...l, x])`, jamais muter.
- Valeurs dérivées (cartes, motifs, bandeau, pastille, activable) en `computed`, jamais un `effect` qui recopie.
- `inject()` jamais après un `await` (NG0203).
- Nom d'`input()` qui masque un attribut natif (`title`, `id`) : préfixer (`plateformeCarte`, `titreCarte`).
- Téléchargements par `mg-bouton-export` (Bearer, message de la route), jamais un `<a href>`.
- Nombres et dates par `core/format/nombre` et `toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })` comme React, jamais un formateur local recopié.
- Le panneau de ⑦ reste MONTÉ quand on quitte l'étape (`carte.page.html`, `visibility`) : une poussée en cours lui survit.
- Textes : ceux de React À LA LETTRE (aucun n'est au tutoiement), sauf ceux qui disent « stratégie » ou « DSP » au singulier de l'onglet (E4) ; chaque texte changé est listé au rapport.

---

## Groupe A — serveur (relecture 1)

### Task 1 : pousser une campagne lancée depuis une extraction, réelle ou simulée

**Files :** voir File Structure, lignes T1.

**Interfaces :**
- Produces : `lireCpPlateforme(supabase: ClientAdmin, extractionId: string, plateforme?: string): Promise<LigneCpExtraction[]>` ; `pousserCiblageDv360(p: { supabase; orgId: string; cps: string[]; advertiserId: string; lineItemId: string; libelle: string; mode: 'reel' | 'simule' }): Promise<{ ok: true; pushed_geo_ids: number; unmapped_postal_codes: string[]; failed_line_item_ids: string[] } | { ok: false; status: 400 | 404 | 502; error: string }>` ; `sourceDuPlan(s: { zone_id: string | null; in_zone_weights: unknown }): { type: 'zone'; zoneId: string } | { type: 'extraction'; extractionId: string } | null` ; `modePoussee(connexions: { provider: string; status: string }[], isDemo: boolean): 'reel' | 'simule' | 'indisponible'`.
- Pré-vol, champs AJOUTÉS (les anciens inchangés, React les lit) : `mode_dv360`, `n_cp_dv360: number`, `extraction: { zone_set_id: string; version: number } | null`, `motifs: { code: 'aucune_strategie' | 'droit' | 'jamais_publiee' | 'derive' | 'aucune_connexion' | 'connexion_en_erreur' | 'aucun_cp_dv360'; message: string; version?: number }[]`.
- Historique : chaque lot gagne `mode: 'reel' | 'simule'`. Flux NDJSON de `pousser` : la ligne `debut` gagne `mode`.

- [ ] Tests d'abord : `tests/unit/campaigns/activation.test.ts` — `sourceDuPlan` (zone, extraction par `in_zone_weights.extraction_id`, ni l'un ni l'autre → `null`, `in_zone_weights` illisible → `null`) ; `modePoussee` (connexion `connected` → `reel` même en démo ; `error`/`revoked`/absente + démo → `simule` ; + non démo → `indisponible`) ; motifs : sans connexion en démo → aucun motif de connexion, `activable` vrai. `tests/unit/dsp/pousser-ciblage.test.ts` (client Google simulé) : `simule` n'appelle jamais `bulkAssignGeoRegions` et rend les mêmes `pushed_geo_ids` / `unmapped_postal_codes` que `reel` sur les mêmes CP ; 2 001 geo IDs → `{ ok: false, status: 400 }` avec « Utiliser l'export fichier » dans les deux modes ; 0 CP mappé → 400. Lancer : FAIL (modules absents).
- [ ] `sql/281_activation_mode_simule.sql` : `alter table … add column if not exists mode …` + `comment on column`. Appliquer en local, relire `\d activation_lots`.
- [ ] Extraire `lireCpPlateforme` de la route `…/cp` (comportement inchangé : les tests du lot 6 sur cette route restent verts) et y ajouter la règle du jeu risque (A-1 : extraction sans `plateformes` → plan entier). Extraire `pousserCiblageDv360` de `targeting/push` ; la route garde son contrat (corps `zone_id`, réponses identiques).
- [ ] `prevol` : `sourceDuPlan` ; si extraction → `n_cp_dv360` par `lireCpPlateforme(…, 'dv360')`, sinon par `lireCodesDeZone` (zone) ; motifs construits par `lib/campaigns/activation.ts`, `blocages` = leurs messages (React inchangé, sauf : une campagne de démo sans connexion devient activable en simulé — écart à lister) ; `aucun_cp_dv360` bloque la poussée seulement.
- [ ] `pousser` : même pré-vol rejoué (fonctions partagées) ; source extraction ou zone ; `mode` écrit sur le lot ; appel direct à `pousserCiblageDv360` par line item, `etat_avant` gagne `extraction_id` et `mode` ; tout le reste (lot avant sortie, cible avant appel, `failed_line_item_ids`, `finally`, `cancel()`) INCHANGÉ. `historique` : `mode` dans le `select`.
- [ ] `tests/integration/activation-extraction.test.ts` (base locale, campagne de démo créée et nettoyée par le test, extraction du jeu `66061937-…` rattachée) : pré-vol avant publication → motif `jamais_publiee` ; après `publier` → `activable`, `mode_dv360 = 'simule'`, `n_cp_dv360` = lignes de `…/cp?plateforme=dv360` ; `pousser` sur 2 line items → NDJSON `debut` (`mode: 'simule'`), 2 `cible` `pousse`, `fin` `termine` ; `activation_lots.mode = 'simule'` ; historique le rend ; relancer `rattacher` → nouveau pré-vol `jamais_publiee` et l'ancien lot toujours listé (Review Focus 4) ; même campagne sans `is_demo` → `indisponible`, `pousser` 409 sans lot écrit ; extraction Meta + TikTok seuls (fabriquée dans une transaction annulée ou par une extraction de test) → `n_cp_dv360 = 0`, motif `aucun_cp_dv360`, pas d'erreur ; jeu risque rattaché par extraction → `n_cp_dv360` = plan entier (Review Focus 2) ; caractérisation du chemin `zone_id` : stratégie à zone, `pousser` simulé → mêmes comptes qu'avant le refactor.
- [ ] `EXPLAIN (ANALYZE, BUFFERS)` de la lecture des unités DV360 d'une extraction (index de clé primaire attendu), chiffre noté dans le rapport.
- [ ] `ARCHITECTURE.md` (par `Grep "activation/prevol"`, `"activation/pousser"`, `"targeting/push"`, `"activation_lots"`, `"extractions/\[version\]/cp"`) : extensions, `mode`, sql/281, la poussée directe sans HTTP. `npx tsc --noEmit`, `npm run test:unit`, `npm run test:integration` (codes de retour lus sans pipe).
- [ ] Commit `feat(api): ⑦ pousser le ciblage d'une extraction, poussée simulée (lot 7, T1)`.

### Task 2 : fichiers par plateforme d'une extraction

**Files :** voir File Structure, lignes T2.

**Interfaces :**
- Consumes : `lireCpPlateforme` (T1).
- Produces : `GET /api/zones/jeux/[id]/extractions/[version]/fichier?plateforme=<dv360|ttd|meta|tiktok>&format=<cp|sdf|cercles|polygone|territoires>` → fichier (`Content-Disposition` `extraction_<slug>_v<n>_<plateforme>_<format>.<ext>`) ; 400 format inconnu ou sans objet pour la maille (« La plateforme meta n'achète pas au code postal dans cette extraction. ») ; 404 jeu d'un autre espace (chargeur) ou version absente ; 409 « Aucune unité retenue pour cette plateforme. ». `fichierPlateforme(e: { jeu: string; version: number; plateforme: Plateforme; maille: Maille; aVerifier: boolean; releveLe: string }, unites: UniteFichier[], forme: unknown | null, format: FormatFichier): { nom: string; type: string; contenu: string }` ; `formatsDe(plateforme, maille): FormatFichier[]` (lu aussi par l'Angular, recopié en T3 avec un test de parité). `texteCpDv360(cps: string[]): string`, `texteSdfDv360(nomZone: string, cps: string[]): string`.

- [ ] Tests d'abord, `tests/unit/zones/fichiers-plateformes.test.ts` : `formatsDe('dv360','cp')` = `['cp','sdf']`, `('ttd','polygone')` = `['polygone']`, `('meta','cercle')` = `['cercles']`, `('tiktok','departement')` = `['territoires']` ; CSV cercles : `nom;latitude;longitude;rayon_km`, 6 décimales, rayon 5000 m → `5`, seules les unités retenues, BOM en tête, lignes `#` de méthode avec « à vérifier » quand `aVerifier` ; Meta CP préfixé `FR:` ; GeoJSON = `FeatureCollection` d'une `Feature` à `properties.methode` ; `texteCpDv360` et `texteSdfDv360` rendent EXACTEMENT ce que rend aujourd'hui l'export de zone (caractérisation sur une liste fixe, référence écrite avant l'extraction).
- [ ] Extraire `texteCpDv360` / `texteSdfDv360` dans `lib/digital/fichiers-dv360.ts` ; `custom-geo/[id]/export` les appelle (réponses identiques).
- [ ] `lib/zones/fichiers-plateformes.ts` : `fichierPlateforme`, `formatsDe`, constante des en-têtes ; aucune I/O.
- [ ] Route `…/fichier` : `requireAuth`, `chargerJeu` sans filtre de type (les deux types), extraction par `(zone_set_id, version)`, CP par `lireCpPlateforme`, autres mailles par `lireTout` sur `zone_set_extraction_unites` (`select('ordinal, code, nom, centre, rayon_m, retenu')`, plafond 7 000), polygone par `select('forme')` ; `plateformes_geo` lu pour `a_verifier` et `releve_le` ; quota 6/min `geo:rl:zone-set-extraction-fichier` ; jeu risque : seuls `dv360`/`ttd` en `cp`/`sdf` (A-4).
- [ ] `tests/integration/fichier-extraction.test.ts` sur l'extraction `66061937-…` v1 : DV360 `cp` = autant de lignes que `…/cp?plateforme=dv360` ; `sdf` contient « Geography Targeting - Include » ; Meta `cercles` = 53 lignes de données ; TikTok `territoires` = 1 ligne (13) ; TTD `polygone` = GeoJSON valide (`JSON.parse`) ; Meta `cp` → 400 ; autre espace → 404 ; version 99 → 404.
- [ ] `ARCHITECTURE.md` (route neuve, par `Grep "extractions/\[version\]/export"`). tsc, tests unitaires et d'intégration.
- [ ] Commit `feat(api): ⑦ fichiers par plateforme d'une extraction (lot 7, T2)`.

**Relecture 1** (T1 + T2, une passe, modèle le plus capable) : le chemin `zone_id` de `pousser` et le contrat de `targeting/push` sont-ils strictement inchangés ? le simulé peut-il appeler Google par un chemin quelconque ? un lot peut-il rester `en_cours` ? les fichiers de l'export de zone sont-ils identiques octet pour octet ? `lireCpPlateforme` rend-il le plan entier pour un jeu risque ?

## Groupe B — état et poussée DV360 (relecture 2)

### Task 3 : Angular — logique pure, API, état de ⑦

**Files :** voir File Structure, lignes T3.

**Interfaces :**
- Consumes : routes de T1 et T2 ; `PlanCampagneService` (`campagne`, `detail`, `prerempli`, `canaux`, `brouillon().jeuZones`, `extraction`, `retenirExtractions`, `libelleCanal`) ; `JeuxApi.extractions`, `JeuxApi.plateformes` ; `resumeDuCanal`, `CANAL_DE_PLATEFORME`.
- Produces : `CarteActivation { canal: string; plateforme: Plateforme | null; libelle: string; maille: Maille | null; nature: string; mode: 'api' | 'simule' | 'fichier'; unites: number; formats: FormatFichier[]; motifs: string[]; avertissements: string[] }` ; `cartesActivation(e: { canaux: string[]; extraction: ExtractionJeu | null; typeJeu: 'zone' | 'risque' | null; prevol: Prevol | null; registre: PlateformeGeo[] }): CarteActivation[]` ; `texteMotif(m: MotifPrevol): string` ; `lireLineItems(brut: string): { ids: string[]; invalides: number }` ; `bandeauActivation(cartes, lots): { plateformes; pretes; poussees; enErreur; derniere: string | null }` ; `ActivationApi { prevol(c); historique(c); pousser(c, corps): Observable<LigneFlux>; annuler(c, lot); publier(strategie); urlFichier(jeu, version, plateforme, format) }` ; `ActivationCampagneService { prevol; lots; cartes; bandeau; renseignee; chargement; erreur; flux; pousseeEnCours: Signal<{ campagne: string } | null>; pousser(advertiserId, lineItems); publier(); annuler(lot); relire() }`.

- [ ] Specs d'abord : `cartes.spec.ts` (extraction de démonstration → 4 cartes, natures « 63 CP — conversion de la zone (95 % d'utile) » etc. (le résumé compte des unités retenues ; la poussée et le fichier comptent les codes BRUTS de `lireCpPlateforme`, ruling du lot 6), DV360 `api`/`simule`/`fichier` selon `mode_dv360` ; Meta + TikTok seuls → carte DV360 « rien à pousser » sans erreur — Review Focus 1 ; plateforme cochée hors extraction ; jeu risque — Review Focus 2 ; avertissements réglementaires A-13 ; `max_unites` dépassé) ; `motifs.spec.ts` (un texte par code, vouvoiement, sans le mot « stratégie ») ; `line-items.spec.ts` (parité avec le parsing de `ActivationPanel.tsx:166-170`, 51 identifiants → refus « 50 line items au plus ») ; `bandeau.spec.ts` ; parité de `formatsDe` avec `lib/zones/fichiers-plateformes.ts` (Vitest racine, patron `plan-logique-paritaire.test.ts`).
- [ ] `activation.api.ts` typé d'après les routes LUES ; `pousser` par `lignesNdjson`, corps `{ canal: 'dv360', advertiser_id, cibles }`.
- [ ] `ActivationCampagneService` (page) : lecture séquentielle annulable déclenchée quand l'espace est validé (piège n° 3), relue après poussée, publication, annulation ; extractions du jeu lues et retenues dans `PlanCampagneService` si absentes ; poussée liée à SA campagne (A-10) ; `renseignee` (A-11). Specs : rien n'est lu tant que `prerempli()` est faux ; campagne d'un autre espace → aucun appel à `prevol` ; changement de campagne pendant le pré-vol → réponse ignorée ; pendant une poussée → flux gardé sur A, `pousseeEnCours` = A, et B le voit (Review Focus 3).
- [ ] `cd angular && npx ng test --watch=false`, `npx tsc --noEmit` racine, `npm run test:unit`. Commit `feat(angular): ⑦ logique, API et état de l'activation (lot 7, T3)`.

### Task 4 : panneau ⑦, carte DV360, poussée et historique

**Files :** voir File Structure, lignes T4.

**Interfaces :**
- Consumes : `ActivationCampagneService`, `PlanCampagneService`, `ParcoursService.choisir`.
- Produces : `mg-panneau-activation`, `mg-carte-plateforme` (entrée `carte: CarteActivation`, projette le contenu propre à la plateforme), `mg-poussee-dv360`, `mg-flux-poussee`, `mg-historique-activation`.

- [ ] Specs d'abord : sans `?campagne=` → « Choisissez une campagne dans la barre, ou créez-la à l'étape ⑥. » + « Aller à ⑥ Plan » ; campagne sans plan → « Cette campagne n'a pas encore de plan : lancez-la à l'étape ⑥. » ; accès refusé → message de `PlanCampagneService` ; carte DV360 : motifs, « Publier le plan » / « Republier (v1 → v2) » à côté du motif `jamais_publiee`/`derive` (Review Focus 4), annonceur prérempli des liaisons, line items, bouton « Pousser le ciblage vers DV360 » (simulé : « Simuler la poussée vers DV360 » + « Mode démo : rien ne part chez Google. »), avertissement additif de React mot pour mot ; flux : `Départ — N line item(s)`, `[i/N] <id> · <statut> — <erreur>`, `Terminé — X poussé(s), Y échec(s)`, barre `mg-barre-progression` au rapport `n/total` ; historique : canal, statut (libellé + point de couleur), « Simulé » quand `mode = 'simule'`, date `fr-FR`, `v<n> · N line items · …`, « Annuler ce lot » → `mg-confirmation` « Marquer ce lot annulé ? », message de la route affiché tel quel.
- [ ] `carte.page.html` : `@case ('activation') { <mg-panneau-activation /> }` ; `parcours.ts` : `ONGLET_REACT` perd `activation`, `CONSIGNE_ETAPE.activation` = « Envoyez le ciblage de la campagne à chaque plateforme : poussée DV360, fichiers pour les autres. Rien ne part sans votre clic. », `EtatRenseigne.activationRenseignee` + `RENSEIGNEE_PAR.activation` ; `carte.fournisseurs.ts` : `FOURNISSEURS_ACTIVATION` et `suivreActivationRenseignee()` ; `carte.page.ts` : une ligne (pastille).
- [ ] `cd angular && npx ng test --watch=false`, `npx tsc --noEmit`. Commit `feat(angular): ⑦ panneau d'activation, poussée DV360 et historique (lot 7, T4)`.

**Relecture 2** (T3 + T4) : une lecture part-elle avant la validation de l'espace (piège n° 3) ? une poussée peut-elle s'afficher sur la mauvaise campagne ? chaque texte de React est-il repris, et chaque écart listé ? aucun hex, aucun `effect` qui recopie ?

## Groupe C — fichiers et bandeau (relecture 3)

### Task 5 : cartes TTD, Meta, TikTok, fichiers, bandeau, fichiers en ⑤

**Files :** voir File Structure, lignes T5.

**Interfaces :**
- Consumes : `CarteActivation.formats`, `ActivationApi.urlFichier`, `bandeauActivation`, `mg-bouton-export`.
- Produces : `mg-fichiers-extraction` (entrées `jeuFichier`, `versionFichier`, `plateformeFichier`, `formats`), `mg-bandeau-activation`.

- [ ] Specs d'abord : une carte par plateforme cochée, dans l'ordre du registre ; mode « Fichier » ; un bouton par format (« ↓ Codes postaux », « ↓ SDF DV360 », « ↓ Cercles (CSV) », « ↓ Polygone (GeoJSON) », « ↓ Départements (CSV) » / « ↓ Communes (CSV) ») ; DV360 garde ses fichiers en repli même en mode API ; « à vérifier » affiché quand `a_verifier` ; avertissements A-13 ; un échec de téléchargement affiche le message de la route ; bandeau A-12 ; ⑤ : la liste des extractions montre le bloc par plateforme de la version, plus le texte « arrivent avec les exports ».
- [ ] Implémenter ; aucun `<a href>`.
- [ ] `cd angular && npx ng test --watch=false`, `npx tsc --noEmit`. Commit `feat(angular): ⑦ fichiers par plateforme et bandeau de l'activation (lot 7, T5)`.

**Relecture 3** (T5) : chaque format offert par l'écran est-il accepté par la route (parité `formatsDe`) ? le contraste des textes de statut tient-il en thème clair ?

## Task 6 : revue finale, factorisation, preuve navigateur

- [ ] Revue finale du lot (modèle le plus capable) : mineurs accumulés, passe de factorisation inter-tâches (dire ce qui reste dupliqué : `formatsDe` et le parsing des line items, dupliqués par construction et verrouillés par parité ; à retirer côté React à la bascule).
- [ ] **Preuve navigateur, une seule fois, deux thèmes** (`L7-T6-*`), sur **:3002 + :4202** : espace BMW GROUP ; campagne de DÉMO lancée en ⑥ sur l'extraction v1 du jeu des lycées BdR ; « Préparer l'activation → ⑦ » ; quatre cartes (DV360 63 CP, Meta 53 cercles, TikTok 1 département, TTD 1 polygone) ; motif « jamais publié » → « Publier le plan » → prêt ; poussée simulée sur 2 line items, flux et barre ; historique « Simulé · terminé » ; annulation et son message ; les cinq fichiers téléchargés et ouverts (comptes vérifiés) ; bandeau ; pastille ⑦ allumée ; la même campagne non démo → « Aucune connexion DV360 active… », fichiers seuls ; campagne d'un autre espace collée en Marine nationale → message de ⑥, aucun appel à `prevol` dans l'onglet réseau ; ⑤ : fichiers téléchargeables depuis la liste des extractions.
- [ ] `ARCHITECTURE.md` (§ carte Angular : étape ⑦, services, `mode` simulé), `angular/src/app/features/carte/README.md` (§ ⑦ et table des fichiers). Tests complets : `npm test`, `cd angular && npx ng test --watch=false`, `npx tsc --noEmit`, `npm run build` avec `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_ANON_KEY` locaux explicites, `cd angular && npx ng build`.
- [ ] Commit `docs: ⑦ Activation — revue finale et preuve navigateur (lot 7, T6)`.

---

## Estimation

| Groupe | Tâches | Charge |
|---|---|---|
| A serveur | T1, T2 | 0,75 j (T1 porte le refactor du push et les tests d'intégration d'une route jamais testée) |
| B état + poussée | T3, T4 | 0,6 j |
| C fichiers + bandeau | T5 | 0,3 j |
| Fin | T6 | 0,35 j |
| **Total** | **6 tâches, 3 relectures, 1 preuve** | **≈ 2 jours** |

## Critères de fin du lot

Une campagne lancée en ⑥ depuis une extraction se publie et se pousse vers DV360 depuis ⑦ (en simulé sur une campagne de démo, en réel quand une connexion existe), avec un lot et ses cibles en base et `mode` exact ; chaque plateforme cochée a son fichier, lu dans l'extraction figée, aux comptes de l'extraction ; une extraction sans CP DV360 et un jeu risque s'activent sans erreur ; aucune trace de custom bidding, de pacing, d'ad server ni de « stratégie » dans l'écran Angular ; React inchangé hors l'écart listé (campagne de démo activable en simulé) ; tests et builds verts ; preuve navigateur dans les deux thèmes.

## Hors V1 (rappel, § 19.2-19.4)

Script et poussée de custom bidding (`bidding_script`, `lib/dsp/push/*`, `/api/bidding/strategies/[id]/export`), pacing algorithmique, poussée API vers TTD, Meta et TikTok, ad server, retrait réel des geo IDs à l'annulation, location list DV360 (`zones/push`), liste des line items lue chez Google, déclaration réglementaire bloquante, journal des téléchargements.
