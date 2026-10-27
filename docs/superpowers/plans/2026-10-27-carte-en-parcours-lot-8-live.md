# La carte en parcours — lot 8 « ⑧ Live » — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (ou superpowers:executing-plans). Skill `porting-react-to-angular` chargé AVANT chaque tâche Angular. Cases à cocher (`- [ ]`) pour le suivi.

**Mode accéléré (Vincent, 24/10) :** 6 tâches en 3 groupes, **un implémenteur et une relecture par groupe**, seuls les défauts Critiques et Importants corrigés au fil de l'eau (les mineurs vont à T6), **une seule preuve navigateur**, en T6. Cible : **≈ 3 jours**.

**Goal :** à l'étape ⑧ de la carte Angular, pour la campagne courante lancée en ⑥ depuis une extraction, montrer **les impressions livrées contre prévues et la dépense, par plateforme et par territoire, à la maille que la plateforme rapporte** (CP pour DV360, région pour Meta et TikTok, dite à l'écran), le **rythme** (temps écoulé / budget dépensé / volume livré), les alertes **retard** et **zone sous-livrée**, le **CPM réel contre prévu** — avec un bouton qui **relève les livraisons** par une couche d'adaptateurs par plateforme, aujourd'hui alimentée par la **seule simulation** (aucune API de plateforme n'est branchable, voir pré-vol).

**Architecture :** une table d'atterrissage neuve `livraison_plateformes` (un jour × une plateforme × une unité de rapport), écrite par des **adaptateurs** (`lib/optimisation/adaptateurs/`, contrat `lireLivraison(campagne, jour)`) ; un **noyau pur** (`lib/optimisation/noyau/`) qui recalcule le prévu par plateforme et par unité depuis `geo_strategy.channels` et l'extraction (spec § 19.4), puis l'écart, le rythme, l'alignement et les alertes ; une RPC `jsonb` d'agrégats ; deux routes (`GET …/live`, `POST …/live/relever`). Côté Angular : un panneau `mg-panneau-live` (port allégé de `SuiviV2`), un service `LiveCampagneService` fourni par la page, la grande carte peinte par les contours déjà partagés (`ContoursZonesService`). **Le navigateur ne calcule rien** : il filtre et met en forme un payload déjà chiffré par le serveur.

**Tech Stack :** Angular 21.2 standalone, zoneless, signals ; Tailwind 4 ; ECharts modulaire (`src/app/graphiques/`) ; Vitest (`cd angular && npx ng test --watch=false`). Next.js 15, supabase-js, Zod, Vitest racine (`npm run test:unit`, `npm run test:integration`). Postgres 17.6 local (`docker exec supabase_db_genesis_app psql -U postgres`).

**Spec :** `docs/superpowers/specs/2026-10-13-carte-en-parcours-design.md` — **§ 19 fait foi** (19.2 ligne ⑧, 19.3, 19.4 « porter / ne pas porter », prévu par CP et par plateforme, maille de rapport) ; § 4 « ⑦ Live » (numérotation d'origine) pour l'écran ; § 16.1 ligne ⑧ ; § 16.2 règles 3 (règles des plateformes en table) et 4 (connexion par espace). Plans précédents : `…/2026-10-24-carte-en-parcours-lot-6-plan.md`, `…/2026-10-25-carte-en-parcours-lot-7-activation.md`. Mémoires : `project_suivi_sans_adserver`, `project_archi_algo_optimisation`, `project_ttd_premier_dsp`, `project_dv360_parked`, `project_tiktok_connexion`, `feedback_mode_accelere`, `feedback_angular_vigilance`, `feedback_agents_frugaux`, `feedback_no_hardcoded_colors`, `reference_postgrest_db_max_rows`, `reference_maplibre_paint_sans_var`.

## Global Constraints

- V1 = **impressions et dépense** remontées par les plateformes. Ni ad server, ni réconciliation, ni conversions, ni rebid / « Recaler », ni constats d'optimisation (`sur_pression`, `canal_cher`), ni « coût du déséquilibre », ni pression par classe, ni vignette « Variable du plan » (§ 19.2-19.4).
- **Aucun calcul dans le navigateur** : prévu, écart, rythme, alignement, alertes, tranches de dispersion arrivent chiffrés du serveur. Angular filtre (par plateforme, par parent), trie et colore.
- **Le prévu n'est JAMAIS lu dans `campaign_cp_rollup.planned_share` ni `get_campaign_expected`** (§ 19.4) : il se recalcule depuis `geo_strategy.channels.{budgets,cpm_prevus}` et l'extraction.
- **Aucune donnée simulée sur une campagne qui n'est pas de démo** (Q-1) : sans connecteur réel, une vraie campagne affiche « non branché », rien n'est écrit.
- Campagnes réservées au **super_admin** en V1 ; `relever` le vérifie (403 avant toute écriture). **Contrôle d'espace côté Angular** comme ⑦ : rien n'est lu avant que `PlanCampagneService` ait validé la campagne dans l'espace actif ; le serveur refait le contrôle (404).
- Troncature PostgREST (1 000 lignes) : la RPC est `RETURNS jsonb` avec une borne écrite et `tronque` ; les CP d'une extraction se lisent par `lireCpExtraction` / `lireCpPlateforme` (déjà paginés).
- Écritures : **lots de 50, 3 en parallèle au plus**, erreur de CHAQUE lot lue, progression NDJSON (CLAUDE.md « Imports & batch DB ») ; upsert idempotent sur la clé primaire.
- Aucun `DROP` ; migration additive rejouable ; base locale seulement, jamais le MCP Supabase.
- Vouvoiement ; textes de React à la lettre là où on porte (écarts listés au rapport) ; sentence case ; jetons `var(--…)` seulement (valeurs CALCULÉES par `CouleursService` pour MapLibre) ; Inter + JetBrains Mono ; bordures 0,5 px.
- Fichiers `.ts` < 400 lignes ; `carte.page.ts` est à 379/400 : une ligne de pastille, rien d'autre. `plan-campagne.service.ts` est à 391/400 : **rien n'y entre**.
- Preuve sur les serveurs du worktree (:3002 / :4202 ou suivants libres), **jamais :3000 / :4200**, qu'on n'arrête pas.

## Review Focus

1. **Deux plateformes au CP** (DV360 + TTD au CP, ou jeu risque) : le prévu de chacune = ses impressions (budget ÷ CPM × 1 000) réparties sur SES CP au prorata des multiplicateurs ; la somme par plateforme retombe exactement sur son total ; rien ne vient de `planned_share`. Test unitaire du noyau (T2) et d'intégration (T2).
2. **Maille honnête** : Meta et TikTok n'ont aucune ligne sous la région ; l'écran dit « Meta ne rend pas le code postal : comparaison à la région. » ; le fil d'Ariane s'arrête à la région pour elles ; « Toutes plateformes » se lit à la région. Spec en T5, test du noyau en T2.
3. **Campagne non démo** : `relever` n'écrit rien, rend `non_branche` par plateforme avec un message qui nomme le manque (« accès API The Trade Desk manquant ») ; aucune ligne `source = 'simule'` n'existe hors campagne de démo (test d'intégration T1).
4. **Relevé idempotent et déterministe** : deux relevés successifs donnent les mêmes lignes à l'octet (graine par campagne et plateforme, upsert sur la clé) ; un relevé ne simule jamais un jour futur ni hors période.
5. **Échelle nationale** : jeu risque « Seveso haut + bas » v1 (2 595 CP) rattaché à une campagne de démo de 30 jours : relevé ≈ 78 000 lignes avec progression, `GET …/live` sous 1 s et sous 500 Ko, `EXPLAIN (ANALYZE, BUFFERS)` noté (T1, T2).
6. **Changement de campagne pendant une lecture ou un relevé** : une réponse tardive de A ne s'écrit jamais dans B ; un relevé en cours sur A continue, B voit « Un relevé est en cours sur une autre campagne. » (patron A-10 de ⑦). Spec en T3.

---

## Pré-vol : ce qui existe vraiment (reconnaissance du 27/10, worktree `carte-live`, HEAD `b3610369`)

### Quelle source alimente ⑧ aujourd'hui — mesuré en base locale

**Réponse honnête : aucune API de plateforme. Seule la simulation peut alimenter ⑧ en V1.**

| Source | État mesuré le 27/10 | Utilisable par ⑧ ? |
|---|---|---|
| API DV360 | `lib/dsp/report/dv360.ts` est un **bouchon** (`status: 'skipped'`, « droits Google en attente ») ; `dsp_connections` : **1 ligne**, DV360 en `error`, espace 00…01 ; BMW GROUP : aucune | non (droits Google, `project_dv360_parked`) |
| API TikTok | `lib/dsp/tiktok/client.ts` : OAuth + liste des annonceurs, **aucun rapport** ; app dev non créée | non |
| API The Trade Desk | **rien** (ni code, ni siège, ni identifiants, ni doc) | non |
| API Meta | **rien** | non |
| `dsp_campaign_data` (≈ 1,04 M lignes, 394 Mo) | 5 campagnes, **aucune** issue d'une API : `1c327461…` et `ffc231bd…` = simulation du module risque (`dsp_source = 'simulation'`, Partenaires A/B/C, 218 k et 168 k lignes) ; `d0000000…f1a5` [DEMO] Risque (175 k, seed) ; `dccc0000…02` Démo pilotage (306 k, seed sql/112, acteurs dv360/ttd/tiktok + 2 régies, avril 2026) ; `fd18d97c…` import Adform national (172 k lignes, **sans date ni impression**) | non : monde « ad server », grain CP×jour×acteur, pas de région, et rien pour une campagne lancée en ⑥ |
| `campaign_dsp_report` (2 131 lignes) | **toutes** `source = 'simulated'` (`simulate_dsp_report`, dérivée de `dsp_campaign_data`), une seule campagne (`dccc…02`) ; grain contraint (jour SANS CP, ou CP SANS canal) | non : ni CP par canal, ni région |
| `campaign_cp_rollup` / `campaign_daily_rollup` | 16 031 / 240 lignes, deux campagnes de seed (`dccc…02`, `d000…f1a5`) | non : `planned_share` campagne entière (interdit par § 19.4) |
| Campagnes lancées en ⑥ (stratégie à `extraction_id`) | `4935811d…` (BMW GROUP, stratégie `fe2562a4…` active, `52a1fdce…` archivée) et `ba49acd8…` (« Brouillon preuve L6-T7 ») : **0 ligne de livraison**, `is_demo = false` toutes deux | — |

Conséquence : ⑧ a besoin d'une **table d'atterrissage neuve** et d'un **adaptateur simulé** pour les campagnes de démo ; les adaptateurs réels se brancheront sur le même contrat (Q-7).

### Le plan d'une campagne lancée en ⑥ (mesuré sur `4935811d…`)

- `geo_strategy.channels` : budgets dv360 10 000 / ttd 8 000 / meta 6 000 / tiktok 4 000 € ; CPM prévus 4,5 / 3,8 / 5,2 / 6 € → impressions prévues 2 222 222 / 2 105 263 / 1 153 846 / 666 667, **total 6 147 998 = `bidding_strategies.kpi_target`** (cohérent avec ⑥). Période 01/11 → 30/11/2026 : **future** — rien ne peut être livré le 27/10 (la preuve utilise une campagne de démo à dates passées).
- Extraction `2fc8fd52…` (jeu « Lycées 5 km — BdR », v1) : plan CP 88 lignes (toutes `multiplicateur > 0`) ; DV360 63 unités CP retenues → **72 CP bruts** par `lireCpPlateforme` ; Meta 53 cercles de 5 km ; TikTok 1 département retenu sur 2 ; TTD 1 polygone exact. Régions du plan : **PACA 87 CP (1 561 527 hab. en zone) + Occitanie 1 CP (1 331)**.
- `zone_set_extraction_unites` porte `pop_en_zone` par unité, mais **aucun multiplicateur hors CP** : le prévu d'une plateforme qui n'achète pas au CP ne peut se répartir qu'à la population (A-4).
- `plateformes_geo` (13 lignes) porte la maille d'ACHAT ; **aucune maille de RAPPORT** (question ouverte du § 19.4).

### L'existant React à porter (≈ 3 700 lignes d'écran) et ses données

| Brique React (lignes) | Données aujourd'hui | Sort au lot 8 |
|---|---|---|
| `SuiviV2.tsx` (709) — assemblage, sémaphore à 3, 7 lectures | `/api/digital/[id]/suivi`, `/alignement`, `/alignement/maille`, `/maille/map`, `/dispersion`, `/constats`, `/actors` | **Porté allégé** : UNE lecture (`GET …/live`), drill en mémoire |
| `BarreContexteCampagne.tsx` (273) | `/api/digital/campaigns` | **Déjà porté** : `mg-choix-campagne` (lot 6) |
| `BarreMaille.tsx` (103) | session | **Porté** + sélecteur de plateforme + note de maille |
| `BandeauAvancement.tsx` (160) | `get_campaign_suivi.pacing` | **Porté** (trois barres, repère, phrase) |
| `CoutEtRythme.tsx` (116) | suivi + alignement | **Porté** sans « coût du déséquilibre » |
| `ScoreAlignement.tsx` (251) + `TroisComposantes.tsx` (101) | `calculer_alignement_geo` | **Portés**, plateformes au CP seules ; variation 7 j gardée |
| `TableauDeregles.tsx` (373) | `alignement_par_maille` | **Porté** (« Territoires déréglés ») |
| `GraphiqueEcart.tsx` (253) | maille / dispersion | **Histogramme CP porté** en barres HTML ; courbe région/département non portée (Q-5) |
| `QuiADiffuse.tsx` (156) | `get_campaign_actors` | **Porté** : une barre par PLATEFORME (dépense, volume, CPM réel vs prévu) |
| `ConstatsCorrection.tsx` (134) | `calculerConstats` | **Porté**, constat `sous_pression` seul + alerte retard |
| `TrioCartes.tsx` (178) + `CarteVignette.tsx` (335) | `alignement_par_maille_geo` | **Remplacés par la grande carte** (Écart / Impressions, Q-4) |
| `PressionParClasse`, `DetailTechnique`, vignette « Variable du plan » | — | **Non portés** (§ 19.4) |

TS serveur réutilisable tel quel : `calculerAlignement` (`lib/campagne/alignement.ts`, la formule jumelle de `calculer_alignement_geo`), `SEUIL_ECART_SIGNALE_PCT` et le constat sous-pression (`lib/campagne/constats.ts`, fonction à exporter), `diffuserJour` / `repartirEntier` (`lib/simulation/generateur.ts`, graine fixe, effet inventaire), `trancheDivergente` / `BORNES_DIVERGENTES` (`lib/campagne/palette-divergente.ts`), `lireCpExtraction` / `lireCpPlateforme`, `connexionUtilisable` (`lib/campaigns/activation.ts`), `insererLignes` (`lib/simulation/serveur.ts`, à généraliser), `rpcJson`, `lireTout`.

### Côté Angular

- `logique/parcours.ts` : étape `live` existe ; `carte.page.html` la rend par `@default { <mg-etape-bientot> }` ; `ONGLET_REACT.live = 'suivi'` ; `CONSIGNE_ETAPE.live` annonce « arrive dans le parcours » ; `ETAPES_CAMPAGNE` inclut `live` (le sélecteur de campagne y est déjà).
- `etat/plan-campagne.service.ts` (391/400) : `campagne()`, `detail()`, `strategieExistante()`, `canaux()`, `brouillon().jeuZones`, `extraction()`, `prerempli()`, `accesRefuse()`, `libelleCanal`. `etat/activation-campagne.service.ts` : le patron « validée » et la tâche liée à SA campagne (A-10).
- Briques : `ui/{entete-section, kpi, bandeau-kpi, tuile-chiffre, barre-progression, fil-ariane, pastille, tableau, notifications}`, `core/http/ndjson.ts` (`lignesNdjson`), `etat/lecture-annulable.ts`, `etat/contours-zones.service.ts` (polygones région / département / CP **déjà partagés**, ≈ 3,8 Mo au CP, lus une fois par écran), `couches/couche-unites.ts` (`ajouterCouche`), `features/risques/logique/palette-divergente.ts` (`trancheDivergente`, `LIBELLES_TRANCHES`, `RAMPE_CSS`, verrouillée) et `logique/carte-campagne.ts` (`JETONS_CAMPAGNE`, `couleurIndice`), `graphiques/` (ECharts : courbe et nuage seulement, **pas de barres**).

### Mesures locales (27/10)

| Mesure | Valeur |
|---|---|
| Table synthétique « livraison » nationale (transaction annulée) : 30 j × 2 595 CP × 4 campagnes + 3 plateformes × 30 j × 18 régions | 313 020 lignes, 58 Mo (≈ 190 o/ligne) |
| Agrégat par (plateforme, maille, code) + 7 derniers jours, une campagne (79 470 lignes) | **24 ms**, index de clé primaire, ≈ 2 060 buffers (16 Mo), 2 649 groupes |
| Agrégat par (plateforme, jour), même campagne | **14 ms**, ≈ 2 060 buffers, 120 groupes |
| Relevé national simulé, une plateforme au CP, 30 jours | ≈ 77 850 lignes → **1 557 lots de 50** (519 vagues de 3) |
| Relevé de la démo BdR, 30 jours | DV360 72 CP + fuite ≈ 2 200 lignes ; Meta / TikTok / TTD ≤ 2 régions × 30 = ≤ 180 lignes chacune → ≈ 50 lots |
| Plan national (jeu risque `78f6911a…`) | 2 595 CP, 97 départements, 15 régions, 0 CP hors référentiel |

### « Mode pays » (zone France entière > 100 000 km²) : **ne bloque pas ⑧**

⑧ n'appelle ni `couverture_geometrie` (sql/269) ni aucune RPC bornée à 100 000 km² : il lit une extraction **déjà figée** et des agrégats. La borne bloque **en amont** (④ couverture, ⑤ extraction d'un jeu de ZONE national) : une campagne nationale d'un jeu de zone n'arrive jamais à ⑧. Un jeu **risque** national s'extrait déjà (Seveso, 2 595 CP) et sert de preuve d'échelle (Review Focus 5). **Pas de tâche dédiée dans ce lot** ; le « mode pays » reste une ligne ④/⑤ de l'Excel, à traiter avant la première campagne nationale d'un jeu de zone.

### Écarts relevés (corrigés par ce plan)

| # | Constat | Ce que fait ce plan |
|---|---|---|
| E1 | Aucune source de livraison pour une campagne lancée en ⑥ ; les tables existantes sont le monde ad server (CP × acteur, pas de région) ou contraintes à deux grains. | T1 : `livraison_plateformes`, une ligne par (campagne, plateforme, jour, maille, code), `source ∈ (api, simule)`. |
| E2 | `lib/dsp/report/*` (« miroir de push ») ne sert que la réconciliation React (hors V1) et n'a qu'un bouchon DV360. | Non touché (supprimé à la bascule React) ; ⑧ ne l'appelle pas. Les adaptateurs neufs ne créent **aucun fichier vide** (Q-7). |
| E3 | La maille de RAPPORT des plateformes n'est écrite nulle part. | T1 : `plateformes_geo.maille_rapport` (dv360 → cp ; meta, tiktok → region ; ttd → region, `a_verifier`, Q-2). |
| E4 | Les écrans React chiffrent dans le navigateur (`calculerConstats`, `preparerDispersion`, `pourcentageVolumeLivre`, sept lectures et un sémaphore). | T2 : tout est calculé côté serveur en UNE réponse ; Angular ne fait que filtrer et mettre en forme. |
| E5 | La boucle d'écriture par lots de 50 vit dans `insererLignes`, liée à `dsp_campaign_data`. | T1 : extraite en `ecrireParLots` (générique), `insererLignes` l'appelle — aucune seconde copie. |

---

## Routes API

**Deux routes neuves** : `GET /api/campaigns/[campaignId]/live` (T2) et `POST /api/campaigns/[campaignId]/live/relever` (T1, NDJSON). **Aucune route existante modifiée.**

Plus appelées par ⑧ (V1) : `/api/digital/[id]/{suivi,actors,reconcile,reconcile/pull}`, `/api/campaigns/[id]/alignement*`, `/api/campaigns/[id]/pression-classes`, `/api/demo/*`. Elles restent, React s'en sert.

**Charge I/O.** `GET …/live` : campagne + stratégie (2 lignes), `plateformes_geo` (13), le plan CP de l'extraction **lu une fois** (≤ 7 000, paginé) et ses sous-ensembles par plateforme dérivés en mémoire (A-1), puis UNE RPC d'agrégats (≈ 2 000 buffers à l'échelle nationale, mesuré). Séquentiel, jamais plus d'un appel Supabase à la fois. `relever` : lectures identiques puis écritures par lots de 50 (3 en parallèle), quota 2/min. Côté Angular : une lecture à l'entrée dans ⑧ pour la campagne (mise en cache par campagne), relue après un relevé ; changer de plateforme ou de maille ne relit rien ; les contours viennent de `ContoursZonesService` (déjà en cache s'ils ont servi à ②).

---

## Arbitrages (tranchés ; coût si faux)

Ceux de la spec § 16.8, § 19 et des lots 3 à 7 s'appliquent. Ajoutés :

| # | Point | Tranché | Coût si faux |
|---|---|---|---|
| A-1 | Lecture du plan | `lireCpPlateforme` gagne un paramètre optionnel `plan?: LigneCpExtraction[]` (le plan déjà lu) pour ne pas relire `lireCpExtraction` à chaque plateforme ; ses quatre appelants actuels inchangés. | une relecture paginée par plateforme |
| A-2 | Table d'atterrissage | `livraison_plateformes (campaign_id uuid FK cascade, plateforme text check (dv360,ttd,meta,tiktok), jour date, maille text check (cp,departement,region), code text, impressions bigint ≥ 0, depense numeric(12,4) ≥ 0, source text check (api,simule), lu_le timestamptz default now(), PK (campaign_id, plateforme, jour, maille, code))`. Pas de RLS active (comme les rollups), lue par la route admin seule. | une colonne |
| A-3 | Contrat d'adaptateur | `interface AdaptateurLivraison { plateforme; source: 'api' \| 'simule'; lireLivraison(c: CampagneLive, jour: string): Promise<LigneLivraison[]> }` ; `choisirAdaptateur(plateforme, { connexions, isDemo })` → adaptateur réel si connexion `connexionUtilisable` ET connecteur écrit ; sinon `simule` si démo ; sinon `{ statut: 'non_branche', message }` (« Connecteur <libellé> non branché : <manque> » — DV360 « droits Google en attente », TTD « accès API manquant (siège, identifiants, documentation) », Meta « connecteur à écrire », TikTok « application développeur non créée »). Aucun fichier `ttd.ts`/`dv360.ts`/`meta.ts`/`tiktok.ts` tant qu'il n'y a rien à y écrire (Q-7). | quatre fichiers vides |
| A-4 | Prévu par plateforme et par unité | **Impressions de la plateforme** = budget ÷ CPM × 1 000 (formule de ⑥). **Plateforme au CP** (unités CP dans l'extraction, ou jeu risque) : réparties sur SES CP bruts (`lireCpPlateforme`) au prorata des multiplicateurs, plus forts restes (la somme retombe exactement). **Autre maille d'achat** (cercles, polygone, communes, départements) : réparties sur les CP **canoniques** du plan au prorata de `pop_en_zone` (où vit la cible), puis agrégées à la région. Jamais `planned_share`. | une règle du noyau |
| A-5 | Maille de comparaison | `maille_rapport` de `plateformes_geo` (A-2, E3) ; si la plateforme n'achète pas au CP, son prévu n'existe qu'à la région : comparaison à la **région** même si elle rapporte au CP. Drill : région › département › CP pour une comparaison au CP ; région seule sinon. « Toutes plateformes » = la région (somme des plateformes). Note à l'écran : « <Plateforme> ne rend pas le code postal : comparaison à la région. » / « <Plateforme> n'achète pas au code postal : comparaison à la région. » / TTD : « … (maille de rapport à vérifier). » | un libellé |
| A-6 | Écart par territoire | Écart de **répartition**, comme React : prévu à date d'un territoire = part prévue × livré total de la plateforme ; `ecart_pct = (livré − prévu à date) ÷ prévu à date × 100` ; `hors_plan` si livré sur un territoire sans prévu. Le retard de VOLUME se lit dans le rythme (A-7), pas dans l'écart (Q-3). Tableau : livré, prévu (campagne entière), écart. | une formule |
| A-7 | Rythme et alertes | Par plateforme et au total, au **dernier jour relevé** : `temps_pct` (jours écoulés ÷ jours de la période), `budget_pct` (dépense ÷ budget), `volume_pct` (livré ÷ prévu total), `indice = volume_pct ÷ temps_pct`. Alerte **retard** : indice < 0,85 (avertissement), < 0,70 (danger) — les seuils de `get_campaign_suivi` ; **avance** : > 1,15 / > 1,30. Alerte **zone sous-livrée** : le constat `sous_pression` de React (`SEUIL_ECART_SIGNALE_PCT` = 20, ≤ 3 territoires, « N impressions manquantes »), par plateforme. CPM réel = dépense ÷ livré × 1 000 contre CPM prévu ; alerte CPM > prévu × 1,25 (`SEUIL_CPM_CHER`). | des seuils importés |
| A-8 | Alignement | `calculerAlignement` (TS, jumelle de `calculer_alignement_geo`) sur les CP d'une plateforme au CP, tolérance et poids de la campagne (`tolerance_pct`, `overpressure_weight`) ; variation 7 j sur la fenêtre précédente quand elle existe (sinon `null`, jamais « +93 points ») ; `sur_pression_eur` non rendu. Une plateforme qui n'est pas au CP : pas de score, phrase « Score calculé au code postal : non disponible pour <plateforme>. » | un bloc masqué |
| A-9 | Simulation | Adaptateur `simule` = `diffuserJour` du module risque (`lib/simulation/generateur.ts`), **sans recopie** : pour chaque plateforme, plan = ses CP et multiplicateurs (CP) ou les CP canoniques pondérés par `pop_en_zone` (autres), `P = { ...PARAMS_DEFAUT, budget, jours, partenaires: [{ nom: plateforme, cpm: cpm_prevu, part: 1 }], graine: hash(campagne, plateforme) }`, puis agrégé à la `maille_rapport`. Un facteur de rythme par plateforme, tiré de la même graine dans [0,8 ; 1,05], applique un léger retard plausible — **aucun verdict écrit**, comme le générateur. Jours simulés : du début de période à `min(fin, hier)`. | un paramètre |
| A-10 | Déclenchement du relevé | Bouton « Relever les livraisons » (super_admin) dans ⑧, NDJSON (`debut` par plateforme avec sa source, `progression` après chaque vague, `fin` avec compteurs) ; jours relus : toute la période écoulée (upsert idempotent) ; aucune tâche Inngest quotidienne tant qu'aucun connecteur réel n'existe (Q-6). Un relevé à la fois par campagne ; lié à SA campagne côté Angular (patron A-10 de ⑦). | une tâche Inngest |
| A-11 | Campagne hors parcours | Stratégie sans `extraction_id` (campagnes de seed, wizard React) : « Cette campagne n'a pas été lancée depuis une extraction : son suivi reste dans l'application actuelle. » + lien `ONGLET_REACT.live` gardé pour ce cas. Période future : « La campagne commence le <date> : rien à relever avant. » Aucune ligne : « Aucune livraison relevée. » + bouton. | un message |
| A-12 | Grande carte | Une couche `live` sur la carte principale, polygones de `ContoursZonesService` à la maille affichée (région, département d'une région, CP d'un département), deux modes : **Écart** (divergente, `--diverge-*`, `trancheDivergente`) et **Impressions** (séquentielle, `--seq-1…5`) ; couleurs calculées par `CouleursService` ; clic sur un territoire = descendre. Remplace les vignettes (Q-4). | des vignettes à porter |
| A-13 | Pastille « renseignée » de ⑧ | Le payload de la campagne courante porte au moins un jour relevé (lu à l'entrée dans ⑧ ; aucune lecture hors de l'étape). | une règle |
| A-14 | Bandeau de l'étape | `mg-bandeau-live` : livré / prévu, dépensé / budget, CPM réel / prévu, jours restants, dernier jour relevé et sa source (« Simulé » quand une plateforme l'est). | du texte |

---

## Questions pour Vincent (produit seulement ; recommandation entre crochets)

| # | Question | Ce qui en dépend | Recommandation |
|---|---|---|---|
| Q-1 | Aucune API de plateforme n'est branchable : ⑧ s'alimente-t-il d'une **livraison simulée** pour les seules campagnes de démo (marquée « Simulé »), une vraie campagne affichant « non branché » ? | A-3, A-9, T1 | **[Oui, démo seulement, comme la poussée de ⑦.]** |
| Q-2 | Maille de rapport de **TTD** (inconnue sans accès) : on la pose à la **région**, « à vérifier », jusqu'à l'accès API ? | A-5, sql | **[Oui, région à vérifier.]** |
| Q-3 | « Zone sous-livrée » : écart de **répartition** (part du livré contre part du plan, comme React), le retard de volume étant dit par le rythme — ou écart au **prévu proratisé au temps** ? | A-6, A-7 | **[Répartition, comme React ; le retard par le rythme.]** |
| Q-4 | Les trois vignettes carte de React deviennent **la grande carte** de la page (modes Écart / Impressions) ? | A-12, T5 | **[Oui, la carte est déjà l'écran.]** |
| Q-5 | « Graphique d'écart » : on porte l'**histogramme CP** et on laisse la **courbe région/département** (redite du tableau des territoires) ? | T5 | **[Oui.]** |
| Q-6 | Relevé : **bouton** dans ⑧ en V1, la tâche Inngest quotidienne venant avec le premier vrai connecteur (TTD) ? | A-10 | **[Oui.]** |
| Q-7 | Adaptateurs : on n'écrit que le **contrat + simulé** ; `ttd.ts`, `dv360.ts`, `meta.ts`, `tiktok.ts` naissent avec leur accès API (zéro fichier vide) ? | A-3 | **[Oui.]** |

En attendant les réponses, le plan applique les recommandations ; chaque arbitrage dit son coût si la réponse est autre.

---

## File Structure

| Fichier | Responsabilité | Tâche |
|---|---|---|
| `sql/288_livraison_plateformes.sql` (créé ; numéro à confirmer au moment de coder) | table `livraison_plateformes` (A-2), `plateformes_geo.maille_rapport` + valeurs (E3), RPC `livraison_agregee_jsonb(p_campagne uuid, p_cps text[])` : livré par (plateforme, maille, code) total / 7 j / 7 j précédents, par (plateforme, jour), et région / département (codes + noms) des CP demandés ∪ livrés ; borne écrite 20 000 entrées + `tronque` | T1 |
| `lib/supabase/ecrire-par-lots.ts` (créé) ; `lib/simulation/serveur.ts` (modifié : `insererLignes` l'appelle) | lots de 50, 3 en parallèle, erreur de chaque lot, `onConflict` optionnel (E5) | T1 |
| `lib/optimisation/adaptateurs/{types,index,simule}.ts` (créés) | contrat, choix (A-3), simulé (A-9) | T1 |
| `lib/campagne/live/campagne-live.ts` (créé) | lecture SERVEUR de la campagne de ⑧ : stratégie la plus récente, `extraction_id` (`sourceDePoussee` réutilisé), période, canaux, `plateformes_geo`, plan CP lu une fois et CP par plateforme (A-1) — partagée par les deux routes | T1 |
| `lib/zones/cp-plateforme.ts` (modifié, A-1) | paramètre `plan?` | T1 |
| `app/api/campaigns/[campaignId]/live/relever/route.ts` (créé) | relevé NDJSON (A-10), super_admin, quota `geo:rl:live-relever` 2/min | T1 |
| `tests/unit/optimisation/adaptateurs.test.ts`, `tests/unit/supabase/ecrire-par-lots.test.ts`, `tests/integration/live-relever.test.ts` (créés) | T1 | T1 |
| `lib/optimisation/noyau/{prevu,suivi}.ts` (créés) | `impressionsPrevues`, `repartitionParCp`, `repartitionParPopulation` (A-4) ; `territoires`, `rythme`, `alertes`, `dispersion` (A-5 à A-8) — PURS | T2 |
| `lib/campagne/constats.ts` (modifié : `export` de `constatSousPression`) | réutilisé par `alertes` | T2 |
| `app/api/campaigns/[campaignId]/live/route.ts` (créé) | le payload unique de ⑧ | T2 |
| `tests/unit/optimisation/noyau-prevu.test.ts`, `…/noyau-suivi.test.ts`, `tests/integration/live-suivi.test.ts` (créés) ; `tests/unit/angular/plan-logique-paritaire.test.ts` (étendu : `repartitionParCp` et `impressionsPrevues` du noyau = Angular) ; `tests/unit/db/troncature-postgrest.test.ts` (complété si besoin) | T2 | T2 |
| `angular/.../carte/data/live.api.ts` (+ spec) ; `app.routes.ts` (`FOURNISSEURS_DISTANTS`) | `suivi(c)`, `relever(c): Observable<LigneReleve>` | T3 |
| `angular/.../carte/etat/live-campagne.service.ts` (+ spec) ; `carte.fournisseurs.ts` | état de ⑧ (page) : validée, lecture annulable, cache par campagne, plateforme et parent choisis, relevé lié à SA campagne, `renseignee` | T3 |
| `angular/.../carte/logique/live/{vue,textes}.ts` (+ specs) | filtrage par plateforme / parent, tri des déréglés (volume mal placé, comme React), libellés et notes de maille — aucune formule métier | T3 |
| `angular/.../carte/panneaux/live/{panneau-live,releve-livraisons,bandeau-live}.component.ts` (+ specs) ; `carte.page.html`, `logique/parcours.ts`, `carte.page.ts` (une ligne) | squelette, états A-11, relevé, bandeau | T3 |
| `angular/.../carte/panneaux/live/{bandeau-avancement,cout-rythme,qui-a-diffuse,score-alignement,trois-composantes}.component.ts` (+ specs) | ports de React | T4 |
| `angular/.../carte/panneaux/live/{barre-maille,tableau-territoires,dispersion-cp,constats-live}.component.ts` (+ specs) | ports de React | T5 |
| `angular/.../carte/couches/{couche-live.ts,live-carte.service.ts}` (+ specs) | grande carte (A-12) | T5 |
| `angular/.../carte/testing/live-factice.ts` | doublure du service | T3 |
| `ARCHITECTURE.md`, `angular/src/app/features/carte/README.md` | T1, T2, T6 | — |

---

## Pièges Angular / AIDA (à recopier dans CHAQUE brief de tâche Angular)

- Contrat AIDA : aucun `position: fixed`, aucun écouteur `window`/`document`, aucun `localStorage` neuf, aucun portail hors de l'arbre, services d'état **fournis par la page** (`carte.fournisseurs.ts`), services d'API dans `FOURNISSEURS_DISTANTS`, adresses par `HttpBaseService.baseUrl`, pas de `@angular/core/rxjs-interop`.
- **Aucune lecture avant la validation de l'espace** : `LiveCampagneService` attend `plan.prerempli() && plan.detail()?.id === plan.campagne()` et `!plan.accesRefuse()` (patron `ActivationCampagneService.validee`).
- **Aucune formule dans Angular** : pas de `budget / cpm`, pas de `livré / prévu`, pas de seuil. Le relecteur grep `/ 1000`, `* 100`, `0.85`, `1.25` dans `logique/live/` et `panneaux/live/`.
- Couleurs par jetons ; MapLibre reçoit des valeurs CALCULÉES (`CouleursService`), jamais `var()` dans `paint` ; palette divergente = `features/risques/logique/palette-divergente.ts` (ne pas recopier). Texte de statut sur fond clair : `--text-primary` pour le texte, la couleur de statut pour le point et la bordure.
- Graphiques : `graphiques/` (ECharts) n'a ni barres ni aires ; les barres (avancement, dispersion, qui a diffusé, territoires) sont du **HTML/CSS**, comme React les dessine déjà.
- Lectures en UN abonnement annulable par jeton (`lecture-annulable.ts`) ; flux NDJSON par `lignesNdjson`, une ligne = un `update` de signal ; dérivées en `computed`, jamais un `effect` qui recopie ; `inject()` jamais après un `await`.
- Nombres, euros et dates par `core/format/*` (jamais un formateur local).
- Le panneau de ⑧ reste MONTÉ hors de l'étape (le relevé lui survit) ; la couche `live` se retire quand on quitte ⑧.
- `input()` qui masque un attribut natif : préfixer.

---

## Groupe A — serveur (relecture 1)

### Task 1 : livraisons relevées — table, adaptateurs, relevé simulé

**Files :** voir File Structure, lignes T1.

**Interfaces :**
- Produces : `ecrireParLots<T>(supabase, table: string, lignes: T[], o: { onConflict?: string; onProgres?: (faites: number) => void }): Promise<void>` ; `LigneLivraison { plateforme: Plateforme; jour: string; maille: 'cp' | 'departement' | 'region'; code: string; impressions: number; depense: number }` ; `AdaptateurLivraison` et `choisirAdaptateur` (A-3) ; `lireCampagneLive(supabase, campagneId, orgId): Promise<CampagneLive | { refus: 404 | 409; code: string; message: string }>` où `CampagneLive = { id; nom; isDemo; debut; fin; tolerance; poids; extractionId; typeJeu; plateformes: { code; budget; cpm; mailleAchat; mailleRapport; aVerifier; cps: LigneCpExtraction[] | null }[]; plan: LigneCpExtraction[] }` ; flux NDJSON de `relever` : `{ type: 'debut', plateformes: [{ code, source: 'api' | 'simule' | 'non_branche', message? }], jours }` · `{ type: 'progression', faites, total }` · `{ type: 'fin', lignes, par_plateforme, dernier_jour }` · `{ type: 'erreur', message }`.

- [ ] Tests d'abord : `ecrire-par-lots.test.ts` (client factice : 101 lignes → 3 lots, au plus 3 en vol, une erreur de lot lève avec son message, `onProgres` cumulé) ; `adaptateurs.test.ts` — `choisirAdaptateur` (connexion `connected` sans connecteur écrit → `simule` si démo, sinon `non_branche` avec le message de la plateforme ; `error`/absente + démo → `simule` ; non démo → `non_branche`) ; `simule.lireLivraison` : déterministe (deux appels, mêmes lignes), aucun jour hors période, Meta/TikTok/TTD à la région seulement, DV360 au CP, somme des impressions d'une plateforme sur la période ≈ prévu × facteur de rythme (± fuite), CPM moyen dans [0,8 ; 1,3] × CPM prévu. Lancer : FAIL.
- [ ] `sql/288_livraison_plateformes.sql` : `create table if not exists`, `alter table plateformes_geo add column if not exists maille_rapport text check (maille_rapport in ('cp','departement','region'))` + `update` des 13 lignes (A-5, Q-2), RPC `livraison_agregee_jsonb` (`SECURITY DEFINER`, `search_path`, `comment on function` avec la borne), index = clé primaire seule. Appliquer en local, `\d`, `EXPLAIN (ANALYZE, BUFFERS)` sur la campagne nationale de T1 (chiffre au rapport). Compléter `troncature-postgrest.test.ts` si la RPC y entre.
- [ ] `ecrireParLots` extrait de `insererLignes` (contrat de `insererLignes` inchangé : les tests de la simulation du module risque restent verts).
- [ ] `lireCampagneLive` : stratégie la plus récente (`bidding_strategies`), `sourceDePoussee` (lot 7) pour l'extraction, refus `hors_parcours` (409, A-11) sans extraction ; `checkCampaignAccess` + contrôle d'espace (404) ; plan lu UNE fois, `lireCpPlateforme(…, plan)` par plateforme au CP (A-1).
- [ ] Adaptateurs (A-3, A-9) : `simule` importe `diffuserJour`, `PARAMS_DEFAUT`, `hashStr` ; pas de copie du générateur.
- [ ] Route `relever` : `requireAuth` + super_admin (403), `lireCampagneLive`, quota, un relevé = toutes les plateformes cochées, jours du début à `min(fin, hier)` (aucun → `fin` avec 0 ligne et le message A-11), lignes de CHAQUE plateforme simulée écrites par `ecrireParLots(…, { onConflict: 'campaign_id,plateforme,jour,maille,code' })`, `source` posée par la route d'après l'adaptateur (jamais lue du corps) ; plateformes `non_branche` : aucune écriture.
- [ ] `tests/integration/live-relever.test.ts` (campagne de démo créée et nettoyée par le test, extraction `2fc8fd52…`, dates passées) : NDJSON `debut` (4 plateformes `simule`), `progression`, `fin` ; lignes en base par plateforme et par maille (DV360 `cp`, autres `region`), `source = 'simule'` ; second relevé → même nombre de lignes, mêmes valeurs (Review Focus 4) ; même campagne `is_demo = false` → 4 `non_branche`, 0 ligne (Review Focus 3) ; campagne de seed sans extraction → 409 `hors_parcours` ; période future → 0 ligne ; jeu risque national (`78f6911a…`, 30 jours, DV360 seul) → ≈ 78 000 lignes, durée notée (Review Focus 5) ; un client admin non super_admin → 403 sans écriture.
- [ ] `ARCHITECTURE.md` (par `Grep "plateformes_geo"`, `"dsp_campaign_data"`, `"lib/simulation"`) : table, colonne, RPC, route, adaptateurs ; `npx tsc --noEmit`, `npm run test:unit`, `npm run test:integration` (codes de retour lus sans pipe).
- [ ] Commit `feat(api): ⑧ livraisons relevées par plateforme, adaptateur simulé (lot 8, T1)`.

### Task 2 : le payload de ⑧ — prévu, écart, rythme, alignement, alertes

**Files :** voir File Structure, lignes T2.

**Interfaces :**
- Consumes : `lireCampagneLive`, `livraison_agregee_jsonb` (T1).
- Produces : `GET /api/campaigns/[campaignId]/live` →
  `{ campagne: { id, nom, debut, fin, dernier_jour: string | null, jours_ecoules, jours_total, temps_pct }, plateformes: PlateformeLive[], total: Rythme & Montants, territoires: Record<string /* plateforme | 'toutes' */, { maille_comparaison: 'cp' | 'region'; note: string | null; region: Territoire[]; departement: Territoire[]; cp: Territoire[] }>, alertes: Alerte[], tronque: boolean }`
  avec `PlateformeLive = { code, libelle, source: 'api' | 'simule' | 'non_branche' | 'aucune'; message: string | null; maille_achat; maille_rapport; a_verifier; budget; cpm_prevu; impressions_prevues; impressions_livrees; depense; cpm_reel; rythme: Rythme; alignement: { score; conformes_pct; sous_pression_pct; sur_pression_pct; sous_pression_imps; sur_pression_imps; variation_7j: number | null; tolerance_pct; n_cp } | null; dispersion: { borne_basse: number | null; borne_haute: number | null; n: number }[] | null }`, `Rythme = { temps_pct; budget_pct; volume_pct; indice; etat: 'retard' | 'avance' | 'dans_le_rythme' | null }`, `Territoire = { code; nom; parent: string | null; prevu; livre; depense; ecart_pct: number | null; hors_plan: boolean }`, `Alerte = { type: 'retard' | 'avance' | 'sous_livree' | 'cpm'; plateforme: string | 'toutes'; severite: 'warning' | 'danger'; titre; detail; cible: string | null }`.
  Refus : 404 (espace, campagne), 409 `hors_parcours` (A-11) avec message français.

- [ ] Tests d'abord : `noyau-prevu.test.ts` — `impressionsPrevues(10000, 4.5) = 2 222 222` (et les trois autres de la démo, total 6 147 998) ; `repartitionParCp` = celle d'Angular sur les cas de `impressions.spec.ts` (somme exacte, plus forts restes) ; **deux plateformes au CP** sur des CP qui se recouvrent → deux répartitions indépendantes, aucune n'utilise l'autre (Review Focus 1) ; `repartitionParPopulation` : membres non canoniques écartés, somme exacte. `noyau-suivi.test.ts` — écart de répartition (A-6) sur un cas à la main, `hors_plan` ; agrégation CP → département → région (sommes exactes) ; plateforme au cercle → territoires à la région seulement, note A-5 (Review Focus 2) ; rythme et seuils (0,84 → retard avertissement, 0,69 → danger, 1,16 → avance) ; sous-livrée = le texte de `constatSousPression` ; alignement = `calculerAlignement` sur les CP, `variation_7j = null` sans fenêtre précédente ; dispersion par `BORNES_DIVERGENTES`. Lancer : FAIL.
- [ ] `lib/optimisation/noyau/prevu.ts` et `suivi.ts` : purs, sans I/O ; importent `calculerAlignement`, `constatSousPression` (export ajouté), `SEUIL_ECART_SIGNALE_PCT`, `SEUIL_CPM_CHER`, `trancheDivergente`/`BORNES_DIVERGENTES`. En tête de `prevu.ts` : « copie verrouillée de `angular/…/logique/plan/impressions.ts` et de `computeForecast` ; la version React disparaît à la bascule ».
- [ ] Route `GET …/live` : `requireAuth`, `lireCampagneLive`, RPC (CP demandés = plan ∪ CP des plateformes), noyau, réponse `no-store` ; une plateforme cochée sans aucune ligne → `source: 'aucune'` (ou `non_branche` si l'adaptateur l'est, même règle que T1) ; aucun appel en parallèle.
- [ ] Étendre `plan-logique-paritaire.test.ts` : noyau ↔ Angular ↔ `computeForecast`.
- [ ] `tests/integration/live-suivi.test.ts` : après un relevé simulé (fixture de T1), `GET` → 4 plateformes, `impressions_prevues` = 6 147 998 au total, DV360 `maille_comparaison = 'cp'` avec 3 niveaux, Meta/TikTok/TTD `region` sans `departement` ni `cp`, `toutes` à la région ; Σ prévu des CP DV360 = prévu DV360 ; alignement DV360 calculable, Meta `null` ; campagne nationale de T1 → réponse < 1 s, < 500 Ko (mesures au rapport) ; autre espace → 404 ; seed `dccc…02` → 409 `hors_parcours`.
- [ ] `ARCHITECTURE.md` (route, contrat ⑥ → ⑧ honoré : « prévu recalculé par le noyau ») ; tsc, unitaires, intégration.
- [ ] Commit `feat(api): ⑧ suivi des livraisons par plateforme et par territoire (lot 8, T2)`.

**Relecture 1** (T1 + T2, une passe, modèle le plus capable) : une ligne `simule` peut-elle naître sur une campagne non démo ? le prévu touche-t-il `planned_share` ou `get_campaign_expected` par un chemin quelconque ? `insererLignes` est-il strictement inchangé pour ses appelants ? la RPC peut-elle tronquer sans le dire ? un relevé peut-il écrire un jour futur ? Meta peut-elle sortir une ligne au CP ?

## Groupe B — état, squelette et chiffres (relecture 2)

### Task 3 : Angular — API, état, squelette de ⑧, relevé, bandeau

**Files :** voir File Structure, lignes T3.

**Interfaces :**
- Consumes : routes de T1 et T2 ; `PlanCampagneService` (`campagne`, `detail`, `prerempli`, `accesRefuse`, `libelleCanal`) ; `ParcoursService`.
- Produces : `LiveApi { suivi(c): Observable<SuiviLive>; relever(c): Observable<LigneReleve> }` ; `LiveCampagneService { suivi; chargement; erreur; refus; plateforme: Signal<string>; parent: Signal<{ maille; code } | null>; vue: Signal<VueLive>; releve: Signal<{ campagne; lignes: LigneReleve[]; faites; total } | null>; releveEnCours; renseignee; choisirPlateforme(p); descendre(code); remonter(niveau); relever() }` ; `vueLive(suivi, plateforme, parent): VueLive` (filtrage pur : territoires du niveau, plateforme sélectionnée, fil d'Ariane, note de maille) ; `textes.ts` (états A-11, libellés de source « Simulé » / « API » / « Non branché », note A-5).

- [ ] Specs d'abord : `vue.spec.ts` (DV360 → région / département de la région / CP du département ; Meta → région seule et note ; « toutes » → région ; parent inconnu → région) ; `textes.spec.ts` ; service : rien n'est lu tant que l'espace n'est pas validé ; campagne d'un autre espace → aucun appel ; changement de campagne pendant la lecture → réponse ignorée ; relevé lié à SA campagne, B voit « Un relevé est en cours sur une autre campagne. » (Review Focus 6) ; relecture du suivi après `fin` ; cache par campagne (revenir sur A ne relit pas) ; panneau : sans campagne → « Choisissez une campagne dans la barre, ou créez-la à l'étape ⑥. » + « Aller à ⑥ Plan » ; `hors_parcours` → message A-11 + lien vers l'application actuelle ; période future ; aucune livraison → bouton ; relevé : barre `mg-barre-progression`, une ligne par plateforme avec sa source et le message `non_branche` tel quel ; bandeau A-14.
- [ ] `live.api.ts` typé d'après les routes LUES ; `relever` par `lignesNdjson`.
- [ ] `LiveCampagneService` (page) ; `carte.fournisseurs.ts` : `FOURNISSEURS_LIVE`, `suivreLiveRenseignee()`.
- [ ] `carte.page.html` : `@case ('live') { <mg-panneau-live /> }` ; `parcours.ts` : `CONSIGNE_ETAPE.live` = « Suivez les impressions livrées et la dépense de chaque plateforme, comparées au plan. », `RENSEIGNEE_PAR.live` ; `ONGLET_REACT.live` gardé pour le seul cas `hors_parcours` ; `carte.page.ts` : une ligne.
- [ ] `cd angular && npx ng test --watch=false`, `npx tsc --noEmit` racine, `npm run test:unit`. Commit `feat(angular): ⑧ état, squelette, relevé et bandeau du suivi (lot 8, T3)`.

### Task 4 : Angular — rythme, coût, plateformes, alignement

**Files :** voir File Structure, lignes T4.

**Interfaces :** Consumes `VueLive` (T3). Produces `mg-bandeau-avancement`, `mg-cout-rythme`, `mg-qui-a-diffuse`, `mg-score-alignement`, `mg-trois-composantes`.

- [ ] Specs d'abord, **textes et mesures de React à la lettre** (lire chaque `.tsx` avant d'écrire) : trois barres sur la même échelle et repère du temps, phrase de fin de campagne (`BandeauAvancement`) ; CPM réel vs prévu et impressions livrées / prévues, **sans** la carte « coût du déséquilibre » (`CoutEtRythme`) ; une barre par plateforme : volume, dépense, CPM réel contre prévu, badge « Simulé » / « Non branché » (`QuiADiffuse`, « partenaire » → « plateforme », écart listé) ; score, mention « calculé au code postal », variation 7 j ou « inconnue », phrase A-8 pour une plateforme hors CP (`ScoreAlignement`) ; trois composantes avec la tolérance interpolée (`TroisComposantes`) ; « Toutes plateformes » : pas de score (il n'est défini que par plateforme au CP), le dire.
- [ ] Implémenter ; aucune formule (piège n° 3).
- [ ] `cd angular && npx ng test --watch=false`, `npx tsc --noEmit`. Commit `feat(angular): ⑧ rythme, coût, plateformes et alignement (lot 8, T4)`.

**Relecture 2** (T3 + T4) : une lecture part-elle avant la validation de l'espace ? un relevé peut-il s'afficher sur la mauvaise campagne ? une formule s'est-elle glissée côté Angular ? chaque texte de React est-il repris, chaque écart listé ? aucun hex, aucun `effect` qui recopie ?

## Groupe C — territoires et carte (relecture 3)

### Task 5 : Angular — maille, territoires, dispersion, alertes, grande carte

**Files :** voir File Structure, lignes T5.

**Interfaces :** Consumes `LiveCampagneService`, `VueLive`, `ContoursZonesService`, `CouleursService`, `palette-divergente.ts`, `ajouterCouche`. Produces `mg-barre-maille`, `mg-tableau-territoires`, `mg-dispersion-cp`, `mg-constats-live`, `couche-live.ts`, `LiveCarteService`.

- [ ] Specs d'abord : barre de maille = sélecteur de plateforme (« Toutes plateformes » puis les cochées, ordre du registre) + fil d'Ariane France › région › département › CP (`mg-fil-ariane`), arrêté à la région quand `maille_comparaison = 'region'`, note A-5 (Review Focus 2) ; tableau des territoires (`TableauDeregles` : barre divergente centrée, bascule sous / sur, 7 lignes puis « Voir les N … » EN MÉMOIRE, « hors plan » jamais une cellule vide, tri par volume mal placé, titre qui suit la maille) ; histogramme CP en barres HTML, tranche conforme au centre, couleurs `--diverge-*` (Q-5) ; constats : ≤ 3 sous-livrés + retard / avance / CPM, « Voir sur la carte » qui descend et centre ; couche : un territoire par polygone de la maille affichée, couleur par `trancheDivergente` (Écart) ou `--seq-1…5` (Impressions), `--donnee-absente` sans prévu ni livré, clic = descendre ; la couche se retire hors de ⑧ ; changement de thème → couleurs recalculées.
- [ ] Implémenter ; contours au CP lus seulement quand on descend dans un département (filtrés à ses CP) — ils sont partagés et mis en cache par `ContoursZonesService`.
- [ ] `cd angular && npx ng test --watch=false`, `npx tsc --noEmit`. Commit `feat(angular): ⑧ territoires, dispersion, alertes et carte (lot 8, T5)`.

**Relecture 3** (T5) : le fil d'Ariane peut-il descendre sous la région pour Meta / TikTok / TTD ? la palette divergente est-elle importée, pas recopiée ? le contraste des textes tient-il en thème clair ? la couche survit-elle à un changement d'étape ?

## Task 6 : revue finale, factorisation, preuve navigateur

- [ ] Revue finale du lot (modèle le plus capable) : mineurs accumulés, passe de factorisation inter-tâches. Dire ce qui reste dupliqué : `impressionsPrevues` / `repartitionParCp` (noyau, Angular ⑥, React `computeForecast`) verrouillés par parité ; l'écran React de suivi, `lib/dsp/report/*`, `simulate_dsp_report`, `/api/digital/[id]/suivi` et `alignement*` restent pour React et partent à la bascule.
- [ ] **Preuve navigateur, une seule fois, deux thèmes** (`L8-T6-*`), serveurs du worktree : espace BMW GROUP, mode démo ; campagne de DÉMO lancée en ⑥ sur l'extraction v1 du jeu des lycées BdR, **dates passées** (01/10 → 31/10/2026), 4 plateformes aux budgets de `4935811d…` ; ⑧ → « Aucune livraison relevée » → « Relever les livraisons » : flux, barre, 4 sources « Simulé » ; bandeau ; rythme et alerte retard s'il y a lieu ; plateformes ; DV360 : score, trois composantes, région PACA → Bouches-du-Rhône → CP, tableau, histogramme, carte Écart puis Impressions ; Meta : note « ne rend pas le code postal », fil arrêté à la région ; « Toutes plateformes » à la région ; second relevé → mêmes chiffres ; même campagne non démo → 4 « Non branché », rien écrit ; campagne de seed `dccc…02` → message A-11 et lien ; campagne d'un autre espace collée en Marine nationale → message de ⑥, aucun appel à `…/live` dans l'onglet réseau ; pastille ⑧ allumée ; campagne nationale (jeu risque Seveso, DV360) : temps du relevé et de l'affichage notés.
- [ ] `ARCHITECTURE.md` (§ carte Angular : étape ⑧, services, source simulée), `angular/src/app/features/carte/README.md` (§ ⑧, table des fichiers, « dupliqué à dessein »). Tests complets : `npm test`, `cd angular && npx ng test --watch=false`, `npx tsc --noEmit`, `npm run build` avec `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_ANON_KEY` locaux explicites, `cd angular && npx ng build`.
- [ ] Commit `docs: ⑧ Live — revue finale et preuve navigateur (lot 8, T6)`.

---

## Estimation

| Groupe | Tâches | Charge |
|---|---|---|
| A serveur | T1, T2 | 1,2 j (T1 : migration, extraction de `ecrireParLots`, adaptateurs, route NDJSON, intégration nationale ; T2 : noyau et payload) |
| B état + chiffres | T3, T4 | 0,9 j |
| C territoires + carte | T5 | 0,6 j |
| Fin | T6 | 0,4 j |
| **Total** | **6 tâches, 3 relectures, 1 preuve** | **≈ 3 jours** |

## Critères de fin du lot

Pour une campagne de démo lancée en ⑥ depuis une extraction, ⑧ relève une livraison simulée par plateforme (idempotente, à la maille de rapport), puis affiche livré contre prévu, dépense, CPM réel contre prévu, rythme et alertes, par plateforme et par territoire — CP pour DV360, région pour Meta, TikTok et TTD, dit à l'écran ; le prévu est recalculé par le noyau depuis les canaux et l'extraction, jamais `planned_share` ; une vraie campagne affiche « non branché » sans rien écrire ; une campagne hors parcours renvoie à l'application actuelle ; aucun calcul dans le navigateur ; aucune trace d'ad server, de réconciliation, de rebid ni de constat d'optimisation dans l'écran Angular ; React inchangé ; tests et builds verts ; preuve navigateur dans les deux thèmes, échelle nationale mesurée.

## Hors V1 (rappel, § 19.2-19.4)

Connecteurs réels TTD, DV360, Meta, TikTok (naissent avec leurs accès, sur le contrat de T1) et la tâche Inngest quotidienne ; boucle d'optimisation (`lib/optimisation/boucle.ts`, `appliquerPoids`, `optimisation_cycles`, marches 1-3 de l'Excel) ; autres KPI ; ad server et réconciliation ; « Recaler » ; constats `sur_pression` / `canal_cher` ; coût du déséquilibre ; pression par classe ; vignette « Variable du plan » ; courbe région/département du graphique d'écart ; zones météo recalculées ; suivi au-delà de la région pour les plateformes sociales ; « mode pays » (④/⑤).
