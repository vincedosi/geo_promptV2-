# La carte en parcours — lot 5 « ⑤ Jeu de zones » — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** à l'étape ⑤ de la carte Angular, FIGER ce qui sera acheté : partir d'UNE zone enregistrée (n'importe quelle recette de ③), montrer côte à côte, plateforme par plateforme (DV360, The Trade Desk, Meta, TikTok), ce que chacune accepte, un lien vers sa doc officielle, la maille que l'utilisateur CHOISIT et **ce que cette maille fait perdre** (habitants de la zone manqués, diffusion achetée hors zone, taux d'utile) ; enregistrer le jeu de zones ; en tirer une extraction versionnée immuable qui fige les unités de chaque plateforme (ce que les exports du lot 6 liront).

**Architecture:** la conversion n'est PAS un nouveau moteur : c'est la couverture du lot 4 (`couverture_geometrie`, table étroite `carreau_couverture`) LUE dans une maille, plus un seuil appliqué CÔTÉ CLIENT (le seuil se rejoue sans aucune requête). Deux découpages neufs (`commune`, `departement`, dénominateurs déjà construits dans `unite_population_totale`) et une seule brique neuve lourde, `paver_cercles` (pavage hexagonal d'une zone en cercles, perte exacte sur l'union des cercles). Une table `plateformes_geo` porte les capacités (jamais en dur). `zone_sets` gagne un `type` (`risque` | `zone`) : le moteur risque n'est PAS touché, il est caractérisé puis cohabite ; un jeu de zone = une zone (`custom_geo_zone_id`, colonne déjà là et déjà lue par `zone_referencee`) + un choix par plateforme (`zone_set_plateformes`) ; l'extraction écrit ses CP dans `zone_set_extraction_cp` (existant) et les autres unités dans `zone_set_extraction_unites`. Côté Angular : le panneau `mg-panneau-jeu` remplace « bientôt » à l'étape `jeu`, un `JeuZonesService` fourni par la page, reflété dans `?jeu=`, `?zoneJeu=`, `?mailles=`, une couche qui peint la zone exacte et les unités de LA plateforme regardée.

**Tech Stack:** Angular 21.2 standalone zoneless signals, Tailwind 4, Vitest (`cd angular && npx ng test --watch=false`) ; Next.js 15 (routes API), supabase-js, Zod, Vitest racine (`npm run test:unit`, `npm run test:integration`) ; PostgreSQL 17.6 + PostGIS local (`docker exec supabase_db_genesis_app psql -U postgres`).

**Spec:** `docs/superpowers/specs/2026-10-13-carte-en-parcours-design.md` — **§ 16 fait foi** (16.1 ligne ⑤ : « l'utilisateur choisit la maille plateforme par plateforme ; lien vers sa doc officielle ; ce que la maille choisie fait perdre » ; 16.2 règles 1, 2, 3, 5 ; 16.5 lot 5), § 8 (tableau natures × plateformes, À VÉRIFIER), § 17 quater (écarts du lot 4), § 18 (onglets et dossiers : APRÈS ④→⑧ depuis le 19/10 — on ne les construit pas, on ne fait rien qui les empêche : tout l'état neuf est dans l'URL du § 5). Sommaire d'origine : `docs/superpowers/plans/2026-10-14-carte-en-parcours-lot-3.md`, « ### Lot 5 » (7 points). Mémoires : `reference_dsp_maille_geo`, `feedback_polygones_pas_que_cp`, `project_convertisseur_zones_plan`, `project_jeux_de_zones`, `project_conversion_cp_phases` (cinq pièges), `project_coeur_du_produit`, `feedback_agents_frugaux`, `feedback_angular_vigilance`.

---

## Pré-vol : ce qui existe vraiment (reconnaissance du 24/10, worktree `carte-jeu-de-zones` = `f07443ba`)

Dernière migration **sql/273** (sql/271 repliée dans 270 par la vague finale du lot 4) : le premier numéro libre est **274**, à revérifier à chaque tâche (`ls sql | sort -V | tail -3`).

### Base (locale, lue le 24/10)

| Objet | Ce qu'il est | Réutilisé ? |
|---|---|---|
| `zone_sets` | jeux du module risque : `profil jsonb NOT NULL`, `profil_hash NOT NULL`, `gravites/natures/modes`, `territoire`, `mode_plan` (`pondere`/`exclusif`), `seuil_couverture_cp`, `poids`, `brouillon`, **`custom_geo_zone_id uuid` (déjà là, jamais rempli)** ; 4 lignes dont 2 jeux nommés (« Seveso France — test phase 4 », « Seveso haut + bas — 5 km ») | OUI, généralisé par un `type` |
| `zone_set_cp` | une ligne par CP × grappe ; `classe`, `cluster_id` **NOT NULL, dans la clé primaire** ; 6 908 lignes | NON pour les jeux de zone (une clé primaire ne se rend pas nullable sans la refaire) |
| `zone_set_clusters`, `zone_set_geoms`, `zone_set_simulations` | propres au risque (grappes, anneaux, simulation 62 → 89) | non touchés |
| `zone_set_extractions` (4 lignes) + `zone_set_extraction_cp` (9 190) | extraction immuable (déclencheur `zse_refuser_update`), empreinte md5 des `cp:multiplicateur`, `cluster_id` et `cluster_rang` **déjà facultatifs** ; écrite par `creer_zone_set_extraction(p_zone_set_id, p_lignes, p_resume, …)` | OUI : les CP de tout jeu y vont |
| `remplir_zone_set_cp` / `appliquer_seuil_zone_set` / `construire_zone_set` | le moteur risque : carreaux classés par `classe_carreau_risque` sur `carreau_risque_distance`, rattachés à la grappe la plus proche, seuil appliqué en base | **non touchés** (caractérisés en T1) |
| `couverture_geometrie(zone, org, cible, decoupage ∈ forme|cp|iris, max)` → jsonb | lot 4 : `lignes [{code, nom, pop_en_zone, pop_totale, part}]`, `hors_territoire`, `reference`, refus `zone_trop_vaste` (> 100 000 km²), `trop_de_carreaux` ; carreaux par `carreaux_de_forme` (centroïde, `ST_Subdivide` 256, `distinct on`) | OUI : c'EST le convertisseur CP/IRIS |
| `couverture_zone` / `couverture_zone_en_cache` / `couverture_zone_cache` | cache par (zone, `updated_at`, construction, cible, découpage), contrôle d'espace en SQL | OUI, étendu aux deux découpages neufs |
| `carreau_couverture` | 2 324 577 carreaux : `centroide_3857`, `code_postal` (canonique), `code_iris`, **`code_commune`, `code_departement`**, `pops real[24]` | OUI |
| `unite_population_totale` | dénominateurs **commune 34 918 · département 98 · région 15 · IRIS 48 872**, même règle que les numérateurs | OUI (commune, département) |
| `ref_communes` (GIST `geom`), `get_zone_polygons(scale ∈ region|departement|cp)` | contours ; **aucune source nationale de contours de communes** côté carte | `ref_communes` pour les communes retenues (borne 3 000) |
| `zone_referencee(zone)` | lit DÉJÀ `zone_sets.custom_geo_zone_id` → `'jeu_de_zones'` : une zone d'un jeu ne se recalcule ni ne se supprime (spec A-2) | OUI, gratuit |
| `custom_geo_zones` | 7 zones locales (toutes d'avant le lot 3, `recette` NULL) ; aucune `rayon_poi` : les preuves en créeront | — |
| Recettes (`lib/zones/recette-schema.ts`) | `rayon_point`, `rayon_poi`, `seuil_carreaux`, `seuil_territoire`, `codes_postaux`, `dessin`, `import`, `isochrone`, `combinaison`, `capture` | la recette dit si une maille est EXACTE (A-6) |

### Routes et code serveur

- `/api/zones/jeux` (GET liste ≤ 200 non-brouillons ; POST construit un jeu risque, quota `geo:rl:zone-sets` 6/min, brouillon par `profil_hash`), `/api/zones/jeux/[id]` (GET lit `zone_set_cp` par `lireTout`, PATCH seuil/poids/mode → `appliquer_seuil_zone_set`, DELETE), `…/extractions` (GET, POST : `genererPlanCp` puis `creer_zone_set_extraction`), `…/export`, `…/cp-geo`, `…/grappes`, `…/rattacher`, `…/simulation` — **tous lisent `zone_set_cp` et `normaliserJeu` (profil risque)**. Aussi `app/api/campaigns/[campaignId]/pression-classes/route.ts` lit `zone_sets`.
- `lib/zones/jeu.ts` : `JeuDeZonesSchema` (profil risque obligatoire), `MOTIF_CLASSE` (`haut|bas|autres:…` ou `hors`), `poidsDeClasse`, `normaliserJeu`, `codeJeu`. `lib/zones/plan.ts` : `genererPlanCp(entrees, jeu, membres)` — **ne lit du jeu que `mode_plan` et `poids`** (via `poidsDeClasse`) : réutilisable tel quel pour un jeu de zone si son type d'entrée est rétréci. `plierParCodePostal`, `tauxUtile`, `lireGroupesCp` (groupes `cp_groupe`).
- `GET /api/zones/[id]/couverture` (lot 4) : quota `geo:rl:couverture` 6/min APRÈS le cache ; `lib/zones/couverture.ts` : `DECOUPAGES`, messages, `statutDuRefus`.
- Aucune trace de `plateformes_geo` ni d'un registre des plateformes dans le code.

### Angular

- `logique/parcours.ts` : l'étape `'jeu'` existe ; `carte.page.html` la rend par `@default { <mg-etape-bientot> }`. `carte.page.ts` **372/400** lignes (plafond `taille-fichiers.test.ts`) — tout ajout passe par `carte.fournisseurs.ts` ou un fichier voisin.
- `etat/zone-analysee.service.ts` (lot 4) : patron EXACT d'un état de page reflété dans l'URL (`?zoneAnalyse=`), annulation + jeton ; `etat/ecrire-parametres.ts` : SEUL écrivain de paramètres (P-g fermé).
- `panneaux/analyse/choix-zone-analysee.component.ts` : sélecteur de zone réutilisable (liste lue au 1er clic). `couches/couche-couverture.ts` + `couverture.service.ts` : peinture CP (5 classes `--seq-*`, `ContoursZonesService`), IRIS (`minzoom 9`, `niveau = 'iris'`), contour de zone.
- Module risque : `features/risques/etapes/zones/*` (`dilution` 88 l., `mode-plan` 52 l., `panneau-extractions` 313 l., `actions-jeu`, `bibliotheque`, `tableau-classes`), `etat/atelier-jeux.service.ts`, `data/jeux-zones.api.ts` — `mg-dilution` et `mg-mode-plan` sont génériques (entrées numériques), `panneau-extractions` est lié à `JeuxZonesApi`.
- Boîte à outils « Mes zones » : `panneaux/zones/jeux-de-zones.component.ts` (« Jeux de zones à risque », ouvre le module risque).

### Écarts au sommaire (corrigés par ce plan)

| # | Le sommaire dit | La réalité | Ce que fait ce plan |
|---|---|---|---|
| E1 | « `zone_sets` généralisé : `profil`… facultatifs, `zone_set_cp.classe/cluster_id` facultatifs ; remplissage par `couverture_geometrie` » | `cluster_id` est dans la CLÉ PRIMAIRE de `zone_set_cp` ; la rendre nullable = refaire la clé d'une table que sept routes lisent. Et un jeu de zone n'a pas besoin de lignes stockées : sa conversion se relit en < 1,1 s (en cache ensuite) et ne se fige qu'à l'extraction. | A-2 : pas de `zone_set_cp` pour un jeu de zone ; les unités vivent dans l'EXTRACTION. Le moteur risque garde ses tables intactes. |
| E2 | « caractérisation Seveso (simulation 62 → 89) » ; le lot 4 notait 4 chiffres contradictoires (1 102/73,1 · 1 112/72,3 · 1 113/75,9 · 939/88,4) | **Mesuré le 24/10** : le jeu « Seveso France — test phase 4 » (profil haut 1/2/5 km + bas 0,5/1 km, gravité `seveso_haut`) rend **1 102 CP / 73,1 %** au seuil 20 et **931 / 79,8 %** au seuil 35 ; RECONSTRUIT de zéro (transaction annulée), il rend exactement les mêmes chiffres (1 927 CP touchés, 13 430 921 hab.). Les autres chiffres portaient sur d'autres profils. | T1 fige ces deux paires + l'empreinte de l'extraction v1 (`8ccfe4b8…`, part du plan en zone 60,6 %). |
| E3 | « Mailles par plateforme… paliers pour Meta et TikTok » | Un palier n'a de sens qu'avec des POIDS différenciés. La source de poids du jeu de zone est uniforme en v1 (registre ouvert de sources : hors lot) : il n'y a qu'UN palier. | A-9 : paliers hors lot ; la contrainte TikTok « ≥ 1 000 personnes par groupe » est vérifiée sur le palier unique (avertissement). |
| E4 | « brique `paver_cercles(geom, rayon_min, rayon_max, n_max, pop_min)` » (rayon choisi par la brique) | Choisir le rayon = essayer une échelle de rayons : mesuré 3,0 s / 28 000 accès + 80 Mo de tri sur disque pour 11 rayons sur 5 000 km² (marge 80 km). | A-8 : UN rayon par appel (choisi par l'utilisateur), refus si le nombre de cercles dépasse la limite de la plateforme ; rayon automatique = suivi hors lot (Q-M). |
| E5 | Lot 4, A-10 : « redirection `carte/risques` au lot 5, quand ⑤ remplace l'étape Zones » | ⑤ ne remplace pas l'étape Zones du risque : les jeux risque (classes, grappes, poids par classe, simulation) n'ont pas d'équivalent dans un jeu de zone, et ⑥ Plan n'existe pas encore. | A-12 : pas de redirection au lot 5 ; les jeux risque sont LISTÉS en ⑤ et s'ouvrent dans le module. |

---

## Mesures (base LOCALE, `EXPLAIN (ANALYZE, BUFFERS)` et chronos psql, 24/10)

Poste sous pression mémoire (**84 Mo de RAM libre** au démarrage du stack Docker, relancé pour ces mesures). Prototypes en tables TEMPORAIRES ou transactions annulées ; rien n'est resté en base. « Accès » = `shared hit + read`.

**M1 — Conversion CP par la couverture existante** (`couverture_geometrie(…, 'cp', 400 000)`, base froide) : quatre zones (382 · 1 888 · 5 000 · 13 000 km²) en **2,2 s au total**. Le lot 4 mesurait déjà : Bouches-du-Rhône CP 95-100 ms, ARA forme 0,79-0,96 s, IRIS 0,93-1,10 s.

**M2 — Ce que la maille CP fait perdre, selon le seuil** (calcul sur les `lignes`, sans requête de plus — c'est ce que fera le client) :

| Zone | Seuil | CP retenus / touchés | Taux d'utile | Habitants de la zone manqués | Diffusion achetée hors zone |
|---|---|---|---|---|---|
| « Cible composite (2 zones) », 13 000 km², 11 224 929 hab. | 0 % | 895 / 895 | 40,8 % | 0 | 16 305 578 |
| | 20 % | 617 / 895 | 57,6 % | 977 538 (8,7 %) | 7 541 431 |
| | 50 % | 358 / 895 | 76,6 % | 3 670 499 (32,7 %) | 2 302 112 |
| « CIRFA Bretagne » (isochrone), 5 000 km², 1 355 354 hab. | 0 % | 121 / 121 | 75,9 % | 0 | 429 532 |
| | 20 % | 94 / 121 | 87,4 % | 13 227 | 192 660 |
| | 50 % | 75 / 121 | 95,4 % | 79 634 | 61 338 |

**M3 — Découpages commune et département** (prototype : même lecture que `carreaux_de_forme`, `code_commune` / `code_departement` de la table étroite, dénominateur `unite_population_totale`) sur la composite : **0,60 s · 31 600 accès** (1 410 communes, 91 départements). Au seuil 20 : communes 854 retenues, 59,0 % d'utile, 860 285 manqués ; départements 15 retenus, **39,2 %**, 3 293 876 manqués. `carreau_couverture.code_commune` porte les ARRONDISSEMENTS (751xx, 132xx, 6938x : 36 codes) — TikTok les accepte-t-il ? à vérifier (Q-B).

**M4 — Contours des communes retenues** (`ref_communes`, `ST_SimplifyPreserveTopology(geom, 0.001)`, GeoJSON 5 décimales) : ≈ 400 communes en **65 ms · 3 900 accès, 242 Ko** → ≈ 0,6 Ko par commune, ≈ 1,8 Mo au plafond de 3 000 (limite TikTok par groupe).

**M5 — Pavage en cercles** (prototype grille carrée, cercle circonscrit `r = côté/√2`, échelle `1/cos(lat)` en 3857 ; cellules retenues au seuil 20 ; perte EXACTE sur l'union des cercles retenus) :

| Zone | Rayon | Cercles | Manqués | Hors zone acheté | Taux d'utile | Durée · accès |
|---|---|---|---|---|---|---|
| CIRFA Bretagne (5 000 km²) | 5 km | 141 | 3 129 | 183 680 | 88,0 % | **0,24 s · 25 400** |
| | 10 km | 44 | 11 998 | 319 060 | 80,8 % | 0,27 s · 25 900 |
| Composite (13 000 km², 91 départements touchés) | 5 km | 481 (> 200 Meta) | 807 602 | 12 274 456 | 45,9 % | 0,96 s · 108 300 |
| | 10 km | 167 | 865 173 | 15 236 721 | 40,5 % | 1,06 s · 120 000 |

Première écriture de la perte exacte (sous-requête `exists … ST_DWithin` contre une CTE sans index) : **11,5 s sur 5 000 km², 445 s sur 13 000 km²** — le piège est nommé en T4. La version retenue lit les carreaux de chaque cercle retenu par l'index (`&& ST_Expand` + `ST_DWithin`, `distinct on`).

**M6 — Moteur risque (caractérisation)** : `appliquer_seuil_zone_set` sur le jeu enregistré — seuil 20 → **1 102 / 73,1 % / 13 430 921** en 47 ms ; seuil 35 → **931 / 79,8 % / 12 793 361** en 55 ms ; « Seveso haut + bas — 5 km » seuil 20 → 1 687 / 80,0 %. **Reconstruction complète** du premier (`construire_zone_set`, transaction annulée) : chiffres IDENTIQUES, mais **259 s à froid** — au-delà des 60 s de Kong (la doc dit 7-21 s). Hors lot (le moteur risque n'est pas touché), consigné au registre comme suivi : l'atelier risque répondrait 504 à froid sur ce poste.

### Bornes déduites (écrites dans le code, verrouillées par test)

| Calcul | Borne | Pourquoi |
|---|---|---|
| Découpages `commune` / `departement` | celles de `couverture_geometrie` (≤ 100 000 km², ≤ 400 000 carreaux) | même lecture que CP (M3 ≈ M1) |
| `paver_cercles` | rayon ∈ [1 000, 80 000] m ; zone ≤ 100 000 km² ; **≤ 5 000 cellules candidates** (`limit + 1`, refus `trop_de_cercles`) ; seuil ∈ [0, 100] ; `pop_min` ≥ 0 | M5 : composite 5 km ≈ 1 200 candidates, 1 s ; le refus vient AVANT la lecture des cercles |
| Contours des communes retenues | ≤ **3 000** codes (limite TikTok par groupe), `limit + 1` | M4 : ≈ 1,8 Mo au plafond |
| Quota de la conversion en cercles | `geo:rl:conversion` **6 / min / compte** | ≈ 120 000 accès au pire mesuré × 6 ≈ 0,7 M / min, sous le budget du lot 3 (A-7 spec : ≤ 1,1 M) |
| Conversion CP / IRIS / commune / département | quota et cache de la couverture (`geo:rl:couverture`, 6/min APRÈS cache) | la conversion EST une couverture ; le seuil se rejoue côté client (0 requête) |
| Enregistrer un jeu, extraire | quota existant `geo:rl:zone-sets` 6/min ; extraction : au plus 4 conversions SÉQUENTIELLES (≤ 4 × 1,1 s) | jamais en parallèle (≤ 3 appels simultanés, CLAUDE.md) |

---

## Global Constraints

- Les huit étapes et leurs valeurs d'URL sont inchangées. Ce lot ne touche qu'à ⑤ `jeu` (et à « Mes zones » dans la boîte à outils). **Rien de l'existant n'est retiré** : le module risque, ses jeux, son atelier, ses extractions, sa simulation et le plan média des zones restent intacts. React gelé (P5) : aucun fichier de `app/map/**`, `components/**`, `lib/navigation/**`.
- **La forme exacte est la vérité** (§ 16.2-2) : ⑤ est le SEUL endroit qui traduit une zone dans une maille, et il dit toujours ce que la traduction perd. Une maille exacte pour la recette (A-6) affiche « exacte, aucune perte » — jamais un chiffre inventé.
- **Une seule règle d'attribution** carreau → territoire, celle du lot 4 (centroïde `ST_Centroid(geom_3857)`, CP canonique par `cp_des_points`, commune/département par le premier code de `lcog_geo`, IRIS par `ST_Contains`) ; un numérateur et son dénominateur rattachent le carreau au MÊME territoire ; `sum(pops[n]::numeric)`, jamais `sum(pops[n])` (piège 1 de `project_conversion_cp_phases`). Le taux d'utile se calcule sur les SEULES unités retenues, des deux côtés (piège 4).
- **Le moteur risque n'est pas modifié** : aucune ligne de `remplir_zone_set_cp`, `appliquer_seuil_zone_set`, `construire_zone_set*`, `creer_zone_set_extraction`. T1 le fige AVANT tout ; ses tests restent verts à chaque tâche.
- **Les règles des plateformes vivent dans `plateformes_geo`** (§ 16.2-3) : aucune limite (200 cercles, 1-80 km, 3 000 communes, ≥ 1 000 habitants…) écrite en dur hors de la migration de seed ; un test le verrouille (grep des nombres dans `lib/zones/conversion*.ts` et `angular/…/jeu/**`).
- PostgREST coupe à 1 000 lignes : toute RPC neuve rend `jsonb` ; une liste d'unités est rendue EN ENTIER ou refusée, jamais coupée ; `tests/unit/db/troncature-postgrest.test.ts` complété.
- I/O : `EXPLAIN (ANALYZE, BUFFERS)` en LOCAL sur chaque RPC neuve, chiffres dans le rapport (s'arrêter si un chiffre dépasse de plus de 50 % la mesure de ce plan) ; quotas par `lib/api/rate-limit.ts` ; ≤ 3 appels Supabase simultanés ; **ouvrir ⑤ ne lit rien** tant qu'aucune zone n'est choisie (la liste des zones et `plateformes_geo` se lisent à la première ouverture du sélecteur ou à l'arrivée d'une zone par l'URL, une fois par page) ; **déplacer une réglette de seuil ne lance AUCUNE requête** ; une réglette de rayon (cercles) ne lance sa requête qu'au RELÂCHEMENT.
- **Aucun `DROP`** de fonction, de table ou de contrainte nommée existante (base locale partagée) — exception écrite : `ALTER COLUMN … DROP NOT NULL` sur `zone_sets.profil` et `zone_sets.profil_hash` (T6), remplacé par une contrainte CHECK par type. `create or replace`, `add column if not exists`, migrations rejouables (appliquées DEUX fois, empreinte identique).
- Routes API : `export const dynamic = 'force-dynamic'`, Zod, `lireCorps()` pour un corps, `searchParams` par schéma Zod, garde `requireAuth(request)` DANS le source, espace = `profile.organization_id` (`espaceDeZone`), `createAdminClient()` depuis `@/lib/auth`, messages en français, détail Postgres seulement dans `console.error`, toute erreur supabase-js LUE (`delete()` compris). `middleware.ts` et `app/api/isochrone-battle/route.ts` ne sont pas touchés.
- Types : `types/database.types.ts` régénéré dans le commit de chaque migration (`npx supabase gen types typescript --db-url "postgresql://postgres:postgres@127.0.0.1:54322/postgres" > types/database.types.ts`) ; le diff n'ajoute QUE les objets de la migration.
- Angular / AIDA (skill `porting-react-to-angular` à charger avant T9-T12 : il n'y a pas d'écran React à porter — ⑤ est neuf —, mais le contrat AIDA et les pièges s'appliquent) : aucun `position: fixed`, aucun écouteur `window`/`document`, aucun `localStorage` neuf, services d'état fournis par la page (jamais `providedIn: 'root'`), services d'API dans `FOURNISSEURS_DISTANTS` et adresses par `HttpBaseService.baseUrl` UNIQUEMENT, pas de `@angular/core/rxjs-interop`, couleurs par jetons — MapLibre reçoit des couleurs CALCULÉES (`CouleursService`), jamais `var()` dans `paint`.
- **Pièges Angular nommés** (chaque brief les recopie) : (P-a) un `effect()` qui écrit un signal qu'il lit boucle — `untracked()` ; (P-b) zoneless : une réponse HTTP ne rafraîchit l'écran QUE par un signal ; (P-c) toute souscription est désabonnée au `DestroyRef` et toute réponse porte un JETON (la réponse d'une zone, d'une maille, d'un rayon ou d'un espace quittés n'est jamais affichée ni peinte) ; (P-d) `input()` se lit en fonction, jamais copié au constructeur ; (P-e) le panneau d'une étape reste MONTÉ : un résultat survit à ⑤ → ① → ⑤, une couche se retire au `DestroyRef` du SERVICE qui l'a posée ; (P-f) une couche posée avant le chargement du style est perdue — passer par le pont de carte (`PONT_CARTE`, `couches-carte.service.ts`) ; (P-g) `ecrireParametres` est le SEUL écrivain de paramètres : `?jeu=`, `?zoneJeu=`, `?mailles=` passent par lui, et un test écrit `?mailles=` et `?etape=` dans le même tick et exige les deux ; (P-h) **une réglette ne requête pas à chaque pixel** : seuil = calcul local, rayon = au relâchement + jeton ; (P-i) un `@for` sur des unités porte un `track` par CODE, jamais par index (5 498 IRIS d'ARA).
- Aucun fichier `.ts` non-spec d'`angular/src` au-delà de 400 lignes ; aucun fichier source (TS/SQL) neuf au-delà de 400 lignes.
- DESIGN_SYSTEM : sentence case, Inter + JetBrains Mono (chiffres), bordures 0,5 px, accent teal, en-têtes `mg-entete-section`, CTA teal (« Enregistrer le jeu », « Extraire »), palette SÉQUENTIELLE `--seq-1…5` pour une part (intensité sans signe), badge neutre « À vérifier » (jamais une couleur de statut pour une incertitude documentaire), jamais de violet ni d'hexadécimal en dur. Toute couleur de TEXTE teal/statut en clair respecte le contraste (règle `--*-texte` du lot 6 si le composant vit dans un cadre qui la pose ; sinon jeton de texte).
- `ARCHITECTURE.md` (Grep par nom : `## Routes API` l.1401, `### Zones custom — plan média` l.1674, `## Tables Supabase` l.1850, `## Fonctions RPC PostGIS` l.2041) et `angular/src/app/features/carte/README.md` mis à jour DANS le commit de chaque tâche qui ajoute une route, une table, une RPC, un service.
- Tests : codes de retour lus SANS pipe (`npx tsc --noEmit` ; `npm run test:unit` ; `npm run test:integration` ; `cd angular && npx ng test --watch=false` ; `cd angular && npm run build -- --output-path=<scratchpad>/ng-lot5` ; `npm run lint`). Aucun échec admis.
- Code : réutiliser avant de créer (chaque rapport dit ce qui a été réutilisé), aucune ligne morte, commentaires du POURQUOI, zéro duplication non déclarée (mémoire `feedback_agents_frugaux`). Rapports dans un fichier du registre, retour au contrôleur en 5 lignes.
- **Serveurs** : ne JAMAIS arrêter ni redémarrer les serveurs de Vincent (**:3000** Next, **:4200** Angular) ni le stack Docker. Serveurs perso : Next **:3002** lancé DEPUIS CE WORKTREE (son propre `.next` — leçon du 23/10 : un second `next dev` dans le worktree de Vincent cassait son :3000), Angular **:4202** ; un serveur à la fois, tués en fin de tâche par leur PID (jamais `taskkill /IM node.exe`). RAM du poste très juste (84 Mo libres mesurés le 24/10) : `scripts/local/12-sante.sh` avant toute preuve navigateur.
- Preuve navigateur : deux thèmes ; espaces BMW GROUP puis Marine nationale (zones de test créées puis SUPPRIMÉES, espace actif rétabli) ; ⑤ n'a **aucun équivalent React** (le dire) — la comparaison visuelle se fait avec l'étape ④ du module risque Angular ET React (`/map` → risques → Zones) pour la lecture du seuil et du taux d'utile ; captures dans `.superpowers/sdd/2026-10-24-carte-en-parcours-lot-5/` (non suivi).
- Git : commits atomiques `type: description` sur `feat/carte-jeu-de-zones`, **pas de push, pas de PR**, rien sur `main`.

## Contrat AIDA (chaque tâche Angular le vérifie et le dit dans son rapport)

1. Racine d'ombre : aucun style global ajouté ; jetons lus sur `:host`.
2. Aucune adresse absolue : `HttpBaseService.baseUrl` ; navigation relative ; les liens vers les docs officielles des plateformes sont des `<a target="_blank" rel="noopener noreferrer">` dont l'URL vient de `plateformes_geo` (jamais écrite dans le composant).
3. Aucun `position: fixed`, aucun écouteur `window`/`document`, aucun `localStorage` neuf.
4. Services d'API dans `FOURNISSEURS_DISTANTS` ; services d'état fournis par la page.
5. Tout état partageable dans l'URL (§ 5) : `?jeu=`, `?zoneJeu=`, `?mailles=`, `?x=` — ce que la version du § 18 sérialisera.
6. Fonctionne dans les deux thèmes sans hexadécimal.

## Review Focus

1. **Perte honnête** : pour chaque plateforme et chaque maille, `manques + couverte = population de la zone` et `hors_zone + couverte = population achetée` (aux arrondis près, test) ; une maille exacte (A-6) affiche zéro perte SANS calcul ; aucune part > 100 % ; un CP entièrement dans la zone vaut 100 %. → T3, T4, T5.
2. **Zone d'un autre espace, supprimée, recalculée** : `?zoneJeu=` ou `?jeu=` d'un autre espace → « Zone introuvable dans cet espace. » / « Jeu de zones introuvable dans cet espace. », paramètre retiré ; une zone recalculée en ③ AVANT l'enregistrement → la conversion se relit (cache `updated_at`) ; une zone d'un jeu enregistré ne se recalcule plus (409 existant de `zone_referencee`). → T6, T7, T9.
3. **Extraction immuable et autoportée** : une extraction relue après suppression OU recalcul de sa zone rend les mêmes unités ; deux extractions identiques → `deja_extraite` ; les unités d'une plateforme sont recalculées par le SERVEUR, jamais acceptées du client. → T6, T8.
4. **Moteur risque intact** : 1 102 / 73,1 et 931 / 79,8, empreinte v1 `8ccfe4b8…` verts à chaque tâche ; les routes risque refusent un jeu de zone par un 409 explicite au lieu de planter. → T1, T6.
5. **Les règles en base** : modifier `plateformes_geo` (ex. Meta 200 → 150 cercles) change l'écran sans livraison ; aucune limite en dur. → T2, T10.

## Arbitrages (tranchés ; coût si faux)

Ceux de la spec § 16.8 (A-1 à A-7, préfixés « spec »), du lot 3 (L3-1 à L3-8) et du lot 4 (A-1 à A-16, préfixés « L4 ») s'appliquent. Ajoutés par ce plan :

| # | Point | Tranché | Coût si faux |
|---|---|---|---|
| A-1 | Un jeu de zone porte combien de zones ? | **Une** (`zone_sets.custom_geo_zone_id`, déjà lu par `zone_referencee`). Plusieurs secteurs = une combinaison (union) en ③ — c'est le « seul objet zone » du § 16.2-1. | une table de liaison `zone_set_zones` |
| A-2 | Où vivent les unités d'un jeu de zone ? | **Nulle part avant l'extraction** : le jeu stocke la zone, la cible, le mode de plan et un choix par plateforme (`zone_set_plateformes`) ; ses chiffres se relisent (couverture en cache, < 1,1 s sinon). L'EXTRACTION fige les unités : CP dans `zone_set_extraction_cp` (`classe = 'zone'` ou `'hors'`, `cluster_id` NULL), autres mailles dans `zone_set_extraction_unites`. Pas de brouillon pour un jeu de zone (l'aperçu ne s'écrit pas). | une table d'unités vivantes si l'écran doit afficher un jeu sans relire la couverture |
| A-3 | Le moteur risque | **Non touché**, caractérisé (T1), coexistant par `zone_sets.type` (`risque` par défaut, `zone`). Les routes risque (`[id]` GET/PATCH, `export`, `cp-geo`, `grappes`, `rattacher`, `simulation`, `pression-classes`) refusent un jeu de zone par **409** « Ce jeu de zones se gère à l'étape ⑤ de la carte. » via UN chargeur commun. | aucun |
| A-4 | Choix de la maille | **Par plateforme, par l'utilisateur** (§ 16.2) ; défaut = la maille NATIVE la plus fine non « à vérifier » de la plateforme pour cette recette (A-6) ; chaque plateforme garde son propre seuil (défaut 20 %, la valeur du risque) et, pour les cercles, son rayon. Q-L le soumet à Vincent. | un seuil unique |
| A-5 | Mailles calculées | `polygone` (la forme exacte), `cp`, `iris` (lecture seule, aucune plateforme ne l'achète au 24/10 : affichée si une ligne de `plateformes_geo` la porte), `commune`, `departement`, `cercle`. Les quatre découpages territoriaux = `couverture_geometrie` (deux découpages neufs) ; le seuil s'applique côté client (Angular) ET serveur (extraction) par la MÊME fonction pure, copiée et verrouillée par un test de parité. | une RPC de seuil |
| A-6 | Quand une maille est-elle EXACTE ? | Selon la recette (spec § 16.4 « la nature se déduit de la recette ») : `polygone` toujours ; `cp` pour `codes_postaux` ; `cercle` pour `rayon_point` (un cercle, rayon dans les bornes de la plateforme) et `rayon_poi` (un cercle par POI — ⚠ la zone est DÉCOUPÉE par le périmètre de ① (Q-H) : les cercles entiers débordent ; la perte est alors CALCULÉE sur le pavage, pas déclarée nulle). Sinon la perte est calculée. Table pure `exactitude(recette, maille)` + test. | une ligne de la table |
| A-7 | `plateformes_geo` | `(plateforme, maille)` clé ; `libelle`, `natif` (bool), `disponible` (bool : une maille « non » de la doc, ex. TikTok cercle, est une ligne `disponible = false` qui s'AFFICHE grisée avec sa raison), `limites jsonb` (`max_unites`, `rayon_min_m`, `rayon_max_m`, `pop_min_unite`, `pop_min_groupe`, `max_sommets`), `doc_url`, `releve_le date`, `a_verifier bool`, `note text`, `ordre`. Seed = relevé du 14/10 (`reference_dsp_maille_geo`) + § 8 de la spec. Lecture `GET /api/zones/plateformes` (`Cache-Control: private, max-age=300`). Édition : SQL (`update`), écran d'admin hors lot. | un écran d'admin à ajouter |
| A-8 | Pavage en cercles | **Grille HEXAGONALE** (≈ 23 % de cercles en moins qu'une grille carrée à rayon égal : densité de recouvrement 1,209 contre 1,571), cercle circonscrit à la cellule, échelle `1/cos(lat)` du centroïde de la zone en 3857, UN rayon par appel, cellule retenue si `part ≥ seuil` ET `pop_totale ≥ pop_min_unite`, perte exacte sur l'union. Refus `trop_de_cercles` si les cercles retenus dépassent `max_unites` de la plateforme (le chiffre est rendu : l'écran dit « 481 cercles pour 200 admis : augmentez le rayon »). | changer de grille (une fonction) |
| A-9 | Paliers (Meta, TikTok) | **Hors lot** : poids uniforme ⇒ un seul palier. `pop_min_groupe` (TikTok 1 000) est vérifié sur ce palier unique : avertissement, pas de refus. Les paliers arrivent avec le registre de sources de poids. | une fonction de paliers |
| A-10 | Où s'enregistre le choix courant avant « Enregistrer » ? | Dans l'URL : `?zoneJeu=<uuid>&mailles=<code>` ; `mailles` = `dv360.cp.20,ttd.polygone,meta.cercle.10000.20,tiktok.commune.20` (fonction pure `lireMailles/ecrireMailles`, ne lève jamais, valeur illisible → défauts). Après enregistrement : `?jeu=<uuid>` (et `zoneJeu`/`mailles` retirés : ils sont dans le jeu). `?x=<version>` désigne une extraction. | renommer trois paramètres |
| A-11 | Extraction | Route `POST /api/zones/jeux/[id]/extractions` : pour un jeu de zone, le SERVEUR rejoue chaque plateforme choisie (conversions SÉQUENTIELLES), calcule le plan CP par `genererPlanCp` (classe `'zone'`, poids 1, `mode_plan` du jeu ; type d'entrée rétréci à `Pick<JeuDeZones, 'mode_plan' \| 'poids'>`, le risque inchangé) et appelle une RPC NEUVE `creer_extraction_jeu_zone(p_zone_set_id, p_cp jsonb, p_unites jsonb, p_resume jsonb, p_origine, p_commentaire, p_created_by)` : version, empreinte md5 sur TOUTES les unités (CP + autres), `zone_set_extractions.plateformes jsonb` (résumé par plateforme), `forme` (la géométrie de la zone, copie) pour que l'extraction survive à sa zone. `creer_zone_set_extraction` inchangée. | réécrire l'empreinte |
| A-12 | Redirection `carte/risques` | **Pas au lot 5** (E5). Les jeux risque apparaissent dans la bibliothèque de ⑤ avec le badge « Risque » et le bouton « Ouvrir dans le module » (navigation existante `ouvrirJeuDeZones`). | un lien |
| A-13 | Passerelle ④ → ⑤ | Si `?zoneAnalyse=` est posé et `?zoneJeu=` absent, ⑤ PROPOSE cette zone (« Partir de la zone analysée : <nom> »), il ne la prend pas d'office. | un clic |
| A-14 | Carte de ⑤ | Une plateforme REGARDÉE à la fois (onglet de colonne) : contour de la zone exacte + ses unités retenues (CP : `ContoursZonesService` ; département : `get_zone_polygons('departement')` ; commune : RPC `contours_communes` bornée ; cercles : `cercleGeoJSON` existant ; IRIS : `iris-source`, `minzoom 9`, `niveau = 'iris'`), non retenues en contour fin. Factorisé avec `couche-couverture.ts` (une seule fonction de peinture d'unités par part). | une seconde couche |
| A-15 | Rattacher un jeu de zone à une campagne | **Hors lot** (lot 7, ⑥ Plan : « Cible = une extraction ») ; `rattacher` refuse un jeu de zone (A-3). | une route |

## Questions pour Vincent (produit seulement ; recommandation entre crochets)

| # | Question | Ce qui en dépend | Recommandation |
|---|---|---|---|
| Q-A, Q-B, Q-C | (spec § 16.7, toujours ouvertes) TTD polygone natif ou via Foursquare ? TikTok point + rayon en France (et arrondissements Paris/Lyon/Marseille, M3) ? Meta : CP français acceptés ? | les lignes `a_verifier` de `plateformes_geo` (T2) | **Vérifier dans les comptes dentsu ; d'ici là le lot les montre « À vérifier » avec le lien doc, sans les bloquer** — une `update` de la table suffira, sans livraison |
| Q-L | **Un seuil par plateforme ou un seul pour le jeu ?** Une commune à 20 % et un CP à 20 % ne coupent pas la même chose (M2/M3 : 59,0 % contre 57,6 % d'utile ; département 39,2 %). | T5, T10 | **Un seuil par plateforme**, défaut 20 % partout |
| Q-M | **Rayon des cercles : choisi à la main (réglette 1-80 km, l'écran dit « 481 cercles pour 200 admis ») ou calculé (le plus petit rayon qui tient sous la limite) ?** Le calcul coûte ≈ 3 s et 28 000 accès par zone de 5 000 km² (M5, E4). | T4, T10 | **À la main au lot 5** ; le rayon automatique quand un client le demande |

## File Structure

| Fichier | Responsabilité |
|---|---|
| `tests/integration/jeu-risque-caracterisation.test.ts` (créé) | T1 : seuils 20/35, empreinte v1, garde des routes risque. |
| `sql/274_plateformes_geo.sql`, `lib/zones/plateformes.ts`, `app/api/zones/plateformes/route.ts` (créés) | T2 : registre des plateformes. |
| `sql/275_couverture_commune_departement.sql` (créé), `lib/zones/couverture.ts` (modifié) | T3 : deux découpages neufs, cache compris. |
| `sql/276_paver_cercles.sql` (créé) | T4 : pavage hexagonal, perte exacte. |
| `lib/zones/conversion.ts` (créé) | T5 : seuil, perte, exactitude, maille par défaut — PUR. |
| `sql/277_jeux_de_zone.sql` (créé), `lib/zones/jeu.ts`, `lib/zones/plan.ts`, `lib/zones/charger-jeu.ts` (créé), routes risque (garde) | T6 : schéma, extraction, garde. |
| `app/api/zones/jeux/route.ts`, `app/api/zones/jeux/[id]/route.ts` (modifiés) | T7 : enregistrer, lire, régler un jeu de zone. |
| `sql/278_contours_communes.sql`, `app/api/zones/[id]/cercles/route.ts`, `app/api/zones/communes/contours/route.ts` (créés), `app/api/zones/jeux/[id]/extractions/route.ts` (modifié) | T8 : conversion en cercles, contours, extraction. |
| `angular/.../carte/data/jeux.api.ts`, `etat/jeu-zones.service.ts`, `logique/jeu/conversion.ts`, `logique/jeu/mailles-url.ts` (créés) | T9 : API, état d'URL, logique pure. |
| `angular/.../carte/panneaux/jeu/panneau-jeu.component.ts`, `colonne-plateforme.component.ts`, `choix-maille.component.ts` (créés) ; `carte.page.html`, fichier voisin des pastilles | T10 : l'écran par plateforme. |
| `angular/.../carte/couches/couche-unites.ts`, `couches/jeu-carte.service.ts` (créés) ; `couche-couverture.ts` (factorisé) | T11 : la carte de ⑤. |
| `angular/.../carte/panneaux/jeu/bibliotheque-jeux.component.ts`, `extractions-jeu.component.ts` (créés) ; `panneaux/zones/jeux-de-zones.component.ts` (généralisé) | T12 : enregistrer, bibliothèque, extraire. |

Numéros 274-278 au 24/10 : prendre à chaque tâche le premier numéro libre et chercher les fichiers par SUFFIXE dans les tests.

---

### Task 1: Caractérisation du moteur risque (aucun code de production)

**Objectif :** un filet VERT et VRAI avant de toucher `zone_sets`, `lib/zones/jeu.ts` ou `lib/zones/plan.ts`.

**Files:** Create `tests/integration/jeu-risque-caracterisation.test.ts` ; Doc `ARCHITECTURE.md` (ligne `zone_sets` : chiffres figés, date).

- [ ] **Step 1 : tests** (transaction annulée par test, client `pg` du conteneur — patron `tests/integration/_psql.ts` du lot 4) :
  - `appliquer_seuil_zone_set('0b7ece33-…', 20)` → `n_cp_retenus 1102`, `taux_utile 73.1`, `population_exposee 13430921` ; seuil 35 → `931`, `79.8`, `12793361` ; le jeu `d9b81560-…` seuil 20 → `1687`, `80.0`.
  - **Plan** : `genererPlanCp` sur les `zone_set_cp` du premier jeu (seuil 20, pondéré, `lireGroupesCp`) puis l'empreinte de `creer_zone_set_extraction` recalculée en TS (md5 `seuil|mode|cp:mult,…`, la règle SQL citée) = l'empreinte de l'extraction v1 en base (`8ccfe4b87df01674…`, lue en base) ; `part_plan_en_zone` = 60,6.
  - Un jeu absent ÉCHOUE avec un message qui renvoie à la restauration du dump (jamais un `skip` muet).
- [ ] **Step 2 : PASS** (ils sont verts d'emblée : c'est une caractérisation) ; vérifier qu'ils MORDENT (modifier le seuil attendu → rouge, puis rétablir ; le dire dans le rapport).
- [ ] **Step 3 : reconstruction** — mesurer UNE fois `construire_zone_set` d'une copie du premier jeu (transaction annulée), deux passes (froid puis chaud), noter durées dans le rapport et au registre (M6 : 259 s à froid). Ne PAS mettre la reconstruction dans la suite.
- [ ] **Step 4 : commit** `test(risque): moteur des jeux de zones caractérisé — 1 102 / 73,1, 931 / 79,8, empreinte v1 (lot 5, T1)`.

**Critère de fin :** fichier vert, mutation constatée, durées de reconstruction consignées.

---

### Task 2: `plateformes_geo` — les règles des plateformes en base

**Files:** Create `sql/274_plateformes_geo.sql`, `lib/zones/plateformes.ts`, `app/api/zones/plateformes/route.ts`, `tests/integration/plateformes-geo.test.ts`, `tests/unit/api/zones-plateformes-route.test.ts` ; Modify `types/database.types.ts`, `tests/unit/db/troncature-postgrest.test.ts` (si une RPC est ajoutée — la route lit la TABLE : ≤ 50 lignes, borne écrite) ; Doc `ARCHITECTURE.md`.

**Interfaces :** table (A-7), `check (maille in ('polygone','cp','iris','commune','departement','cercle'))`, `check (plateforme in ('dv360','ttd','meta','tiktok'))`, droits `service_role` seul (patron sql/234). Seed, une ligne par case du § 8 de la spec et du relevé du 14/10 : DV360 `cp` (natif, vérifié, doc developers.google.com/display-video/api/guides/concepts/targeting/geography), DV360 `cercle` (natif, `rayon_min_m 1000`, `pop_min_unite 1000`, note « liste de proximité, poussée non branchée ») ; TTD `polygone`, `cercle`, `cp` (`a_verifier`, note Q-A) ; Meta `cercle` (`max_unites 200`, 1 000-80 000 m), Meta `cp` (`max_unites 50000`, `a_verifier`, Q-C) ; TikTok `departement` et `commune` (`max_unites 3000`, `pop_min_groupe 1000`, commune `a_verifier` — arrondissements), TikTok `cercle` (`disponible = false`, `a_verifier`, Q-B), TikTok `cp` (`disponible = false`, note « pas de CP en France »). `releve_le = 2026-10-14`. `lib/zones/plateformes.ts` : `PLATEFORMES`, `MAILLES` (`as const`), `PlateformeGeoSchema` (Zod), `type PlateformeGeo`.

- [ ] Tests (échec) : intégration — 12 lignes, clé unique, aucune ligne `natif` sans `doc_url` sauf TTD (`a_verifier`), migration rejouée deux fois identique ; route — 401 sans session, 200 trié par `ordre`, aucun appel avant auth, `Cache-Control` présent.
- [ ] FAIL → migration + route → PASS ; `routes-publiques`, `validation-corps` verts.
- [ ] Commit `feat(db): plateformes_geo — capacités géographiques des plateformes, en base (sql/274, lot 5, T2)`.

---

### Task 3: Découpages `commune` et `departement` de la couverture

**Objectif :** la maille TikTok (commune, département) lue comme le CP : même règle, mêmes refus, même cache.

**Files:** Create `sql/275_couverture_commune_departement.sql` ; Modify `lib/zones/couverture.ts` (`DECOUPAGES` + libellés), `angular/.../logique/analyses/couverture.ts` (copie verrouillée par `couverture-paritaire.test.ts`), `tests/integration/couverture-geometrie.test.ts` (ou le fichier du lot 4 par suffixe), `types/database.types.ts` ; Doc `ARCHITECTURE.md`.

**Interfaces :** `couverture_geometrie` (`create or replace`, MÊME signature) : `p_decoupage ∈ forme|cp|iris|commune|departement` ; pour commune/département, `code` = `carreau_couverture.code_commune|code_departement` (⚠ `carreaux_de_forme` ne rend que CP et IRIS : l'étendre — `create or replace` d'une fonction SQL `RETURNS TABLE` dont on AJOUTE des colonnes change son type de retour, donc interdit — écrire une jumelle `carreaux_de_forme_codes(p_geom, p_rang)` qui rend les quatre codes et faire de `carreaux_de_forme` une enveloppe qui la lit, patron « jumelle » de CLAUDE.md), dénominateur `unite_population_totale` maille `commune|departement`, `nom` lu dans `ref_communes`/`ref_departements` ; `couverture_zone` / `couverture_zone_en_cache` / le CHECK du cache acceptent les deux valeurs. L'onglet Angular de ④ N'AFFICHE PAS ces découpages (rien ne change à l'écran de ④ : `DECOUPAGES_ANALYSE` reste `forme|cp|iris`, un test le dit).

- [ ] Tests (échec) : composite 13 000 km² (ou une zone créée dans le test) en `commune` → `n_territoires` ≈ 1 410, ∑ lignes + `hors_territoire` = `population` de la forme ; `departement` → 91 ; aucune part > 100 ; Paris : une zone couvrant le 75 rend des ARRONDISSEMENTS (751xx), le test le documente ; cache : deux appels `commune` → le second `cache: true`.
- [ ] FAIL → migration → PASS + **EXPLAIN** composite commune (M3 : 0,60 s / 31 600 ; arrêt si > 0,9 s ou > 47 000) et `cp` inchangé (95-100 ms BdR).
- [ ] Commit `feat(db): couverture par commune et par département — la maille TikTok (sql/275, lot 5, T3)`.

---

### Task 4: `paver_cercles` — une zone en cercles, perte exacte

**Files:** Create `sql/276_paver_cercles.sql`, `tests/integration/paver-cercles.test.ts` ; Modify `types/database.types.ts`, `tests/unit/db/troncature-postgrest.test.ts` ; Doc `ARCHITECTURE.md`.

**Interfaces :** `paver_cercles(p_zone_id uuid, p_org_id uuid, p_cible text, p_rayon_m int, p_seuil numeric, p_pop_min int default 0, p_max_cercles int default null, p_max_candidates int default 5000) → jsonb`, STABLE, `service_role`, `plan_cache_mode = force_custom_plan` (leçon du pic de 165 s, lot 4). Rend `{ zone_id, rayon_m, seuil, n_candidates, n_cercles, cercles: [{lon, lat, pop_en_zone, pop_totale, part}], population (zone), couverte, manques, hors_zone, achetee, taux_utile, reference }` ou `{ refus }` : `zone_introuvable`, `cible_inconnue`, `zone_trop_vaste` (> 100 000 km²), `trop_de_candidates`, `trop_de_cercles` (+ `n_cercles`, `plafond`), `couverture_non_construite` ; rayon hors [1 000, 80 000] → 22023.
- Algorithme (prototype M5, grille HEXAGONALE A-8) : (1) carreaux de la zone (`carreaux_de_forme`) avec leur cellule hexagonale (coordonnées axiales, arrondi cubique — fonction SQL IMMUTABLE `cellule_hex(x, y, pas)` testée seule) ; (2) cellules candidates (`limit p_max_candidates + 1`) et leur population TOTALE (carreaux de la cellule par `&&` sur l'enveloppe + même formule de cellule) ; (3) cellules retenues ; (4) carreaux de l'UNION des cercles retenus par l'index (`&& ST_Expand(centre, r·k)` + `ST_DWithin`, `distinct on`) ; (5) perte. ⚠ **Jamais** `exists (select … from <cte> where ST_DWithin(…))` : une CTE n'a pas d'index — mesuré 11,5 s → 445 s (M5).
- Le refus `trop_de_cercles` vient APRÈS l'étape 3 et AVANT l'étape 4 (on n'a pas besoin de la perte pour refuser).

- [ ] Tests (échec) : CIRFA-like (zone de test d'≈ 5 000 km²) r = 5 km, seuil 20 → `n_cercles` < 141 (l'hexagone fait mieux que la grille carrée du prototype) et `taux_utile` ≥ 85 ; **invariants** : `couverte + manques = population`, `couverte + hors_zone = achetee` (± 1) ; tout carreau de la zone dont la cellule est retenue est à ≤ r de son centre (requête de contrôle) ; `p_max_cercles => 10` → `trop_de_cercles` avec le nombre ; `p_pop_min => 1000` retire les cellules sous 1 000 habitants ; rayon 500 → 22023 ; zone d'un autre espace → `zone_introuvable`.
- [ ] FAIL → migration → PASS + **EXPLAIN** : 5 000 km² r 5 et 10 km (M5 : 0,24-0,27 s, ≈ 25 000 accès) ; composite 13 000 km² r 10 km (1,06 s, 120 000) ; une zone-région ARA (seuil territoire) r 10 km — **arrêt si > 2 s ou > 400 000 accès** : alors baisser `p_max_candidates` et le dire.
- [ ] Commit `feat(db): paver_cercles — une zone en cercles hexagonaux, perte exacte (sql/276, lot 5, T4)`.

---

### Task 5: La logique pure de la conversion (serveur)

**Files:** Create `lib/zones/conversion.ts`, `tests/unit/zones/conversion.test.ts`.

**Interfaces (PUR, sans I/O) :**
- `appliquerSeuil(lignes: LigneCouverture[], population: number, seuil: number) → ResumeMaille` : `{ n_unites, n_touchees, couverte, achetee, manques, hors_zone, taux_utile }` — couverte = ∑ `pop_en_zone` retenues ; achetee = ∑ `pop_totale` retenues ; manques = `population − couverte` (le hors-territoire compte comme manqué : on ne l'achète pas) ; taux d'utile sur les SEULES retenues ; une ligne à `part` NULL n'est jamais retenue.
- `exactitude(recette, maille, plateforme?) → 'exacte' | 'calculee'` (A-6) ; `mailleParDefaut(plateformes, plateforme, recette)` (A-4).
- `resumeExact(population, surface)` : la maille polygone ou une maille exacte — zéro perte, aucun calcul.
- `verifierLimites(resume, ligne: PlateformeGeo) → Avertissement[]` (`max_unites` dépassé, `pop_min_groupe` non atteint) — lit les limites, n'en écrit aucune.
- `lireMailles(brut) / ecrireMailles(choix)` (A-10), ne lève jamais.

- [ ] Tests (échec) : les chiffres de M2 (composite seuil 20 → 617 / 57,6 / 977 538 / 7 541 431 à partir des `lignes` figées dans une fixture tirée de la base) ; seuil 0 → tout retenu ; part NULL ; exactitude des dix recettes × six mailles (tableau) ; `lireMailles('n importe quoi')` → défauts ; un test grep : aucun des nombres de la seed (200, 80000, 3000, 50000, 1000) dans `lib/zones/conversion.ts`.
- [ ] FAIL → implémenter → PASS. Commit `feat: conversion d'une zone dans une maille — seuil, perte, exactitude (lot 5, T5)`.

---

### Task 6: Schéma des jeux de zone, extraction généralisée, garde des routes risque

**Files:** Create `sql/277_jeux_de_zone.sql`, `lib/zones/charger-jeu.ts`, `tests/integration/jeux-de-zone-schema.test.ts` ; Modify `lib/zones/jeu.ts` (schéma discriminé), `lib/zones/plan.ts` (type d'entrée rétréci), les sept routes risque + `pression-classes` (UN appel au chargeur), `types/database.types.ts`, `tests/unit/db/troncature-postgrest.test.ts` ; Doc `ARCHITECTURE.md`.

**Interfaces :**
- `zone_sets` : `type text not null default 'risque' check (type in ('risque','zone'))` ; `profil`, `profil_hash` `DROP NOT NULL` + `check (type = 'zone' or (profil is not null and profil_hash is not null))` + `check (type = 'risque' or custom_geo_zone_id is not null)` ; clé étrangère `custom_geo_zone_id → custom_geo_zones(id) on delete restrict` (`zone_referencee` l'empêche déjà côté route ; la base aussi).
- `zone_set_plateformes (zone_set_id uuid references zone_sets on delete cascade, plateforme text, maille text, seuil numeric check 0-100, rayon_m int null, primary key (zone_set_id, plateforme), foreign key (plateforme, maille) references plateformes_geo)`.
- `zone_set_extractions` : `add column if not exists plateformes jsonb`, `forme geometry(MultiPolygon, 4326)` ; `zone_set_extraction_unites (extraction_id references zone_set_extractions on delete cascade, plateforme, maille, code text null, nom text null, centre geometry(Point,4326) null, rayon_m int null, pop_en_zone numeric, pop_totale numeric, part numeric, retenu bool, primary key (extraction_id, plateforme, maille, ordinal))` + déclencheur `zse_refuser_update` (immuable, comme les deux autres).
- RPC `creer_extraction_jeu_zone(…)` (A-11) : refus `jeu_introuvable`, `type_non_zone`, `plan_vide` ; verrou consultatif comme `creer_zone_set_extraction` ; `deja_extraite` sur empreinte égale.
- `lib/zones/jeu.ts` : `JeuZoneSchema = { type: 'zone', zone_id, cible, mode_plan, plateformes: [{ plateforme, maille, seuil, rayon_m? }] }` (≤ 4, une par plateforme, couple validé contre `MAILLES`) ; `MOTIF_CLASSE` accepte `zone` ; `JeuDeZonesSchema` (risque) INCHANGÉ. `lib/zones/plan.ts` : `genererPlanCp(entrees, jeu: Pick<JeuDeZones, 'mode_plan' | 'poids'>, membres?)` — aucune autre ligne.
- `lib/zones/charger-jeu.ts` : `chargerJeu(supabase, id, orgId, { type })` → jeu ou réponse 404/409 prête (« Jeu de zones introuvable dans cet espace. » / « Ce jeu de zones se gère à l'étape ⑤ de la carte. ») ; les routes risque l'appellent avec `{ type: 'risque' }`.

- [ ] Tests (échec) : intégration — migration rejouée deux fois, empreinte identique ; insérer un jeu `zone` sans zone → violation ; supprimer une zone d'un jeu → refus ; extraction : deux appels identiques → `deja_extraite`, `update` d'une unité → refus du déclencheur, suppression de la zone… impossible (FK) mais l'extraction porte `forme` ; unitaires — chaque route risque rend 409 sur un jeu `zone` (client factice) ; **T1 vert**.
- [ ] FAIL → implémenter → PASS ; `npm run test:unit`, `npm run test:integration` entiers.
- [ ] Commit `feat(db): jeux de zone — type, choix par plateforme, extraction de toute maille (sql/277, lot 5, T6)`.

---

### Task 7: Routes — enregistrer, lire, régler un jeu de zone

**Files:** Modify `app/api/zones/jeux/route.ts` (GET : `type`, `custom_geo_zone_id`, nom de la zone ; POST : corps discriminé `type`), `app/api/zones/jeux/[id]/route.ts` (GET/PATCH/DELETE via `chargerJeu`) ; tests `tests/unit/api/zones-jeux-zone.test.ts`, intégration `tests/integration/jeux-de-zone-routes.test.ts` ; Doc.

**Comportement :** POST `type: 'zone'` : zone de l'ESPACE (`espaceDeZone`, sinon 404), cible connue, chaque couple (plateforme, maille) présent et `disponible` dans `plateformes_geo`, nom obligatoire, version = max + 1 par nom (comme le risque) ; écrit `zone_sets` + `zone_set_plateformes` (une requête par table, erreur LUE, retrait du jeu si la seconde échoue) ; quota `geo:rl:zone-sets` ; AUCUN calcul (les chiffres se relisent). GET `[id]` d'un jeu de zone → `{ jeu, zone: { id, nom, recette }, plateformes }` (aucune lecture de `zone_set_cp`). PATCH : nom, mode de plan, choix par plateforme (remplacement DELETE ciblé + INSERT, DELETE LU — règle CLAUDE.md). DELETE : jeu sans extraction référencée par une campagne (lot 7 : rien à vérifier encore, le dire en commentaire).
- [ ] Tests (échec) : 401/403/400 (couple inconnu, maille `disponible = false`, plateforme en double, nom absent)/404 (zone d'un autre espace)/429/201 ; GET liste contient les deux types ; PATCH remplace les choix ; zone d'un jeu → `POST /api/zones/[id]/recalculer` rend le 409 existant (Review Focus 2).
- [ ] FAIL → PASS ; `routes-publiques`, `validation-corps`.
- [ ] Commit `feat(api): jeux de zone — enregistrer, lire, régler (lot 5, T7)`.

---

### Task 8: Routes — cercles, contours des communes, extraction

**Files:** Create `app/api/zones/[id]/cercles/route.ts`, `app/api/zones/communes/contours/route.ts`, `sql/278_contours_communes.sql` ; Modify `app/api/zones/jeux/[id]/extractions/route.ts` (branche `type = 'zone'`, le risque inchangé) ; tests unitaires + intégration ; Doc.

**Interfaces :**
- `GET /api/zones/[id]/cercles?cible=&rayon=&seuil=&plateforme=` : `requireAuth`, `espaceDeZone`, Zod, limites lues dans `plateformes_geo` (`rayon_min_m`, `rayon_max_m`, `pop_min_unite`, `max_unites`) — jamais du client — → `paver_cercles` ; quota `geo:rl:conversion` 6/min ; 404/422 (refus traduits en français dans `lib/zones/conversion.ts` → `MESSAGES_CONVERSION`)/429/500. Pas de cache (dépend du rayon et du seuil).
- `contours_communes(p_codes text[], p_max int default 3000) → jsonb` (`[{code, nom, geometry}]` simplifiée 0,001, 5 décimales ; `limit p_max + 1` → refus `trop_de_communes`) ; `POST /api/zones/communes/contours` (corps `{ codes }` ≤ 3 000 par `lireCorps`, quota `geo:rl:couverture`).
- Extraction d'un jeu de zone (A-11) : pour chaque plateforme choisie, SÉQUENTIELLEMENT — maille territoriale : `couverture_zone` (cache) puis `appliquerSeuil` (T5) ; cercle : `paver_cercles` ; polygone : rien à calculer (la forme est copiée par la RPC) — puis plan CP (si une plateforme est au CP) par `genererPlanCp` + `lireGroupesCp` (le multiplicateur DIVISÉ par les membres du groupe : piège 2), puis `creer_extraction_jeu_zone`. `maxDuration = 60`. GET des extractions inchangé (les deux types).

- [ ] Tests (échec) : cercles — 401/400 (rayon 500 sous le `rayon_min_m` lu en base)/404/422 `trop_de_cercles` avec le nombre/429 ; contours — 3 001 codes → 400, 2 codes → 2 géométries ; extraction — jeu avec DV360 `cp` + Meta `cercle` + TTD `polygone` + TikTok `commune` → une extraction, CP dans `zone_set_extraction_cp` (`classe 'zone'`), cercles et communes dans `zone_set_extraction_unites`, `forme` non nulle, `plateformes` porte quatre résumés ; rejouée → `deja_extraite` ; les unités envoyées par le client sont IGNORÉES (le corps ne les accepte pas : Zod `strict`) ; **EXPLAIN** de `contours_communes` (M4 : 65 ms pour ≈ 400).
- [ ] FAIL → PASS. Commit `feat(api): ⑤ conversion en cercles, contours des communes, extraction de toute maille (sql/278, lot 5, T8)`.

---

### Task 9: Angular — API, état de ⑤ dans l'URL, logique pure

**Files:** Create `angular/src/app/features/carte/data/jeux.api.ts` (+ spec), `etat/jeu-zones.service.ts` (+ spec), `logique/jeu/conversion.ts` (+ spec, copie de T5), `logique/jeu/mailles-url.ts` (+ spec) ; Modify `app.routes.ts` (`JeuxApi` dans `FOURNISSEURS_DISTANTS`), `carte.fournisseurs.ts` (`JeuZonesService`), `tests/unit/angular/` (test de parité `conversion-paritaire.test.ts` : fonctions, messages et `MAILLES` comparés à `lib/zones/conversion.ts` et `lib/zones/plateformes.ts`) ; Doc README carte (« ⑤ Jeu de zones : l'état »).

**Interfaces :**
- `JeuxApi extends HttpBaseService` : `plateformes()`, `lister()`, `lire(id)`, `enregistrer(corps)`, `regler(id, corps)`, `supprimer(id)`, `cercles(zoneId, {cible, rayon, seuil, plateforme})`, `contoursCommunes(codes)`, `extractions(id)`, `extraire(id, {commentaire, recalage})` ; la conversion territoriale réutilise `CouvertureApi.couverture(zoneId, cible, decoupage)` du lot 4 (aucune méthode dupliquée).
- `JeuZonesService` (`@Injectable()`, fourni par la PAGE) : signaux `zoneId`, `jeuId`, `choix` (par plateforme), `plateformes` (registre, lu une fois), `couvertures` (par maille, cache mémoire par `zone|cible|maille`), `cercles` (par plateforme), `resumes` (computed : `appliquerSeuil` — AUCUNE requête quand le seuil bouge), `enCours`, `erreurs` ; `choisirZone(id|null)`, `regler(plateforme, {maille?, seuil?, rayon?})`, `charger(jeuId)` ; reflet `?zoneJeu=`, `?jeu=`, `?mailles=`, `?x=` (patron EXACT de `ZoneAnalyseeService`, écriture par `ecrireParametres`) ; jeton par requête ; changer de zone efface tout résultat ; 404 → paramètre retiré + message. Au plus UNE couverture par maille distincte, lancée à la demande de la colonne (jamais les quatre mailles d'un coup : ≤ 3 appels simultanés — file séquentielle).
- [ ] Specs (échec) : URL lue à la construction ; `regler(seuil)` ne déclenche AUCUNE requête (`HttpTestingController.expectNone`) ; rayon : une requête au `valider`, jeton (deux rayons rapides → seule la seconde réponse) ; réponse arrivée après `choisirZone(autre)` → jetée ; service détruit → aucune écriture ; `?mailles=` et `?etape=` écrits dans le même tick → les deux présents (P-g) ; parité.
- [ ] FAIL → PASS (`--include` des quatre specs) ; `taille-fichiers`, build, `tsc`.
- [ ] Commit `feat(angular): ⑤ l'état du jeu de zones — API, URL, conversion pure (lot 5, T9)`.

**Pièges :** P-a, P-b, P-c, P-d, P-e (service à la PAGE : le jeu survit à ⑤ → ① → ⑤), P-g, P-h.

---

### Task 10: Angular — l'écran ⑤ : une colonne par plateforme

**Files:** Create `panneaux/jeu/panneau-jeu.component.ts`, `panneaux/jeu/colonne-plateforme.component.ts`, `panneaux/jeu/choix-maille.component.ts` (+ specs) ; Modify `carte.page.html` (`@case ('jeu') { <mg-panneau-jeu /> }`), fichier voisin des pastilles (`jeuRenseigne` ← `?jeu=` ou `?zoneJeu=`), `carte.page.spec.ts` (inventaire : ligne ⑤), `panneaux/aide.component.ts` (aide de l'étape ⑤) ; Doc README, `ARCHITECTURE.md` (§ carte Angular).

**Comportement :**
- En tête : **Source** — `mg-choix-zone-analysee` RÉUTILISÉ (même composant que ④, entrée renommée si besoin, aucune copie) ; passerelle A-13 ; la zone choisie affiche nom, recette (`libelleRecette`), population et surface de la forme ; cible (`mg-choix-cible` réutilisé) ; mode de plan (`mg-mode-plan` du risque réutilisé tel quel).
- **Par plateforme** : une colonne (≥ 900 px de panneau : côte à côte ; plus étroit : pile, une colonne dépliée à la fois) avec : nom ; `mg-choix-maille` (boutons segmentés des mailles de `plateformes_geo` pour cette plateforme — natives en premier, `disponible = false` grisées avec la `note` en `title` et en texte sous le bouton) ; badge neutre « À vérifier » + date du relevé ; lien « Doc officielle » (`doc_url`) ; réglette de seuil (`mg-dilution` du risque réutilisé : ses entrées sont génériques) ; réglette de rayon pour `cercle` (bornes de la ligne, requête au relâchement) ; chiffres en JetBrains Mono : unités retenues / touchées, **taux d'utile**, **habitants manqués** (nombre + % de la zone), **diffusion hors zone**, avertissements de `verifierLimites` (« 481 cercles pour 200 admis », « palier sous 1 000 personnes ») ; « exacte : aucune perte » quand `exactitude` le dit ; bouton « Voir sur la carte » (la plateforme regardée, T11).
- Phrase sous le tableau (Q-J du lot 4) : « Habitants carroyés (Filosofi 2021) ; la part rapporte chaque territoire à ses propres habitants carroyés. »
- Vide : « Aucune zone : choisissez une zone enregistrée, ou créez-en une à l'étape ③. » (lien relatif vers ③).
- Bandeau `mg-kpi` de l'étape : zone, plateformes réglées, meilleur taux d'utile, version d'extraction.
- [ ] Specs (échec) : aucune requête à l'ouverture sans zone ; une zone → la couverture de la maille de la colonne OUVERTE seulement ; seuil déplacé → chiffres mis à jour sans requête ; maille `disponible = false` non cliquable ; lien doc = `doc_url` de la ligne ; une limite modifiée dans le registre factice change l'avertissement (Review Focus 5) ; inventaire de la page.
- [ ] FAIL → PASS + suite Angular + build + `tsc` + `taille-fichiers` ; seuil du fil compact (640 px) remesuré avec la pastille ⑤ allumée.
- [ ] **Preuve navigateur** (`:4202` + Next `:3002` de ce worktree, deux thèmes, BMW GROUP puis Marine nationale ; captures `L5-T10-*`) : (1) ⑤ ouvert sans zone : aucune requête (Réseau) ; (2) une zone `rayon_poi` créée en ③ (lycées 5 km, Bouches-du-Rhône) : quatre colonnes, DV360 CP seuil 0 → 20 → 50 (chiffres qui bougent sans requête), Meta cercles 5 puis 10 km, TikTok commune puis département, TTD polygone « exacte » ; (3) une zone `codes_postaux` : DV360 CP « exacte » ; (4) ④ avec zone analysée → ⑤ propose la zone ; (5) ⑤ → ① → ⑤ : tout est là. Capture de comparaison : étape Zones du module risque Angular et React (seuil, taux d'utile).
- [ ] Commit `feat(angular): ⑤ jeu de zones — une colonne par plateforme, maille choisie, perte chiffrée (lot 5, T10)`.

**Pièges :** P-b, P-c, P-d, P-h, P-i ; `mg-dilution` et `mg-mode-plan` importés de `features/risques` (`carte/` en importe déjà) — sans les modifier, sinon le spec du risque le dira.

---

### Task 11: Angular — la carte de ⑤

**Files:** Create `couches/couche-unites.ts` (+ spec), `couches/jeu-carte.service.ts` (+ spec) ; Modify `couches/couche-couverture.ts` (sa peinture CP/IRIS par part DÉPLACÉE dans `couche-unites.ts` et appelée par elle — un seul code de peinture), `logique/ordre-couches.ts` (`jeu-*` comme `couverture-*`), `panneaux/jeu/colonne-plateforme.component.ts` (« Voir sur la carte ») ; Doc README.

**Comportement (A-14) :** `JeuCarteService` (fourni par la PAGE) peint la plateforme REGARDÉE : contour de la zone exacte (`ZonesCustomApi.geometrie`, une lecture par zone) ; unités retenues en `--seq-*` par part, non retenues en contour fin `--contour-carte` ; CP (`ContoursZonesService` `cp`), département (`ContoursZonesService` `departement` — vérifier qu'il accepte l'échelle, sinon l'ajouter là et nulle part ailleurs), commune (`JeuxApi.contoursCommunes`, retenues seulement, une lecture par jeu de codes), IRIS (`iris-source`, `minzoom 9`, `niveau = 'iris'`), cercles (`cercleGeoJSON` de `risques/logique/cercle.ts`) ; polygone : le contour seul. Recadrage sur l'emprise de la zone. Retrait au changement de plateforme regardée, de zone, et à la destruction du SERVICE (P-e). La couverture de ④ et la carte de ⑤ ne s'empilent pas : une seule choroplèthe à la fois (registre des dégradés du lot 4, `'couverture'` → ajouter `'jeu'` des deux côtés, parité `carte-logique-paritaire`).
- [ ] Specs (échec) : carte factice — couches posées/retirées, aucune couleur `var(` ni `#` dans `paint`, `match` de 5 498 codes sans lever, 200 cercles en une source ; changement de plateforme regardée → anciennes couches retirées ; ④ puis ⑤ → la couverture de ④ est masquée ; les specs de `couche-couverture` du lot 4 restent verts SANS modification.
- [ ] FAIL → PASS ; build, `tsc`.
- [ ] **Preuve navigateur** deux thèmes (captures `L5-T11-*`) : CP retenus au seuil 20 puis 50 sur la zone lycées BdR ; cercles Meta 10 km ; communes TikTok ; départements ; IRIS zoomé/dézoomé (« Zoomez pour voir les IRIS ») ; retour en ④ : la couverture revient.
- [ ] Commit `feat(angular): ⑤ la carte du jeu — zone exacte et unités de la plateforme regardée (lot 5, T11)`.

**Pièges :** P-b, P-c, P-e, P-f, P-i.

---

### Task 12: Angular — enregistrer, bibliothèque, extraire

**Files:** Create `panneaux/jeu/bibliotheque-jeux.component.ts`, `panneaux/jeu/extractions-jeu.component.ts` (+ specs) ; Modify `panneaux/zones/jeux-de-zones.component.ts` (« Mes zones » de la boîte à outils : les DEUX types ; un jeu de zone ouvre ⑤ `?jeu=`, un jeu risque ouvre le module comme aujourd'hui ; titre « Jeux de zones »), `features/risques/etapes/zones/panneau-extractions.component.ts` (seulement si la factorisation l'exige : extraire la liste des versions en un composant partagé `mg-liste-extractions` utilisé par les deux — le spec du risque INCHANGÉ et vert) ; Doc README, `ARCHITECTURE.md`.

**Comportement :** pied du panneau ⑤ : nom (proposé : nom de la zone), CTA teal « Enregistrer le jeu » → `?jeu=` posé, `zoneJeu`/`mailles` retirés ; jeu chargé : « Enregistrer » devient « Enregistrer les réglages » (PATCH) ; « Extraire » (commentaire, case « recalage ») → liste des versions (v1, v2…, origine, date, résumé par plateforme : maille, unités, taux d'utile), `deja_extraite` dit « Cette extraction existe déjà (v2). » ; `?x=` reflète la version sélectionnée. Bibliothèque (lue à la première ouverture) : jeux de l'espace, badge « Risque » / « Zone », ouvrir, supprimer (dialogue de confirmation existant `dialogue-suppression-zone` réutilisé si possible). Le téléchargement des fichiers par plateforme est le LOT 6 : un texte l'annonce (« Les fichiers par plateforme arrivent avec les exports. »), aucun bouton mort.
- [ ] Specs (échec) : enregistrer → POST unique, URL réécrite ; double clic → une seule requête ; extraire → POST puis relecture de la liste ; un 207/réponse perdue (statut 0) → « vérifiez la liste des versions » (leçon du lot 3) ; bibliothèque : ouvrir un jeu risque navigue vers le module (`ouvrirJeuDeZones`), un jeu de zone pose `?jeu=` ; « Mes zones » lit la liste UNE fois.
- [ ] FAIL → PASS ; suite Angular, build, `tsc`, `taille-fichiers`.
- [ ] **Preuve navigateur** deux thèmes (`L5-T12-*`) : enregistrer le jeu lycées BdR (quatre plateformes), extraire v1, ré-extraire → `deja_extraite`, changer un seuil, extraire v2 ; recharger la page sur `?jeu=…&x=2` → tout revient ; `?jeu=` de BMW collé dans Marine nationale → « Jeu de zones introuvable dans cet espace. », paramètre retiré ; « Mes zones » ouvre les deux types ; tentative de recalcul de la zone en ③ → 409 lisible.
- [ ] Commit `feat(angular): ⑤ enregistrer, bibliothèque et extractions du jeu de zones (lot 5, T12)`.

**Pièges :** P-b, P-c, P-e, P-g.

---

### Task 13: Revue finale du lot, passe de factorisation, documentation

**Files:** `ARCHITECTURE.md` (§ zones custom : « ⑤ traduit, et dit ce qu'il perd » ; tables, RPC, routes ; le suivi M6), README carte, inventaire de la page, `docs/superpowers/specs/…-design.md` (« § 17 quinquies. Écarts à la livraison du lot 5 » — commit `docs(spec)` séparé).

- [ ] **Step 1 : vérification complète** sans pipe : `npx tsc --noEmit` ; `npm run lint` ; `npm run test:unit` ; `npm run test:integration` (0 échec) ; `cd angular && npx ng test --watch=false` ; build Angular ; `npm run build` (Next, `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` locales passées explicitement) ; `npm run catalogue` si `knip` a bougé.
- [ ] **Step 2 : revue finale** (modèle le plus capable) du lot entier, avec **passe de FACTORISATION inter-tâches** (mémoire `feedback_factorisation_fin_de_lot`) : attendus à examiner — refus/messages SQL ↔ TS ↔ Angular (une table par couche, copies verrouillées), peinture d'unités (une seule), lecture séquentielle des conversions (serveur et client), composants réutilisés du risque (`mg-dilution`, `mg-mode-plan`, liste des extractions) ; **une seule vague de correctifs** ; dire ce qui RESTE dupliqué, et pourquoi.
- [ ] **Step 3 : commit** `docs: lot 5 — ⑤ jeu de zones multi-plateformes livré`.

---

### Task 14: Parcours complet et preuve

- [ ] Sur les serveurs `:3002` / `:4202` de ce worktree, deux thèmes, deux espaces (BMW GROUP, Marine nationale) : ① périmètre Bouches-du-Rhône → ③ zone `rayon_poi` (lycées 5 km) → ④ couverture par CP → ⑤ (passerelle) quatre plateformes réglées, carte de chaque plateforme regardée → enregistrer → extraire v1 → recalage v2 ; puis une zone `codes_postaux` (DV360 exacte) et une zone `isochrone` capturée (CIRFA, Marine nationale) ; les cinq cas du Review Focus, captures `L5-FINAL-*`.
- [ ] Onglet Réseau relu : aucune requête au déplacement d'un seuil, ≤ 3 requêtes simultanées partout, aucune lecture à l'ouverture de ⑤ sans zone.
- [ ] Zones et jeux de test SUPPRIMÉS, espace actif rétabli ; registre clos (« Lot 5: complete », suivis hors lot listés).
- [ ] Commit éventuel des correctifs de preuve ; pas de push, pas de PR.

---

## Risques

| Risque | Effet | Parade |
|---|---|---|
| R1 — RAM du poste (84 Mo libres le 24/10) | serveurs lents, Docker qui tombe pendant une preuve | `12-sante.sh` avant chaque preuve ; un serveur perso à la fois ; jamais de reconstruction pendant une preuve |
| R2 — Les règles des plateformes sont fausses (Q-A/B/C) | un choix de maille impossible en vrai | « À vérifier » visible, `update` sans livraison, aucune règle en dur (Review Focus 5) |
| R3 — Toucher `zone_sets` casse le risque | Seveso faux, simulation 62 → 89 perdue | T1 avant tout ; moteur non modifié ; garde 409 par UN chargeur |
| R4 — Pavage lent sur une zone dispersée (composite : 91 départements touchés) | > 1 s par rayon | borne de candidates, requête au relâchement, quota ; EXPLAIN ARA en T4 |
| R5 — Commune = arrondissement (Paris, Lyon, Marseille) que TikTok n'accepterait pas | export TikTok refusé | documenté (Q-B) ; le lot 6 regroupera si la vérification le dit |
| R6 — Deux chiffres pour une zone (couverture par centroïde vs `audience_stats` par intersection, L4 A-15) | confusion | inchangé, unifié au lot 7 |
| R7 — Lot « onglets + dossiers » (§ 18) qui suit | ⑤ à déménager dans l'onglet Activation | état dans l'URL (`jeu`, `zoneJeu`, `mailles`, `x`) et services de PAGE : déménagement = montage |
| R8 — La base locale est partagée | une migration de ce lot gêne un autre worktree | migrations rejouables, aucun `DROP`, annonce au registre |

## Suivis hors lot (à porter à l'Excel `priorites-projets-dentsu-explore.xlsx` par le chef de projet)

- Reconstruction d'un jeu risque : **259 s à froid** mesurés (M6) contre 7-21 s documentés — au-delà de Kong (60 s) ; à remesurer sur un poste moins chargé avant d'en faire un chantier.
- Rayon automatique des cercles (Q-M) ; paliers Meta/TikTok et registre ouvert de sources de poids (A-9) ; écran d'administration de `plateformes_geo` (A-7) ; rattachement d'une extraction à une campagne (lot 7, A-15) ; redirection `carte/risques` (A-12).
- Hérités du lot 4 (registre `2026-10-22-carte-en-parcours-lot-4`) : plafond 5 000 POI qui refuse les ICPE de l'Ille-et-Vilaine à 10 km ; capture React CIRFA ; cinq mineurs de `vague-finale-rereview.md` ; `requireAuth` appelle `auth.getUser(token)` sur les routes API.

## Registre d'exécution

À tenir dans `.superpowers/sdd/2026-10-24-carte-en-parcours-lot-5/progress.md` (non suivi), même format que le lot 4 : une ligne par dispatch, implémentation, revue, ruling (avec « coût si faux »), et les mesures EXPLAIN de chaque migration à côté de celles de ce plan.
