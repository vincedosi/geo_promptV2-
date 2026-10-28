# La carte en parcours — lot 8 « ⑧ Live » — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (ou superpowers:executing-plans). Skill `porting-react-to-angular` chargé AVANT chaque tâche Angular. Cases à cocher (`- [ ]`) pour le suivi.

**Révisé le 28/10 avec les réponses de Vincent** (Q-1 à Q-7 de la version du 27/10, tableau « Décisions du 28/10 » plus bas). Objectif de Vincent : **aller le plus loin possible dans le fil d'Ariane, sans démo** — aucune simulation, aucun mode démo, aucune donnée de démonstration en base.

**Mode accéléré (Vincent, 24/10) :** 10 tâches en 3 groupes et une revue finale, **un implémenteur et une relecture par groupe**, seuls les défauts Critiques et Importants corrigés au fil de l'eau (les mineurs vont à T10), **une seule preuve navigateur**, en T10. Cible : **≈ 5 jours**.

**Goal :** à l'étape ⑧ de la carte Angular, pour la campagne courante lancée en ⑥ depuis une extraction, montrer **les impressions livrées contre prévues et la dépense, par plateforme et par territoire**, remontées par les **vraies API** de DV360 (Bid Manager reporting), Meta (Insights) et TikTok (Reporting), **mises à jour chaque matin** par une tâche Inngest ; le **rythme** (temps / budget / volume), les alertes **retard** et **zone sous-livrée**, le **CPM réel contre prévu** ; une **vue de retard en descente** (région → département → CP), plafonnée à la maille que la plateforme rapporte, sur la grande carte et dans une liste des territoires les plus en retard. **Sans plateforme connectée, un état vide honnête** : « Aucune donnée remontée — plateforme non connectée. »

**Architecture :** une table d'atterrissage `livraison_plateformes` (jour × plateforme × unité de rapport), écrite par des **adaptateurs réels** (`lib/optimisation/adaptateurs/{dv360,meta,tiktok}.ts`, contrat `lireLivraison(campagne, jour)`) qui réutilisent les clients et les connexions OAuth existants (`lib/dsp/…`, `dsp_connections`) ; un service de relevé appelé par une **tâche Inngest quotidienne** (un step par campagne) et par un bouton « Relever maintenant » ; un **noyau pur** (`lib/optimisation/noyau/`) qui recalcule le prévu depuis `geo_strategy.channels` et l'extraction (§ 19.4), puis l'écart, le rythme, l'alignement et les alertes à chaque niveau de la descente ; une RPC `jsonb` d'agrégats ; une route `GET …/live`. Côté Angular : `mg-panneau-live` (port allégé de `SuiviV2`), `LiveCampagneService` fourni par la page, la grande carte peinte par les contours déjà partagés (`ContoursZonesService`). **Le navigateur ne calcule rien.**

**Tech Stack :** Angular 21.2 standalone, zoneless, signals ; Tailwind 4 ; Vitest (`cd angular && npx ng test --watch=false`). Next.js 15, supabase-js, Zod, Inngest, papaparse, Vitest racine (`npm run test:unit`, `npm run test:integration`). Postgres 17.6 local (`docker exec supabase_db_genesis_app psql -U postgres`).

**Spec :** `docs/superpowers/specs/2026-10-13-carte-en-parcours-design.md` — **§ 19 fait foi** (19.2 ligne ⑧, 19.3, 19.4 « porter / ne pas porter », prévu par CP et par plateforme, maille de rapport) ; § 4 « ⑦ Live » (numérotation d'origine) pour l'écran ; § 16.2 règles 3 (règles des plateformes en table) et 4 (connexion par espace). Plans précédents : `…/2026-10-24-carte-en-parcours-lot-6-plan.md`, `…/2026-10-25-carte-en-parcours-lot-7-activation.md`. Mémoires : `project_suivi_sans_adserver`, `project_archi_algo_optimisation`, `project_ttd_premier_dsp`, `project_dv360_parked`, `project_tiktok_connexion`, `feedback_api_first_no_file_imports`, `feedback_mode_accelere`, `feedback_angular_vigilance`, `feedback_agents_frugaux`, `feedback_no_hardcoded_colors`, `reference_postgrest_db_max_rows`, `reference_maplibre_paint_sans_var`, `reference_dsp_maille_geo`.

## Décisions du 28/10 (Vincent)

| # | Question du 27/10 | Décision |
|---|---|---|
| Q-1 | Livraison simulée pour les démos ? | **NON.** Aucune simulation, aucun mode démo, aucune donnée de démo. Pas d'adaptateur simulé, aucun recours à `diffuserJour` ni au seed. Sans plateforme connectée : état vide honnête. |
| Q-2 | Maille de rapport TTD ? | **TTD mis de côté** (doc bientôt) : aucune tâche TTD dans ce lot. Une plateforme TTD cochée affiche « The Trade Desk : connecteur à venir. » |
| Q-3 | Écart de répartition ? | **Oui** (comme React ; le retard de volume se lit dans le rythme). |
| Q-4 | Grande carte au lieu des vignettes ? | **Oui** : une grande carte, zoomable. |
| Q-5 | Graphique d'écart ? | **Pas d'histogramme CP.** Vue de retard **en descente** : région → département → CP → (IRIS ou polygone, comme TTD), **plafonnée à la maille que la plateforme rapporte réellement**, dite à l'écran. Sur la grande carte : écart livré / prévu par territoire au niveau choisi + liste triée des territoires les plus en retard ; clic = descendre d'un niveau. Prévu recalculé au même niveau (agrégation depuis le CP du plan, ou unité du jeu pour un polygone). |
| Q-6 | Bouton seulement ? | **NON** : connexion API réelle + **mise à jour automatique** (tâche Inngest planifiée, un step par campagne, règles I/O). Bouton « Relever maintenant » gardé : il appelle le même service (quasi gratuit). |
| Q-7 | Adaptateurs vides ? | **On code les vrais adaptateurs** DV360 reporting, Meta Insights, TikTok reporting (TTD plus tard) sur le contrat `lireLivraison`, d'après la doc publique, **testés par des réponses enregistrées** dans les tests unitaires (fixtures de test ≠ données de démo : rien n'entre en base). Réutiliser les clients existants et les connexions OAuth. |

## Global Constraints

- V1 = **impressions et dépense** remontées par les plateformes. Ni ad server, ni réconciliation, ni conversions, ni rebid / « Recaler », ni constats d'optimisation (`sur_pression`, `canal_cher`), ni « coût du déséquilibre », ni pression par classe, ni vignette « Variable du plan », ni histogramme CP (§ 19.2-19.4, Q-5).
- **Aucune donnée inventée** : aucune ligne de `livraison_plateformes` n'est écrite autrement que par un adaptateur qui a lu une vraie réponse d'API. Les fixtures vivent dans `tests/` ; un test d'intégration qui écrit en base le fait sur une campagne de test qu'il crée et supprime lui-même (patron des lots 6 et 7), jamais sur une campagne visible.
- **Aucun calcul dans le navigateur** : prévu, écart, rythme, alignement, alertes, classement des retards arrivent chiffrés du serveur. Angular filtre (plateforme, parent), trie déjà-trié et colore.
- **Le prévu n'est JAMAIS lu dans `campaign_cp_rollup.planned_share` ni `get_campaign_expected`** (§ 19.4).
- **Une connexion par espace** (règle 4) : un adaptateur lit la connexion de l'espace de la campagne (`dsp_connections`, `connexionUtilisable` du lot 7), et les identifiants de la campagne sur la plateforme dans `geo_strategy.channels.links` (liaisons de ⑥ : DV360 annonceur / campagne / insertion order ; Meta compte / campagne / ad set ; TikTok annonceur / campagne / ad group).
- **Appels sortants** : `fetchAvecDelai` (délai borné), jeton rafraîchi par les fonctions existantes (`resolveAccessToken` DV360), erreurs lues et journalisées par `logDspEvent` ; aucune clé en dur (`aucun-secret-en-dur.test.ts`).
- Écritures : **lots de 50, 3 en parallèle au plus**, erreur de CHAQUE lot lue, upsert idempotent sur la clé primaire ; progression NDJSON pour le bouton (CLAUDE.md « Imports & batch DB ») ; la tâche Inngest journalise ses compteurs par step.
- Inngest : **une campagne à la fois** (un step par campagne, séquentiels), horaire creux, aucune campagne sans plateforme connectée n'est relue.
- Troncature PostgREST (1 000 lignes) : RPC `RETURNS jsonb` avec borne écrite et `tronque` ; CP d'une extraction par `lireCpExtraction` / `lireCpPlateforme`.
- Campagnes réservées au **super_admin** en V1 ; `relever` le vérifie (403). **Contrôle d'espace côté Angular** comme ⑦ ; le serveur refait le contrôle (404).
- Aucun `DROP` ; migration additive rejouable ; base locale seulement, jamais le MCP Supabase.
- Vouvoiement ; textes de React à la lettre là où on porte (écarts listés au rapport) ; sentence case ; jetons `var(--…)` seulement (valeurs CALCULÉES par `CouleursService` pour MapLibre) ; Inter + JetBrains Mono ; bordures 0,5 px.
- Fichiers `.ts` < 400 lignes ; `carte.page.ts` 379/400 (une ligne de pastille) ; `plan-campagne.service.ts` 391/400 (**rien n'y entre**).
- Preuve sur les serveurs du worktree, **jamais :3000 / :4200**, qu'on n'arrête pas.

## Review Focus

1. **Aucune donnée inventée** : grep `diffuserJour`, `simul`, `demo`, `is_demo` dans tout fichier neuf du lot → aucun ; aucune ligne écrite sans réponse d'API ; état vide « Aucune donnée remontée — plateforme non connectée. » quand la connexion manque (tests T3, T7).
2. **Deux plateformes au CP** : prévu de chacune = ses impressions (budget ÷ CPM × 1 000) réparties sur SES CP au prorata des multiplicateurs, somme exacte ; rien de `planned_share` (T2).
3. **Descente plafonnée** : Meta et TikTok s'arrêtent à la région, DV360 au CP ; le niveau suivant est grisé avec la phrase de la plateforme ; « Toutes plateformes » à la région ; le prévu de chaque niveau est l'agrégat du CP du plan (T2, T9).
4. **Adaptateurs fidèles à la doc** : chaque adaptateur, rejoué sur sa réponse enregistrée, rend exactement les lignes attendues (jour, maille, code, impressions, dépense en euros) ; pagination et rapport asynchrone (DV360) couverts ; une erreur d'API ne vide jamais les jours déjà relevés (T4-T6).
5. **Inngest et I/O** : un step par campagne, séquentiels ; seules les campagnes en vol avec au moins une connexion utilisable sont relues ; re-relève idempotent ; coût mesuré (T3).
6. **Changement de campagne pendant une lecture ou un relevé** : une réponse tardive de A ne s'écrit jamais dans B ; « Un relevé est en cours sur une autre campagne. » (patron A-10 de ⑦) (T7).

---

## Pré-vol : ce qui existe vraiment (reconnaissance des 27-28/10, worktree `carte-live`, HEAD `b3610369`)

### Quelle source alimente ⑧ aujourd'hui — mesuré en base locale

**Aucune.** Aucune API de plateforme n'est branchée, et aucune ligne de livraison n'existe pour une campagne lancée en ⑥. ⑧ affichera donc l'état vide honnête tant qu'aucune connexion n'est active ; le lot livre la plomberie complète pour que la première connexion remplisse l'écran sans autre code.

| Plateforme | Client existant | Connexion en base (27/10) | Reporting | Ce que fait ce lot |
|---|---|---|---|---|
| DV360 | `lib/dsp/dv360/{auth,client}.ts` : OAuth et compte de service, `resolveAccessToken`, cascade annonceur → campagne → IO, poussée géo | **1 ligne**, espace 00…01, `error` ; BMW GROUP : aucune ; droits Google bloqués (`project_dv360_parked`) | `lib/dsp/report/dv360.ts` = **bouchon** `skipped` ; le scope `doubleclickbidmanager` est **commenté** dans `DV360_SCOPES` (« itération 2 ») | T4 : scope ajouté (reconsentement nécessaire, dit dans l'écran Connexions), adaptateur Bid Manager v2 |
| Meta | **rien** (`dsp_channel_registry.meta.connection_provider = 'meta'`, liaisons `ad_account / campaign / ad_set`) | aucune | rien | T5 : connexion OAuth (patron TikTok) + adaptateur Insights |
| TikTok | `lib/dsp/tiktok/client.ts` : OAuth, échange du code, liste des annonceurs ; routes `admin/dsp/tiktok/{connect,oauth/callback}` | aucune ; app développeur non créée (`project_tiktok_connexion`) | rien | T6 : adaptateur Reporting (`/report/integrated/get/`) |
| TTD | rien | — | — | **à venir** (Q-2) |

Le reste de la base n'apporte rien à ⑧ : `dsp_campaign_data` (≈ 1,04 M lignes, 394 Mo) n'est que seed, simulation du module risque et import Adform ; `campaign_dsp_report` (2 131 lignes) est tout entier `simulated` ; les rollups portent `planned_share` (interdit par § 19.4). Rien de cela n'est lu ni modifié par ce lot.

### Le plan d'une campagne lancée en ⑥ (mesuré sur `4935811d…`)

- `geo_strategy.channels` : budgets dv360 10 000 / ttd 8 000 / meta 6 000 / tiktok 4 000 € ; CPM prévus 4,5 / 3,8 / 5,2 / 6 € → impressions prévues 2 222 222 / 2 105 263 / 1 153 846 / 666 667, **total 6 147 998 = `kpi_target`**. Période 01/11 → 30/11/2026. `links` : vides sur cette campagne (aucune liaison faite en ⑥) — un adaptateur sans identifiant de campagne rend `non_lie` (A-3).
- Extraction `2fc8fd52…` : plan CP 88 lignes ; DV360 63 unités CP retenues → **72 CP bruts** ; Meta 53 cercles ; TikTok 1 département retenu sur 2 ; TTD 1 polygone. Régions : PACA 87 CP (1 561 527 hab. en zone) + Occitanie 1.
- `zone_set_extraction_unites` porte `pop_en_zone` par unité mais **aucun multiplicateur hors CP**.

### Les mailles que les plateformes rapportent (doc publique, à confirmer à la première connexion)

| Plateforme | Dimension géographique du rapport | Maille de rapport retenue | Niveau le plus fin de la descente |
|---|---|---|---|
| DV360 (Bid Manager v2) | `FILTER_ZIP_POSTAL_CODE` (+ `FILTER_DATE`) | `cp` | CP |
| Meta (Insights) | `breakdowns=region` (le code postal n'est pas une ventilation Insights en France) | `region` | région |
| TikTok (Reporting, rapport AUDIENCE) | `province_id` (identifiant TikTok, nom via `/tool/region/`) | `region`, **à vérifier** pour la France | région |
| TTD | — | à venir | — |

**IRIS et polygone** : aucune de ces API ne rapporte sous le CP. La descente est donc construite sur une liste de niveaux ordonnée (`region` → `departement` → `cp` → `iris` | `unite`) plafonnée par `maille_rapport`, mais **les niveaux IRIS et unité du jeu ne sont pas codés tant qu'aucune plateforme ne les rapporte** (TTD, quand sa doc arrivera) : zéro code mort, et l'écran dit pourquoi on s'arrête (Q-11).

### L'existant React à porter (≈ 3 700 lignes) et ses données

| Brique React (lignes) | Sort au lot 8 |
|---|---|
| `SuiviV2.tsx` (709) — sept lectures, sémaphore à 3 | **Porté allégé** : UNE lecture (`GET …/live`), descente en mémoire |
| `BarreContexteCampagne.tsx` (273) | **Déjà porté** (`mg-choix-campagne`, lot 6) |
| `BarreMaille.tsx` (103) | **Porté** + sélecteur de plateforme + plafond de la descente |
| `BandeauAvancement.tsx` (160) | **Porté** |
| `CoutEtRythme.tsx` (116) | **Porté** sans « coût du déséquilibre » |
| `ScoreAlignement.tsx` (251) + `TroisComposantes.tsx` (101) | **Portés**, plateformes au CP seules |
| `TableauDeregles.tsx` (373) | **Porté** en « Territoires les plus en retard » (liste triée, clic = descendre) |
| `GraphiqueEcart.tsx` (253) | **Non porté** (Q-5 : ni courbe ni histogramme ; la descente sur la carte le remplace) |
| `QuiADiffuse.tsx` (156) | **Porté** : une barre par plateforme, état « non connectée » |
| `ConstatsCorrection.tsx` (134) | **Porté**, constat `sous_pression` seul + alerte retard |
| `TrioCartes.tsx` (178) + `CarteVignette.tsx` (335) | **Remplacés par la grande carte** (Q-4) |
| `PressionParClasse`, `DetailTechnique`, vignette « Variable du plan » | **Non portés** (§ 19.4) |

TS serveur réutilisé tel quel : `calculerAlignement` (`lib/campagne/alignement.ts`), `SEUIL_ECART_SIGNALE_PCT`, `SEUIL_CPM_CHER` et le constat sous-pression (`lib/campagne/constats.ts`, fonction à exporter), `trancheDivergente` (`lib/campagne/palette-divergente.ts`), `lireCpExtraction` / `lireCpPlateforme`, `sourceDePoussee` et `connexionUtilisable` (`lib/campaigns/activation.ts`), `resolveAccessToken` / `fetchAvecDelai` (`lib/dsp/dv360/client.ts`), `exchangeTiktokAuthCode` et le patron OAuth TikTok, `logDspEvent` (`lib/dsp/logger.ts`), `insererLignes` (`lib/simulation/serveur.ts`, boucle à généraliser), `rpcJson`, `lireTout`, `inngest` (`lib/inngest/client.ts`, patron `civicDailyIngest`).

### Côté Angular

- `logique/parcours.ts` : étape `live` (`@default { <mg-etape-bientot> }`), `ONGLET_REACT.live = 'suivi'`, `CONSIGNE_ETAPE.live` « arrive dans le parcours », `ETAPES_CAMPAGNE` inclut `live`.
- `etat/plan-campagne.service.ts`, `etat/activation-campagne.service.ts` (patron « validée », tâche liée à SA campagne) ; écran Connexions API de l'admin (lot 6) pour la connexion Meta et le reconsentement DV360.
- Briques : `ui/{entete-section, kpi, bandeau-kpi, tuile-chiffre, barre-progression, fil-ariane, pastille, tableau, notifications}`, `core/http/ndjson.ts`, `etat/lecture-annulable.ts`, `etat/contours-zones.service.ts` (région / département / CP, ≈ 3,8 Mo au CP, une lecture par écran), `couches/couche-unites.ts` (`ajouterCouche`), `features/risques/logique/palette-divergente.ts` et `logique/carte-campagne.ts` (`JETONS_CAMPAGNE`, `couleurIndice`).

### Mesures locales (27-28/10)

| Mesure | Valeur |
|---|---|
| Table synthétique de livraison (transaction annulée), 30 j × 2 595 CP | 77 850 lignes par campagne-mois et plateforme au CP, ≈ 190 o/ligne (≈ 15 Mo) |
| Agrégat livré par (plateforme, maille, code) + 7 derniers jours | **24 ms**, index de clé primaire, ≈ 2 060 buffers |
| Agrégat par (plateforme, jour) | **14 ms**, ≈ 2 060 buffers |
| **Descente complète** (Q-5) : livré + poids du plan agrégés aux trois niveaux région / département / CP en UN passage, plan national 2 595 CP | **37 ms**, 2 707 groupes (15 régions, 97 départements, 2 595 CP) ; ≈ 1 680 buffers partagés dont **1 552 pour un parcours séquentiel de `ref_codes_postaux`** (13 Mo, géométries comprises) — un index couvrant `(code_postal) include (code_dept)` le ramènerait à quelques dizaines (à mesurer en T1) |
| Relevé quotidien d'une plateforme au CP, national | ≈ 2 600 lignes → 52 lots de 50 ; re-relève de 3 jours ≈ 156 lots |
| Plan national (jeu risque `78f6911a…`) | 2 595 CP, 97 départements, 15 régions, 0 CP hors référentiel |

### « Mode pays » : ne bloque pas ⑧

⑧ n'appelle ni `couverture_geometrie` ni aucune RPC bornée à 100 000 km² ; il lit une extraction figée et des agrégats. La borne bloque **en amont** (④ couverture, ⑤ extraction d'un jeu de ZONE national). Un jeu risque national s'extrait déjà et sert de mesure d'échelle. **Pas de tâche dans ce lot** ; ligne ④/⑤ de l'Excel.

### Écarts relevés (corrigés par ce plan)

| # | Constat | Ce que fait ce plan |
|---|---|---|
| E1 | Aucune table pour une livraison par plateforme et par unité de rapport (`dsp_campaign_data` = ad server au CP × acteur ; `campaign_dsp_report` contraint à deux grains, sans région). | T1 : `livraison_plateformes`. |
| E2 | `lib/dsp/report/*` (bouchon DV360, contrat sans maille) ne sert que la réconciliation React (hors V1). | Non touché ; supprimé à la bascule React. Les adaptateurs neufs portent la maille et les identifiants de liaison. |
| E3 | La maille de RAPPORT n'est écrite nulle part (§ 19.4). | T1 : `plateformes_geo.maille_rapport` (dv360 → cp ; meta, tiktok → region ; ttd → null, à venir). |
| E4 | Le scope reporting DV360 est commenté ; une connexion existante ne peut pas lire de rapport. | T4 : scope ajouté ; l'écran Connexions dit « Reconnectez DV360 pour autoriser la lecture des rapports. » quand le jeton n'a pas le scope. |
| E5 | Aucune connexion Meta possible. | T5 : flux OAuth Meta (patron TikTok). |
| E6 | Les écrans React chiffrent dans le navigateur. | T2 : tout est calculé côté serveur en UNE réponse. |
| E7 | La boucle d'écriture par lots vit dans `insererLignes`, liée à `dsp_campaign_data`. | T1 : `ecrireParLots` générique ; `insererLignes` l'appelle. |

---

## Routes API et tâche planifiée

**Routes neuves** : `GET /api/campaigns/[campaignId]/live` (T2) ; `POST /api/campaigns/[campaignId]/live/relever` (T3, NDJSON) ; `GET /api/admin/dsp/meta/oauth/start` et `GET /api/admin/dsp/meta/oauth/callback` (T5). **Tâche Inngest neuve** : `releve-livraisons-quotidien` (T3), enregistrée dans `app/api/inngest/route.ts`. **Modifiés sans changement de contrat** : `DV360_SCOPES` (un scope ajouté), `lib/simulation/serveur.ts` (`insererLignes` délègue à `ecrireParLots`).

Plus appelées par ⑧ : `/api/digital/[id]/{suivi,actors,reconcile,reconcile/pull}`, `/api/campaigns/[id]/alignement*`, `/api/campaigns/[id]/pression-classes`. Elles restent pour React.

**Charge I/O.** `GET …/live` : campagne + stratégie, `plateformes_geo`, le plan CP **lu une fois** (≤ 7 000, paginé), UNE RPC d'agrégats (≈ 2 000 buffers à l'échelle nationale, 37 ms mesurés pour la descente). Séquentiel. Inngest : chaque matin, pour chaque campagne en vol avec une connexion utilisable, une lecture du plan puis les appels API (hors base) puis ≈ 52 à 156 lots d'upsert ; une campagne à la fois. Côté Angular : une lecture à l'entrée dans ⑧ par campagne (cache), relue après un relevé ; descendre ou changer de plateforme ne relit rien.

---

## Arbitrages (tranchés ; coût si faux)

| # | Point | Tranché | Coût si faux |
|---|---|---|---|
| A-1 | Lecture du plan | `lireCpPlateforme` gagne un paramètre optionnel `plan?: LigneCpExtraction[]` (plan déjà lu) ; ses quatre appelants inchangés. | une relecture par plateforme |
| A-2 | Table d'atterrissage | `livraison_plateformes (campaign_id uuid FK cascade, plateforme text check (dv360,ttd,meta,tiktok), jour date, maille text check (cp,departement,region,iris,unite), code text, impressions bigint ≥ 0, depense numeric(12,4) ≥ 0, devise text not null default 'EUR', lu_le timestamptz default now(), PK (campaign_id, plateforme, jour, maille, code))`. Pas de colonne `source` : toute ligne vient d'une API. Pas de RLS active (lue par la route admin seule). | une colonne |
| A-3 | Contrat d'adaptateur | `interface AdaptateurLivraison { plateforme; mailleRapport; lireLivraison(c: CampagneLive, jours: { de: string; a: string }): Promise<LigneLivraison[]> }` (une plage plutôt qu'un jour : DV360 produit un rapport par plage ; les autres paginent par jour). `choisirAdaptateur(plateforme, connexion, liens)` → l'adaptateur, ou un **état** : `non_connectee` (« Aucune donnée remontée — <plateforme> non connectée. »), `non_liee` (« Liez la campagne <plateforme> à l'étape ⑥ pour remonter ses données. »), `scope_manquant` (DV360, E4), `a_venir` (TTD). | un état de plus |
| A-4 | Prévu par plateforme et par unité | Impressions de la plateforme = budget ÷ CPM × 1 000 (⑥). **Au CP** : sur SES CP bruts (`lireCpPlateforme`) au prorata des multiplicateurs, plus forts restes. **Autre maille d'achat** : sur les CP **canoniques** du plan au prorata de `pop_en_zone`. Chaque niveau de la descente = somme des CP (Q-5). Jamais `planned_share`. | une règle du noyau |
| A-5 | Descente | Niveaux ordonnés `region → departement → cp` ; plafond = `maille_rapport` de la plateforme ; si elle n'achète pas au CP, son prévu n'existe qu'agrégé : la descente s'arrête à la région même si elle rapporte au CP. « Toutes plateformes » = région. Note : « Meta ne rend pas le code postal : la descente s'arrête à la région. » ; TikTok : « … (maille à vérifier). » | un libellé |
| A-6 | Écart par territoire | Écart de **répartition** (Q-3) : prévu à date = part prévue × livré total de la plateforme ; `ecart_pct = (livré − prévu à date) ÷ prévu à date × 100` ; `hors_plan` si livré sans prévu ; `retard_imps = max(0, prévu à date − livré)`. | une formule |
| A-7 | Liste des plus en retard | Au niveau affiché, triée par `retard_imps` décroissant (volume manquant, comme le tri de React par volume mal placé), 7 lignes puis « Voir les N … » en mémoire ; clic = descendre (Q-5). | un tri |
| A-8 | Rythme et alertes | Au dernier jour relevé : `temps_pct`, `budget_pct`, `volume_pct`, `indice = volume_pct ÷ temps_pct` ; retard < 0,85 / < 0,70, avance > 1,15 / > 1,30 (seuils de `get_campaign_suivi`) ; zone sous-livrée = constat `sous_pression` de React (≤ 3, seuil 20 %) ; CPM réel > prévu × `SEUIL_CPM_CHER`. | des seuils importés |
| A-9 | Alignement | `calculerAlignement` sur les CP d'une plateforme au CP, tolérance et poids de la campagne ; variation 7 j ou `null` ; pas de `sur_pression_eur`. Plateforme hors CP : « Score calculé au code postal : non disponible pour <plateforme>. » | un bloc masqué |
| A-10 | Dépense | La dépense de la plateforme, en euros, telle que l'API la rend : DV360 `METRIC_REVENUE_ADVERTISER` (ce que l'annonceur paie, comparable au budget saisi en ⑥ ; Q-9), Meta `spend`, TikTok `spend`. Devise de la connexion ≠ EUR : ligne refusée et dite (« Devise <X> non prise en charge »), jamais convertie en silence. | une métrique |
| A-11 | Relevé | `releverCampagne(supabase, campagneId, { onProgres })` : pour chaque plateforme cochée, `choisirAdaptateur` ; jours = du début de période à `min(fin, hier)`, **plafonnés aux 3 derniers jours** après le premier relevé complet (les plateformes corrigent leurs chiffres a posteriori ; Q-12) ; upsert par lots ; erreur d'une plateforme = journalisée, n'efface rien, n'arrête pas les autres. Appelé par Inngest et par le bouton (même fonction). | une fenêtre |
| A-12 | Inngest | `releve-livraisons-quotidien`, cron `TZ=Europe/Paris 0 6 * * *` ; un step `lister` (campagnes dont la période couvre hier, stratégie à `extraction_id`, ≥ 1 plateforme `connected` avec adaptateur), puis **un step par campagne**, séquentiels ; `retries: 2` par step ; compteurs par campagne dans `dsp_api_logs` (`logDspEvent`). | un horaire |
| A-13 | Campagne hors parcours / vide | Sans `extraction_id` : « Cette campagne n'a pas été lancée depuis une extraction : son suivi reste dans l'application actuelle. » + lien `ONGLET_REACT.live`. Période future : « La campagne commence le <date>. » Aucune plateforme connectée : « Aucune donnée remontée — plateforme non connectée. » + lien vers Connexions API. | un message |
| A-14 | Grande carte | Couche `live` sur la carte principale, zoomable : polygones de `ContoursZonesService` au niveau affiché (régions ; départements d'une région ; CP d'un département), couleur par `trancheDivergente` de l'écart, `--donnee-absente` sans prévu ni livré ; clic = descendre et cadrer ; la couche se retire hors de ⑧. | une couche |
| A-15 | Pastille et bandeau | Pastille ⑧ : le payload porte ≥ 1 jour relevé. Bandeau : livré / prévu, dépensé / budget, CPM réel / prévu, jours restants, dernier jour relevé et sa date de lecture. | du texte |

---

## Questions pour Vincent (nouvelles, 28/10 ; recommandation entre crochets)

| # | Question | Ce qui en dépend | Recommandation |
|---|---|---|---|
| Q-8 | Sans aucune connexion active, l'écran **rempli** ne peut pas être montré dans le navigateur (pas de démo). Preuve du lot = specs Angular sur une réponse de test + preuve navigateur des états vides et de la navigation ; la preuve remplie se fait à la **première vraie connexion** ? | T10 | **[Oui.]** |
| Q-9 | Dépense DV360 = **coût total annonceur** (`Revenue (Adv Currency)`, ce que couvre le budget saisi en ⑥) plutôt que le coût média seul ? | A-10, T4 | **[Coût total annonceur.]** |
| Q-10 | Accès à obtenir hors code : **app Meta** (app id / secret, accès Marketing API `ads_read`, Business Manager dentsu), **app développeur TikTok**, **droits Google** + reconsentement DV360 pour le scope reporting. Qui les porte ? | T4-T6 en réel | **[Vincent ou le CP repreneur ; le code est livré et testé sans eux.]** |
| Q-11 | Aucune API publique ne rapporte sous le CP : la descente s'arrête au **CP** en V1, les niveaux IRIS / polygone venant avec TTD ? | A-5 | **[Oui.]** |
| Q-12 | Chaque matin, relire les **3 derniers jours** (chiffres corrigés a posteriori par les plateformes) ? | A-11 | **[Oui, 3 jours.]** |

En attendant les réponses, le plan applique les recommandations ; chaque arbitrage dit son coût si la réponse est autre.

---

## File Structure

| Fichier | Responsabilité | Tâche |
|---|---|---|
| `sql/288_livraison_plateformes.sql` (créé ; numéro à reconfirmer) | `livraison_plateformes` (A-2), `plateformes_geo.maille_rapport` + valeurs (E3), index couvrant de `ref_codes_postaux` s'il paie (mesure), RPC `livraison_agregee_jsonb(p_campagne uuid, p_cps text[])` : livré par (plateforme, maille, code) total / 7 j / 7 j précédents, par (plateforme, jour), et département / région (codes, noms) des CP demandés ∪ livrés ; borne 20 000 entrées + `tronque` | T1 |
| `lib/supabase/ecrire-par-lots.ts` (créé) ; `lib/simulation/serveur.ts` (modifié) | lots de 50, 3 en parallèle (E7) | T1 |
| `lib/optimisation/adaptateurs/{types,index}.ts` (créés) | contrat, `choisirAdaptateur` et ses états (A-3) | T1 |
| `lib/campagne/live/campagne-live.ts` (créé) ; `lib/zones/cp-plateforme.ts` (modifié, A-1) | lecture serveur de la campagne de ⑧ (stratégie, extraction, période, canaux, liens, connexions de l'espace, plan, CP par plateforme) | T1 |
| `lib/optimisation/noyau/{prevu,suivi}.ts` (créés) ; `lib/campagne/constats.ts` (export) | prévu, descente, écart, retard, rythme, alignement, alertes — PURS | T2 |
| `app/api/campaigns/[campaignId]/live/route.ts` (créé) | le payload unique de ⑧ | T2 |
| `lib/campagne/live/relever.ts` (créé) ; `app/api/campaigns/[campaignId]/live/relever/route.ts` (créé) ; `lib/inngest/functions/releveLivraisonsQuotidien.ts` (créé) ; `app/api/inngest/route.ts` (modifié) | relevé (A-11, A-12) | T3 |
| `lib/dsp/dv360/auth.ts` (scope) ; `lib/dsp/dv360/rapports.ts` (créé : `creerRequete`, `lancer`, `attendre`, `telecharger`) ; `lib/optimisation/adaptateurs/dv360.ts` (créé) | DV360 Bid Manager v2 | T4 |
| `lib/dsp/meta/client.ts` (créé) ; `app/api/admin/dsp/meta/oauth/{start,callback}/route.ts` (créés) ; `lib/optimisation/adaptateurs/meta.ts` (créé) ; `lib/optimisation/adaptateurs/regions.ts` (créé : nom de région rendu par une API → `code_region` de `ref_regions`, partagé Meta / TikTok) | Meta | T5 |
| `lib/dsp/tiktok/client.ts` (étendu : `lireRapport`) ; `lib/optimisation/adaptateurs/tiktok.ts` (créé) | TikTok | T6 |
| `tests/unit/optimisation/**`, `tests/fixtures/dsp/{dv360,meta,tiktok}/*` (réponses enregistrées, anonymisées), `tests/integration/live-*.test.ts` | — | T1-T6 |
| `angular/.../carte/data/live.api.ts`, `etat/live-campagne.service.ts`, `logique/live/{vue,textes}.ts`, `panneaux/live/{panneau-live,releve-livraisons,bandeau-live}.component.ts`, `testing/live-factice.ts` (+ specs) ; `carte.page.html`, `logique/parcours.ts`, `carte.fournisseurs.ts`, `carte.page.ts` (une ligne), `app.routes.ts` | état, squelette, relevé, bandeau | T7 |
| `angular/.../carte/panneaux/live/{bandeau-avancement,cout-rythme,qui-a-diffuse,score-alignement,trois-composantes}.component.ts` (+ specs) | chiffres | T8 |
| `angular/.../carte/panneaux/live/{barre-maille,territoires-retard,constats-live}.component.ts`, `couches/{couche-live.ts,live-carte.service.ts}` (+ specs) | descente et carte | T9 |
| écran Connexions API (admin Angular, lot 6) | Meta connectable ; « Reconnectez DV360… » (E4) | T5 |
| `ARCHITECTURE.md`, `angular/src/app/features/carte/README.md` | T1-T6, T10 | — |

---

## Pièges Angular / AIDA (à recopier dans CHAQUE brief de tâche Angular)

- Contrat AIDA : aucun `position: fixed`, aucun écouteur `window`/`document`, aucun `localStorage` neuf, aucun portail hors de l'arbre, services d'état fournis par la page, services d'API dans `FOURNISSEURS_DISTANTS`, `HttpBaseService.baseUrl`, pas de `@angular/core/rxjs-interop`.
- **Aucune lecture avant la validation de l'espace** (patron `ActivationCampagneService.validee`).
- **Aucune formule dans Angular** : le relecteur grep `/ 1000`, `* 100`, `0.85`, `1.25` dans `logique/live/` et `panneaux/live/`.
- **Aucune donnée de démo** : les doublures (`testing/live-factice.ts`) vivent dans les specs seulement.
- MapLibre reçoit des couleurs CALCULÉES (`CouleursService`) ; palette divergente importée de `features/risques/logique/palette-divergente.ts`, jamais recopiée. Texte de statut sur fond clair : `--text-primary`, la couleur de statut pour le point et la bordure.
- Barres (avancement, plateformes, territoires) en **HTML/CSS**, comme React ; `graphiques/` n'a ni barres ni aires.
- Lecture annulable (`lecture-annulable.ts`) ; NDJSON par `lignesNdjson` ; dérivées en `computed` ; `inject()` jamais après un `await` ; formats par `core/format/*`.
- Le panneau de ⑧ reste MONTÉ hors de l'étape ; la couche `live` se retire quand on quitte ⑧.

---

## Groupe A — socle serveur (relecture 1)

### Task 1 : table, maille de rapport, contrat d'adaptateur, lecture de la campagne

**Interfaces :** `ecrireParLots<T>(supabase, table, lignes, o: { onConflict?; onProgres? })` ; `LigneLivraison { plateforme; jour; maille; code; impressions; depense }` ; `AdaptateurLivraison`, `choisirAdaptateur` (A-3) ; `lireCampagneLive(supabase, campagneId, orgId): Promise<CampagneLive | { refus: 404 | 409; code; message }>` où `CampagneLive = { id; nom; debut; fin; tolerance; poids; extractionId; typeJeu; plan: LigneCpExtraction[]; plateformes: { code; budget; cpm; mailleAchat; mailleRapport; liens: Record<string, string>; connexion: { status; auth_method; … } | null; cps: LigneCpExtraction[] | null }[] }`.

- [ ] Tests d'abord : `ecrire-par-lots.test.ts` (101 lignes → 3 lots, ≤ 3 en vol, erreur de lot levée, progression cumulée) ; `adaptateurs-choix.test.ts` (connexion absente → `non_connectee` ; `error` → `non_connectee` ; liens vides → `non_liee` ; TTD → `a_venir` ; DV360 sans scope reporting → `scope_manquant`) ; `campagne-live` par l'intégration. Lancer : FAIL.
- [ ] `sql/288_livraison_plateformes.sql` : table, colonne et valeurs, RPC (`SECURITY DEFINER`, `search_path`, `comment on function` avec la borne) ; mesurer la descente avec et sans l'index couvrant `(code_postal) include (code_dept)` sur `ref_codes_postaux`, ne le garder que s'il paie (chiffres au rapport) ; compléter `troncature-postgrest.test.ts`.
- [ ] `ecrireParLots` extrait (`insererLignes` : contrat et tests inchangés).
- [ ] `lireCampagneLive` (A-1, contrôle d'espace 404, `hors_parcours` 409).
- [ ] `tests/integration/live-campagne.test.ts` : campagne de test créée et supprimée par le test, extraction `2fc8fd52…` ; plan lu une fois ; DV360 72 CP ; `hors_parcours` sur une stratégie sans extraction ; autre espace → 404.
- [ ] `ARCHITECTURE.md` ; tsc, unitaires, intégration (codes de retour lus sans pipe). Commit `feat(api): ⑧ table des livraisons et contrat des adaptateurs (lot 8, T1)`.

### Task 2 : le payload de ⑧ — prévu, descente, retard, rythme, alignement

**Interfaces :** `GET /api/campaigns/[campaignId]/live` → `{ campagne: { id, nom, debut, fin, dernier_jour, lu_le, jours_ecoules, jours_total, temps_pct }, plateformes: PlateformeLive[], total, descente: Record<string /* plateforme | 'toutes' */, { plafond: 'region' | 'departement' | 'cp'; note: string | null; region: Territoire[]; departement: Territoire[]; cp: Territoire[] }>, alertes: Alerte[], tronque }` ; `PlateformeLive = { code, libelle, etat: 'ok' | 'non_connectee' | 'non_liee' | 'scope_manquant' | 'a_venir' | 'aucune_donnee'; message; maille_rapport; budget; cpm_prevu; impressions_prevues; impressions_livrees; depense; cpm_reel; rythme; alignement | null }` ; `Territoire = { code; nom; parent; prevu; livre; depense; ecart_pct; retard_imps; hors_plan }` (chaque liste déjà triée par `retard_imps` décroissant) ; `Alerte = { type: 'retard' | 'avance' | 'sous_livree' | 'cpm'; plateforme; severite; titre; detail; cible }`.

- [ ] Tests d'abord : `noyau-prevu.test.ts` (démo de calcul : 2 222 222 / 2 105 263 / 1 153 846 / 666 667 = 6 147 998 ; `repartitionParCp` = Angular, somme exacte ; deux plateformes au CP indépendantes — Review Focus 2 ; `repartitionParPopulation` sans membres non canoniques) ; `noyau-suivi.test.ts` (descente : sommes exactes CP → département → région, prévu et livré ; plafond région pour Meta — Review Focus 3 ; écart de répartition, `hors_plan`, `retard_imps`, tri ; rythme et seuils ; sous-livrée = texte de `constatSousPression` ; alignement = `calculerAlignement` ; plateforme sans ligne → `aucune_donnee` ou son état d'adaptateur).
- [ ] `lib/optimisation/noyau/{prevu,suivi}.ts` (purs ; en tête de `prevu.ts` : « copie verrouillée d'`angular/…/logique/plan/impressions.ts` et de `computeForecast` ») ; export de `constatSousPression`.
- [ ] Route `GET …/live` (séquentielle, `no-store`) ; étendre `plan-logique-paritaire.test.ts` au noyau.
- [ ] `tests/integration/live-suivi.test.ts` : lignes de livraison **de test** insérées sur une campagne de test puis supprimées (jamais visibles) → payload attendu ; national (jeu risque, 2 595 CP, lignes de test sur 30 jours) : < 1 s, < 500 Ko, buffers notés ; aucune connexion → toutes `non_connectee`, payload vide valide.
- [ ] `ARCHITECTURE.md` ; tsc, unitaires, intégration. Commit `feat(api): ⑧ suivi des livraisons par plateforme et en descente (lot 8, T2)`.

### Task 3 : le relevé — service, bouton, tâche Inngest quotidienne

**Interfaces :** `releverCampagne(supabase, campagneId, o: { onProgres? }): Promise<{ par_plateforme: Record<string, { etat; lignes; jours; erreur? }>; dernier_jour }>` ; NDJSON de `relever` : `debut` (plateformes et leur état), `progression`, `fin`, `erreur` ; fonction Inngest `releve-livraisons-quotidien`.

- [ ] Tests d'abord : service avec adaptateurs factices (fenêtre de jours A-11 : première fois toute la période écoulée, ensuite les 3 derniers jours ; jour futur jamais demandé ; erreur d'une plateforme n'arrête pas les autres et n'efface rien ; idempotence sur la clé) ; Inngest : la liste ne retient que les campagnes en vol avec ≥ 1 connexion utilisable et un adaptateur ; un step par campagne, séquentiels (Review Focus 5).
- [ ] `lib/campagne/live/relever.ts`, route `relever` (super_admin 403, quota `geo:rl:live-relever` 2/min, un relevé à la fois par campagne), `releveLivraisonsQuotidien.ts` (patron `civicDailyIngest`), enregistrement dans `app/api/inngest/route.ts`.
- [ ] Intégration : sans connexion → `debut` avec 3 `non_connectee` et TTD `a_venir`, `fin` 0 ligne, rien écrit (Review Focus 1) ; non super_admin → 403 ; coût d'une passe Inngest à vide mesuré.
- [ ] `ARCHITECTURE.md` (tâche planifiée, route) ; tsc, unitaires, intégration. Commit `feat(api): ⑧ relevé des livraisons, quotidien et à la demande (lot 8, T3)`.

**Relecture 1** (T1-T3) : une ligne peut-elle naître sans réponse d'API ? le prévu touche-t-il `planned_share` ? `insererLignes` inchangé ? la RPC peut-elle tronquer sans le dire ? Inngest peut-il relire deux campagnes en parallèle ou une campagne sans connexion ?

## Groupe B — adaptateurs réels (relecture 2)

Chaque adaptateur est écrit d'après la **doc publique** (lien et date de lecture en tête de fichier), testé par des **réponses enregistrées** (`tests/fixtures/dsp/<plateforme>/`, construites d'après les exemples de la doc, aucun identifiant réel), et ne touche à la base que par `releverCampagne`. `fetchAvecDelai` partout ; `logDspEvent` à chaque appel (statut, durée, nombre de lignes).

### Task 4 : DV360 — Bid Manager reporting v2

- [ ] Tests d'abord, sur fixtures : création de requête (`POST /v2/queries`, `metadata.dataRange` CUSTOM_DATES, `params.type = STANDARD`, `groupBys = [FILTER_DATE, FILTER_ZIP_POSTAL_CODE]`, `filters = FILTER_ADVERTISER + FILTER_INSERTION_ORDER` des liens de ⑥, `metrics = [METRIC_IMPRESSIONS, METRIC_REVENUE_ADVERTISER]`) ; `:run` ; attente bornée de `reports.get` jusqu'à `DONE` (délai et nombre d'essais écrits, échec dit) ; téléchargement du CSV `googleCloudStoragePath` ; analyse papaparse (ligne de totaux et pied ignorés, code postal normalisé sur 5 chiffres, dates ISO, devise vérifiée A-10) → `LigneLivraison` maille `cp` ; requête supprimée après lecture ; jeton sans scope reporting → `scope_manquant`.
- [ ] Scope `https://www.googleapis.com/auth/doubleclickbidmanager` ajouté à `DV360_SCOPES` ; `lib/dsp/dv360/rapports.ts` ; `adaptateurs/dv360.ts`.
- [ ] Commit `feat(dsp): ⑧ adaptateur DV360 reporting (lot 8, T4)`.

### Task 5 : Meta — connexion OAuth et Insights

- [ ] Tests d'abord : OAuth (URL de consentement avec `ads_read`, échange du code, jeton longue durée, état signé par `lib/dsp/oauth-state.ts`, connexion écrite par espace comme TikTok) ; Insights sur fixtures (`GET /{campaign_id}/insights?fields=impressions,spend,account_currency&breakdowns=region&time_increment=1&time_range=…&level=campaign`, pagination `paging.next`, région rendue par son nom → `code_region` par `regions.ts`, région inconnue journalisée et comptée, jamais devinée).
- [ ] `lib/dsp/meta/client.ts`, routes `admin/dsp/meta/oauth/{start,callback}`, `adaptateurs/{meta,regions}.ts` ; écran Connexions API : Meta connectable, et la ligne DV360 « Reconnectez DV360… » quand `scope_manquant`.
- [ ] Commit `feat(dsp): ⑧ connexion Meta et adaptateur Insights (lot 8, T5)`.

### Task 6 : TikTok — Reporting

- [ ] Tests d'abord, sur fixtures : `GET /report/integrated/get/` (`advertiser_id` et `campaign_ids` des liens, `report_type = AUDIENCE`, `data_level = AUC_CAMPAIGN`, `dimensions = ["stat_time_day","province_id"]`, `metrics = ["impressions","spend"]`, pagination `page_info`) ; `province_id` → nom (`/tool/region/`, mis en cache par relevé) → `code_region` par `regions.ts` ; province hors France ignorée et comptée.
- [ ] `lireRapport` dans `lib/dsp/tiktok/client.ts` ; `adaptateurs/tiktok.ts`.
- [ ] Commit `feat(dsp): ⑧ adaptateur TikTok reporting (lot 8, T6)`.

**Relecture 2** (T4-T6) : chaque requête est-elle conforme à la doc citée ? une erreur d'API peut-elle effacer des jours relevés ? une devise étrangère passe-t-elle sans le dire ? un jeton ou un identifiant réel traîne-t-il dans les fixtures ?

## Groupe C — Angular (relecture 3)

### Task 7 : API, état, squelette de ⑧, relevé, bandeau

- [ ] Specs d'abord : `vue.spec.ts` (descente DV360 région → département → CP ; Meta plafonnée à la région avec sa note ; « toutes » à la région ; parent inconnu → région) ; `textes.spec.ts` (états A-3 et A-13 mot pour mot) ; service : rien avant l'espace validé ; autre espace → aucun appel ; réponse tardive ignorée ; relevé lié à SA campagne (Review Focus 6) ; relecture après `fin` ; cache par campagne ; panneau : sans campagne → renvoi ⑥ ; `hors_parcours` → message + lien ; période future ; aucune plateforme connectée → « Aucune donnée remontée — plateforme non connectée. » + lien Connexions API ; bouton « Relever maintenant » (super_admin) avec `mg-barre-progression` et l'état de chaque plateforme ; bandeau A-15.
- [ ] `live.api.ts`, `LiveCampagneService`, `FOURNISSEURS_LIVE`, `@case ('live')`, `CONSIGNE_ETAPE.live` = « Suivez les impressions livrées et la dépense de chaque plateforme, comparées au plan. », `RENSEIGNEE_PAR.live`, une ligne dans `carte.page.ts`.
- [ ] `ng test`, `tsc`, `test:unit`. Commit `feat(angular): ⑧ état, squelette, relevé et bandeau du suivi (lot 8, T7)`.

### Task 8 : rythme, coût, plateformes, alignement

- [ ] Specs d'abord, textes et mesures de React à la lettre (lire chaque `.tsx`) : `BandeauAvancement` ; `CoutEtRythme` sans « coût du déséquilibre » ; `QuiADiffuse` par plateforme, avec l'état d'une plateforme non connectée ou à venir ; `ScoreAlignement` (« calculé au code postal », variation 7 j ou « inconnue », phrase A-9) ; `TroisComposantes` (tolérance interpolée) ; « Toutes plateformes » : pas de score, dit.
- [ ] Implémenter ; aucune formule. Commit `feat(angular): ⑧ rythme, coût, plateformes et alignement (lot 8, T8)`.

### Task 9 : descente, territoires en retard, grande carte

- [ ] Specs d'abord : barre de maille = sélecteur de plateforme + fil d'Ariane France › région › département › CP (`mg-fil-ariane`), niveau au-delà du plafond grisé avec la note A-5 (Review Focus 3) ; « Territoires les plus en retard » (A-7 : 7 lignes, « Voir les N … », barre divergente centrée, « hors plan » jamais vide, clic = descendre) ; constats (≤ 3 sous-livrés + retard / avance / CPM, « Voir sur la carte » descend et cadre) ; couche `live` (A-14 : couleurs par tranche, absence, clic = descendre, cadrage sur le territoire, retrait hors de ⑧, couleurs recalculées au changement de thème) ; contours CP lus seulement en descendant dans un département.
- [ ] Implémenter. Commit `feat(angular): ⑧ descente, territoires en retard et carte (lot 8, T9)`.

**Relecture 3** (T7-T9) : une lecture part-elle avant la validation de l'espace ? une formule ou une donnée de démo s'est-elle glissée ? la descente peut-elle dépasser le plafond ? palette importée, pas recopiée ? contraste en thème clair ?

## Task 10 : revue finale, factorisation, preuve navigateur

- [ ] Revue finale (modèle le plus capable) : mineurs, factorisation inter-tâches. Dupliqué à dessein : `impressionsPrevues` / `repartitionParCp` (noyau, Angular ⑥, React), verrouillés par parité. Laissé pour React jusqu'à la bascule : écran de suivi React, `lib/dsp/report/*`, `simulate_dsp_report`, `/api/digital/[id]/suivi`, `alignement*`.
- [ ] **Preuve navigateur, deux thèmes** (`L8-T10-*`), sans aucune donnée inventée (Q-8) : campagne lancée en ⑥ (BMW GROUP, extraction des lycées BdR) → ⑧ : « Aucune donnée remontée — plateforme non connectée » pour DV360, Meta, TikTok, « connecteur à venir » pour TTD, lien Connexions API ; « Relever maintenant » → flux, états, 0 ligne ; campagne non liée en ⑥ (si une connexion existe) → « Liez la campagne… » ; campagne de seed → message hors parcours et lien ; campagne d'un autre espace → message de ⑥, aucun appel à `…/live` ; écran Connexions API : Meta connectable, phrase de reconsentement DV360. L'écran **rempli** est prouvé par les specs Angular (T7-T9) ; sa preuve navigateur est inscrite au registre pour la première vraie connexion.
- [ ] `ARCHITECTURE.md`, `README.md` de la carte. Tests complets : `npm test`, `ng test`, `tsc`, `npm run build` (variables Supabase locales explicites), `ng build`. Inngest local : la fonction apparaît et s'exécute à vide.
- [ ] Commit `docs: ⑧ Live — revue finale et preuve navigateur (lot 8, T10)`.

---

## Estimation

| Groupe | Tâches | Charge |
|---|---|---|
| A socle serveur | T1, T2, T3 | 1,6 j |
| B adaptateurs réels | T4 DV360, T5 Meta (OAuth + Insights), T6 TikTok | 1,7 j |
| C Angular | T7, T8, T9 | 1,4 j |
| Fin | T10 | 0,4 j |
| **Total** | **10 tâches, 3 relectures, 1 preuve** | **≈ 5 jours** |

## Critères de fin du lot

⑧ affiche, pour une campagne lancée en ⑥, ce que les API DV360, Meta et TikTok remontent — rien d'autre — avec livré contre prévu, dépense, CPM, rythme, alertes, alignement au CP et une descente région → département → CP plafonnée à la maille rapportée, sur la grande carte et dans la liste des territoires en retard ; le relevé tourne chaque matin (un step par campagne) et à la demande ; sans connexion, un état vide honnête qui dit quoi faire ; le prévu vient du noyau, jamais de `planned_share` ; aucune donnée de démo, aucune simulation, aucun calcul dans le navigateur ; adaptateurs verts sur leurs réponses enregistrées ; React inchangé ; tests et builds verts ; preuve navigateur des états vides dans les deux thèmes, preuve remplie à la première connexion.

## À venir (hors lot)

**The Trade Desk** (Q-2) : adaptateur et niveaux IRIS / unité du jeu (polygone) quand sa doc et son accès arrivent. Boucle d'optimisation (`lib/optimisation/boucle.ts`, `appliquerPoids`, `optimisation_cycles`, marches 1-3 de l'Excel). Autres KPI ; ad server et réconciliation ; « Recaler » ; constats `sur_pression` / `canal_cher` ; coût du déséquilibre ; pression par classe ; zones météo recalculées ; « mode pays » (④/⑤).
