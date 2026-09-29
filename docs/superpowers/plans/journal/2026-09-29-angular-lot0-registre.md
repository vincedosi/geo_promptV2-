# SDD ledger — plan: docs/superpowers/plans/2026-09-29-angular-lot0-socle.md
Spec: docs/superpowers/plans/2026-09-29-transition-angular-feuille-de-route.md
Branch: feat/angular-lot0 (from main 3e681505; plan commit 8e084249)

## Pre-flight scan
| Rows | Produces / consumes | Finding |
|---|---|---|
| T1 ↔ T3 angular/package.json | T1 pins @angular 21.2.4; T3 adds supabase deps + scripts config/prestart | compatible |
| T2 ↔ T3/T4 Tailwind classes | T2 @theme defines page/surface/elevated/overlay/primary/secondary/tertiary/subtle/default/teal/danger; T3/T4 templates use bg-page, bg-surface, bg-elevated, bg-overlay, text-primary, text-tertiary, text-secondary, text-danger, border-subtle, border-primary, text-page, bg-primary | all defined |
| T3 ↔ T4 app.config.ts / app.routes.ts / accueil.page.ts | T3 writes provisional accueil + remoteRoutes/appRoutes; T4 replaces accueil, nests under coquille, adds interceptor | consistent |
| T3 ↔ T4 ConfigService.valeur.apiBaseUrl / AuthService.jeton/email/deconnecter | used by HttpBaseService, interceptor, coquille | signatures match |
| T1 self | isolement test needs >3 .ts in angular/src — generated app has main.ts, app.ts, app.config.ts, app.routes.ts, app.spec.ts | ok |
| T2 self | parity test reads first ':root {' and 'html.light {' of globals.css (lines ~9, ~235 = token blocks) | ok |
| T3 self | tests 4+9+5+2 vs code | ok |
| T4 self | tests 2+3+6+1+2 vs code | ok |
| T5 self | [200,401] check: /api/ref/geo and zones-risque tiles call no requireAuth (grep 2026-09-29) → cookie-only | ok |

Ruling: T3 step 1 pins @supabase/ssr to the version INSTALLED at the root (0.5.2 per package.json floor; exact read from node_modules) rather than the literal 0.5.2 — the spec's reason is cookie-format parity with the running React app — cost if wrong: none, identical when equal.
Task 1: dispatched (BASE 8e084249, model sonnet)
Task 1: implemented b59dd86f (DONE); review dispatched (sonnet)
Task 1: minor (deferred): rxjs/tslib/typescript/vitest on semver ranges in angular/package.json
Task 1: minor (deferred): .vscode/mcp.json runs @angular/cli unpinned; angular/README.md English (replaced in Task 5)
Task 1: ⚠️ dist/cache indexed — checked by controller: none tracked
Task 1: complete (commits 8e084249..b59dd86f, review clean)
Task 2: dispatched (BASE b59dd86f, model sonnet — copy step needs care)
Task 2: implemented 1b0a87e1 (DONE). Ruling: index.html gets no theme class — dark is the :root default and light toggle is lot 1 — cost if wrong: one attribute added later
Task 2: minor (deferred): jetons.css keeps --radius under a "shadcn HSL" comment (cosmetic)
Task 2: complete (commits b59dd86f..1b0a87e1, review clean)
Task 3: dispatched (BASE 1b0a87e1, model sonnet)
Task 3: implemented c12ef874 (DONE); review dispatched (sonnet)
Task 3: Ruling: plan defect — ConfigService rejection escaped bootstrap (main.ts only console.error) → blank screen, contradicting Review Focus item 2 (spec-owned). Fix: extract afficherErreurDemarrage(erreur, doc) in core/demarrage/, rendered via textContent in main.ts catch, with spec — cost if wrong: one small file
Task 3: fix round 1 implemented 9af7ce8c; re-review dispatched (haiku)
Task 3: fix round 1/5 (1 addressed, 0 open — blank screen on config error; commits c12ef874..9af7ce8c)
Task 3: complete (commits 1b0a87e1..9af7ce8c, review clean after 1 fix round)
Task 4: dispatched (BASE 9af7ce8c, model sonnet)
Task 4: implemented fa0c2678 (DONE; added .gitignore negation for angular features/*/data/); review dispatched (sonnet)
Task 4: minor (deferred): sidebar active bg uses bg-overlay (#181818) vs DESIGN_SYSTEM literal #151515 — no token exists; correct under no-hex rule
Task 4: fix round 1 dispatched (Important: .gitignore comment points to CLAUDE.md instead of ARCHITECTURE.md)
Task 4: fix round 1/5 (1 addressed, 0 open — gitignore comment pointer; commits fa0c2678..22cdf26c)
Task 4: complete (commits 9af7ce8c..22cdf26c, review clean after 1 fix round)
Task 5: dispatched (BASE 22cdf26c, model sonnet)
Task 5: implemented 9dfe98c5 (DONE_WITH_CONCERNS: fixed 2 bootstrap bugs in T3/T4 code — config↔interceptor cycle, inject after await); review dispatched (opus-tier? no: sonnet)
Task 5: minor (deferred): ARCHITECTURE.md lacks a « piège » bullet on bootstrap order (HttpBackend in ConfigService; inject() after await = NG0203)
Task 5: minor (deferred): jetonInterceptor should fail open (next(req)) if config not loaded
Task 5: minor (deferred): app.config initializer could use inject(Injector).get() instead of EnvironmentInjector+runInInjectionContext
Task 5: minor (deferred): ARCHITECTURE section should state the 401-without-Bearer half of the proof
Task 5: fix round 1 dispatched (Important: add app.config.spec.ts exercising the real provider graph)
Task 5: fix round 1/5 (1 addressed, 0 open — appConfig real-graph test; commits 9dfe98c5..b5d0b6fe)
Task 5: complete (commits 22cdf26c..b5d0b6fe, review clean after 1 fix round)
Final review: dispatched (opus)
Final review: Ready after fixes — 1 Important (mid-page session end never returns to login), Minors 2-5 fix now, ledger triage: fix now = mcp.json pin, ARCHITECTURE bootstrap-order bullet, 401-half sentence; defer = semver ranges, --radius comment, bg-overlay, interceptor fail-open (Ruling: rejected — fail-closed is safer, only pre-config request uses HttpBackend — cost if wrong: a bootstrap crash message instead of a silent pass), inject(Injector) cosmetic, reverse guard on /connexion (lot 1), 403 message (lot 1)
Final fix wave: dispatched (sonnet), FIX_BASE b5d0b6fe
Final fix wave: implemented 4889b7ce..e4929374; scoped re-review dispatched (sonnet)
Final fix wave: re-review APPROVE (8/8 addressed, no new breakage)
Final: parked — concurrent 401s may call renvoyerVersConnexion twice — Ruling: harmless (same-URL navigation no-ops; SIGNED_OUT path does not re-signOut); add an in-flight guard + test in lot 1 — cost if wrong: a double navigation
LOT 0 COMPLETE (3e681505..e4929374)
