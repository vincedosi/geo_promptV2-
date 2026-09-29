# SDD ledger — plan: docs/superpowers/plans/2026-09-29-angular-lot1-composants.md
Spec: docs/superpowers/plans/2026-09-29-transition-angular-feuille-de-route.md
Branch: feat/angular-lot0 (lot 1 stacked; plan commit b8d18db9)

## Pre-flight scan
| Rows | Produces / consumes | Finding |
|---|---|---|
| T1 ↔ T6 ThemeService | T1 theme/basculer; T6 coquille button | match |
| T2 ↔ app.config | T2 adds limiteur first; app.config.spec real graph must stay green | noted in brief |
| T3 ↔ T6 ChargementService.suivre | T3 may swap to suivreChargement (fallback written in T3); T6 notes the switch | consistent |
| T4 ↔ T6 styles.css --color-teal-10 | T4 adds it; T6 uses bg-teal-10 via pastille | match |
| T5 ↔ T6 inputs | fil-etapes/fil-ariane/reglette signatures used verbatim in catalogue | match |
| T1 self | 5+3+2 tests vs code | ok (TestBed.tick fallback flushEffects) |
| T2 self | dedup test references existing spies in auth.service.spec — implementer reads the file | acceptable |
| T3 self | DestroyRef-in-service risk handled by written fallback | ok |
| T4/T5 self | tests vs code | ok |
| T6 self | catalogue spec lowercase attribute selectors noted | ok |
Task 1: dispatched (BASE b8d18db9, model sonnet)
Task 1: implemented df3cdbcb (DONE); review dispatched (sonnet)
Task 1: review Changes requested — Critical: localStorage getter unguarded (plan code); fix round 1 dispatched
Task 1: fix round 1/5 (2 addressed, 0 open — localStorage getter guard + spec; commits df3cdbcb..ceebb678)
Task 1: complete (commits b8d18db9..ceebb678, review clean after 1 fix round)
Task 2: dispatched (BASE ceebb678, model sonnet)
Task 2: implemented e1fc022d (DONE; adjusted limiteur test for HttpTestingController.match consuming requests); review dispatched (sonnet)
Task 2: minor (deferred): limiteur — add `if (abandonne) interne.unsubscribe()` after inner subscribe (sync-emission gap, unreachable today behind jetonInterceptor's defer)
Task 2: minor (deferred): auth.service.spec — test a second sequential session end redirects again
Task 2: minor (deferred): limiteur spec — expectNone('/api/a4') after abandon
Task 2: minor (deferred): semaphore enAttente() counts abandoned waiters until their turn — document
Task 2: complete (commits ceebb678..e1fc022d, review clean)
Task 3: dispatched (BASE e1fc022d, model sonnet)
Task 3: implemented 2237b15d (DONE; API = ChargementService.suivre); review dispatched (sonnet)
Task 3: ⚠️ DestroyRef FIFO ordering (effect torn down before retirer) not proven by an adversarial test — controller: accepted, behavioural test passes; noted for final review
Task 3: complete (commits e1fc022d..2237b15d, review clean)
Task 4: dispatched (BASE 2237b15d, model sonnet)
Task 4: implemented e159e91d (DONE, booleanAttribute); review dispatched (sonnet)
Task 4: minor (deferred): pastille static host type=button — explicit consumer type="submit" likely wins (deliberate override, accepted); JSDoc note optional
Task 4: complete (commits 2237b15d..e159e91d, review clean)
Task 5: dispatched (BASE e159e91d, model sonnet)
Task 5: implemented c8b44f3d (DONE); review dispatched (sonnet)
Task 5: minor (deferred): fil-ariane `precision` lowercased (faithful to React, conflicts with acronyms-uppercase rule) — generic component should not transform; consumer passes the text
Task 5: fix round 1 dispatched (Important: fil-etapes spec leaks DOM nodes, no afterEach)
Task 5: fix round 1/5 (1 addressed, 0 open — spec DOM cleanup; commits c8b44f3d..d5b3efc7)
Task 5: complete (commits e159e91d..d5b3efc7, review clean after 1 fix round)
Task 6: dispatched (BASE d5b3efc7, model sonnet)
Task 6: implemented a9491328 (DONE). Ruling: 'login pre-filled' concern = browser password autofill in the Playwright profile — grep shows no credential in angular/src — cost if wrong: none found; review dispatched (sonnet)
Task 6: complete (commits d5b3efc7..a9491328, review clean)
Final review: dispatched (opus), range 0ee89f17..HEAD
Final review: Ready after fixes — Important: theme not applied before first paint (regression vs React inline themeInitScript); fil-ariane lowercases precision. Fix now: SIGNED_OUT double-navigation race, reglette (change), sr-only « renseignée », aria-current on breadcrumb, td alignement input, barre provider comment, limiteur `if (abandonne) interne.unsubscribe()`, second-session test, expectNone, enAttente comment. Deferred: pastille explicit type=submit → lot 3 (Ruling: no current form use — cost if wrong: an accidental submit found at first form use); tokenless waiting requests under 401 load → document only (Ruling: harmless, redirect skipped on /connexion)
Final fix wave: dispatched (sonnet), FIX_BASE a9491328
Final fix wave: implemented 3a65e14b..db26bcfe (item 3 via flag + promise cache; item 9 defensive, no RED possible); scoped re-review dispatched (sonnet)
Final fix wave: re-review — 11/11 addressed, no new breakage. CSP: no CSP in angular/ today; the inline theme script needs 'unsafe-inline' or a hash under a strict CSP — Ruling: disclosed as AIDA-integration concern (lot 7) — cost if wrong: theme flash inside AIDA only
LOT 1 COMPLETE (0ee89f17..db26bcfe)
