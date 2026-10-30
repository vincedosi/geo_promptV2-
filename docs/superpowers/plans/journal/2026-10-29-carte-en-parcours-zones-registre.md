# SDD ledger — plan: docs/superpowers/plans/2026-10-29-carte-en-parcours-zones.md
Worktree .claude/worktrees/carte-finitions, branche feat/carte-finitions (HEAD au plan : 857ac3ed). Mode accéléré, agents opus, 2 groupes + T7.
Spec : 2026-10-13-carte-en-parcours-design.md § 16 (fait foi), § 17 bis (V-1..V-9), § 19.3-19.4 (custom bidding temps 2).

## Pré-vol (29/10, architecte)
- ③ Angular livré (lots 3-4, retours 26/10) ; parité des créateurs et de Mes zones relevée par chaînes visibles : aucun manque, côte à côte dû en T7.
- E1 CRITIQUE : bataille non capturable depuis le retrait V1 (210404df) — bataille-v2.service.ts:168 pose cle:null alors que isochrone-battle-v2 rend battleCacheKey (:156, :306).
- E2 aperçu sans recadrage ; E3 message « Zone créée » persistant ; E4 script custom bidding dans Mes zones (§ 19) ; E5-E8 = V-2, V-4, V-6, V-8 ; E9 CIRFA orphelines (Excel 23) ; E10 teal clair (Excel 45, hors lot).
- Base locale ÉTEINTE au pré-vol (Docker Desktop arrêté, non relancé) : mesures portées par T1-T4.
- SQL : dernier pris 290 ; ⑧ prendra 291 ; ce lot 292 (T1) et 293 (T3) — à revérifier.
- Questions Q-1..Q-8 (plan) : le plan applique les recommandations en attendant.

## Statut des tâches
- [x] T1 seuil carreaux min ménages + codes normalisés (sql/292) — Groupe A
- [x] T2 route « Dupliquer » — Groupe A
- [x] T3 CIRFA → custom_geo_zones (sql/293, si Q-8 = migrer) — Groupe A
- [x] Relecture 1 (groupe A)
- [x] T4 capture de la bataille V2 (peut partir seule en premier) — Groupe B
- [x] T5 Mes zones : Dupliquer, sans script bidding, provenance du score — Groupe B
- [x] T6 atelier : recadrage, message, champ min ménages — Groupe B
- [x] Relecture 2 (groupe B)
- [x] T7 revue finale, preuve navigateur deux thèmes (:3002/:4202), doc, Excel 23-24

== RESUME HERE ==
1. Lire les réponses de Vincent à Q-1..Q-8 (une réponse ≠ reco : amender l'arbitrage cité, retirer la partie de tâche concernée).
2. Vérifier que la base locale tourne (docker ps) ; sinon scripts/local/00-docker-up.sh puis 01-supabase-up.sh.
3. Revérifier les numéros SQL libres (`ls sql .claude/worktrees/*/sql | grep -E '^29[0-9]_'`).
4. Dispatcher T4 seul si Vincent veut le correctif critique d'abord ; sinon Groupe A (T1+T2+T3) à UN implémenteur, BASE = HEAD courant ; puis relecture 1.
29/10 : Vincent suit TOUTES les recos Q-1..Q-8 (Q-8 = migrer). Docker relancé ; Groupe A (T1-T3) à dispatcher à un implémenteur, BASE ef4fd3d8, rapport task-1-3-report.md.
Groupe A DONE_WITH_CONCERNS : 7c35fd6c · a5f21379 · 4a133185 (sql/292-294). Écart : recette CIRFA isochrone figée au lieu d'import ; min sur ménages même pour parts d'individus (à trancher). Relecture 1 dispatchée.
Relecture 1 : ✅, I-1 + mineurs corrigés 95d4d268 · 0f0159f3 ; provenance en deux temps acceptée (creer_zone_recette partagée). Tasks 1-3 complete. Groupe B (T4-T6) dispatché, BASE 0f0159f3, rapport task-4-6-report.md.

29/10 — ARRÊT PROPRE demandé par Vincent. Groupe B arrêté en cours : T4 7ffd05bf, T5 36c336cd (vérifier que « score avec sa provenance » de T5 y est), T6 = specs seules en WIP (commit wip, rouge attendu). Rien relu du Groupe B. Poussé.
== RESUME HERE (v2) ==
1. Lire le diff 0f0159f3..HEAD ; vérifier T5 complet (Dupliquer/Recalculer, script bidding retiré, score provenance).
2. Finir T6 depuis le WIP (specs déjà écrites) : implémentation, ng test ciblé, tsc, commit (amender rien : nouveau commit).
3. Relecture 2 (Groupe B) puis correctifs.
4. T7 : revue finale, factorisation, preuve navigateur 2 thèmes :3002/:4202 (fermer d'abord les Chrome orphelins ; config.local.json présent), suppression des zones de preuve.
5. Clôture : push, Excel (ligne ③ à créer/mettre à jour), archive du registre dans docs/superpowers/plans/journal/.

== 30/10 ==
- Docker + stack local relancés (131 tables).
- T6 fait : 89f32867 (280 tests verts, tsc OK). Écart noté : « 1 000 » en dur dans le message du champ min_menages.
- Relecture 2 (Groupe B, 0f0159f3..89f32867) lancée.
- Relecture 2 : 10 mineurs corrigés 8fc9a039 (387 tests ciblés verts).
- Revue finale : 0 Critique/Important ; 7b2c3024 corrige 3 rouges des suites (outil-score spec attend parametres, mes-zones-montage sans @angular/core/testing, knip 140) + mineurs. À trancher (Vincent) : dupliquer une combinaison fige ses zones membres ; Dupliquer recalcule à neuf (A-5) ; mes-zones.component.ts à 400 l.
- Suites complètes sur 7b2c3024 : tuées par manque de mémoire du poste (non relancées).
== RESUME HERE (v3) == relancer suites (npm test, ng test, tsc, lint, build avec NEXT_PUBLIC locaux, ng build) une à une → preuve navigateur T7 (:3002/:4202) → docs T7 → clôture.
- 30/10 Vincent : oui aux points 1 et 2 (combinaison qui fige ses membres ; Dupliquer recalcule à neuf).
- Suites sur 7b2c3024 : unit 2972/2972, ng test 3465/3465, tsc 0, lint 0, build Next (env locaux) 0, ng build 0 (2e essai, 1er = Google Fonts injoignable).
  Intégration 13 rouges / 5 fichiers, AUCUN touché par ③ : dépendent de l'état de base du 28/10 (abstention privée Bercy, jeu L6-T7 supprimé) → dette à porter à l'Excel (tests d'intégration liés à des données de preuve).
- Preuve navigateur T7 lancée (:3002/:4202).
- Preuve T7 : 7/7 scénarios × 2 thèmes OK (36 captures, rapport-preuve-T7.md), 0 lecture /api à l'ouverture de ③ ; 8 zones de preuve supprimées (101 = état initial), BMW GROUP rétabli. Défaut D-1 Important (V2 : sous-zone = anneau extérieur seul) + mineurs → correctif lancé. D-3 (React created_by NULL) = React gelé, à lister.
- Correctif de la preuve 1e6cf219 : D-1 (sous-zone V2 = union de toutes les bandes du POI, champ `geometries` de /api/custom-geo/capture) — mesuré Bretagne : sous-zones 25 130 km² = zone, 1 799 IRIS · 345 CP (avant 7 056 km², 720 · 212) ; D-2 disparu de fait ; D-5, D-6, D-7 (Angular) corrigés.
- Docs T7 (30/10) : README carte § « ③ Finitions » (écarts React : pas de capture V2, script bidding gardé, ni Dupliquer ni min ménages — indicator-threshold inchangée —, created_by NULL capture/save (D-3), libellés sans accents (D-7), pas d'import KML) ; spec § 17 bis V-2/V-4/V-6/V-8 « fait le 30/10/2026 » + ligne « Suites » ; ARCHITECTURE.md déjà à jour (dupliquer + dupliquer_zone sql/294, zone_seuil_carreaux_min sql/292, encart CIRFA « migrées le 2026-10-29 » sql/293, `geometries` de la capture) ; cases T1-T7 cochées. tests/unit/docs 20/20 (code 0).
- Reste : Excel n° 23 et 24 (État), mémoire project_zones_cirfa_orphelines à clore, push, archive du registre.
