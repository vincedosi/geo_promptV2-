# SDD ledger — plan: docs/superpowers/plans/2026-09-30-angular-lot-aida-conformite.md
Spec: docs/documentation-remote-app-native-federation-aida.pdf (PRIVATE, never staged) + docs/superpowers/plans/2026-09-29-transition-angular-feuille-de-route.md § Compatibilité AIDA
Branch: feat/angular-lot0 (stacked; plan commit e8656055). Reviews on opus (Vincent: hyper-vigilance).

## Pre-flight scan
| Rows | Produces / consumes | Finding |
|---|---|---|
| T1 ↔ T4 build output layout | T1 changes builder to NF; T4 relies on chunks + maplibre.css + config.local.json in one folder | T4 step 1 measures first, BLOCKED if not — ok |
| T1 ↔ T3/T4 main.ts→bootstrap.ts | T3 keeps afficherErreurDemarrage in bootstrap for standalone only | consistent |
| T2 ↔ T3 services | T2 keeps providedIn root; T3 removes it and provides at route level | consistent (stated) |
| T2 ↔ T3 HttpBaseService.baseUrl / jetonInterceptor | T2 renames apiUrl→baseUrl; T3 test expects '/api/risques/sites/compter' with Bearer | match |
| T3 ↔ T4 DemarrageService | T3 creates; T4 adds stylesheet load before config | consistent |
| T3 ↔ T5 ThemeService | T5 only; App double-mount in T3 injects ThemeService singleton | ok |
| T3 ↔ T6 routes/paths | T6 host mounts at outils/magelian, relies on T3 relative links | match |
| T1 self | .npmrc decision rule measured (keep / .npmrc.aida) | ok |
| T2 self | modele-aida guard: glob fallback to root test named | ok |
| T3 self | 4 remote.spec tests vs code; App mounted twice per doc | ok, reviewer to check double mount |
| T4 self | import.meta.url strategy gated by measurement | ok |
| T5 self | no-loop + no-persist of external theme | ok |
| T6 self | host outside repo; CORS may need serve flag — report, commit nothing | ok |
Ruling (plan-level, Vincent approved 2026-09-30): our interceptors run first, then the host's via withRequestsMadeViaParent — cost if wrong: adapt when the siège answers the auth questions
Task 1: dispatched (BASE e8656055, model sonnet)
Task 1: implemented ae90cbec (DONE_WITH_CONCERNS: schematic-added deps @softarc/native-federation-node + es-module-shims kept, @angular/animations + @angular-devkit/build-angular removed; lockfile +14k lines; initial 59.66 kB; initFederation failure only console)
Task 1: review dispatched (opus)
Task 1: review → Needs fixes (Important: test target defaults to NF builder — unsupported by unit-test builder, silent warning, tests built without real options; @softarc/native-federation-node SSR-only, extra dep)
Task 1: Ruling: es-module-shims kept (required by NF runtime: polyfill + type=module-shim) as accepted deviation from « one new dependency only », pinned exact 1.10.1 — cost if wrong: one extra pinned dep
Task 1: Ruling: ARCHITECTURE.md not updated in T1 (plan-mandated deferral to T6) — T6 brief must list NF dep, esbuild/serve-original target split, test buildTarget, .npmrc, es-module-shims — cost if wrong: doc lag within the lot
Task 1: fix round 1 dispatched (resumed implementer; FIX_BASE ae90cbec)
Task 1: fix round 1 implemented 73ddbb8d (test buildTarget → esbuild, warning gone, 154 pass; native-federation-node removed, 0 in lockfile; es-module-shims 1.10.1; main.ts static erreur-demarrage); scoped re-review dispatched (opus)
Task 1: fix round 1/5 (4 addressed, 0 open; commits ae90cbec..73ddbb8d)
Task 1: complete (commits e8656055..73ddbb8d, review clean after 1 fix round)
Task 2: dispatched (BASE 73ddbb8d, model sonnet)
Task 2: first implementer stopped by user mid-task (uncommitted partial: 17 files + environment.ts + provisoire + modele-aida.test.ts); Vincent said « continue » → Ruling: fresh implementer finishes FROM the partial work — cost if wrong: partial defect, reviewer catches
Task 2: implemented ad1e8446 (DONE; partial kept unchanged; RED reproduced by dropping /api → 15 failures; guard test at root proven to fail); review dispatched (opus)
Task 2: review Approved (opus), 0 Critical/Important
Task 2: Ruling: carry into T3 (it touches the same files): harden modele-aida guard (any \bHttpClient\b in *.api.ts, HttpBaseService only in import+extends, strip comments); alias import `…Provisoire as MechaRemoteAppHttpBaseService` so the swap is one line; mark slug test as stand-in-bound. T3's remote.spec test 2 IS the missing end-to-end proof of the interceptor/HttpBaseService no-cycle claim — cost if wrong: small T3 scope growth
Task 2: minor (deferred → T6 docs): ARCHITECTURE.md stale text on HttpBaseService.apiUrl startup cycle (~l.2518) and « il héritera de… » (~2539)
Task 2: minor (deferred): redundant configureTestingModule in http-base spec; essai-carte tile regex loosened (pinned elsewhere)
Task 2: complete (commits 73ddbb8d..ad1e8446, review clean)
Task 3: dispatched (BASE ad1e8446, model opus — hardest task: route-level providers, DI, navigation)
Task 3: implemented 1f43f815 (DONE; RED 4/4 for stated reasons; 167 ng tests; KPI 13 841 288; concerns: /connexion shows no startup error; old /catalogue bookmark → /app home; logo img path resolves against shell origin; slug test stand-in-bound; guard text-based)
Task 3: Ruling: logo image path (and any public/ asset referenced by the remote) joins T4's « resources resolved against the remote » scope — cost if wrong: broken logo inside AIDA
Task 3: review dispatched (opus)
Task 3: review Approved (opus), 0 Critical/Important
Task 3: Ruling: carry into T4 (it touches DemarrageService + resources): startup error message says « recharger la page » (or reset enCours in catch); /connexion renders DemarrageService.erreur(); logo = resource resolved against the remote AND brand teal exact (inline SVG currentColor or light variant, no filter approximation); fix CHEMIN_CONNEXION comment (« seul point à changer » is false: messages.ts/sans-session/CIBLE_PAR_DEFAUT are standalone-only) — cost if wrong: T4 scope growth
Task 3: Ruling: root-route `providers`+`canActivate` on remoteRoutes and « shell must provide HttpClient » (withRequestsMadeViaParent → null backend in prod otherwise) added to the AIDA questions doc for concertation — cost if wrong: none
Task 3: minor (deferred): xsrfInterceptorFn precedes ours (comment « limiteur en premier » slightly inaccurate, harmless); old /catalogue bookmark → /app
Task 3: complete (commits ad1e8446..1f43f815, review clean)
Task 4: dispatched (BASE 1f43f815, model opus) with T3 carried items; AIDA questions docx updated (Q7 root-route providers/canActivate, Q8 shell HttpClient)
Task 4: implemented f9cb0b60 (DONE; measurement gate passed incl. cross-origin host; 187 ng tests; initial 60.3→40.8 kB; KPI 13 841 288; logo exact teal both themes; concerns: fixed out-of-list sansSessionGuard race (guards run in parallel → /connexion blank); possible white flash standalone on slow net; magelian-icon.svg unused; retry-after-failure + maplibre.css in host not browser-shown)
Task 4: review dispatched (opus)
Task 4: review Approved (opus), 0 Critical/Important; sansSessionGuard concurrency claim verified in router source
Task 4: ESCALATION (brief-level): magelian.css (Tailwind preflight, html/body rules, :root tokens) restyles the WHOLE AIDA shell document once loaded, never removed. Ruling: T6 measures the leak precisely in the real host (element-by-element before/after); a follow-up task « isolation CSS » is added to this lot after T6, designed from that measurement (candidates: Tailwind without preflight + reset scoped under the remote root; html/body rules moved to the remote root; token-name clash assessed); question added to the AIDA doc — cost if wrong: integration blocked until isolation is done
Task 4: Ruling: carry into T5 (small task): make sans-session.guard spec mock async so the order test can catch the race it is named after; add color-scheme to the index.html theme script (no white canvas before magelian.css in standalone) — cost if wrong: small scope growth
Task 4: minor (deferred): feuilles.ts treats a foreign link with the attribute as loaded; ressource-distante default-base test vacuous; logo star dot now currentColor (needs sign-off); public/magelian-icon.svg unused but still copied
Task 4: complete (commits 1f43f815..f9cb0b60, review clean)
Task 5: dispatched (BASE f9cb0b60, model sonnet) with T4 carried items; AIDA docx Q9 added (CSS isolation / preflight / reserved var names)
Task 5: implemented b5eb90cf (DONE; 196 ng tests; RED guard race + theme 8/23; browser: external class → repaint, no requests, localStorage unchanged; concerns: initial theme no longer persisted on first run; class removed/both → keep current, don't re-add); review dispatched (opus)
Task 5: review → Needs fixes (Important: at startup ThemeService writes its own class over the host's — contradicts the rule; Minor required: absent/both class → follow rendered CSS: light present → light else dark)
Task 5: minor (deferred): carte/courbe repaint effects only browser-proven (CouleursService mechanism unit-tested)
Task 5: fix round 1 dispatched (resumed implementer; FIX_BASE b5eb90cf)
Task 5: fix round 1 implemented a9fcc020 (201 ng tests; RED startup 2/3 + ambiguous 2; concern: effect re-adds a class on host's <html> in ambiguous cases); scoped re-review dispatched (opus)
Task 5: fix round 1/5 (2 addressed, 1 new Important open — effect writes host <html> class on external change; commits b5eb90cf..a9fcc020)
Task 5: Ruling: ownership rule — MAGELIAN writes <html> (classes + colorScheme) ONLY on user toggle or at initial run when <html> has neither class; follow-only otherwise (external changes, startup with one/both classes); suivreLaClasse no longer writes colorScheme — cost if wrong: host without theme class gets no colorScheme from us
Task 5: fix round 2 dispatched (resumed implementer; FIX_BASE a9fcc020)
Task 5: fix round 2 implemented 98888996 (ecrireHtml flag; RED 8; 203 ng tests); scoped re-review dispatched (opus)
Task 5: fix round 2/5 (1 addressed; residual Minor of the same class — ecrireHtml not disarmed by suivreLaClasse → a pending flag writes host <html> in a narrow window; commits a9fcc020..98888996)
Task 5: Ruling: fix the residual now despite Minor label — it is the original finding in a narrower window and a one-liner — cost if wrong: one extra round
Task 5: minor (deferred): after a user toggle, host clearing the class leaves colorScheme=light on a dark render (host owns colorScheme per ruling)
Task 5: fix round 3 dispatched (resumed implementer; FIX_BASE 98888996)
Task 5: fix round 3 implemented 6386bf59 (disarm in suivreLaClasse + 5th hole same-theme shortcut; RED 4; 207 ng tests; superseded toggle not persisted); scoped re-review dispatched (opus)
Task 5: fix round 3/5 (1 addressed + 5th hole closed, 0 open; commits 98888996..6386bf59)
Task 5: minor (deferred): theoretical — basculer() called synchronously in the same tick after the effect's write is taken as host mutation and dropped (no caller does this); comment could note it
Task 5: complete (commits f9cb0b60..6386bf59, review clean after 3 fix rounds)
Task 6: dispatched (BASE 6386bf59, model opus)
Task 6: implemented e3593aa4 (DONE_WITH_CONCERNS; docs only). Host proof: 7/7 pass ONLY with host ignoreUnusedDeps:false; generated host crashes essai-carte (NG0203) — host doesn't share @angular/core/rxjs-interop → remote loads its own copy bound to its own core. No-session in host → redirect to /connexion which host lacks (NG04002, empty frame). Host without provideHttpClient works (Angular 21 root handler). Cookie carries :4201→:4300. Dev mode only (prod build not replayed in host). CSS leak: body margin/bg/font/size, lists/links/buttons/inputs reset, h1 700→400, 123 :root custom props incl. --surface/--radius/--spacing/--danger
Task 6: review dispatched (opus)
Task 6: review → Needs fixes (Important: roadmap ✅ dishonest — default host failed 4/7; reserve understated — whole remote at risk (accueil toSignal), structural incl. prod; CHEMIN_CONNEXION described as mode-specific but is /connexion both modes). NG0203 root cause CONFIRMED: rxjs-interop imports private core chunks relatively → separate currentInjector when not shared; only rxjs-interop is exposed today (common/http shared via platform-browser; router/forms import bare core)
Task 6: Ruling: roadmap row → « ⚠ Partiel » with reviewer's wording; lot NOT closed: two tasks added — T7 « Robustesse dans l'hôte » (remove rxjs-interop + runtime-import guard; hosted no-session behaviour with inverted CHEMIN default — root = hosted message, standalone `app` route provides /connexion; AuthService keeps only signals; re-run proof with DEFAULT host + prod build + limiter in host) and T8 « Isolation CSS » (inventory incl. unlayered selectors, @property --tw-*, keyframes, reverse leak, out-of-frame elements; spike Shadow DOM root vs scoped CSS + --mg- token prefix; measured in host) — cost if wrong: lot takes 2 more tasks
Task 6: fix round 1 dispatched (resumed implementer; docs only; FIX_BASE e3593aa4)
Plan extended with Task 7 (robustesse hôte) + Task 8 (isolation CSS, spike A Shadow DOM vs B scoped, controller arbitrates) — plan file edited, commit deferred until T6 fix round commits (avoid index race)
Task 6: fix round 1 implemented 4befe929 (docs; premise corrected: assert dev-gated but inject(DestroyRef) throws in prod); plan commit done; scoped re-review dispatched (opus)
Task 6: fix round 1/5 (4 addressed, 0 open; commits e3593aa4..4befe929)
Task 6: minor (deferred): « lève aussi en production » is code-reading inference, confirmed by T7's prod replay
Task 6: complete (commits 6386bf59..4befe929, review clean after 1 fix round)
Task 7: dispatched (BASE 30d50c4b, model opus)
Task 7: implemented efa70d30 (DONE_WITH_CONCERNS; 223 ng / 1789 root; host GENERATED config dev 10/10 prod 9/9; limiter in host 3 then 4th after 1st reply; concerns: interceptor doesn't read strategy — Racine is single decider (brief deviation); AuthService.deconnecter(portee); host 401 unit-only; session from other tab not picked up; logout redirect relies on Racine effect skipping during navigation; prod remote in dev host); review dispatched (opus)
Task 7: review Approved (opus), 0 Critical/Important; deviation (Racine single decider) judged better than brief — removes a microtask race class
Task 7: minor (deferred → final fix wave): strategie-sans-session.ts:18-19 comment wrongly lists the interceptor as a reader; versEtat lost toSignal's assertNotInReactiveContext (add it); coquille logout ordering relies on zoneless scheduler — name the assumption in a comment
Task 7: minor (noted): report concern 4 inaccurate — BroadcastChannel propagates same-origin tab logins; the real gap is a session obtained by the AIDA shell's own auth (phrase AIDA question that way)
Task 7: complete (commits 30d50c4b..efa70d30, review clean)
Task 8: dispatched (BASE efa70d30, model opus) — steps 1-2 only, then NEEDS_CONTEXT with recommendation for controller arbitration
Task 8: steps 1-2 done (NEEDS_CONTEXT, recommendation A). Baseline 65 host diffs + 123 props on <html>, reverse leak yes. A: 0 diffs, 0 props, no reverse leak, 11/11, +103/−14 (12 files), 23 harness spec failures. B: 0 diffs but 103 --mg-/--tw- props, reverse leak yes (map broken by host .absolute/h1/button), 11/11, +610/−245
Task 8: Ruling: approach A (Shadow DOM root) — only zero-leak-both-ways option, smallest change, lot-3 ports keep token names; controller verified hostile-host screenshots (A intact, B broken). Conditions: one path both modes; :host{all:initial}; injectable adopter seam; @property rewrite unit-tested; :host(.light) mirrored by ThemeService (ownership rule unchanged); maplibre.css inside root; MANDATORY portal guard test (document.body/appendTo/CDK overlay/position:fixed); fix 23 harness failures without weakening; measure --tw-* reach — cost if wrong: future body-portalled overlays render unstyled (guarded), Shadow DOM quirks in lots 3-6
Task 8: steps 3-4 dispatched (resumed implementer, BASE efa70d30)
Task 8: steps 3-4 implemented 134a873b (DONE_WITH_CONCERNS; 246 ng / 1794 root; host default prod+dev 0 diffs, 0 props, no reverse leak, 11/11 each; direction set separately; portal guard exception erreur-demarrage.ts; :host(.light) Firefox/Safari unmeasured; prod reverse-leak/theme measured before direction fix); review dispatched (opus)
Task 8: review → Needs fixes (Important: I1 all:initial resets color-scheme inside roots, nothing re-sets it — docs claim otherwise; I2 host `*` rule beats :host for normal declarations → inherited props leak, untested by the hostile sheet). Architecture approved (ShadowDomRenderer addHost verified in Angular source)
Task 8: Ruling: fix all minors in the same round (foundational layer): portal-guard gaps (style.position, host class fixed, querySelector body, ::ng-deep/ViewEncapsulation.None), @property inherits:true, strip original @property, throw on missing shadow root, test prod adopter/constructor factories, docs (emulated styles in head, CORS on magelian.css), nodeType check, MapLibre drag/click/popup-close evidence — cost if wrong: one longer round
Task 8: fix round 1 dispatched (resumed implementer; FIX_BASE 134a873b)
OBJECTIVE (Vincent 2026-09-30, verbatim): « la même chose que Next.js mais Angular en respectant la doc donnée … à toi de gérer de bout en bout comme chef de projet ». Screens judged « super moche ».
Ruling: new lot « Rendu » (visual parity with React) inserted AFTER lot AIDA and BEFORE lot 3; new exit criterion for every display task = Angular screenshot beside the React equivalent, reviewed by the controller; « x » bar above the map (likely MapLibre control/popup unstyled in shadow root) is a regression to fix first — cost if wrong: lot 3 delayed by one lot
Rendu lot: read-only React↔Angular gap inventory dispatched (opus) → inventaire-rendu.md
Rendu inventory DONE: 80 gaps (login 17, shell 16, curve 13, map 9, essai-carte 6, KPI 5, base 5, headers 4, accueil 4, lot-1 1); 13 proposed tasks R0-R12; « x » bar = fake popup injected by T8 measurement script (not an app defect) — needs one live check (R0); shell reference = AppSidebar.tsx, map/risk routes without shell; icons: in-house component copying lucide paths (no new dep); T8 styles.css:124 font-smoothing should be antialiased. Report: inventaire-rendu.md
PAUSED 2026-09-30: usage limit reached. Pending on resume: (1) T8 fix round 1 result (implementer may still be running) → scoped re-review opus; (2) final whole-lot review of AIDA lot; (3) write Rendu lot plan from inventaire-rendu.md, rule the 8 open questions
Task 8: fix round 1 implemented 4446c346 (I1+I2+m1-m8; 256 ng / 1815 root; host default prod+dev 0 diffs, no reverse leak w/ extended hostile sheet incl. * and html font-size — found+fixed rem scaling via remEnPx; color-scheme follows; 11/11 each; m8 drag/click/close OK; deviation:  not !important — inherited props !important instead, display/height/visibility normal). NEXT on resume: scoped re-review (opus) of 134a873b..4446c346, then final AIDA lot review, then Rendu plan
Rendu plan committed (docs/superpowers/plans/2026-09-30-angular-lot-rendu.md, R0-R11, 8 arbitrages); inventory committed; roadmap row added
Task 8: fix round 1/5 (all addressed, 0 open; commits 134a873b..4446c346)
Task 8: minor (deferred → final fix wave): rem a11y wording false (standalone <html> = user's default size, rem scaling lost; name the trade-off); remEnPx regex lookbehind (?<![\w-]); add pointer-events (+ -webkit-tap-highlight-color) to :host !important list; ARCHITECTURE typo « CONSTRUIT et la CONSTRUIT »; custom props forceable on host element by outer rule (note); [ngStyle] position fixed not caught (nit)
Task 8: complete (commits efa70d30..4446c346, review clean after 1 fix round)
AIDA lot: all 8 tasks complete → final whole-lot review dispatched (opus, e8656055..4446c346)
AIDA final review: With fixes — I1 MAGELIAN writes shell html (no-class host + toggle), I2 guard gap providedIn root api services lose interceptors, I3 unhashed runtime files, I4 next-lot rules missing; + minors
Ruling (I1): token ECRIRE_HTML default false, true only in app.config.ts; hosted toggle acts on shadow roots + storage only; host class still followed — cost if wrong: hosted theme not synced when host sets no class
Ruling (I3): document deployment requirements (no-cache, CORS, CSP) now, no versioning until a deployment exists
Ruling: fonts sheet failure non-blocking; retry = real fix (runGuardsAndResolvers always + late adoption)
AIDA final fix wave dispatched (ONE fixer, opus) — brief final-fix-brief.md (written right after dispatch due to shell error)
Vincent 2026-09-30: NO GitHub PR (and no push) — lot endings stop at local commits
AIDA final fix wave implemented 76422feb + 7f0c0948 (273 ng / 1825 root; I1 host proof: html untouched, 0 mutations; concerns: host removing class → MAGELIAN keeps current theme (was dark); zone tests characterization only; CSP untested; I1 proof dev only)
Ruling: hosted, host removes its class → keep MAGELIAN's current theme (roots carry their own tokens since T8, host html no longer governs rendering) — cost if wrong: hosted theme doesn't snap to dark
AIDA final fix wave: scoped re-review dispatched (opus)
AIDA final fix wave: re-review clean (opus), 0 Critical/Important
AIDA final: minor (deferred): theme.service standalone paragraph wording (« le shell pose la classe ») misplaced; startup both-classes initial vs dernierHote inconsistency; gardes-styles array regex truncation + inline style= uncovered; stalled font sheet holds startup (no timeout); CSP beyond fonts (connect-src/style-src/script-src/worker-src blob:) at first deployment
AIDA LOT COMPLETE (e8656055..7f0c0948)
