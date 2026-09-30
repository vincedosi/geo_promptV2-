# SDD ledger — plan: docs/superpowers/plans/2026-09-29-angular-lot2-carte-graphiques.md
Spec: docs/superpowers/plans/2026-09-29-transition-angular-feuille-de-route.md
Branch: feat/angular-lot0 (lot 2 stacked; plan commit 42a9e8fd)

## Pre-flight scan
| Rows | Produces / consumes | Finding |
|---|---|---|
| T1 ↔ T4/T5 CouleursService.palette | Record<K,jeton> → Signal<Record<K,string>> | match |
| T2 ↔ T3/T5 CarteFactice | T5 extends it with addSource/addLayer/getSource/setPaintProperty/on(click,layer) | T5 must keep T2/T3 specs green (stated) |
| T2 ↔ T5 CarteComponent prete/deplacee | used by page | match |
| T3 ↔ T5 chargerParCadre signature | match | ok |
| T4 ↔ T5 SerieCourbe/repere/domaineX | match | ok |
| T1 self | themeApplique test depends on effect timing via TestBed.tick | ok |
| T4 self | fake palette returns plain fn (noted typing fallback) | ok |
| T5 self | spec (a)(b)(c) described in prose, not code — implementer writes it | Ruling: acceptable, behaviours precise; reviewer checks the three assertions exist — cost if wrong: weaker page tests |
Task 1: dispatched (BASE 42a9e8fd, model sonnet)
Task 1: implemented 7a7b56ed (DONE); review dispatched (sonnet)
Task 1: ⚠️ jsdom does not exercise var() chains — covered by T5 browser step 6 (theme toggle on real tokens)
Task 1: fix round 1 dispatched (Important: no test catches dependency on theme vs themeApplique)
Task 1: fix round 1/5 (1 addressed, 0 open — ordering guard test; commits 7a7b56ed..ec367325)
Task 1: complete (commits 42a9e8fd..ec367325, review clean after 1 fix round)
Task 2: dispatched (BASE ec367325, model sonnet)
Task 2: implemented 93e9a76f (DONE_WITH_CONCERNS: initial budget warning 527kB>500kB from global maplibre-gl.css); review dispatched (sonnet)
Task 2: Ruling: plan defect — global maplibre-gl.css breaks « MapLibre never weighs on initial bundle »; move to component styleUrl + ViewEncapsulation.None. Also pull the Minor « no error surfaced if style fails » into this round (lot 3 blocks on `prete`): add output `erreur` emitted only for errors BEFORE load — cost if wrong: one extra output
Task 2: fix round 1 dispatched
Task 2: fix round 1 implemented 972136f6 — initial bundle restored (457.91 kB) BUT anyComponentStyle budget raised 4/8→8/80 kB and a permanent build warning. Ruling: reject the budget loosening — use Angular's lazy global style bundle (styles entry with "inject": false, "bundleName": "maplibre") and have CarteComponent add the <link> once on first creation; restore component budgets — cost if wrong: one small DOM helper
Task 2: fix round 2 dispatched
Task 2: fix rounds 1-2/5 (2 addressed, 0 open — lazy maplibre style bundle + erreur output; commits 93e9a76f..632627f6)
Task 2: minor (deferred to lot 7/AIDA): href="maplibre.css" relative to document base — re-check under the AIDA shell's base href
Task 2: complete (commits ec367325..632627f6, review clean after 2 fix rounds)
Task 3: dispatched (BASE 632627f6, model sonnet)
Task 3: implemented 2f7fee23 (DONE); review dispatched (sonnet)
Task 3: minor (deferred): chargerParCadre first load also waits 350 ms (uniform path) — UX cost only; could startWith immediate first emission
Task 3: complete (commits 632627f6..2f7fee23, review clean)
Task 4: dispatched (BASE 2f7fee23, model sonnet)
Task 4: INTERRUPTED — PC shutdown 2026-09-29 evening; on resume check git status for partial work from base 2f7fee23, then re-dispatch Task 4
Task 4: RESUMED 2026-09-30 — partial uncommitted work found on BASE 2f7fee23: echarts 6.1.0 in package.json/lock, graphiques/{option-courbe.ts,option-courbe.spec.ts,fabrique-graphique.ts,courbe.component.spec.ts}; courbe.component.ts missing. Ruling: re-dispatch Task 4 to a fresh implementer that finishes FROM the partial files (verify them against the brief, keep what conforms) rather than restarting — cost if wrong: partial files carry a defect the reviewer must catch
Task 4: re-dispatched 2026-09-30 (BASE 2f7fee23 + uncommitted partial, model sonnet)
Task 4: implemented 814bde1c (DONE_WITH_CONCERNS: no lazy chunk measurable yet — nothing imports mg-courbe; no RED run recorded for component spec; palette restructured to one signal)
Task 4: Ruling: lazy-chunk (ECharts off the initial bundle) verification moves to Task 5, whose page is the first importer — cost if wrong: echarts lands in initial bundle, caught at T5 build
Task 4: review dispatched (sonnet)
Decision (Vincent 2026-09-30): React risk module NOT removed at lot 3 — both coexist until lot 7 (Next pages cut at the end). Roadmap updated.
Task 4: review → Needs fixes (2 Important: silent grey fallback on unknown/non-risk series token; observer disconnect not asserted)
Task 4: minor (deferred): fake palette maps every key to one colour — per-series colour mapping only covered by optionCourbe pure test
Task 4: minor (deferred): redimensionnements counted but never asserted (ResizeObserver → resize wiring untested)
Task 4: fix round 1 dispatched (resumed implementer; FIX_BASE 814bde1c; controller doc commit 2e146ddc sits in range)
Task 4: fix round 1/5 (2 addressed, 0 open — palette from present tokens + loud unknown token; disconnect asserted w/ RED proof; commits 814bde1c..604a43b9)
Task 4: minor (deferred): an unknown token throws inside the option computed → chart stays unpainted, error via ErrorHandler; lot 3 pages should know
Task 4: complete (commits 2f7fee23..604a43b9, review clean after 1 fix round)
Task 5: dispatched (BASE 604a43b9, model sonnet). Rulings: doc dates = date actually observed (2026-09-30), not the brief's 2026-09-29 — cost if wrong: cosmetic; Docker is down → implementer starts it with scripts/local/00-docker-up.sh + 01-supabase-up.sh (non-destructive) — cost if wrong: stack fails to come up, task reports BLOCKED
AIDA doc read 2026-09-30 (Vincent: « faire comme ils disent »). Gaps vs current socle: (1) services must EXTEND HttpBaseService and use this.httpClient + this.baseUrl (incl. /api) — ours inject + base.url(); (2) slug must live in src/environments/environment.ts (compile-time, passed to super()) — ours in runtime config.local.json; (3) appRoutes shape '' → redirect 'app', 'app' {component App, children remoteRoutes} — ours spreads remoteRoutes at root; (4) federation.config.js + @angular-architects/native-federation@21.2.1 + .npmrc (scope registry, ${NPM_GITHUB_TOKEN}, legacy-peer-deps) absent; (5) HOST loads only remoteRoutes → app.config providers (3 interceptors, config+auth initializer) and global styles.css/theme script are NOT loaded in AIDA — must move to route-level providers/guard. Ruling: insert a dedicated « conformité AIDA » lot AFTER lot 2 and BEFORE lot 3 (lot 3 would multiply services on the wrong pattern); roadmap edit waits until Task 5 commits (it edits the same file) — cost if wrong: one lot of delay before the risk module
Task 5: implemented 7ede1ec8 (DONE_WITH_CONCERNS: KPI 13 841 288 == psql 13 841 288; found+fixed T2 defect — .maplibregl-map position:relative cancelled inset-0 → h-full w-full in carte.component.ts; inertial drag can yield 2 site requests (moveend >350 ms apart); page spec no separate RED; maplibre-gl non-ESM build warning; lazy chunk essai-carte 1.56 MB raw holds maplibre+echarts)
Task 5: review dispatched (sonnet)
Task 5: minor (deferred): theme repaint (setPaintProperty, no new addSource) has no page spec — CarteFactice.peintures unused
Task 5: minor (deferred): page destroy (arreter + listeners) untested; erreurSites/erreurZones messages unasserted; spec (a) waits 500 ms real time
Task 5: minor (deferred): inertial drag can give 2 site requests (moveend >350 ms apart), bounded by limiter
Task 5: complete (commits 604a43b9..7ede1ec8, review clean)
Lot 2: final whole-branch review dispatched (opus, 42a9e8fd..7ede1ec8)
Lot 2 final review: With fixes — Important: dark-theme popup unreadable; early non-style error leaves red alert; `cadre` input changes ignored; tile URL via location.origin bypasses HttpBaseService; maplibre.css relative href breaks under AIDA
Lot 2: Ruling: #5 (maplibre.css href) + theme ownership by AIDA shell (MutationObserver on <html> class) move to the AIDA-conformance lot plan, not this fix wave — cost if wrong: none, that lot precedes lot 3
Lot 2: Ruling: lot 3 plan must require a theme-repaint spec per map page (CarteFactice.peintures, no new addSource) and state /essai-carte removal at end of lot 3 (it sits in remoteRoutes) — cost if wrong: pattern copied untested
Lot 2: minor (deferred, accepted): maplibre.css emitted without hash; palettesParJetons unbounded (harmless); essai-carte KPI labels « seuil haut seul » vs map showing seuil bas
Lot 2: final fix wave dispatched (sonnet) — brief final-fix-brief.md
Ruling (Vincent: hyper-vigilance, focus Angular): from now on Angular task reviews run on opus (sonnet task reviews missed 4 defects the opus final review caught); every display task needs a browser proof in both themes — cost if wrong: higher review cost
Lot 2: final fix wave implemented dace6fae (DONE; popup overrides in styles.css with !important; cadre effect; tile URL via HttpBaseService.urlAbsolue; early-error rule; courbe resize asserted); scoped re-review dispatched (opus)
Lot 2: observation (controller, screenshot): sidebar logo top-left nearly invisible in dark theme (lot 0/1 coquille) — to fix in the AIDA lot or lot 3 opening; popup tip + padding (8px 10px vs React 0) minor
Lot 2: final fix wave re-review — all 5 addressed (opus), no new Critical/Important
Lot 2: minor (deferred): `cadre` compared by reference — binding it to (deplacee) output would drift the map outward (padding 40) → JSDoc warning to add when a consumer appears; tip override paints wrong sides for left/right anchors (same flaw as React); getStyle() vs isStyleLoaded() cost
Lot 2: COMPLETE (42a9e8fd..dace6fae)
