# La carte en parcours — lot 8 « ⑧ Live » — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (ou superpowers:executing-plans). Skill `porting-react-to-angular` chargé AVANT chaque tâche Angular. Cases à cocher (`- [ ]`) pour le suivi.

**Révisé le 28/10 avec les réponses de Vincent**, puis avec sa **correction du même jour** (prioritaire) : **les connecteurs des plateformes (DV360, Meta, TikTok, TTD) ne sont PAS codés dans ce lot** — un développeur humain les écrira. ⑧ s'arrête au **contrat `lireLivraison` documenté** (interface + table `livraison_plateformes`) et à tout ce qui est côté dentsu.explore : stockage, agrégats en descente, routes, écran Angular, tâche Inngest qui appelle les adaptateurs enregistrés. **Aucune simulation, aucune donnée de démonstration.** Objectif de Vincent : aller le plus loin possible dans le fil d'Ariane, sans démo.

**Mode accéléré (Vincent, 24/10) :** 7 tâches en 2 groupes et une revue finale, **un implémenteur et une relecture par groupe**, seuls les défauts Critiques et Importants corrigés au fil de l'eau (les mineurs vont à T7), **une seule preuve navigateur**, en T7. Cible : **≈ 3,5 jours**.

**Goal :** à l'étape ⑧ de la carte Angular, pour la campagne courante lancée en ⑥ depuis une extraction, montrer **les impressions livrées contre prévues et la dépense, par plateforme et par territoire**, telles que les adaptateurs enregistrés les auront écrites dans `livraison_plateformes` ; le **rythme** (temps / budget / volume), les alertes **retard** et **zone sous-livrée**, le **CPM réel contre prévu** ; une **vue de retard en descente** région → département → CP → IRIS (ou unité du jeu pour un polygone), **plafonnée à la maille que la plateforme rapporte**, sur la grande carte zoomable et dans la liste des territoires les plus en retard. Une **tâche Inngest quotidienne** appelle les adaptateurs enregistrés (aucun enregistré : elle ne fait rien et le dit). **Sans donnée, un état vide honnête** : « Aucune donnée remontée — plateforme non connectée. »

**Architecture :** une table d'atterrissage `livraison_plateformes` (jour × plateforme × unité de rapport) ; un **contrat documenté** `AdaptateurLivraison.lireLivraison` et un **registre vide** (`lib/optimisation/adaptateurs/`) que le développeur remplira ; un service de relevé (tâche Inngest, un step par campagne, + bouton « Relever maintenant ») qui n'écrit QUE ce qu'un adaptateur enregistré rend ; un **noyau pur** (`lib/optimisation/noyau/`) qui recalcule le prévu depuis `geo_strategy.channels` et l'extraction (§ 19.4), puis l'écart, le retard, le rythme, l'alignement et les alertes à chaque niveau ; une RPC `jsonb` d'agrégats ; deux routes de lecture (`GET …/live`, `GET …/live/iris`). Côté Angular : `mg-panneau-live` (port allégé de `SuiviV2`), `LiveCampagneService` fourni par la page, la grande carte peinte par les contours déjà partagés (`ContoursZonesService`). **Le navigateur ne calcule rien.**

**Tech Stack :** Angular 21.2 standalone, zoneless, signals ; Tailwind 4 ; Vitest (`cd angular && npx ng test --watch=false`). Next.js 15, supabase-js, Zod, Inngest, Vitest racine (`npm run test:unit`, `npm run test:integration`). Postgres 17.6 + PostGIS local (`docker exec supabase_db_genesis_app psql -U postgres`).

**Spec :** `docs/superpowers/specs/2026-10-13-carte-en-parcours-design.md` — **§ 19 fait foi** (19.2 ligne ⑧, 19.3, 19.4 « porter / ne pas porter », prévu par CP et par plateforme, maille de rapport) ; § 4 « ⑦ Live » (numérotation d'origine) pour l'écran ; § 16.2 règles 3 et 4. Plans précédents : `…/2026-10-24-carte-en-parcours-lot-6-plan.md`, `…/2026-10-25-carte-en-parcours-lot-7-activation.md`. Mémoires : `project_suivi_sans_adserver`, `project_archi_algo_optimisation`, `project_ttd_premier_dsp`, `project_dv360_parked`, `project_tiktok_connexion`, `feedback_mode_accelere`, `feedback_angular_vigilance`, `feedback_agents_frugaux`, `feedback_no_hardcoded_colors`, `reference_postgrest_db_max_rows`, `reference_maplibre_paint_sans_var`, `reference_dsp_maille_geo`.

## Décisions du 28/10 (Vincent)

| # | Question du 27/10 | Décision |
|---|---|---|
| Q-1 | Livraison simulée pour les démos ? | **NON.** Aucune simulation, aucun mode démo, aucune donnée de démo, aucun recours à `diffuserJour` ni au seed. Sans donnée : état vide honnête. |
| Q-2 | Maille de rapport TTD ? | **TTD mis de côté** (doc bientôt) : « The Trade Desk : connecteur à venir. » |
| Q-3 | Écart de répartition ? | **Oui** (comme React ; le retard de volume se lit dans le rythme). |
| Q-4 | Grande carte au lieu des vignettes ? | **Oui** : une grande carte, zoomable. |
| Q-5 | Graphique d'écart ? | **Pas d'histogramme CP.** Vue de retard **en descente** région → département → CP → IRIS ou polygone, **plafonnée à la maille que la plateforme rapporte réellement**, dite à l'écran ; sur la grande carte, écart livré / prévu au niveau choisi + liste triée des plus en retard ; clic = descendre. Prévu recalculé au même niveau (agrégation depuis le CP du plan, ou unité du jeu pour un polygone). |
| Q-6 | Bouton seulement ? | **NON** : **mise à jour automatique** (tâche Inngest planifiée, un step par campagne, règles I/O) ; bouton « Relever maintenant » gardé, il appelle le même service. |
| Q-7 → **correction** | Adaptateurs ? | **Pas codés dans ce lot** : un développeur humain les écrit sur le contrat `lireLivraison` documenté ici (section « À faire par le développeur »). |

## Global Constraints

- V1 = **impressions et dépense** remontées par les plateformes. Ni ad server, ni réconciliation, ni conversions, ni rebid / « Recaler », ni constats d'optimisation (`sur_pression`, `canal_cher`), ni « coût du déséquilibre », ni pression par classe, ni vignette « Variable du plan », ni histogramme CP (§ 19.2-19.4, Q-5).
- **Aucun connecteur de plateforme dans ce lot** : aucun appel à une API DV360, Meta, TikTok ou TTD, aucun scope OAuth ajouté, aucune route de connexion neuve. Le registre des adaptateurs est livré **vide**.
- **Aucune donnée inventée** : une ligne de `livraison_plateformes` n'est écrite que par `releverCampagne` à partir de ce qu'un adaptateur enregistré a rendu. Un test d'intégration qui écrit en base le fait sur une campagne de test qu'il crée et supprime lui-même (patron des lots 6 et 7), avec un adaptateur **factice défini dans le test**, jamais enregistré dans le code livré.
- **Aucun calcul dans le navigateur** : prévu, écart, retard, rythme, alignement, alertes et tris arrivent du serveur. Angular filtre (plateforme, parent) et colore.
- **Le prévu n'est JAMAIS lu dans `campaign_cp_rollup.planned_share` ni `get_campaign_expected`** (§ 19.4).
- Écritures : **lots de 50, 3 en parallèle au plus**, erreur de CHAQUE lot lue, upsert idempotent sur la clé primaire ; progression NDJSON pour le bouton ; la tâche Inngest journalise ses compteurs par step.
- Inngest : **une campagne à la fois** (un step par campagne, séquentiels), horaire creux, aucune campagne sans adaptateur enregistré pour une de ses plateformes n'est relue.
- Troncature PostgREST (1 000 lignes) : RPC `RETURNS jsonb` avec borne écrite et `tronque` ; CP d'une extraction par `lireCpExtraction` / `lireCpPlateforme`.
- Campagnes réservées au **super_admin** en V1 ; `relever` le vérifie (403). **Contrôle d'espace côté Angular** comme ⑦ ; le serveur refait le contrôle (404).
- Aucun `DROP` ; migration additive rejouable ; base locale seulement, jamais le MCP Supabase ; `EXPLAIN ANALYZE` sur toute requête PostGIS neuve.
- Vouvoiement ; textes de React à la lettre là où on porte (écarts listés au rapport) ; sentence case ; jetons `var(--…)` seulement (valeurs CALCULÉES par `CouleursService` pour MapLibre) ; Inter + JetBrains Mono ; bordures 0,5 px.
- Fichiers `.ts` < 400 lignes ; `carte.page.ts` 379/400 (une ligne de pastille) ; `plan-campagne.service.ts` 391/400 (**rien n'y entre**).
- Preuve sur les serveurs du worktree, **jamais :3000 / :4200**, qu'on n'arrête pas.

## Review Focus

1. **Aucune donnée inventée, aucun connecteur** : grep `diffuserJour`, `simul`, `demo`, `googleapis`, `graph.facebook`, `business-api.tiktok` dans tout fichier neuf du lot → aucun ; registre vide ; la tâche Inngest et le bouton disent « Aucun connecteur enregistré : rien à relever. » (T3, T4).
2. **Deux plateformes au CP** : prévu de chacune = ses impressions (budget ÷ CPM × 1 000) réparties sur SES CP au prorata des multiplicateurs, somme exacte ; rien de `planned_share` (T2).
3. **Descente plafonnée** : le niveau le plus fin = `maille_rapport` de la plateforme (et la région quand elle n'achète pas au CP) ; le niveau suivant est grisé avec la phrase de la plateforme ; « Toutes plateformes » à la région ; le prévu de chaque niveau est l'agrégat du plan (T2, T6).
4. **Contrat tenu par le relevé** : une ligne rendue par un adaptateur hors de sa maille déclarée, d'un jour hors période ou futur, d'une devise ≠ EUR, ou d'un code inconnu du référentiel est refusée et comptée, jamais écrite ; une erreur d'adaptateur n'efface aucun jour déjà relevé (T3).
5. **Inngest et I/O** : un step par campagne, séquentiels ; re-relève idempotent ; coût d'une passe à vide mesuré (T3).
6. **Changement de campagne pendant une lecture ou un relevé** : une réponse tardive de A ne s'écrit jamais dans B (patron A-10 de ⑦) (T4).

---

## Pré-vol : ce qui existe vraiment (reconnaissance des 27-28/10, worktree `carte-live`, HEAD `b3610369`)

### Quelle source alimente ⑧ aujourd'hui — mesuré en base locale

**Aucune**, et ce lot n'en branche aucune : ⑧ affichera l'état vide honnête jusqu'à ce que le développeur enregistre un premier adaptateur ; dès lors, la tâche Inngest remplit la table et l'écran sans autre code côté dentsu.explore.

| Plateforme | Ce qui existe (27/10) | Reste au développeur |
|---|---|---|
| DV360 | `lib/dsp/dv360/{auth,client}.ts` (OAuth, compte de service, `resolveAccessToken`, cascade, poussée géo) ; `lib/dsp/report/dv360.ts` = bouchon `skipped` ; scope `doubleclickbidmanager` **commenté** dans `DV360_SCOPES` ; 1 connexion, espace 00…01, `error` ; droits Google bloqués | adaptateur de rapport (voir « À faire par le développeur ») |
| Meta | rien (registre : `connection_provider = 'meta'`, liaisons `ad_account / campaign / ad_set`) | connexion OAuth + adaptateur |
| TikTok | `lib/dsp/tiktok/client.ts` (OAuth, annonceurs) ; app développeur non créée | adaptateur de rapport |
| TTD | rien | à venir (doc attendue) |

Le reste de la base n'apporte rien à ⑧ : `dsp_campaign_data` (≈ 1,04 M lignes, 394 Mo) = seed, simulation du module risque, import Adform ; `campaign_dsp_report` (2 131 lignes) tout `simulated` ; rollups à `planned_share`. Rien de cela n'est lu ni modifié.

### Le plan d'une campagne lancée en ⑥ (mesuré sur `4935811d…`)

- `geo_strategy.channels` : budgets dv360 10 000 / ttd 8 000 / meta 6 000 / tiktok 4 000 € ; CPM prévus 4,5 / 3,8 / 5,2 / 6 € → impressions 2 222 222 / 2 105 263 / 1 153 846 / 666 667, **total 6 147 998 = `kpi_target`**. Période 01/11 → 30/11/2026. `links` vides (aucune liaison faite en ⑥).
- Extraction `2fc8fd52…` : plan CP 88 lignes ; DV360 63 unités CP retenues → **72 CP bruts** ; Meta 53 cercles ; TikTok 1 département retenu sur 2 ; TTD 1 polygone. Régions : PACA 87 CP (1 561 527 hab. en zone) + Occitanie 1.
- `zone_set_extraction_unites` porte `pop_en_zone` par unité, aucun multiplicateur hors CP. **Aucune table IRIS ↔ CP** : la correspondance se calcule (IRIS dont le point intérieur tombe dans le CP).

### Mailles de rapport attendues (doc publique, à confirmer par le développeur)

| Plateforme | Dimension géographique | `maille_rapport` posée par sql/288 |
|---|---|---|
| DV360 (Bid Manager v2) | `FILTER_ZIP_POSTAL_CODE` | `cp` |
| Meta (Insights) | `breakdowns=region` | `region` |
| TikTok (Reporting, AUDIENCE) | `province_id` | `region` (à vérifier) |
| TTD | inconnue (polygone, IRIS ?) | `null` (à venir) |

La descente côté dentsu.explore va jusqu'à **IRIS** et **unité du jeu** (polygone) ; elle n'est atteinte que pour une plateforme dont la `maille_rapport` le permet. Aujourd'hui aucune : ces niveaux sont testés en intégration avec des lignes de test (Q-13).

### L'existant React à porter (≈ 3 700 lignes) et ses données

| Brique React (lignes) | Sort au lot 8 |
|---|---|
| `SuiviV2.tsx` (709) — sept lectures, sémaphore à 3 | **Porté allégé** : UNE lecture (`GET …/live`), descente en mémoire jusqu'au CP, IRIS à la demande |
| `BarreContexteCampagne.tsx` (273) | **Déjà porté** (`mg-choix-campagne`, lot 6) |
| `BarreMaille.tsx` (103) | **Porté** + sélecteur de plateforme + plafond |
| `BandeauAvancement.tsx` (160) | **Porté** |
| `CoutEtRythme.tsx` (116) | **Porté** sans « coût du déséquilibre » |
| `ScoreAlignement.tsx` (251) + `TroisComposantes.tsx` (101) | **Portés**, plateformes au CP seules |
| `TableauDeregles.tsx` (373) | **Porté** en « Territoires les plus en retard » |
| `GraphiqueEcart.tsx` (253) | **Non porté** (Q-5) |
| `QuiADiffuse.tsx` (156) | **Porté** : une barre par plateforme, état « non connectée » |
| `ConstatsCorrection.tsx` (134) | **Porté**, constat `sous_pression` seul + alerte retard |
| `TrioCartes.tsx` (178) + `CarteVignette.tsx` (335) | **Remplacés par la grande carte** (Q-4) |
| `PressionParClasse`, `DetailTechnique`, vignette « Variable du plan » | **Non portés** (§ 19.4) |

TS serveur réutilisé tel quel : `calculerAlignement` (`lib/campagne/alignement.ts`), `SEUIL_ECART_SIGNALE_PCT`, `SEUIL_CPM_CHER` et le constat sous-pression (`lib/campagne/constats.ts`, fonction à exporter), `trancheDivergente` (`lib/campagne/palette-divergente.ts`), `lireCpExtraction` / `lireCpPlateforme`, `sourceDePoussee` et `connexionUtilisable` (`lib/campaigns/activation.ts`), `logDspEvent`, `insererLignes` (`lib/simulation/serveur.ts`, boucle à généraliser), `rpcJson`, `lireTout`, `inngest` (patron `civicDailyIngest`).

### Côté Angular

- `logique/parcours.ts` : étape `live` (`@default { <mg-etape-bientot> }`), `ONGLET_REACT.live = 'suivi'`, `CONSIGNE_ETAPE.live` « arrive dans le parcours », `ETAPES_CAMPAGNE` inclut `live`.
- `etat/plan-campagne.service.ts`, `etat/activation-campagne.service.ts` (patron « validée », tâche liée à SA campagne).
- Briques : `ui/{entete-section, kpi, bandeau-kpi, tuile-chiffre, barre-progression, fil-ariane, pastille, tableau, notifications}`, `core/http/ndjson.ts`, `etat/lecture-annulable.ts`, `etat/contours-zones.service.ts` (région / département / CP, ≈ 3,8 Mo au CP), tuiles IRIS de la carte (`couches/couche-iris.ts`, source `iris-source`, IRIS à partir de z9), `couches/couche-unites.ts` (`ajouterCouche`, peinture IRIS par tuiles déjà écrite pour ④/⑤), `features/risques/logique/palette-divergente.ts`, `logique/carte-campagne.ts` (`JETONS_CAMPAGNE`, `couleurIndice`).

### Mesures locales (27-28/10)

| Mesure | Valeur |
|---|---|
| Table synthétique de livraison (transaction annulée), 30 j × 2 595 CP | 77 850 lignes par campagne-mois et plateforme au CP, ≈ 190 o/ligne |
| Agrégat livré par (plateforme, maille, code) + 7 derniers jours | **24 ms**, index de clé primaire, ≈ 2 060 buffers |
| Agrégat par (plateforme, jour) | **14 ms**, ≈ 2 060 buffers |
| **Descente région / département / CP** en UN passage, plan national 2 595 CP | **37 ms**, 2 707 groupes ; ≈ 1 680 buffers dont **1 552 pour un parcours séquentiel de `ref_codes_postaux`** (13 Mo, géométries comprises) — index couvrant `(code_postal) include (code_dept)` à mesurer en T1 |
| **CP → IRIS** (IRIS dont le point intérieur est dans le CP, index GIST) | un CP (13001) : **19 IRIS, 33 ms, ≈ 71 buffers** ; un département entier (13) : 1 126 IRIS, 171 ms, ≈ 6 800 buffers → IRIS **à la demande, un CP à la fois**, jamais dans le payload principal |
| Relevé quotidien d'une plateforme au CP, national | ≈ 2 600 lignes → 52 lots de 50 ; re-relève de 3 jours ≈ 156 |

### « Mode pays » : ne bloque pas ⑧

⑧ n'appelle aucune RPC bornée à 100 000 km² ; il lit une extraction figée et des agrégats. La borne bloque **en amont** (④ couverture, ⑤ extraction d'un jeu de ZONE national). **Pas de tâche dans ce lot** ; ligne ④/⑤ de l'Excel.

### Écarts relevés (corrigés par ce plan)

| # | Constat | Ce que fait ce plan |
|---|---|---|
| E1 | Aucune table pour une livraison par plateforme et par unité de rapport. | T1 : `livraison_plateformes`. |
| E2 | `lib/dsp/report/*` (bouchon DV360, contrat sans maille ni jour) ne sert que la réconciliation React. | Non touché (supprimé à la bascule React) ; le contrat neuf le remplace pour ⑧. |
| E3 | La maille de RAPPORT n'est écrite nulle part (§ 19.4). | T1 : `plateformes_geo.maille_rapport`. |
| E4 | Les écrans React chiffrent dans le navigateur. | T2 : tout est calculé côté serveur. |
| E5 | La boucle d'écriture par lots vit dans `insererLignes`. | T1 : `ecrireParLots` générique. |

---

## Le contrat `lireLivraison` (livré en T1, implémenté par le développeur)

```ts
// lib/optimisation/adaptateurs/types.ts — contrat documenté (JSDoc complet dans le fichier)
export type Plateforme = 'dv360' | 'ttd' | 'meta' | 'tiktok';
export type MailleRapport = 'cp' | 'departement' | 'region' | 'iris' | 'unite';

/** Ce que dentsu.explore donne à l'adaptateur : la campagne, sa connexion d'espace, ses identifiants sur la plateforme. */
export interface CampagnePourAdaptateur {
  campagneId: string;
  organisationId: string;
  plateforme: Plateforme;
  connexion: { id: string; status: string; auth_method: string | null; advertiser_ids: unknown; meta: unknown };
  /** Liaisons de ⑥ (`geo_strategy.channels.links[plateforme]`), ex. DV360 { advertiser_id, campaign_id, insertion_order_id }. */
  liens: Record<string, string>;
  /** Unités de l'extraction pour la maille `unite` (ordinal, code, nom) ; vide sinon. */
  unites: { ordinal: number; code: string | null; nom: string | null }[];
}

/** Une ligne : un jour, une unité de rapport. Dépense en EUR, coût total annonceur (Q-9). */
export interface LigneLivraison {
  jour: string;            // YYYY-MM-DD, fuseau Europe/Paris
  maille: MailleRapport;   // = mailleRapport de l'adaptateur
  code: string;            // CP sur 5 chiffres, code INSEE dépt / région, code IRIS, ou ordinal d'unité
  impressions: number;     // entier ≥ 0
  depense: number;         // ≥ 0
  devise: string;          // 'EUR' seule acceptée en V1
}

export interface AdaptateurLivraison {
  plateforme: Plateforme;
  mailleRapport: MailleRapport;
  /** Lit la livraison des jours [de, a] inclus. Lève en cas d'échec : le relevé n'efface alors rien. N'écrit JAMAIS en base. */
  lireLivraison(c: CampagnePourAdaptateur, jours: { de: string; a: string }): Promise<LigneLivraison[]>;
}
```

`lib/optimisation/adaptateurs/registre.ts` exporte `REGISTRE: Partial<Record<Plateforme, AdaptateurLivraison>> = {}` — **vide à la livraison**. `releverCampagne` est le seul écrivain : il valide chaque ligne (maille, jour dans la période et ≤ hier, devise, code connu du référentiel) avant l'upsert.

## À faire par le développeur (hors lot, un humain)

Commun à toutes les plateformes : implémenter `AdaptateurLivraison` dans `lib/optimisation/adaptateurs/<plateforme>.ts`, l'ajouter au `REGISTRE`, appels par `fetchAvecDelai`, journal par `logDspEvent`, jeton par la connexion de l'espace (`dsp_connections`, règle 4), tests unitaires sur réponses enregistrées dans `tests/fixtures/dsp/<plateforme>/` (aucun identifiant réel), corriger `plateformes_geo.maille_rapport` si la doc dit autre chose ; ne jamais écrire en base.

- **DV360** : ajouter le scope `https://www.googleapis.com/auth/doubleclickbidmanager` à `DV360_SCOPES` (les connexions existantes devront reconsentir) ; Bid Manager API v2 : `queries.create` (STANDARD, `groupBys` `FILTER_DATE` + `FILTER_ZIP_POSTAL_CODE`, filtres annonceur et insertion order des liens de ⑥, métriques `METRIC_IMPRESSIONS` + `METRIC_REVENUE_ADVERTISER`), `queries.run`, attente bornée du rapport, téléchargement du CSV, normalisation des CP sur 5 chiffres ; maille `cp`. Préalable : droits Google (`project_dv360_parked`).
- **Meta** : flux de connexion OAuth (aucun aujourd'hui ; patron des routes TikTok et de `lib/dsp/oauth-state.ts`, permission `ads_read`, jeton longue durée) et entrée dans l'écran Connexions API ; Insights `/{campaign_id}/insights?fields=impressions,spend,account_currency&breakdowns=region&time_increment=1` paginé ; nom de région → `code_region` par `ref_regions` ; maille `region`. Préalable : app Meta (Marketing API) sur le Business Manager dentsu.
- **TikTok** : `/report/integrated/get/` (AUDIENCE, `AUC_CAMPAIGN`, dimensions `stat_time_day` + `province_id`, métriques `impressions` + `spend`, pagination `page_info`) ; `province_id` → nom (`/tool/region/`) → `code_region` ; vérifier que la France est ventilée par région ; maille `region`. Préalable : app développeur TikTok.
- **The Trade Desk** : à la réception de la doc et d'un siège : API de rapports, maille réelle (CP, IRIS ou polygone → maille `unite` avec l'ordinal des unités de l'extraction, déjà fournies par `CampagnePourAdaptateur.unites`) ; poser `maille_rapport`.

---

## Routes API et tâche planifiée

**Routes neuves** : `GET /api/campaigns/[campaignId]/live` (T2) ; `GET /api/campaigns/[campaignId]/live/iris?plateforme=&cp=` (T2, à la demande) ; `POST /api/campaigns/[campaignId]/live/relever` (T3, NDJSON). **Tâche Inngest neuve** : `releve-livraisons-quotidien` (T3), enregistrée dans `app/api/inngest/route.ts`. **Modifié sans changement de contrat** : `lib/simulation/serveur.ts` (`insererLignes` délègue à `ecrireParLots`), `lib/zones/cp-plateforme.ts` (paramètre optionnel).

Plus appelées par ⑧ : `/api/digital/[id]/{suivi,actors,reconcile,reconcile/pull}`, `/api/campaigns/[id]/alignement*`, `/api/campaigns/[id]/pression-classes`. Elles restent pour React.

**Charge I/O.** `GET …/live` : campagne + stratégie, `plateformes_geo`, plan CP **lu une fois** (≤ 7 000, paginé), UNE RPC d'agrégats (≈ 2 000 buffers à l'échelle nationale, descente 37 ms). `GET …/live/iris` : un CP (≈ 71 buffers, 33 ms), quota 30/min. Inngest à vide (registre vide) : une seule requête de liste, aucune écriture. Côté Angular : une lecture à l'entrée dans ⑧ par campagne (cache), IRIS d'un CP au clic (cache par CP), relue après un relevé.

---

## Arbitrages (tranchés ; coût si faux)

| # | Point | Tranché | Coût si faux |
|---|---|---|---|
| A-1 | Lecture du plan | `lireCpPlateforme` gagne un paramètre optionnel `plan?` (plan déjà lu) ; ses quatre appelants inchangés. | une relecture par plateforme |
| A-2 | Table d'atterrissage | `livraison_plateformes (campaign_id uuid FK cascade, plateforme text check (dv360,ttd,meta,tiktok), jour date, maille text check (cp,departement,region,iris,unite), code text, impressions bigint ≥ 0, depense numeric(12,4) ≥ 0, lu_le timestamptz default now(), PK (campaign_id, plateforme, jour, maille, code))` ; devise contrôlée à l'entrée (EUR), pas stockée. Pas de RLS active (route admin seule). | une colonne |
| A-3 | États d'une plateforme | `non_connectee` (aucune connexion utilisable dans l'espace : « Aucune donnée remontée — <plateforme> non connectée. »), `sans_connecteur` (connectée mais aucun adaptateur enregistré : « Aucune donnée remontée — connecteur <plateforme> pas encore installé. »), `non_liee` (« Liez la campagne <plateforme> à l'étape ⑥ pour remonter ses données. »), `a_venir` (TTD), `aucune_donnee` (adaptateur présent, aucune ligne), `ok`. | un état de plus |
| A-4 | Prévu par niveau | Impressions de la plateforme = budget ÷ CPM × 1 000. **Au CP** : sur SES CP bruts au prorata des multiplicateurs, plus forts restes. **Autre maille d'achat** : sur les CP canoniques du plan au prorata de `pop_en_zone`. Département, région = sommes des CP. **IRIS** = prévu du CP × population de l'IRIS ÷ population des IRIS du CP (IRIS dont le point intérieur est dans le CP, `is_true_iris`). **Unité** (polygone, cercle) = impressions de la plateforme au prorata de `pop_en_zone` de ses unités retenues. Jamais `planned_share`. | une règle du noyau |
| A-5 | Plafond de la descente | Niveaux `region → departement → cp → iris` (ou `unite` à la place de la chaîne pour une plateforme qui rapporte par unité) ; plafond = `maille_rapport`, et la région si la plateforme n'achète pas au CP (prévu agrégé seulement). « Toutes plateformes » = région. Note à l'écran : « Meta ne rend pas le code postal : la descente s'arrête à la région. » | un libellé |
| A-6 | Écart par territoire | Écart de **répartition** (Q-3) : prévu à date = part prévue × livré total de la plateforme ; `ecart_pct = (livré − prévu à date) ÷ prévu à date × 100` ; `hors_plan` ; `retard_imps = max(0, prévu à date − livré)`. | une formule |
| A-7 | Liste des plus en retard | Au niveau affiché, triée par `retard_imps` décroissant, 7 lignes puis « Voir les N … » en mémoire ; clic = descendre. | un tri |
| A-8 | Rythme et alertes | Au dernier jour relevé : `temps_pct`, `budget_pct`, `volume_pct`, `indice` ; retard < 0,85 / < 0,70, avance > 1,15 / > 1,30 (seuils de `get_campaign_suivi`) ; zone sous-livrée = constat `sous_pression` de React ; CPM réel > prévu × `SEUIL_CPM_CHER`. | des seuils importés |
| A-9 | Alignement | `calculerAlignement` sur les CP d'une plateforme au CP ; variation 7 j ou `null` ; pas de `sur_pression_eur`. Hors CP : « Score calculé au code postal : non disponible pour <plateforme>. » | un bloc masqué |
| A-10 | Relevé | `releverCampagne(supabase, campagneId, { onProgres })` : plateformes cochées ayant un adaptateur ET une connexion utilisable ET des liens ; jours du début à `min(fin, hier)`, puis seulement les **3 derniers** après le premier relevé complet (Q-12) ; lignes validées (Review Focus 4), upsert par lots ; l'erreur d'une plateforme est journalisée et n'arrête pas les autres. Inngest et bouton appellent la même fonction. | une fenêtre |
| A-11 | Inngest | `releve-livraisons-quotidien`, cron `TZ=Europe/Paris 0 6 * * *` ; step `lister` (registre vide → rend « Aucun connecteur enregistré : rien à relever. » et s'arrête) ; un step par campagne en vol relevable, séquentiels, `retries: 2` ; compteurs par `logDspEvent`. | un horaire |
| A-12 | Campagne hors parcours / vide | Sans `extraction_id` : « Cette campagne n'a pas été lancée depuis une extraction : son suivi reste dans l'application actuelle. » + lien `ONGLET_REACT.live`. Période future : « La campagne commence le <date>. » | un message |
| A-13 | Grande carte | Couche `live`, zoomable : polygones de `ContoursZonesService` au niveau affiché (régions ; départements d'une région ; CP d'un département), IRIS par les tuiles IRIS existantes (filtre sur les codes du CP, `match` de couleur) ; couleur par `trancheDivergente` de l'écart, `--donnee-absente` sans prévu ni livré ; clic = descendre et cadrer ; retirée hors de ⑧. | une couche |
| A-14 | Pastille et bandeau | Pastille ⑧ : ≥ 1 jour relevé. Bandeau : livré / prévu, dépensé / budget, CPM réel / prévu, jours restants, dernier jour relevé. | du texte |

---

## Questions pour Vincent (ouvertes ; recommandation entre crochets)

| # | Question | Ce qui en dépend | Recommandation |
|---|---|---|---|
| Q-8 | Sans adaptateur, l'écran **rempli** ne peut pas être montré dans le navigateur. Preuve du lot = specs Angular sur une réponse de test + tests d'intégration sur lignes de test + preuve navigateur des états vides ; la preuve remplie au premier adaptateur du développeur ? | T7 | **[Oui.]** |
| Q-9 | Le contrat fixe la dépense = **coût total annonceur** en EUR (ce que couvre le budget de ⑥), pas le coût média seul ? | contrat | **[Oui.]** |
| Q-12 | Chaque matin, relire les **3 derniers jours** (chiffres corrigés après coup par les plateformes) ? | A-10 | **[Oui.]** |
| Q-13 | Prévu à l'**IRIS** = prévu du CP réparti par la population des IRIS dont le point intérieur est dans le CP (aucune table IRIS ↔ CP) ? | A-4 | **[Oui.]** |

En attendant les réponses, le plan applique les recommandations.

---

## File Structure

| Fichier | Responsabilité | Tâche |
|---|---|---|
| `sql/288_livraison_plateformes.sql` (créé ; numéro à reconfirmer) | `livraison_plateformes`, `plateformes_geo.maille_rapport` + valeurs, index couvrant s'il paie, RPC `livraison_agregee_jsonb(p_campagne, p_cps text[])` (livré par plateforme / maille / code, total, 7 j et 7 j précédents ; par plateforme / jour ; département et région des CP demandés ∪ livrés ; borne 20 000 + `tronque`), RPC `iris_du_cp_jsonb(p_cp text)` (IRIS du CP et leur population) | T1, T2 |
| `lib/supabase/ecrire-par-lots.ts` (créé) ; `lib/simulation/serveur.ts` (modifié) | lots de 50, 3 en parallèle | T1 |
| `lib/optimisation/adaptateurs/{types,registre}.ts` (créés) | le contrat documenté, le registre vide | T1 |
| `lib/campagne/live/campagne-live.ts` (créé) ; `lib/zones/cp-plateforme.ts` (modifié) | lecture serveur de la campagne de ⑧ (stratégie, extraction, période, canaux, liens, connexions de l'espace, plan, CP et unités par plateforme) | T1 |
| `lib/optimisation/noyau/{prevu,suivi}.ts` (créés) ; `lib/campagne/constats.ts` (export) | prévu par niveau, descente, écart, retard, rythme, alignement, alertes — PURS | T2 |
| `app/api/campaigns/[campaignId]/live/route.ts`, `…/live/iris/route.ts` (créés) | lecture de ⑧ | T2 |
| `lib/campagne/live/relever.ts`, `app/api/campaigns/[campaignId]/live/relever/route.ts`, `lib/inngest/functions/releveLivraisonsQuotidien.ts` (créés) ; `app/api/inngest/route.ts` (modifié) | relevé | T3 |
| `tests/unit/{supabase,optimisation}/**`, `tests/integration/live-*.test.ts` | — | T1-T3 |
| `angular/.../carte/data/live.api.ts`, `etat/live-campagne.service.ts`, `logique/live/{vue,textes}.ts`, `panneaux/live/{panneau-live,releve-livraisons,bandeau-live}.component.ts`, `testing/live-factice.ts` (+ specs) ; `carte.page.html`, `logique/parcours.ts`, `carte.fournisseurs.ts`, `carte.page.ts` (une ligne), `app.routes.ts` | état, squelette, relevé, bandeau | T4 |
| `angular/.../carte/panneaux/live/{bandeau-avancement,cout-rythme,qui-a-diffuse,score-alignement,trois-composantes}.component.ts` (+ specs) | chiffres | T5 |
| `angular/.../carte/panneaux/live/{barre-maille,territoires-retard,constats-live}.component.ts`, `couches/{couche-live.ts,live-carte.service.ts}` (+ specs) | descente et carte | T6 |
| `ARCHITECTURE.md`, `angular/src/app/features/carte/README.md` | T1-T3, T7 | — |

---

## Pièges Angular / AIDA (à recopier dans CHAQUE brief de tâche Angular)

- Contrat AIDA : aucun `position: fixed`, aucun écouteur `window`/`document`, aucun `localStorage` neuf, aucun portail hors de l'arbre, services d'état fournis par la page, services d'API dans `FOURNISSEURS_DISTANTS`, `HttpBaseService.baseUrl`, pas de `@angular/core/rxjs-interop`.
- **Aucune lecture avant la validation de l'espace** (patron `ActivationCampagneService.validee`).
- **Aucune formule dans Angular** : le relecteur grep `/ 1000`, `* 100`, `0.85`, `1.25` dans `logique/live/` et `panneaux/live/`.
- **Aucune donnée de démo** : les doublures (`testing/live-factice.ts`) vivent dans les specs seulement.
- MapLibre reçoit des couleurs CALCULÉES (`CouleursService`) ; palette divergente importée de `features/risques/logique/palette-divergente.ts` ; IRIS par la source de tuiles existante (zoom ≥ 9, filtre `niveau = 'iris'`, piège R-9 du lot 4). Texte de statut sur fond clair : `--text-primary`, la couleur de statut pour le point et la bordure.
- Barres (avancement, plateformes, territoires) en **HTML/CSS**, comme React ; `graphiques/` n'a ni barres ni aires.
- Lecture annulable ; NDJSON par `lignesNdjson` ; dérivées en `computed` ; `inject()` jamais après un `await` ; formats par `core/format/*`.
- Le panneau de ⑧ reste MONTÉ hors de l'étape ; la couche `live` se retire quand on quitte ⑧.

---

## Groupe A — serveur (relecture 1)

### Task 1 : table, maille de rapport, contrat et registre, lecture de la campagne

- [ ] Tests d'abord : `ecrire-par-lots.test.ts` (101 lignes → 3 lots, ≤ 3 en vol, erreur de lot levée, progression cumulée) ; `adaptateurs-etat.test.ts` (`etatPlateforme` : `non_connectee`, `sans_connecteur`, `non_liee`, `a_venir`, `ok` selon connexion, registre et liens) ; registre livré vide (un test l'affirme, il se met à jour quand le développeur ajoute un adaptateur).
- [ ] `sql/288_livraison_plateformes.sql` : table, colonne et valeurs (dv360 cp ; meta, tiktok region ; ttd null), RPC d'agrégats ; `EXPLAIN (ANALYZE, BUFFERS)` de la descente nationale avec et sans index couvrant `(code_postal) include (code_dept)`, ne le garder que s'il paie ; compléter `troncature-postgrest.test.ts`.
- [ ] `types.ts` (le contrat ci-dessus, JSDoc complet : unités, fuseau, devise, idempotence attendue, « n'écrit jamais en base »), `registre.ts` (vide), `ecrireParLots` extrait (`insererLignes` inchangé), `lireCampagneLive` (A-1, 404 d'espace, 409 `hors_parcours`).
- [ ] `tests/integration/live-campagne.test.ts` (campagne de test créée et supprimée) : plan lu une fois ; DV360 72 CP ; unités TTD (1 polygone) ; `hors_parcours` ; autre espace → 404.
- [ ] `ARCHITECTURE.md` (table, colonne, contrat, registre) ; tsc, unitaires, intégration (codes de retour lus sans pipe). Commit `feat(api): ⑧ table des livraisons et contrat lireLivraison (lot 8, T1)`.

### Task 2 : la lecture de ⑧ — prévu, descente, retard, rythme, alignement

**Interfaces :** `GET …/live` → `{ campagne: { id, nom, debut, fin, dernier_jour, lu_le, jours_ecoules, jours_total, temps_pct }, plateformes: PlateformeLive[], total, descente: Record<string /* plateforme | 'toutes' */, { plafond: MailleRapport; note: string | null; region: Territoire[]; departement: Territoire[]; cp: Territoire[]; unite: Territoire[] }>, alertes: Alerte[], tronque }` ; `PlateformeLive = { code, libelle, etat, message, maille_rapport, budget, cpm_prevu, impressions_prevues, impressions_livrees, depense, cpm_reel, rythme, alignement | null }` ; `Territoire = { code, nom, parent, prevu, livre, depense, ecart_pct, retard_imps, hors_plan }` (listes triées par `retard_imps`) ; `Alerte = { type: 'retard' | 'avance' | 'sous_livree' | 'cpm'; plateforme; severite; titre; detail; cible }`. `GET …/live/iris?plateforme=&cp=` → `{ cp, plafond_atteint: boolean, iris: Territoire[] }` (prévu toujours ; livré seulement si la plateforme rapporte à l'IRIS, sinon `plafond_atteint` et la note).

- [ ] Tests d'abord : `noyau-prevu.test.ts` (4 plateformes de la campagne mesurée = 6 147 998 ; `repartitionParCp` = Angular, somme exacte ; deux plateformes au CP indépendantes — Review Focus 2 ; `repartitionParPopulation` sans membres non canoniques ; IRIS et unité, sommes exactes) ; `noyau-suivi.test.ts` (descente et plafond — Review Focus 3 ; écart de répartition, `hors_plan`, `retard_imps`, tri ; rythme et seuils ; sous-livrée = texte de `constatSousPression` ; alignement = `calculerAlignement` ; plateforme sans ligne → son état A-3).
- [ ] `lib/optimisation/noyau/{prevu,suivi}.ts` (purs ; en tête de `prevu.ts` : « copie verrouillée d'`angular/…/logique/plan/impressions.ts` et de `computeForecast` ») ; export de `constatSousPression` ; RPC `iris_du_cp_jsonb` (`EXPLAIN` noté) ; routes `live` (séquentielle, `no-store`) et `live/iris` (quota) ; étendre `plan-logique-paritaire.test.ts` au noyau.
- [ ] `tests/integration/live-suivi.test.ts` : lignes de livraison **de test** sur une campagne de test, supprimées en fin de test → payload attendu à chaque niveau (dont `iris` et `unite` sur des lignes de test à ces mailles) ; national (jeu risque, 2 595 CP, 30 jours de lignes de test) : < 1 s, < 500 Ko, buffers notés ; aucune connexion → `non_connectee` partout, payload vide valide.
- [ ] `ARCHITECTURE.md` ; tsc, unitaires, intégration. Commit `feat(api): ⑧ suivi des livraisons en descente (lot 8, T2)`.

### Task 3 : le relevé — service, bouton, tâche Inngest quotidienne

- [ ] Tests d'abord, avec des adaptateurs **factices définis dans les tests** : fenêtre de jours A-10 ; ligne hors maille, hors période, future, devise ≠ EUR, code inconnu → refusée et comptée (Review Focus 4) ; erreur d'une plateforme n'arrête pas les autres et n'efface rien ; idempotence ; registre vide → « Aucun connecteur enregistré : rien à relever. », 0 écriture (Review Focus 1) ; Inngest : un step par campagne relevable, séquentiels (Review Focus 5).
- [ ] `lib/campagne/live/relever.ts`, route `relever` (super_admin 403, quota `geo:rl:live-relever` 2/min, un relevé à la fois par campagne, NDJSON `debut` / `progression` / `fin` / `erreur`), `releveLivraisonsQuotidien.ts` (patron `civicDailyIngest`), enregistrement dans `app/api/inngest/route.ts`.
- [ ] Intégration : bouton sur la campagne mesurée → 4 plateformes, états A-3, 0 ligne ; non super_admin → 403 ; passe Inngest à vide mesurée (une requête, 0 écriture).
- [ ] `ARCHITECTURE.md` (tâche planifiée, route, « le registre est vide tant que le développeur n'a pas livré ») ; tsc, unitaires, intégration. Commit `feat(api): ⑧ relevé des livraisons, quotidien et à la demande (lot 8, T3)`.

**Relecture 1** (T1-T3) : une ligne peut-elle naître sans adaptateur enregistré ? un appel sortant vers une plateforme s'est-il glissé ? le prévu touche-t-il `planned_share` ? `insererLignes` inchangé ? la RPC peut-elle tronquer sans le dire ? le contrat est-il assez documenté pour qu'un développeur l'implémente sans lire le reste du lot ?

## Groupe B — Angular (relecture 2)

### Task 4 : API, état, squelette de ⑧, relevé, bandeau

- [ ] Specs d'abord : `vue.spec.ts` (descente DV360 région → département → CP → IRIS ; Meta plafonnée à la région avec sa note ; « toutes » à la région ; parent inconnu → région) ; `textes.spec.ts` (états A-3 et A-12 mot pour mot) ; service : rien avant l'espace validé ; autre espace → aucun appel ; réponse tardive ignorée ; relevé lié à SA campagne (Review Focus 6) ; relecture après `fin` ; cache par campagne et IRIS par CP ; panneau : sans campagne → renvoi ⑥ ; `hors_parcours` → message + lien ; période future ; aucune donnée → « Aucune donnée remontée — plateforme non connectée. » (ou le message de l'état) + lien vers Connexions API ; bouton « Relever maintenant » (super_admin) avec `mg-barre-progression` et l'état de chaque plateforme, « Aucun connecteur enregistré : rien à relever. » ; bandeau A-14.
- [ ] `live.api.ts`, `LiveCampagneService`, `FOURNISSEURS_LIVE`, `@case ('live')`, `CONSIGNE_ETAPE.live` = « Suivez les impressions livrées et la dépense de chaque plateforme, comparées au plan. », `RENSEIGNEE_PAR.live`, une ligne dans `carte.page.ts`.
- [ ] `ng test`, `tsc`, `test:unit`. Commit `feat(angular): ⑧ état, squelette, relevé et bandeau du suivi (lot 8, T4)`.

### Task 5 : rythme, coût, plateformes, alignement

- [ ] Specs d'abord, textes et mesures de React à la lettre (lire chaque `.tsx`) : `BandeauAvancement` ; `CoutEtRythme` sans « coût du déséquilibre » ; `QuiADiffuse` par plateforme, avec l'état d'une plateforme sans donnée ; `ScoreAlignement` (« calculé au code postal », variation 7 j ou « inconnue », phrase A-9) ; `TroisComposantes` ; « Toutes plateformes » : pas de score, dit.
- [ ] Implémenter ; aucune formule. Commit `feat(angular): ⑧ rythme, coût, plateformes et alignement (lot 8, T5)`.

### Task 6 : descente, territoires en retard, grande carte

- [ ] Specs d'abord : barre de maille = sélecteur de plateforme + fil d'Ariane France › région › département › CP › IRIS (`mg-fil-ariane`), niveau au-delà du plafond grisé avec la note A-5 (Review Focus 3) ; « Territoires les plus en retard » (A-7) ; constats (≤ 3 sous-livrés + retard / avance / CPM, « Voir sur la carte » descend et cadre) ; couche `live` (A-13 : couleurs par tranche, absence, clic = descendre, cadrage, retrait hors de ⑧, couleurs recalculées au changement de thème, IRIS par tuiles au zoom ≥ 9) ; contours CP lus seulement en descendant dans un département, IRIS seulement en descendant dans un CP.
- [ ] Implémenter. Commit `feat(angular): ⑧ descente, territoires en retard et carte (lot 8, T6)`.

**Relecture 2** (T4-T6) : une lecture part-elle avant la validation de l'espace ? une formule ou une donnée de démo s'est-elle glissée ? la descente peut-elle dépasser le plafond ? palette importée, pas recopiée ? contraste en thème clair ?

## Task 7 : revue finale, factorisation, preuve navigateur

- [ ] Revue finale (modèle le plus capable) : mineurs, factorisation inter-tâches. Dupliqué à dessein : `impressionsPrevues` / `repartitionParCp` (noyau, Angular ⑥, React), verrouillés par parité. Laissé pour React jusqu'à la bascule : écran de suivi React, `lib/dsp/report/*`, `simulate_dsp_report`, `/api/digital/[id]/suivi`, `alignement*`.
- [ ] **Preuve navigateur, deux thèmes** (`L8-T7-*`), sans aucune donnée inventée (Q-8) : campagne lancée en ⑥ (BMW GROUP, extraction des lycées BdR) → ⑧ : états honnêtes par plateforme (« non connectée », « connecteur à venir » pour TTD), lien Connexions API ; « Relever maintenant » → « Aucun connecteur enregistré : rien à relever. » ; campagne de seed → message hors parcours et lien ; campagne d'un autre espace → message de ⑥, aucun appel à `…/live` ; la grande carte reste la carte du parcours, sans couche `live` vide trompeuse. L'écran **rempli** est prouvé par les specs Angular et les tests d'intégration ; sa preuve navigateur est inscrite au registre pour le premier adaptateur du développeur.
- [ ] `ARCHITECTURE.md`, `README.md` de la carte (§ ⑧, contrat, « à faire par le développeur »). Tests complets : `npm test`, `ng test`, `tsc`, `npm run build` (variables Supabase locales explicites), `ng build`. Inngest local : la fonction apparaît et s'exécute à vide.
- [ ] Commit `docs: ⑧ Live — revue finale et preuve navigateur (lot 8, T7)`.

---

## Estimation

| Groupe | Tâches | Charge |
|---|---|---|
| A serveur | T1, T2 (dont IRIS et unité), T3 | 1,7 j |
| B Angular | T4, T5, T6 | 1,4 j |
| Fin | T7 | 0,4 j |
| **Total** | **7 tâches, 2 relectures + revue finale, 1 preuve** | **≈ 3,5 jours** |

## Critères de fin du lot

⑧ affiche, pour une campagne lancée en ⑥, ce que contient `livraison_plateformes` — rien d'autre — avec livré contre prévu, dépense, CPM, rythme, alertes, alignement au CP et une descente région → département → CP → IRIS (ou unité) plafonnée à la maille rapportée, sur la grande carte et dans la liste des territoires en retard ; le contrat `lireLivraison` est documenté et le registre vide ; la tâche Inngest tourne chaque matin, un step par campagne, et dit qu'elle n'a rien à relever tant qu'aucun adaptateur n'est enregistré ; sans donnée, un état vide honnête qui dit quoi faire ; le prévu vient du noyau, jamais de `planned_share` ; aucune donnée de démo, aucune simulation, aucun connecteur, aucun calcul dans le navigateur ; React inchangé ; tests et builds verts ; preuve navigateur des états vides dans les deux thèmes, preuve remplie au premier adaptateur.

## À venir (hors lot)

Les quatre adaptateurs (section « À faire par le développeur »), dont **The Trade Desk** à la réception de sa doc. Boucle d'optimisation (`lib/optimisation/boucle.ts`, `appliquerPoids`, `optimisation_cycles`, marches 1-3 de l'Excel). Autres KPI ; ad server et réconciliation ; « Recaler » ; constats `sur_pression` / `canal_cher` ; coût du déséquilibre ; pression par classe ; zones météo recalculées ; « mode pays » (④/⑤).
