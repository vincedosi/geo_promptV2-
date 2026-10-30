# La carte en parcours — finitions de ④ Analyse — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (ou superpowers:executing-plans). Skill `porting-react-to-angular` chargé AVANT chaque tâche Angular (pas de port ici, mais ses pièges AIDA et sa méthode de parité valent). Cases à cocher (`- [ ]`) pour le suivi.

**Mode accéléré (Vincent, 24/10) :** 10 tâches (T0 à T9) en 2 groupes, **un implémenteur et une relecture par groupe**. Seuls les défauts Critiques et Importants sont corrigés au fil de l'eau ; les mineurs vont en T9. **Une seule preuve navigateur**, en T9. Cible : **≈ 3,4 jours**, ou **≈ 2 jours** si Q-3 et Q-4 sont refusées.

**Goal :** ④ Analyse fini au sens de Vincent (estimé à 75 % le 30/10). Cinq blocs :
1. **Ce que ④ promet et ne tient pas** : le score composite sur une petite zone répond « Périmètre vide » (E1).
2. **La décision du 25/10 jamais planifiée** : une campagne nationale passe par une zone « France entière ». ③ ne sait pas la créer, et ④ la refuse (E2).
3. **Les outils de ④ qui ignorent la zone analysée** : la bataille V2 et le clustering (E3, E4 ; Excel n° 34).
4. **Les mineurs** laissés par le lot 4 et les retours du 26/10.
5. **La spec remise d'équerre** : les § 17 ter et 17 quater n'y ont jamais été reportés, et le § 16.1 promet encore ce qui a été retiré.

**Architecture (le moins de code possible) :** aucune refonte du panneau ④. Le panneau garde ses tiroirs, `ZoneAnalyseeService`, `LectureAnnulable` et la table `carreau_couverture`.
- **SQL :** quatre RPC `jsonb` neuves ou jumelles, sans aucun `DROP`.
- **Routes :** la route du score change de règle pour une zone. La route V2 gagne un paramètre `zone_id`. Une seule route neuve : `GET /api/zones/[id]/typologies`.
- **Angular :** le reste se fait dans des fichiers existants, plus un composant de lecture des typologies.

**Tech Stack :** Angular 21.2 standalone, zoneless, signals ; Tailwind 4 ; Vitest (`cd angular && npx ng test --watch=false`). Next.js 15, supabase-js, Zod, Vitest racine (`npm run test:unit`, `npm run test:integration`). Postgres 17.6 local (`docker exec supabase_db_genesis_app psql -U postgres`).

**Spec :** `docs/superpowers/specs/2026-10-13-carte-en-parcours-design.md`.
- **§ 16 fait foi** : 16.1, ligne ④ ; 16.2, règles 2 (« la forme exacte est la vérité ») et 5 (« ① borne tout calcul lourd »).
- **§ 19** : la V1 ne contrôle que les impressions ; la corrélation y est hors V1.
- **§ 13, Q1** : la corrélation va en Live.

Plans antérieurs :
- `2026-10-22-carte-en-parcours-lot-4.md` (4a et 4b, toutes cases livrées, registre `.superpowers/sdd/2026-10-22-carte-en-parcours-lot-4/`, avec `ecarts-4a.md`, `ecarts-4b.md` et `final-review.md`) ;
- `2026-10-26-carte-retours-26-10.md` (retrait du bloc radio et trafic, tiroirs, métropole, retrait de la V1 le 27/10) ;
- `2026-10-24-carte-en-parcours-lot-6-plan.md` (Q-3, mode pays) ;
- `2026-10-29-carte-en-parcours-zones.md` (modèle de ce plan).

Mémoire : `project_retours_carte_26_10`.

## Global Constraints

- **React est gelé** (P5). Aucun fichier de `app/map/**`, `components/**` ou `lib/navigation/**` n'est modifié. React ne change que par les routes et RPC partagées : la règle des CP d'une zone pour le score (T1). Chaque écart est listé en T9.
- **Fichier protégé** : `app/api/isochrone-battle/route.ts` n'est PAS touché, pas plus que `get_isochrone_battle*` ni `clip_geojson_to_france`. T3 modifie `app/api/isochrone-battle-v2/route.ts`, qui n'est pas protégé.
- **Aucun `DROP`** : la base locale est partagée. Les migrations sont en `create or replace` et rejouables ; chacune est appliquée DEUX fois, à empreinte identique. `sql/284` (retrait de `croisements_zone`) n'est toujours PAS appliquée : elle s'applique au merge dans `feat/angular-lot0` (A-9 des retours du 26/10). Ce lot ne l'applique pas.
- **PostgREST coupe à 1 000 lignes** : toute RPC neuve rend du `jsonb`. Une liste de territoires est rendue entière ou refusée, jamais coupée.
- **I/O de la base** (CLAUDE.md § Disk I/O) :
  - `EXPLAIN (ANALYZE, BUFFERS)` en local sur chaque RPC neuve, avec ses chiffres dans le rapport. S'arrêter si un chiffre dépasse de plus de 50 % la mesure de ce plan.
  - Quotas par `lib/api/rate-limit.ts` : `geo:rl:couverture` (6 par minute) pour toute lecture neuve sur une zone.
  - Au plus 3 appels Supabase simultanés.
  - **Ouvrir ④ ne lit rien** de plus qu'aujourd'hui : le compteur réseau de `carte.page.spec.ts` ne bouge pas. Les typologies (T8) se lisent au premier dépli de leur tiroir.
- **Aucune donnée de démo.** Les zones de preuve (dont la zone « France entière ») sont supprimées en T9. Le clustering n'est PAS relancé pour la preuve : on lit les 190 lignes existantes.
- Routes :
  - `export const dynamic = 'force-dynamic'`, Zod, `lireCorps()` pour un corps, et `searchParams` par schéma pour un GET ;
  - garde `requireAuth(request)` dans le source et `getSession` sur `/api/*` ;
  - espace = `espaceDeZone` ; `createAdminClient()` ; erreurs supabase-js lues ;
  - un id de zone d'un autre espace répond 404 avec `refus: 'zone_introuvable'` et la phrase unique « Zone introuvable dans cet espace. ».
- Fichiers `.ts` sous 400 lignes. À ce jour, au plus près du plafond :
  - `panneaux/zones/mes-zones.component.ts` : **404, au-dessus du plafond** (E5, T0) ;
  - `carte.page.ts` : 382 ;
  - `app/api/analyses/score/route.ts` : 370 (T1 extrait plutôt qu'il n'ajoute) ;
  - `app/api/isochrone-battle-v2/route.ts` : 322.
- Textes en sentence case et au vouvoiement. Couleurs par `var(--…)` seulement (MapLibre reçoit les valeurs calculées de `CouleursService`). Inter et JetBrains Mono, bordures 0,5 px.
- `ARCHITECTURE.md` (par `Grep` sur le nom) et `angular/src/app/features/carte/README.md` sont mis à jour dans le commit de chaque tâche qui ajoute une route, une RPC ou un service.
- La preuve se fait sur **:3002 / :4202** (serveurs du worktree), jamais sur :3000 / :4200. Aucun serveur n'est lancé avant T9.

## Review Focus

1. **Une seule règle « CP d'une zone »** (T1) : le score sur une zone retient les mêmes CP que la couverture « Par code postal » de ④ (carreaux dont le centroïde est dans la zone, `cp_des_points`). Une zone de 2 km en zone rurale n'est plus « vide ». Test croisé : même liste, au code près.
2. **La zone « France entière » ne lit aucun carreau** (T2) : la couverture nationale se lit dans les dénominateurs pré-calculés (`cp_population_totale`, `unite_population_totale`), jamais dans `carreau_couverture` (2,3 M lignes). Le découpage IRIS (48 872 lignes) est refusé en une phrase, sans lecture.
3. **Bataille V2 sur la zone** (T3) : la clé de cache porte l'id de la zone ET sa version (`updated_at`). Une zone recalculée en ③ ne relit jamais la bataille de l'ancienne forme. Une zone d'un autre espace répond 404 avant toute lecture de POI.
4. **Typologies sans fuite d'espace** (T4) : seuls les POI VISIBLES de l'espace (`data_source_id is null or = any(sources)`, la règle de sql/254) et situés dans la zone sont rendus. Le calcul d'un modèle reste réservé au super admin.
5. **Rien de neuf à l'ouverture de ④** (T5-T8) : aucune lecture avant un geste, et une réponse d'une zone quittée est jetée (jeton, P-c).

---

## Pré-vol : ce qui existe vraiment (reconnaissance du 30/10, worktree `carte-finitions`, HEAD `61c5869f`)

### L'état de ④ (Angular, `features/carte/panneaux/analyse/`)

| Brique | Fichiers | État |
|---|---|---|
| Couverture d'une zone (telle quelle, par CP, par IRIS), peinte sur la carte | `outil-couverture.component.ts` (221 l.), `tableau-couverture-zone`, `choix-zone-analysee`, `etat/zone-analysee.service.ts`, `couches/couverture.service.ts` | livré (lot 4a) ; barre de progression du chiffrage (`b3610369`, 27/10) |
| Couverture par rayon autour de tout type de POI | `outil-rayon.component.ts`, `etat/couverture-rayon.service.ts`, RPC `couverture_rayon_poi` (sql/272) | livré (lot 4b) ; département, commune, CP ou zone ≤ 12 000 km² ; région refusée (Q-I) |
| Score composite, sur la zone ou sur ① | `outil-score.component.ts`, `etat/score-composite.service.ts`, `POST /api/analyses/score` | livré (lot 4b, T10), **mais la règle des CP d'une zone est fausse (E1)** |
| Corrélation (une campagne × un indicateur) | `outil-correlation.component.ts` | livré (lot 4 Angular, T18) ; la spec la renvoie en Live (Q-6) |
| Bataille V2 (« Analyse spatiale ») | `outil-bataille-v2.component.ts`, `etat/bataille-v2.service.ts` | livrée ; travaille sur ① seulement (A-9) ; demande des POI choisis en ② ; V1 retirée le 27/10 |
| Clustering | `clustering/*` (1 951 l.) | réservé au super admin (`reserverAuSuperAdmin` sur les 11 routes `/api/poi-clusters/*`) ; ne lit pas la zone (Excel n° 34) |
| Radio et trafic | — | retirés le 26/10 (décision de Vincent) ; la RPC `croisements_zone` est **encore en base** (sql/284 non appliquée) |
| Voronoï | — | jamais porté (décision du propriétaire, lot 4 Angular) |

**Tests mesurés le 30/10 :**
- `ng test` sur `panneaux/analyse/**` : **14 fichiers, 123 tests verts** (45 s) ;
- `tests/unit/angular/taille-fichiers.test.ts` : **ROUGE** (E5).

La suite complète n'a pas été relancée (RAM du poste) : elle se joue en T9.

**Parité React :**
- **Ce que React a et pas l'Angular :** la V1, le Voronoï et le clustering (super admin, comme l'Angular).
- **Ce que l'Angular a et pas React :** la couverture d'une zone, la couverture par rayon généralisée, le score « Sur : la zone analysée ».

Ces écarts sont voulus et déjà documentés (README carte, `ecarts-4a.md`, `ecarts-4b.md`). Ce lot n'en ajoute qu'un : la règle des CP d'une zone pour le score, une règle SERVEUR que React reçoit aussi (T1).

### Écarts constatés dans le code et la base

| # | Constat (fichier:ligne, mesure) | Gravité | Tâche |
|---|---|---|---|
| E1 | **Le score sur une zone ne prend pas les mêmes CP que la couverture.** La branche `zone` de `codes_postaux_du_perimetre_jsonb` retient les CP dont le CENTROÏDE DU CONTOUR CP est dans la zone (`ST_Intersects(z.geometry, r.centroid)`), alors que la couverture rattache chaque carreau à son CP (`cp_des_points`). Mesuré sur un disque de 2 km : (0,5 ; 45,9) → **0 CP** au score contre 2 en couverture ; (−1,2 ; 47,5) → 0 contre 2 ; (3,1 ; 44,3) → 0 contre 1 ; Lyon → 2 contre 10 ; Paris → 7 contre 11. Une zone « rayon autour d'un point » en zone rurale rend donc 400 « Périmètre vide : aucun code postal à scorer. » (`app/api/analyses/score/route.ts`, branche `!codesPostaux.length`). Sur la zone composite de 13 001 km² : **459 CP** au score contre **895** en couverture. | **Important** (un outil de ④ échoue sur l'objet que ④ analyse) | T1, Q-1 |
| E2 | **Pas de « mode pays ».** Q-3 du plan ⑥, tranchée par Vincent le 25/10 : « le national passe par une zone France entière créée en ③ ». Mais aucune recette de ③ ne la crée (`lib/zones/recette-schema.ts` : `rayon_poi` et seuils refusent `france/FR` ; `codes_postaux` est plafonné ; l'import est limité à 20 000 sommets). Et `couverture_geometrie` la refuserait au-delà de 100 000 km² (`zone_trop_vaste`, sql/275:108). Le plan ⑥ écrivait « à planifier avant ⑧ ». Le plan ⑧ dit « ligne ④/⑤ de l'Excel » : **cette ligne n'existe pas**. | **Important** (décision de Vincent sans exécution) | T2, T6, Q-2 |
| E3 | **Le clustering n'existe que pour le super admin et ignore la zone.** Excel n° 34 (P1, « juste après ④ ») : « à rendre visible et utilisable dans ④, sur la zone choisie ». Base : 1 job (26/10, `done`), 3 modèles, **190 lignes `poi_clusters` = 95 CIRFA × 2 versions** (v3 15 min, v4 60 min, voiture), une seule source (privée). Le calcul (`scripts/clustering_poi_filosofi.py`, 2 911 l., ORS) lit tous les POI de tous les espaces, d'où la réserve au super admin (`lib/auth/perimetre-donnees.ts:179`). | **Important** (Excel P1) | T4, T8, Q-3 |
| E4 | **La bataille V2 ignore la zone analysée** (A-9 du lot 4) : elle filtre ses POI par nom de région, département ou ville (`isochrone-battle-v2/route.ts:133-173`) et refuse un filtre CP ou zone (`messageRefusTerritoireBataille`). La spec § 16.1 promet « isochrones comparées » parmi les analyses « sur les zones ». | Important (écart à la spec) | T3, T7, Q-4 |
| E5 | **`taille-fichiers.test.ts` est rouge à HEAD** : `panneaux/zones/mes-zones.component.ts` fait **404 lignes** (commit `1e6cf219`, preuve de ③ finitions). Le test échoue, donc `npm run test:unit` aussi. | **Important** (suite rouge, bloque toute fusion) | T0 |
| E6 | Score sur une zone supprimée ou d'un autre espace : la route répond `404 { error: 'Zone introuvable.' }` sans `refus` (`score/route.ts`, `checkZoneAccess`). `ZoneAnalyseeService.siIntrouvable` ne la reconnaît donc pas, et la zone reste dans ④, contrairement à la couverture et au rayon. Phrase différente de « Zone introuvable dans cet espace. ». | Mineur | T1, T5 |
| E7 | La pastille « renseignée » de ④ (`carte.fournisseurs.ts:58-63`) ne s'allume que pour le score, les zones à risque et la couverture : ni pour une bataille V2 peinte, ni pour la couverture par rayon, ni pour le clustering. | Mineur | T5 |
| E8 | La spec ne porte PAS les écarts du lot 4 : les « § 17 ter » et « § 17 quater » sont rédigés dans `.superpowers/sdd/…lot-4/ecarts-4a.md` et `ecarts-4b.md` (non suivis), jamais reportés. Et le § 16.1, ligne ④, promet encore « Voronoï », « croisements radio/trafic/météo » et « rien de l'existant n'est retiré », contredits par les décisions des 26/10 (radio et trafic) et 27/10 (V1). | Mineur (doc qui ment) | T9, Q-5 |
| E9 | `croisements_zone` est encore en base et dans `types/database.types.ts` (sql/284 écrite, non appliquée). | Mineur (dette datée) | au merge, rappelé en T9 |
| E10 | Dettes déclarées du lot 4 : `outil-score` garde ses propres pastilles « Haut / Bas = mieux » et un cycle de catalogue (`basculerOuvert`) hors `LectureAnnulable` (`ecarts-4b.md`, « Ce qui reste dupliqué »). | Mineur (factorisation) | T5 |
| E11 | La couverture par rayon refuse l'Ille-et-Vilaine, ICPE toutes natures à 10 km (`trop_de_poi`, débord de 5 km, ruling du lot 4). | Décision | Q-7 |

### Mesures I/O (base locale, 30/10, lecture seule)

| Requête | Mesure |
|---|---|
| `couverture_geometrie`, zone composite 13 001 km², 23 073 sommets, `forme`, à froid | **5,18 s** · 18 474 hit + **10 421 lus** · temp 734 |
| idem, `iris` | 2,02 s · 53 899 hit + 6 112 lus · temp 1 568 |
| idem, `cp` (à chaud) | **0,48 s** · 34 356 buffers · temp 1 379 · 895 CP |
| `codes_postaux_du_perimetre_jsonb('zone', …)`, même zone | 36 ms · 6 120 buffers · 459 CP |
| `couverture_geometrie`, CIRFA Angoulême (8 890 km²), `cp` | 0,59 s |
| Dénominateur national par CP (`cp_population_totale`, mode pays) | **2,5 ms** · 831 buffers · 6 009 CP · **63 711 780** hab. · jsonb 277 Ko |
| Dénominateur national par IRIS (`unite_population_totale`, maille `iris`) | 209 ms · 48 872 lignes · jsonb **2,4 Mo** (refusé en mode pays, A-4) |
| Union des régions métropolitaines (`coalesce(geom_perimetre, geom)`) | 47 ms · 2 765 sommets · 547 779 km² |
| `carreau_couverture` | 2 324 577 lignes, certificat de complétude valide ; cache `couverture_zone_cache` : 3 lignes |

**Mesures portées par les tâches** (avant tout code) :
- T1 : la RPC neuve sur la zone composite et sur un disque de 2 km (cible ≤ 0,6 s à chaud et ≤ 40 000 buffers sur 13 000 km² ; c'est le coût d'un chiffrage par CP, déjà admis par le quota de 6 par minute) ;
- T3 : POI d'une catégorie dans une zone, catégorie d'abord (CTE `MATERIALIZED`, patron de sql/285 : 53 ms, ≈ 160 buffers sur la métropole) ;
- T4 : lecture des typologies d'une zone (190 lignes au total : trivial ; mesurer quand même).

### Lignes de l'Excel qui touchent ④ (relevées, pas entrées d'office)

| N° | Ligne | Place |
|---|---|---|
| 3 | ④ couverture générique | **fait** (23/10) |
| 34 | Clustering à réintégrer dans ④, sur la zone choisie (M, P1, ordre 10) | **dans le lot si Q-3 = oui** : T4, T8 (lecture des typologies ; le calcul reste au super admin) |
| — | Mode pays (Q-3 du plan ⑥, 25/10), annoncé par le plan ⑧ comme « ligne ④/⑤ » mais **absent de l'Excel** | **dans le lot pour ③ et ④** (T2, T6) ; ⑤ à part. Ligne à créer en T9 |
| 35 | Basic-Fit : une zone par emplacement, puis clustering des zones | **hors lot** : dépend de n° 34 ET d'ORS par lots (n° 44) |
| 44 | Calculs longs en tâche de fond (bataille nationale au-delà de 700 anneaux, « Par seuil » métropole, route de remplissage ORS propre à la V2) | **hors lot** : repoussé après ⑧ le 27/10 |
| 36 | ICPE : ne garder que les Seveso | **hors lot** ; lève E11 (Q-7) |
| 45 | Contraste du teal en clair (CTA « Chiffrer la zone », « Calculer ») | **hors lot** : une règle unique pour la carte (Q-7 de ③) |
| 20 | Risques, population exposée (chantier C) | **hors lot** : 5 arbitrages |
| 32 | Onglets + dossiers | **hors lot** : tout l'état neuf reste dans l'URL (§ 5) |
| 49 | 13 tests d'intégration liés à des données de preuve | **hors lot** ; à ne pas confondre avec un rouge de ce lot en T9 |

### Numéros SQL (revérifiés le 30/10)

- **Dernier numéro pris : 294** (`ls sql .claude/worktrees/*/sql` : ③ finitions 292-294 ; catalogue 288-290). **291 est libre partout.**
- **⚠ Conflit avec ⑧** : le plan ⑧ (`feat/carte-live`, `9803e320`) écrit toujours `sql/288_livraison_plateformes.sql` (« numéro à reconfirmer »). Or **288 est pris** par `288_indicateurs_privables.sql` (catalogue, fusionné dans `feat/carte-finitions`). ③ finitions supposait que ⑧ prendrait 291 : **à dire au chef de ⑧**.
- Ce lot prend donc **295** (T1), **296** (T2), **297** (T3, si une RPC est nécessaire) et **298** (T4). **À revérifier au début de chaque tâche** (`ls sql .claude/worktrees/*/sql | grep -E '^29[0-9]_|^3[0-9]{2}_'`). Si ⑧ a pris plus que 291, décaler.

---

## Arbitrages (tranchés ; coût si faux)

| # | Point | Tranché | Coût si faux |
|---|---|---|---|
| A-1 | Règle des CP d'une zone pour le score (Q-1) | Nouvelle RPC `codes_postaux_de_zone_jsonb(p_zone uuid, p_org uuid) → jsonb` (sql/295), STABLE, `service_role`. Elle rend `{ codes: [...] }` = les `code_postal` distincts de `carreaux_de_forme(geometry, 1)`, la règle UNIQUE de ③ et ④ (`ecarts-4b.md`), en ordre, sans aucun nul. Refus : `zone_introuvable` (zone absente, ou d'un autre espace), `zone_trop_vaste` au-delà de 100 000 km² (la borne de la couverture). Une zone **pays** (A-3) rend les CP de la métropole ou de la France par la branche `france` existante, sans lire un carreau. La route du score appelle cette RPC pour `perimetre.type === 'zone'` ; les autres types gardent `codes_postaux_du_perimetre_jsonb`, inchangée (aucune fonction partagée réécrite). | une branche à rétablir dans la route |
| A-2 | Phrase et forme du 404 du score sur une zone | `{ error: 'Zone introuvable dans cet espace.', refus: 'zone_introuvable' }` (la phrase unique du lot 4). Côté Angular, `ScoreCompositeService` passe l'erreur à `ZoneAnalyseeService.siIntrouvable`, comme la couverture par rayon. | — |
| A-3 | Forme du mode pays (Q-2) | Recette neuve `{ v: 1, type: 'pays', code: 'METRO' \| 'FR' }`, **figée** : la géométrie est l'union de `coalesce(geom_perimetre, geom)` des régions (métropole : hors `01`-`06` ; France : toutes), calculée par une RPC (47 ms, 2 765 sommets). Elle s'écrit par `POST /api/zones` (quota `geo:rl:zones`) et se range dans la famille « À la main » de ③ (bouton « France métropolitaine » / « France entière », aucun formulaire). Une zone `pays` se reconnaît à sa RECETTE, jamais à sa surface. | une recette de plus dans les copies paritaires |
| A-4 | Couverture d'une zone pays | `couverture_pays_jsonb(p_code text, p_cible text, p_decoupage text)` (sql/296) **ne lit aucun carreau** : `forme` → total national de la cible (`cp_population_totale`, la référence de Q-J) ; `cp` → chaque CP à 100 % (6 009 lignes, 277 Ko) ; `departement` → `unite_population_totale` ; `iris` et `commune` → refus `decoupage_trop_fin_pays` (« 48 872 IRIS : choisissez le découpage par code postal. »), sans lecture. `couverture_zone` (l'enveloppe à cache) l'appelle quand la recette est `pays`, AVANT la borne de 100 000 km². Le cache et le quota sont inchangés. | une liste IRIS de 2,4 Mo à paginer côté serveur |
| A-5 | ⑤ et ⑥ face à une zone pays | **Hors lot.** ⑤ refuse toujours (`zone_trop_vaste`), mais avec un message neuf, dans `lib/zones/couverture.ts` seulement : « Zone nationale : le ciblage France natif des plateformes arrive avec les finitions de ⑤. ». La ligne Excel « Mode pays — ⑤ » est créée en T9. | le message à retirer |
| A-6 | Bataille V2 sur la zone (Q-4) | Paramètre `zone_id: z.string().uuid().nullable().default(null)` dans le corps V2. S'il est présent, l'espace est contrôlé (`espaceDeZone`, 404 sinon), et les POI de la catégorie sont lus **catégorie d'abord** puis `ST_Intersects` avec la forme de la zone. Ils passent par une RPC `jsonb` `poi_de_zone(p_zone, p_org, p_categorie, p_sources, p_limite)` (sql/297), `limit` = `PLAFOND_LECTURE_POI + 1` (500 + 1). Les filtres région, département et ville sont ignorés. Clé de cache `…__z<id>_<epoch de updated_at>__p<empreinte>`, capturable par ③ (finitions T4) puisqu'elle garde le suffixe `__p`. La capacité synchrone de 700 anneaux s'applique telle quelle (pas de borne produit, décision du 26/10). Une zone pays est refusée en une phrase : « Sur toute la France, la bataille se lance depuis l'étape ① (France métropolitaine). ». | un paramètre à retirer |
| A-7 | Clustering pour tous (Q-3) | **Lecture seule** des typologies DÉJÀ calculées : `GET /api/zones/[id]/typologies` → RPC `typologies_de_zone(p_zone, p_org, p_sources)` (sql/298). Elle rend, pour le DERNIER modèle par (`duration_minutes`, `mode`), les POI visibles de l'espace dont le point est dans la zone, avec `cluster_label`, `cluster_id`, la population couverte et le profil moyen du cluster ; au plus 5 000 POI (`tronque`). Le calcul (`/api/poi-clusters/run`, Python, ORS) et la gestion des modèles restent réservés au super admin, sans changement. Aucune typologie dans la zone : « Aucun POI typé dans cette zone : les typologies sont calculées par l'équipe dentsu (CIRFA aujourd'hui). ». | ouvrir le calcul : script Python et cloisonnement (n° 34 complet, L) |
| A-8 | Pastille de ④ (E7) | La pastille s'allume aussi sur une bataille V2 peinte (`BatailleService`, page). La couverture par rayon et les typologies sont fournies par le PANNEAU (P-e) : elles publient un signal `peinte` dans un petit registre de page, `etat/analyses-peintes.ts`, lu par `suivreAnalyseAffichee`. | un fichier |
| A-9 | Spec et Voronoï (Q-5) | § 16.1, ligne ④, réécrite d'après ce qui existe ; « Voronoï : non porté, abandonné » ; radio et trafic retirés le 26/10 ; V1 retirée le 27/10. Les § 17 ter et 17 quater sont recopiés de `ecarts-4a.md` et `ecarts-4b.md`, et un « 17 sexies » (finitions de ④) est ajouté. | une ligne |
| A-10 | Dettes de `outil-score` (E10) | Les pastilles « Haut / Bas = mieux » passent sur `mg-pastilles`, et le catalogue sur `LectureAnnulable.chargerUneFois`. À comportement constant : les specs existantes ne changent pas. | — |
| A-11 | Ce qu'on garde tel quel | Retour de ⑤ vers ④ : « Afficher sur la carte » rend la couverture (`17 quinquies`). Deux chiffres pour une zone (A-15 du lot 4 : plan média de « Mes zones » par intersection). Refus de l'Ille-et-Vilaine à 10 km. Couverture par rayon sur une région (pré-calcul quand un client la demande). Corrélation en ④ jusqu'au déménagement en ⑧. Voir Q-6 et Q-7. | voir Q-6, Q-7 |

## Questions pour Vincent (produit seulement ; recommandation entre crochets)

| # | Question | Ce qui en dépend | Recommandation |
|---|---|---|---|
| Q-1 | **Score composite sur une zone** : aujourd'hui, il ne retient que les codes postaux dont le CENTRE est dans la zone. Une zone de 2 km à la campagne n'en contient aucun, et le score répond « Périmètre vide ». On prend plutôt **tous les codes postaux où la zone a des habitants**, la même liste que la couverture « Par code postal » ? (React reçoit la même correction, côté serveur.) | T1, T5 | **[Oui : une seule règle pour ④, et la fin des scores vides.]** |
| Q-2 | **Campagne nationale** (votre décision du 25/10 : « une zone France entière créée en ③ ») : on ajoute en ③ « France métropolitaine » et « France entière » comme zones prêtes, et ④ les chiffre par la population nationale (par CP ou par département ; l'IRIS est refusé, 48 872 lignes) ? ⑤ suivra dans ses finitions. | T2, T6 | **[Oui pour ③ et ④ dans ce lot ; ⑤ à part (ciblage France natif des plateformes).]** |
| Q-3 | **Clustering dans ④ pour tous** (Excel n° 34) : on montre les typologies DÉJÀ calculées des POI de la zone analysée (aujourd'hui : les 95 CIRFA, deux durées d'isochrone), le calcul d'un nouveau modèle restant réservé à l'équipe dentsu ? | T4, T8 | **[Oui : lecture seule, sans toucher au script Python ni au cloisonnement. Le calcul pour tous reste un chantier L, lié à Basic-Fit (n° 35).]** |
| Q-4 | **Bataille V2 sur la zone analysée** : lancer la bataille sur les POI d'une catégorie situés DANS la zone, plutôt que seulement sur la région ou le département de ① ? | T3, T7 | **[Oui : c'est l'analyse « isochrones comparées » que la spec promet sur les zones.]** |
| Q-5 | **Voronoï** : jamais porté en Angular. On l'abandonne officiellement (la spec le promet encore) ? | T9 (doc) | **[Oui : il ne se lançait que par l'assistant IA, supprimé.]** |
| Q-6 | **Corrélation** (impressions d'une campagne × indicateur) : la spec l'envoie en Live (13/10). Elle reste en ④ jusqu'à ce que ⑧ soit livré, puis elle y déménage ? | hors lot | **[Oui : une ligne dans le plan ⑧ ; rien à coder ici.]** |
| Q-7 | **Trois écarts du lot 4, gardés tels quels** : (a) de retour de ⑤, la couverture ne se repeint pas seule (bouton « Afficher sur la carte ») ; (b) « Mes zones » et ④ donnent deux populations pour une zone (+1,3 % sur CIRFA Bretagne) ; (c) la couverture par rayon refuse l'Ille-et-Vilaine en ICPE toutes natures à 10 km. | hors lot | **[Garder : (a) aucun calcul caché ; (b) au nettoyage final (n° 39) ; (c) levé par la ligne n° 36 (ne garder que les Seveso).]** |

En attendant les réponses, le plan applique les recommandations. Chaque arbitrage dit son coût si la réponse est autre. Une réponse « non » à Q-3 retire T4 et T8 (0,7 j) ; à Q-4, T3 et T7 (0,75 j) ; à Q-2, T2 et T6 (0,8 j). Ces retraits n'ont aucun effet sur les autres tâches.

---

## File Structure

| Fichier | Responsabilité | Tâche |
|---|---|---|
| `angular/…/carte/panneaux/zones/mes-zones.component.ts` (+ un fichier extrait) | retour sous 400 lignes | T0 |
| `sql/295_codes_postaux_de_zone.sql` (neuf) | `codes_postaux_de_zone_jsonb` | T1 |
| `app/api/analyses/score/route.ts`, `lib/analyses/perimetre-score.ts` (neuf, extrait de la route) | règle de la zone, 404 normalisé | T1 |
| `sql/296_zone_pays.sql` (neuf), `lib/zones/recette-schema.ts`, `lib/zones/recette.ts`, `lib/zones/executer-recette.ts`, `lib/zones/couverture.ts` | recette `pays`, couverture nationale, message de ⑤ | T2 |
| `sql/297_poi_de_zone.sql` (neuf), `app/api/isochrone-battle-v2/route.ts` | bataille V2 sur une zone | T3 |
| `sql/298_typologies_de_zone.sql` (neuf), `app/api/zones/[id]/typologies/route.ts` (neuf) | typologies d'une zone | T4 |
| `tests/integration/analyse-finitions.test.ts` (neuf) ; `tests/unit/api/{score-zone,typologies-route}.test.ts` | T1-T4 | T1-T4 |
| `angular/…/carte/{etat/score-composite.service.ts, panneaux/analyse/outil-score.component.ts, carte.fournisseurs.ts, etat/analyses-peintes.ts (neuf)}` | 404 de la zone, pastille, dettes du score | T5 |
| `angular/…/carte/{logique/zones/recette.ts (copie paritaire), panneaux/zones/panneau-zones.component.ts ou creer-pays.component.ts (neuf), logique/analyses/couverture.ts, panneaux/analyse/outil-couverture.component.ts}` | ③ « France entière », ④ couverture pays | T6 |
| `angular/…/carte/{etat/bataille-v2.service.ts, etat/contexte-bataille.service.ts, panneaux/analyse/outil-bataille-v2.component.ts, panneaux/analyse/panneau-analyse.component.ts}` | « Sur : la zone analysée / le périmètre de ① » pour la V2 | T7 |
| `angular/…/carte/{data/couverture.api.ts, panneaux/analyse/typologies-zone.component.ts (neuf), panneaux/analyse/clustering/section-clustering.component.ts, etat/tiroirs-analyse.ts}` | tiroir « Typologies » pour tous | T8 |
| `ARCHITECTURE.md`, README carte, spec (§ 16.1, 17 ter, 17 quater, 17 sexies), Excel | docs | T1-T4, T9 |

## Pièges Angular / AIDA (à recopier dans CHAQUE brief de tâche Angular)

- **Racine d'ombre :** jamais `document`, jamais `position: fixed` ; les écouteurs vont sur l'élément du composant. Services d'API dans `FOURNISSEURS_DISTANTS`, adresses par `HttpBaseService.baseUrl`, pas de `@angular/core/rxjs-interop`.
- **Signals :** `OnPush`, aucun calcul dans le gabarit. `input()` se lit en fonction (P-d). Un `effect()` qui écrit ce qu'il lit boucle : `untracked()` (P-a).
- **Lectures (P-c) :** toute lecture passe par `LectureAnnulable` (jeton + `DestroyRef`). Une réponse d'une zone, d'une catégorie ou d'un espace quittés n'est jamais affichée.
- **P-e :** le panneau ④ reste MONTÉ ; une couche se retire au `DestroyRef` du service qui l'a posée.
- **MapLibre :** jamais `var()` dans `paint` (couleurs par `CouleursService`). `fitBounds` par `marge-carte.ts`.
- **Écrivain d'URL unique (P-g) :** `ecrireParametres` (`etat/ecrire-parametres.ts`). Tout état neuf partageable va dans l'URL (§ 5).
- **`POST /api/zones` n'est pas idempotent** (T6) : bouton inactif dès le premier clic ; réponse perdue → « vérifiez Mes zones » ; 207 = réussite.
- **Copies paritaires verrouillées :** `recette.ts` ↔ `lib/zones/recette.ts`, `couverture.ts` ↔ `lib/zones/couverture.ts`. Changer les deux, et `recette-paritaire` / `couverture-paritaire` restent verts.
- **Deux thèmes prouvés ; fichiers sous 400 lignes ; aucune lecture neuve à l'ouverture de ④.**

---

## Pré-requis

### Task 0 : la suite redevient verte (effort XS, 0,05 j)

- [ ] `npx vitest run --project unit tests/unit/angular/taille-fichiers.test.ts` : FAIL constaté (404 lignes).
- [ ] Extraire de `mes-zones.component.ts` un bloc cohérent (gestion des gestes : dupliquer et recalculer) dans `logique/zones/gestes-zone.ts`, comme l'autorisait la T5 de ③ finitions, à comportement constant. Les specs de `mes-zones` ne changent pas.
- [ ] Test vert ; `cd angular && npx ng test --watch=false --include='src/app/features/carte/panneaux/zones/**'`.
- [ ] Commit `fix(angular): Mes zones repasse sous 400 lignes (④ finitions, T0)`.

## Groupe A — serveur (relecture 1)

### Task 1 : le score sur une zone prend les CP de la couverture (effort S, 0,3 j)

- [ ] **Mesure d'abord** : prototype dans une transaction annulée, puis `EXPLAIN (ANALYZE, BUFFERS)` sur la zone composite (`919ca65d…`, 13 001 km²) et sur un disque de 2 km en (0,5 ; 45,9). Cibles : ≤ 0,6 s à chaud et ≤ 40 000 buffers ; 2 CP pour le disque.
- [ ] Revérifier le numéro libre (295). **Tests d'abord**, dans `tests/integration/analyse-finitions.test.ts` :
  - (a) zone-disque créée par le test, puis supprimée → `codes_postaux_de_zone_jsonb` rend les mêmes codes que `couverture_geometrie(…,'cp')->'lignes'[*].code` (égalité d'ensembles) ;
  - (b) zone composite → 895 codes (valeur mesurée, écrite dans le test) ;
  - (c) zone d'un autre espace → `zone_introuvable` ;
  - (d) zone de plus de 100 000 km² → `zone_trop_vaste`.

  Dans `tests/unit/api/score-zone.test.ts` :
  - `perimetre: { type: 'zone' }` appelle la RPC neuve, et pas `codes_postaux_du_perimetre_jsonb` ;
  - zone inaccessible → 404 `{ refus: 'zone_introuvable', error: 'Zone introuvable dans cet espace.' }` ;
  - les autres types sont inchangés, octet pour octet.

  FAIL attendu.
- [ ] `sql/295_codes_postaux_de_zone.sql` (A-1). Appliquer en local deux fois. `comment on function`, `grant execute … to service_role` seulement.
- [ ] Route : extraire la résolution du périmètre dans `lib/analyses/perimetre-score.ts` (la route redescend sous 370 lignes), puis brancher la zone sur la RPC (A-1, A-2). Régénérer `types/database.types.ts` (le diff n'ajoute que la RPC).
- [ ] `ARCHITECTURE.md` (`Grep "api/analyses/score"`, `"codes_postaux_du_perimetre"`) : règle unique, écart React. `npx tsc --noEmit`, `npm run test:unit`, `npm run test:integration`, codes de retour lus sans pipe.
- [ ] Commit `fix(api): le score sur une zone prend les codes postaux de la couverture (④ finitions, T1)`.

### Task 2 : la zone « France entière » et sa couverture nationale (effort M, 0,45 j — si Q-2 = oui)

- [ ] **Mesure** : union des régions (métropole et France) ; `couverture_pays_jsonb` prototypée en `forme`, `cp` et `departement`, avec la cible `ind` puis une cible du catalogue (`rang_pop` 5). Cible : < 50 ms, < 2 000 buffers, `cp` < 300 Ko.
- [ ] Revérifier le numéro libre (296). **Tests d'abord**, dans `analyse-finitions.test.ts` :
  - recette `pays` `METRO` → zone créée, `ST_NumGeometries` ≥ 1, aucune intersection avec la région `03` ;
  - `couverture_zone` d'une zone pays : `forme` = somme de `cp_population_totale` hors DROM (valeur mesurée) ; `cp` = 100 % partout et nombre de lignes = nombre de CP métropolitains ; `iris` → `decoupage_trop_fin_pays`, sans lecture ;
  - une zone NON pays de plus de 100 000 km² → toujours `zone_trop_vaste` ;
  - rejouer la migration → aucun changement.

  Dans `tests/unit/zones/recette.test.ts` : schéma `pays` (`METRO` | `FR`, tout le reste refusé), `libelleRecette` (« France métropolitaine » / « France entière »), recette figée, message de ⑤ (A-5). FAIL attendu.
- [ ] `sql/296_zone_pays.sql` : la géométrie pays (`zone_pays_geometrie(p_code)`), `couverture_pays_jsonb`, et `couverture_zone` en `create or replace` (branche pays AVANT la borne de surface ; corps sinon inchangé, diff relu ligne à ligne). Appliquer deux fois.
- [ ] `recette-schema.ts`, `recette.ts`, `executer-recette.ts` (A-3), `lib/zones/couverture.ts` (refus `decoupage_trop_fin_pays` et message de ⑤, A-5). Types régénérés.
- [ ] `ARCHITECTURE.md` (`Grep "couverture_zone"`, `"recette"`). tsc, unit, integration.
- [ ] Commit `feat: zone « France entière » et sa couverture nationale, sans lecture de carreaux (④ finitions, T2)`.

### Task 3 : la bataille V2 sur la zone analysée (effort S-M, 0,4 j — si Q-4 = oui)

- [ ] **Mesure** : `poi_de_zone` prototypée, catégorie d'abord, sur la zone composite (`cirfa`, `lycee`) et sur une zone départementale (`lycee`). Cible : < 100 ms, < 2 000 buffers. Le plan sans `MATERIALIZED` est relevé et comparé (le piège GiST des retours du 26/10 : 306 000 buffers).
- [ ] Revérifier le numéro libre (297). **Tests d'abord** : `tests/integration/bataille-v2-zone.test.ts` (handler appelé, auth mockée, patron de `bataille-v2-borne.test.ts`), avec quatre cas :
  - `cirfa` sur une zone Bretagne → `result` dont tous les POI sont dans la zone ;
  - zone d'un autre espace → `error` « Zone introuvable dans cet espace. » sans lecture de POI ;
  - zone pays → la phrase d'A-6 ;
  - la clé rendue (`battleCacheKey`) contient `__z<id>_` et finit par `__p<empreinte>`.

  Plus un test de recalcul : une zone recalculée (`updated_at` changé) produit une clé différente. FAIL attendu.
- [ ] `sql/297_poi_de_zone.sql` (A-6), la route (`zone_id`). Aucune autre ligne de la route ne change. La route protégée et les fonctions de bataille sont intactes (`git diff --stat`).
- [ ] `ARCHITECTURE.md` (`Grep "isochrone-battle-v2"`). tsc, unit, integration (le test ne lance jamais plus de 300 anneaux).
- [ ] Commit `feat(api): bataille V2 sur une zone enregistrée (④ finitions, T3)`.

### Task 4 : les typologies d'une zone (effort S, 0,3 j — si Q-3 = oui)

- [ ] **Mesure** : `typologies_de_zone` prototypée sur une zone Bretagne de la Marine (CIRFA typés) et sur une zone sans POI typé. `EXPLAIN` au rapport.
- [ ] Revérifier le numéro libre (298). **Tests d'abord**, dans `analyse-finitions.test.ts` :
  - zone Marine → les CIRFA de la zone, une ligne par POI et par (durée, mode) du DERNIER modèle ;
  - le même appel avec les sources d'un AUTRE espace → 0 POI (la source CIRFA est privée) ;
  - zone sans POI typé → liste vide et `motif: 'aucun_poi_type'`.

  Dans `tests/unit/api/typologies-route.test.ts` : 401, 404 (autre espace), 429 (quota `geo:rl:couverture`), 200, et le fait que la route n'exige PAS le super admin. FAIL attendu.
- [ ] `sql/298_typologies_de_zone.sql` (A-7), la route (`getOrgSourceIds({…}, { vueEspace: true })`, `espaceDeZone`). Inscrire la route dans `perimetre-routes.test.ts` et dans les tests de validation.
- [ ] `ARCHITECTURE.md` (route et RPC neuves ; § clustering : « lecture ouverte, calcul réservé »). tsc, unit, integration.
- [ ] Commit `feat(api): typologies des POI d'une zone, en lecture pour tous (④ finitions, T4)`.

**Relecture 1** (T1 à T4, une passe, le modèle le plus capable). Questions :
- Une RPC lit-elle un carreau pour une zone pays ?
- Les règles « CP d'une zone » de T1 et de la couverture sont-elles la même fonction ?
- Un id de zone d'un autre espace peut-il servir d'oracle (score, bataille, typologies) ?
- La route protégée a-t-elle bougé ?
- Les migrations sont-elles rejouables ?

## Groupe B — Angular (relecture 2)

### Task 5 : le score suit la zone, la pastille dit vrai, le score factorisé (effort S, 0,3 j)

- [ ] **Specs d'abord :**
  - `score-composite.service.spec.ts` : un 404 `zone_introuvable` retire la zone de ④ (`siIntrouvable`) et garde le message ; un 400 de la route affiche son texte.
  - `carte.page.spec.ts` / `carte.fournisseurs.spec.ts` : la pastille de ④ s'allume sur une bataille V2 peinte et sur un signal du registre `analyses-peintes` (A-8).
  - `outil-score.component.spec.ts` : inchangé, et vert après la factorisation (A-10).
- [ ] Implémentation : A-2 côté écran, A-8, A-10.
- [ ] ng test, tsc. Commit `fix(angular): ④ le score retire une zone introuvable, la pastille compte toutes les analyses peintes (④ finitions, T5)`.

### Task 6 : « France entière » en ③, couverture nationale en ④ (effort S, 0,35 j — si Q-2 = oui)

- [ ] **Specs d'abord :**
  - ③ : deux boutons « France métropolitaine » et « France entière » dans « À la main », avec le nom par défaut ; un clic = un `POST /api/zones` portant la recette `pays` ; un second clic est ignoré en vol ; 207 = réussite ; statut 0 → « vérifiez Mes zones ».
  - `recette-paritaire.test.ts` vert après la recopie.
  - ④ : sur une zone pays, la pastille « Par IRIS » est inactive et dit pourquoi (le texte d'A-4) ; « Telle quelle » montre la population nationale avec la phrase Q-J ; « Par code postal » affiche le tableau, sans couche IRIS.
  - `carte.page.spec.ts` : aucune lecture neuve à l'ouverture de ③ ni de ④.
- [ ] Implémentation (A-3, A-4). Si `panneau-zones.component.ts` dépasse 380 lignes, passer par un composant neuf, `creer-pays.component.ts`.
- [ ] ng test, tsc. Commit `feat(angular): ③ zone France entière, ④ sa couverture nationale (④ finitions, T6)`.

### Task 7 : la bataille V2 « Sur : la zone analysée » (effort S, 0,35 j — si Q-4 = oui)

- [ ] **Specs d'abord :**
  - `bataille-v2.service.spec.ts` : avec une zone analysée et « Sur : la zone », le corps porte `zone_id` et aucun filtre région, département ou ville ; « Sur : le périmètre de ① » rend le corps d'aujourd'hui, octet pour octet.
  - Une réponse arrivée après un changement de zone est jetée. Un 404 `zone_introuvable` retire la zone.
  - `panneau-analyse.component.spec.ts` : la garde laisse passer une bataille sur la zone sans filtre ① ; la ligne A-9 (« Cet outil travaille sur le périmètre de l'étape ① ») ne s'affiche plus pour la bataille quand elle est « Sur : la zone ».
  - Le verrou `panneau-analyse-garde.test.ts` est complété, pas désactivé.
- [ ] Implémentation : la bascule `mg-pastilles` « Sur » (le patron du score, T10 du lot 4 ; défaut = la zone quand il y en a une) et `messageRefusTerritoireBataille`, contournée quand la bataille est sur la zone.
- [ ] ng test, tsc. Commit `feat(angular): ④ la bataille V2 sur la zone analysée (④ finitions, T7)`.

### Task 8 : le tiroir « Typologies » pour tous (effort S-M, 0,4 j — si Q-3 = oui)

- [ ] **Specs d'abord :**
  - `typologies-zone.component.spec.ts` : aucune lecture avant le premier dépli ; une seule lecture par (zone, version) ; rouvrir ne relit rien ; sans zone analysée → « Choisissez une zone en tête de ④. » ; liste vide → le texte d'A-7.
  - Le résultat montre un tableau par (durée, mode) : typologie, nombre de POI, population couverte ; les POI se peignent sur la carte, colorés par typologie (palette `--nature-*`, valeurs calculées) ; survol → surbrillance.
  - `tiroirs-analyse` gagne `typologies` (exclusif avec les autres).
  - Le super admin garde l'assistant de calcul dessous (`mg-section-clustering`), inchangé.
- [ ] Implémentation (A-7) : `CouvertureApi.typologies(zoneId)`, le composant, une couche `couverture-typologies` retirée au `DestroyRef` de son service.
- [ ] ng test, tsc. Commit `feat(angular): ④ typologies des POI de la zone, visibles par tous (④ finitions, T8)`.

**Relecture 2** (T0, T5 à T8). Questions :
- Une lecture part-elle à l'ouverture de ④ ?
- Une réponse de zone quittée peut-elle s'afficher ?
- La bataille « Sur : ① » est-elle identique à avant ?
- Les copies paritaires sont-elles vertes ?
- Contraste en clair (hors teal, n° 45) ?
- Fichiers sous 400 lignes ?

## Task 9 : revue finale, factorisation, preuve navigateur, docs (effort 0,4 j)

- [ ] **Revue finale** du lot, par le modèle le plus capable : les mineurs accumulés, puis la passe de factorisation (mémoire `feedback_factorisation_fin_de_lot`). Dire ce qui reste dupliqué : `recette.ts` et `couverture.ts` le sont par construction et sont verrouillés ; `codes_postaux_du_perimetre_jsonb` garde sa branche `zone` (React l'appelle encore par d'autres routes, si `Grep` en trouve).
- [ ] **Preuve navigateur, une seule fois, deux thèmes** (`L-A4-T9-*`, captures dans `.superpowers/sdd/2026-10-30-carte-en-parcours-analyse/`), sur **:3002 + :4202** :
  1. Zone « rayon autour d'un point » de 2 km en zone rurale → score composite calculé (plus de « Périmètre vide »), mêmes CP que la couverture « Par code postal » ;
  2. ③ « France métropolitaine » → ④ telle quelle (population nationale), par CP, par IRIS refusé avec sa phrase ; ⑤ affiche le message d'A-5 ;
  3. Marine nationale : zone CIRFA Bretagne → bataille V2 « Sur : la zone », CIRFA de la zone seulement, puis ③ capture la bataille ;
  4. Typologies des CIRFA de la zone avec un compte NON super admin ; BMW sur la même zone → aucun CIRFA ;
  5. zone supprimée dans un autre onglet → score : zone retirée de ④, avec son message ;
  6. pastille de ④ allumée par la bataille V2 seule ;
  7. onglet réseau : aucune lecture à l'ouverture de ④ ; rouvrir un tiroir ne relit rien.

  **React (:3002 `/map`)** : le score sur un filtre zone donne la même liste de CP (écart serveur assumé). Zones de preuve supprimées, espace actif rétabli.
- [ ] **Docs :**
  - spec : § 16.1 ligne ④ réécrite (A-9) ; § 17 ter et 17 quater recopiés de `ecarts-4a.md` / `ecarts-4b.md` (commit `docs(spec)` séparé) ; « 17 sexies — finitions de ④ » ;
  - README carte (§ ④) et `ARCHITECTURE.md` ;
  - Excel : n° 34 (État) ; création de « Mode pays — ⑤ (ciblage France natif) » ; rappel n° 44 ;
  - plan ⑧ : signaler le conflit sur sql/288 et la corrélation à déménager (Q-6), par une note au chef de ⑧, sans modifier sa branche ;
  - sql/284 rappelée pour le merge.
- [ ] **Tests complets** : `npm test`, `cd angular && npx ng test --watch=false`, `npx tsc --noEmit`, `npm run lint`, `npm run build` (avec `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_ANON_KEY` locaux explicites), `cd angular && npx ng build`. Les 13 rouges connus de l'Excel n° 49 sont nommés, pas confondus avec ce lot.
- [ ] Commit `docs: ④ Analyse — revue finale et preuve navigateur (finitions, T9)`.

---

## Estimation

| Groupe | Tâches | Charge |
|---|---|---|
| Pré-requis | T0 | 0,05 j |
| A serveur | T1, T2, T3, T4 | 1,45 j (T2 : 0,45 si Q-2 ; T3 : 0,4 si Q-4 ; T4 : 0,3 si Q-3) |
| B Angular | T5, T6, T7, T8 | 1,4 j (T6 : 0,35 si Q-2 ; T7 : 0,35 si Q-4 ; T8 : 0,4 si Q-3) |
| Fin | T9 | 0,4 j |
| Relectures | 2 | ≈ 0,1 j |
| **Total** | **10 tâches, 2 relectures, 1 preuve** | **≈ 3,4 jours** (≈ 2 j sans Q-3 ni Q-4 ; ≈ 1,15 j avec T0, T1, T5 et T9 seuls) |

T0 et T1 (le score sur les petites zones) ne dépendent de rien. Ils peuvent partir seuls, tout de suite, si Vincent veut le correctif avant les réponses.

## Critères de fin du lot

- La suite est verte, dont `taille-fichiers`.
- Le score sur une zone retient les CP de la couverture, et une petite zone n'est plus « vide ».
- Une zone « France entière » se crée en ③ et se chiffre en ④ sans lire un carreau ; ⑤ dit quand il la prendra.
- La bataille V2 se lance sur la zone analysée, et sa clé suit la version de la zone.
- Les typologies déjà calculées des POI de la zone sont visibles par tous, sans fuite d'espace.
- La pastille de ④ dit vrai.
- La spec dit ce que ④ est (§ 16.1, 17 ter, 17 quater, 17 sexies).
- React est inchangé, hors la règle serveur de T1 listée.
- Tests et builds verts ; preuve navigateur dans les deux thèmes.

## Hors champ

- Calcul d'un modèle de clustering par un client, et clustering des emplacements Basic-Fit (n° 34 complet, n° 35).
- Bataille nationale et « Par seuil » métropole en tâche de fond, plus la route de remplissage ORS propre à la V2 (n° 44).
- Couverture par rayon sur une région (pré-calcul national, Q-I du lot 4).
- Mode pays dans ⑤ et ⑥.
- Corrélation déménagée en ⑧ (Q-6).
- Unification des deux chiffres d'une zone (A-15 du lot 4).
- Contraste du teal (n° 45).
- Découpages « Par commune » et « Par département » dans ④ (la RPC les sait depuis le lot 5, et ⑤ les montre par plateforme).
- Météo (lot 10, Q-D).
- Voronoï (Q-5).
- Application de sql/284 (au merge).
