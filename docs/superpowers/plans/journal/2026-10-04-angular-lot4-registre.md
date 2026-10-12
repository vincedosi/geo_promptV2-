# SDD ledger — plan: docs/superpowers/plans/2026-10-04-angular-lot4-carte-principale.md
Clos le 2026-10-12 à e3ca0c86 (feat/angular-lot0, poussé). Registre recopié de .superpowers/sdd/ (ignoré par git).

Task 7: fix round 1/5 (2 addressed, 0 open; commits ec5e08d6..c9352127)
Task 7: complete (commits e6c71f94..c9352127, review clean); cherry-picked onto feat/angular-lot0, head 290af2b2, pushed
ethod skill ~/.claude/skills/porting-react-to-angular. Workflow: one task per isolated worktree stacked on the previous head, review, cherry-pick onto feat/angular-lot0, minors routed to next task.
Ruling: arbitrages B1-B17 accepted as written (cost-if-wrong stated in plan); owner questions (Assistant IA, terra-draw, clustering) asked — defaults applied until answered: Assistant out (entry inactive), freehand hand-written without terra-draw, clustering kept as last 2 tasks
[ledger repair 2026-10-07: lines 1-4 were overwritten by an append; lines 1-3 restored from an earlier read, line 4 (owner answers: Assistant never ported, freehand without terra-draw, clustering kept as last 2 tasks of lot 4) restored from its surviving tail]
Ruling: owner 2026-10-07 — branches feat/angular-lot0 and feat/angular-lot6 are PUSHED to GitHub (not main) after each integrated task; supersedes "NO push" for these two branches only — cost if wrong: none (backup)
Ruling: T1 keeps lib/navigation/config copy verbatim (parity test) — the Assistant entry is filtered OUT at rendering (Task 3, rail) and Ctrl+K not bound; Voronoï (reachable only via the chat in React) is NOT shown in the Analyse panel (Task 17) — cost if wrong: re-add an entry later
Task 1: implemented 59473590 on worktree (base f6dc2ce7); review dispatched (sonnet)
Task 2: dispatched in worktree stacked on 59473590 (model sonnet)
Task 1: review → Spec ✅, Approved
Task 1: minor (carried into Task 3): filter the Assistant entry at rendering; drop the `etincelles` icon if unused; open /app/catalogue once in the browser
Task 1: complete; cherry-picked onto feat/angular-lot0
STOPPED by owner 2026-10-04 (out of minutes). Task 2 agent stopped mid-run in its worktree (uncommitted/partial; restart Task 2 fresh from 4a8a11af on resume). Lot 4: Task 1 done.
RESUMED 2026-10-06 by owner. Task 2: re-dispatched fresh in worktree based on 4a8a11af (model sonnet); earlier partial worktree abandoned
Task 2: implemented 580f3427 on worktree-agent-acc9b3a5385c6b6f9 (base 4a8a11af), DONE_WITH_CONCERNS (index-signature notation, CATALOGUE regenerated); review dispatched (opus)
Task 2: review → Spec ✅, Approved (opus), 5 minors
Task 2: minor (deferred): PIN_COLORS holds var(--bg-level-2) in a `hex` field + violet #a855f7 (verbatim) — Ruling: kept verbatim for parity; any consumer MUST use it in DOM only, never in a MapLibre paint — carried to T8 (POI/OOH) — cost if wrong: addLayer throws
Task 2: minor (deferred): TEINTES_RADIO maps #050505→bg-level-0 and #f0f0f0→text-primary (changes light theme vs React); heatmap/radio paint literals not all named — Ruling: fix at T9 (radio): use brand-teal-fg for invariant dark, keep heatmap core invariant, name remaining literals — cost if wrong: radio layer looks different from React in light theme
Task 2: minor (deferred): comments of types-risque.ts/pprt.ts lost accents/abridged vs "corps verbatim" claim
Task 2: minor (deferred): carreaux/expressions.ts COULEUR_DONNEE_ABSENTE hex outside B12 header — route to T6 (carreaux): read token donnee-absente
Task 2: minor (deferred): CATALOGUE_CODE now hides dead React exports imported only by parity test (POI_TYPES, AUDIENCE_METRICS…) — final review to triage
Task 2: complete (commits 4a8a11af..580f3427, review clean); cherry-picked onto feat/angular-lot0
Task 3: dispatched in worktree stacked on 8fd75605 (model opus); carries T1 minors (Assistant filtered at render, etincelles icon, catalogue check)
Task 3: implemented 563cb065 on worktree-agent-a2f4139150eb1f84d (base 8fd75605), DONE_WITH_CONCERNS (2 timeouts under load also on base; etincelles kept; shadows dropped flat); review dispatched (opus)
Task 3: review → Spec ✅, Needs fixes (opus): 1 Important (shortcuts dead after croix close — focus lost to body)
Task 3: minor (deferred): annonce.service timers of dropped announcements keep running (harmless)
Task 3: minor (deferred): mg-rail / mg-barre-haut / mg-panneau-carte / mg-annonce have no own specs (covered via carte.page.spec)
Task 3: fix round 1/5 dispatched (resume implementer): focus fix + spec, Escape comment/behaviour w/ badge menu, ease tokens, JSDoc, 2nd-theme screenshots, remote.spec timeouts proof on base
Task 3: fix round 1 implemented c6841b3b; scoped re-review dispatched (sonnet)
Ruling: remote.spec.ts l.163/l.212 timeouts are pre-existing (fail at base 8fd75605 too, run alone) — route an explicit 15 s timeout (patron app.config.spec.ts) into Task 4 — cost if wrong: flaky suite masks a real regression in remote routes
Task 3: fix round 1/5 (6 addressed, 0 open; commits 563cb065..c6841b3b)
Task 3: minor (deferred): annonce.service slice(0, -(MAX_VISIBLES-1)||undefined) correct but obscure
Task 3: complete (commits 8fd75605..c6841b3b, review clean); cherry-picked onto feat/angular-lot0
Task 4: dispatched in worktree stacked on 18876fd1 (model opus); carries remote.spec 15 s timeout ruling
STOPPED by owner 2026-10-06. Task 4 agent stopped mid-run (uncommitted partial in worktree-agent-ad4f574f41973337f — restart Task 4 fresh from 18876fd1 on resume, using dispatch-common.md). Lot 4: Tasks 1-3 done.
RESUMED 2026-10-06 (2nd time). Task 4: re-dispatched fresh in new worktree based on 18876fd1 (model opus); partial worktree agent-ad4f574f41973337f abandoned
Ruling: lot 6 (admin) runs IN PARALLEL on branch feat/angular-lot6 (from 18876fd1), own plan + own ledger; lot-4 work stays on feat/angular-lot0; lot 6 rebased onto lot 4 at its end — cost if wrong: conflicts in shared files (ARCHITECTURE.md, routes, navigation.ts, icones.ts) to resolve by hand
Task 4: implemented 5e5c3cd5 on worktree-agent-a2a2655be8a052e82 (base 18876fd1), DONE_WITH_CONCERNS (MAGELIAN style approximated with existing tokens; React bug clair/MAGELIAN same URL fixed by id; Assistant line dropped from Aide; FOND compact selector added); review dispatched (opus)
Ruling: adding NEW tokens to app/globals.css + angular/src/styles/jetons.css (+ DESIGN_SYSTEM.md) is ALLOWED under gel P5 — precedent lot 3 T8 (--contour-point) and Rendu (--cta-hover); gel covers React behaviour, not additive tokens — cost if wrong: a CSS-only addition in a frozen file
Task 4: review → Spec ✅, Needs fixes (opus): 2 Important (MAGELIAN repaint touches data layers; palette approximated → new --carte-magelian-* tokens)
Ruling: ⚠️ Assistant line removed from Aide — consistent with owner decision (Assistant never ported) — cost if wrong: one help line to re-add
Ruling: ⚠️ compact FOND selector added — routed to T4 by T3 review — cost if wrong: an extra widget to remove
Task 4: minor (deferred): Réglages back-office inert links keep hover affordance
Task 4: minor (deferred): carte.page.spec "aucune annonce" assertion not discriminating
Task 4: minor (deferred): fond-compact / fond-carte have no own specs
Task 4: minor (deferred): RED reconstructed by mutation, not run first
Task 4: minor (deferred): Docker/Supabase left running after task (acceptable, local dev env)
Task 4: fix round 1/5 dispatched (resume implementer)
Task 4: fix round 1 implemented 4b972fa9; scoped re-review dispatched (sonnet)
Task 4: fix round 1/5 (2 addressed, 0 open; commits 5e5c3cd5..4b972fa9)
Task 4: complete (commits 18876fd1..4b972fa9, review clean); cherry-picked onto feat/angular-lot0
Task 5: dispatched in worktree stacked on ff962408 (model opus)
Task 5: implemented 636995b2 on worktree-agent-aabdbf21203753035 (base ff962408), DONE_WITH_CONCERNS (AuthService.lireProfil gains organisation + oublierProfil, outside brief file list; 101 depts not 104; React bug « Chargement… » forever fixed; loupe icon added → 54); review dispatched (opus)
Ruling: icon `loupe` is added by BOTH lot 4 T5 and lot 6 T2 — at lot 6 rebase keep ONE entry (same lucide `search` path) and recompute the icon count — cost if wrong: a duplicate-key compile error caught at rebase
Task 5: review → Spec ✅, Approved (opus), 5 minors
Task 5: minor (deferred): panneau-filtre spec title « cp remplit le champ » tests only region
Task 5: minor (deferred): lireProfil failure → « Aucune zone enregistrée » (React fell back to JWT org)
Task 5: minor (carried into Task 14): orgChangee not wired on /carte — a zone filter of the previous org stays posed
Task 5: minor (carried into Task 6): hover rgba(255,255,255,0.04) hard-coded in liste-multiple (invisible in light) — replace by a token/color-mix (owner rule: no hard-coded colors)
Task 5: minor (deferred): T5 captures show each state in one theme only
Task 5: complete (commits ff962408..636995b2, review clean); cherry-picked onto feat/angular-lot0 as 95897d8c
Task 6: dispatched in worktree stacked on 95897d8c (model opus); carries T2 minor (COULEUR_DONNEE_ABSENTE) + T5 minor (hover rgba)
STOPPED (session ended) 2026-10-06 mid Task 6: uncommitted partial in .claude/worktrees/agent-ad04d12a4906abd2e (22 files, HEAD 95897d8c, no report).
RESUMED 2026-10-07. Ruling: Task 6 resumed IN PLACE in agent-ad04d12a4906abd2e (partial kept, audited by the new implementer, no reset --hard) rather than restarted fresh — partial is substantial (carreaux service/api/legend/calques panel + tokens) and owner wants speed — cost if wrong: a flawed partial survives, caught by the task review
Task 6: re-dispatched (opus) in agent-ad04d12a4906abd2e, base 95897d8c
Task 6: implemented 65b7738e on worktree-agent-ad04d12a4906abd2e (base 95897d8c), DONE_WITH_CONCERNS (partial kept; RED by mutation; brief asked localStorage for collapsed groups, React doesn't → React parity kept; new invariant token --carreaux-contour; T2/T5 minors fixed); review dispatched (opus)
Task 6: review → Spec ✅, Approved (opus), 5 minors
Ruling: plan/brief line "groups collapsed state re-read from localStorage" is WRONG — React PanneauCalques keeps groups in useState all-collapsed, useFilterSections(true,…) persists nothing; T7-T12 must NOT build on a persisted collapsed state (React parity) — cost if wrong: one remembered-state feature to add later
Task 6: minor (carried into Task 7+): sections/basculerSectionInterne/DOCUMENT in panneau-calques prepared but unused until T8-T12 — use them or remove; localStorage-throws test cannot fail (panel never reads storage) — rewrite or drop
Task 6: minor (deferred): legend « POI » empty block only a comment; 3D relief lost on fond change (new map not re-pitched, probably React too)
Task 6: complete (commits 95897d8c..65b7738e, review clean); cherry-picked onto feat/angular-lot0 as e6c71f94, pushed
Task 7: dispatched (opus) in isolated worktree, base e6c71f94; carries T6 minors (unused sections/DOCUMENT, non-failing localStorage test) + ruling (no persisted collapsed state)
Task 7: implemented ec5e08d6 on worktree-agent-a0b1c4c71193d64a5 (base e6c71f94), DONE_WITH_CONCERNS (brief inexact: IRIS floor 4 not 9, detail param code_iris; 'below floor' banner tested not browser-checked; layer order vs point layers left to T8; 3 React defects fixed; detail panel SHADOW kept for parity vs flat rule — T3 dropped shadows); review dispatched (opus)
Task 7: review → Spec ✅, Needs fixes (opus): 2 Important (focus lost to body after detail croix → shortcuts dead, same as T3; shadow kept on detail panel contradicts flat rule + hardcoded color)
Ruling: detail panel SHADOW removed (and skeleton gradient made flat) despite brief — DESIGN_SYSTEM « flat total » + T3 precedent (shadows dropped) + owner rule no hardcoded colors outrank a brief line — cost if wrong: one box-shadow to re-add
Ruling: T8 brief carries « order of colour layers (carreaux, IRIS) vs point layers » — T7 left it open — cost if wrong: choropleth drawn over POI points
Task 7: minor (deferred): z5/z7 captures light only; duplicated « % » test; imports order; click in detail panel closes Calques panel (React parity)
Task 7: fix round 1/5 dispatched (resume implementer)
Task 7: fix round 1 implemented c9352127; scoped re-review dispatched (sonnet)
Task 8: dispatched (opus) in isolated worktree, base 290af2b2; carries layer-order ruling + GET/POST check on /api/map/pois
RESUMED 2026-10-10 by owner (« passe à la suite, c'est toi le chef de projet »). feat/angular-lot0 = 852116c2 (pushed), includes lot 6 T1-T5 + espaces/Accès + dentsu rename since 290af2b2.
Ruling: Task 8 resumed IN PLACE in agent-ab860e1c26a62a3e4 (uncommitted partial on 290af2b2, ~40 files) — implementer stashes partial, resets to 852116c2, pops and resolves conflicts — same precedent as T6 (owner wants speed) — cost if wrong: a flawed partial survives, caught by task review
Ruling: push feat/angular-lot0 to GitHub after each integrated task (owner 2026-10-07 and again 2026-10-10 « pousse sur github une sauvegarde mais pas sur main ») — cost if wrong: none (backup)
Task 8: re-dispatched (opus) in agent-ab860e1c26a62a3e4, base 852116c2
Task 8: implemented 50d1ac8e on worktree-agent-ab860e1c26a62a3e4 (base 852116c2), DONE_WITH_CONCERNS (OOH 1000/1434 capped by db-max-rows in React too, frozen route; Street View real key untested; light-theme Afficher fill + --danger banner deviations); review dispatched (opus)
Ruling: OOH route capped at 1 000 of 1 434 panels by db-max-rows (React too) — not fixed in T8 (route outside port scope, gel P5); routed to a dedicated server fix (lireTout) before lot-4 final review, transport route to be checked for the same cap — cost if wrong: 434 panels missing on both apps until then
Task 8: review → Spec ✅, Needs fixes (opus): 1 Important (shared subscription POI/OOH leaves cancelled request's chargement=true → button stuck; effacer() doesn't reset OOH)
Task 8: minor (deferred): transport outside cancellation; clicked-circle popup survives Tout effacer; lancer public taking other services' signals; tiroir borders 1px not 0.5px; T8-tiroir-light capture state differs (Figurés)
Task 8: fix round 1/5 dispatched (resume implementer)
Task 8: fix round 1/5 (3 addressed, 0 open; commits 50d1ac8e..224e62df)
Task 8: minor (deferred): popupCercle keeps only the last popup (React parity, single popup)
Task 8: complete (commits 852116c2..224e62df, review clean); fast-forwarded feat/angular-lot0 to 224e62df, pushed
Ruling: main checkout switched from feat/espaces-de-travail to feat/angular-lot0 (both were 852116c2; lot 4 integrates on lot0) — cost if wrong: none
Task 9: dispatched (opus) in isolated worktree, base 224e62df; carries T2 TEINTES_RADIO ruling
Task 9: implemented 9bc724c3 on worktree-agent-aaad25c6a3a23715e (base 224e62df), DONE_WITH_CONCERNS (radio 500 by default: two overloads of get_radio_emetteurs_geojson (4 & 6 args) → PostgREST ambiguous, React too; emitters lack name/radio id/range; /api/radio/stations capped 1000/1175); review dispatched (opus)
Ruling: server-side defects found while porting (OOH 1000/1434, radio overload 500, radio stations 1000/1175, emitters without radio association) are bundled into ONE server-fix task (« T-serveur ») run after T9 integration, in its own worktree, local DB only (drop the 4-arg overload via a numbered sql/ migration) — they break React too, so fixing them is a correctif, not new React work — cost if wrong: a migration to revert locally
Task 9: review → Spec ✅, Approved (opus), 7 minors
Task 9: minor (carried into T-serveur): radio 500 shown raw on screen (11 English lines with SQL signatures) — route must return a generic French message
Task 9: minor (deferred): 2 unused TEINTES_RADIO constants; cerne token brand-teal-fg semantically « text on teal »; late search response can reopen autocomplete; 2 Angular captures scrolled; theme repaint untested; legend comment cites React wrongly; Figurés legend not seen in captures
Task 9: complete (commits 224e62df..9bc724c3, review clean); fast-forwarded feat/angular-lot0, pushed
T-serveur: dispatched (opus) in isolated worktree, base 9bc724c3 (brief task-serveur-brief.md: OOH/transport/stations caps, radio overload 500 + French error, emitters without radio)
T-serveur: implemented 4bb86238..9cfbe30f (base 9bc724c3), DONE_WITH_CONCERNS (sql/240 applied locally; puissance empty; regionale portée has no colour client-side; count_emetteurs_par_radio 861 rows near 1000); review dispatched (opus)
Ruling: T10 dispatched in parallel with T-serveur review, based on 9cfbe30f (T-serveur head) — files disjoint (angular/ vs app/api+sql); review fixes to T-serveur would land as extra commits rebased under T10 — cost if wrong: a rebase of T10 at integration
Task 10: dispatched (opus) in isolated worktree, base 9cfbe30f
T-serveur: review → Spec ✅, Needs fixes (opus): 2 Important (transport pagination re-walks category index per page → ~6× buffers on dense city views; radio shown per emitter picked alphabetically → false info « Air Zen » on 3 046 emitters)
Ruling: radio per emitter — without a radio filter, an emitter carries a radio ONLY if it is linked to exactly one radio; otherwise radio fields NULL + new field nb_radios (count); with a radio filter, the selected radio — never an arbitrary pick, DESIGN principle « jamais d'information fausse » outranks colouring every point — cost if wrong: fewer coloured points, popup says « Radio non associée » on multi-radio sites until clients show nb_radios
Ruling: transport — single-pass bounded read (RPC RETURNS jsonb with LIMIT 5001, tronque when 5001) instead of lireTout paging, per I/O rules — cost if wrong: one extra RPC to maintain
Task-serveur: minor (deferred): tronque:true not surfaced in React nor Angular UI
T-serveur: fix round 1/5 dispatched (resume implementer)
T-serveur: fix round 1 implemented e9d096ab..4c54681c (sql/241 transport RPC jsonb, sql/242 radio unique + nb_radios; no emitter has exactly one radio (min 13) → radio grey without filter); scoped re-review dispatched (sonnet)
T-serveur: fix round 1/5 (3 addressed, 0 open; commits 9cfbe30f..4c54681c)
T-serveur: minor (deferred): parseFloat("Infinity") passes bbox validation (query bounded, harmless)
Ruling: radio emitter-radio links are 13+ radios per emitter minimum — the « liaisons » are coverage, not broadcast; without a radio filter all emitters stay grey (truthful) — owner may later want a different default (e.g. colour by nb_radios) — cost if wrong: a grey radio layer by default
T-serveur: complete (commits 9bc724c3..4c54681c, review clean); fast-forwarded feat/angular-lot0, pushed; sql/240-242 applied on LOCAL DB only
Task 10: implemented 4d14b241 (base 9cfbe30f), rebased by controller onto 4c54681c → ee352a94 (ARCHITECTURE.md conflict: kept base T8/T9 bullets + T10 bullet), DONE_WITH_CONCERNS (brief said no_data, React shows dated stale message — followed React; HealthIndicatorCard (~364 l.) not ported, plan assigns it to no task; civic reads visible bbox not world (I/O); santé CP route capped 1000 (100 rows today)); review dispatched (opus)
Ruling: HealthIndicatorCard is ported within lot 4 (parity goal; plan omission) — in T10's fix round if review agrees, else as a T10b — cost if wrong: one extra card to maintain
Task-serveur: minor (deferred): /api santé CP table read capped 1000 (100 rows today, ~6 100 after an ingestion) — fix server-side before lot-4 final review
Task 11: dispatched (opus) in isolated worktree, base ee352a94 (parallel with T10 review)
Task 10: review → Spec ❌, Needs fixes (opus): 2 Important (sante.service flux subscription overwritten when zones come from cache → uncancellable, pollen painted on air layer; HealthIndicatorCard parity gap ~615 l.)
Task 10: minor (deferred): ingestion has no % progress bar (React neither); health errors silent; commune cached after failure; white stroke in light theme; small code nits (see task-10-review.md)
Ruling: HealthIndicatorCard ported in T10 fix round 1 by the same implementer (context intact) rather than a separate T10b — cost if wrong: a larger fix diff to re-review
Task 10: fix round 1/5 dispatched (resume implementer)
Task 10: fix round 1 implemented a6e12602..8bea7e0d (flux switchMap, HealthIndicatorCard ported as fiche-sante, new token --contour-civique); scoped re-review dispatched (opus, larger diff)
Task 10: fix round 1/5 (3 addressed, 0 open; commits ee352a94..8bea7e0d)
Task 10: minor (deferred): duplicate blank line in fiche-sante; IRIS legend overlaps bottom of Calques panel on Angular captures (T6/T7 area) — final review
Task 10: complete (commits 4c54681c..8bea7e0d, review clean); fast-forwarded feat/angular-lot0, pushed
Task 12: dispatched (opus) in isolated worktree, base 8bea7e0d (parallel with T11)
Ruling: owner 2026-10-10 asks « code hyper propre, fractionné, factorisé, commenté pour le dev qui reprend » — add Task 22 « propreté et reprise » after T21: split the 8 Angular files > 400 lines (icones.ts excepted, data table), remove dead pages (essai-carte if unused), one README per features/ folder + angular/README « guide de reprise »; every implementer brief from T12 on carries « fichier ≤ 400 lignes, une responsabilité, logique pure dans logique/ » — cost if wrong: one extra task
Task 11: implemented e1eca135 (base ee352a94), DONE_WITH_CONCERNS (shared quandStyleCharge now waits load OR idle — layers T6-T11 did not come back after fond change, seen in browser only; /api/meteo-geo CP capped 1000/6187 by get_zone_centroids (React too); SanteService uses shared zone cache; CP bbox follows React (filter bbox else visible map) not brief)
Ruling: CP bbox for weather follows React (dialog text promises « CP de la vue carte ») — parity outranks brief — cost if wrong: one extra request mode
Task-serveur: minor (deferred): get_zone_centroids / /api/meteo-geo capped at 1000 CP of 6 187 — second server-fix batch before final review (with santé CP cap)
Task 11: rebase onto 8bea7e0d conflicts in 5 files (sante.service, civique.api, specs, ARCHITECTURE) — sent back to implementer to rebase and resolve
Task 11: rebased onto 8bea7e0d → f880d5d3 by implementer; review dispatched (opus)
T-serveur2: dispatched (opus) in isolated worktree, base 8bea7e0d (meteo-geo CP cap, santé CP cap, sweep of carte routes)
Task 11: review → Spec ✅, Needs fixes (opus): 3 Important (I1 polygon failure swallowed → success shown; I2 meteo.api comment says no PostgREST cap, contradicts measure; I3 dialog duplicates logique/meteo constants + validation in component — owner cleanliness rule)
Task 11: fix round 1/5 dispatched (resume implementer)
Task 11: fix round 1 implemented 64b1f781; scoped re-review dispatched (sonnet)
Task 11: fix round 1/5 (3 addressed, 0 open; commits f880d5d3..64b1f781)
Task 11: minor (deferred): no browser re-check after fix round (specs only); M9 kept for parity
Task 11: complete (commits 8bea7e0d..64b1f781, review clean); fast-forwarded feat/angular-lot0, pushed
Task 12: implemented 64ebeb9b (base 8bea7e0d), DONE_WITH_CONCERNS (no initial RED, 8 mutations instead; brief 126 PPRT at z8 from other extent, 43 both apps; --contour-point as React; Tout effacer doesn't clear like React); rebase onto 64b1f781 sent back to implementer
Task 12: rebased → f3104b69 on 64b1f781; review dispatched (opus)
T-serveur2: implemented bbac32ef..91abf67c (sql/243-245 jsonb twins: meteo centroids, santé CP, CP in bbox for score; ingestion loads 35 358 CP-commune links), DONE_WITH_CONCERNS (ingestion not rerun; LOCAL PostgREST caps RPC SETOF at 1000 too, CLAUDE.md says 5000; count_emetteurs_par_radio 861; custom-geo/list 352); review dispatched (opus)
Task 12: review → Spec ✅, Needs fixes (opus): 1 Important (couche-risques.ts 399 l., two responsibilities → popups-risques.ts; el() DOM helper copied 3× → carte/contenu-popup.ts)
Task 12: fix round 1/5 dispatched (resume implementer)
T-serveur2: review → Spec ✅, Approved (opus), 5 minors (ingestion still offset-paged, cheap; mapping step no total; « 10000 » unformatted; old get_zone_centroids still granted to anon but calls service_role twin; report claims Angular shows meteo error — not wired at that commit)
T-serveur2: rebased by controller onto 64b1f781 (ARCHITECTURE.md: 2 hunks, server side kept) → 4e064b96..02da488f; complete (review clean); fast-forwarded feat/angular-lot0, pushed; sql/243-245 LOCAL only; ingestion NOT rerun
Ruling: CLAUDE.md « PostgREST tronque à 5 000 les RPC tabulaires » is FALSE for the local stack (PGRST_DB_MAX_ROWS=1000 applies to RPC SETOF too; 5 000 was the deleted hosted project) — T-serveur3: fix CLAUDE.md + lib/supabase/lire-tout.ts header + troncature-postgrest.test.ts + docs/SUITE_TRONCATURE_POSTGREST.md, and calculer_score_composite (up to 3 000 CP via /api/custom-geo/source/score → likely cut at 1 000 today) — before T18 (score panel) — cost if wrong: none, doc truth
Task 11: minor (deferred): meteo.api.ts comment « 1 000 CP / 6 187 » now stale after sql/243
T-serveur3: dispatched (opus) in isolated worktree, base 02da488f (CLAUDE.md/lire-tout/troncature test truth 1000; calculer_score_composite jsonb twin)
Task 12: fix round 1 implemented 14b07093 (popups-risques split, elementTexte single DOM factory replacing 4 copies incl. radio); scoped re-review dispatched (sonnet)
Task 12: fix round 1/5 (3 addressed, 0 open; commits f3104b69..14b07093)
Task 12: minor (deferred): meteo popup builds DOM by hand (could use elementTexte); « D'où viennent ces zones ? » 4 px taller; services before specs (mutation script outside repo)
Task 12: complete (review clean); rebased cleanly onto 02da488f, fast-forwarded feat/angular-lot0, pushed
Task 13: dispatched (opus) in isolated worktree (base = lot0 head after T12)
T-serveur3: implemented e8ef0a40..50dda324 (score route reads existing _jsonb twin sql/170; sql/246 voronoi jsonb twin; docs 1000; troncature test reads config.toml); get_strategy_comparison_data (306 150 rows) NOT fixed — needs DB aggregate, Gemini route slated for AI removal; review dispatched (opus)
T-serveur3: review → Spec ✅, Approved (opus), 1 Important (ARCHITECTURE.md:756-759 still says 5 000 RPC truncation) + doc minors; fix round 1/5 dispatched (resume implementer)
Ruling: get_strategy_comparison_data (306 150 rows) left as named debt C — a jsonb twin would ship 306k rows (incident class 04-08); real fix = DB aggregate, route belongs to the Gemini bilan slated for AI removal — cost if wrong: strategy comparison silently cut at 1 000 until AI removal
PAUSED 2026-10-10 (usage limit). feat/angular-lot0 = 784b610e (pushed): T1-T12 + T-serveur 1-2 integrated.
In flight at pause: T-serveur3 fix round 1 (worktree agent-a604288f70972af64, base 02da488f, commits e8ef0a40..50dda324 + doc fix pending) — on resume: check its branch, scoped re-review, rebase onto lot0 head, integrate.
In flight at pause: Task 13 implementer (worktree agent-a6309ddf20bcb1395, base 784b610e) — on resume: check git log/status there; if committed → review; if partial → resume in place.
Remaining after: T14-T21 + T22 (propreté/reprise) + final whole-branch review. Lot 4 ≈ 12/21 tasks done.
T-serveur3: fix round 1 implemented eb4edac0 (doc 5000→1000 everywhere, DROP reason restored); NOT yet re-reviewed nor integrated — on resume: scoped re-review 50dda324..eb4edac0, rebase onto lot0 head, integrate
Task-serveur: minor (deferred, new): app/api/admin/transport-stats/route.ts:28 .limit(5000) on panneaux_affichage → scoring on 1 000 of 1 434 — fix with lireTout in a later server task
RESUMED 2026-10-10 evening after usage limit. Dev servers :3000/:4200 were killed by low memory (not restarted). T13 agent died mid-run (rate limit), partial uncommitted in agent-a6309ddf20bcb1395 → resume same agent in place.
T-serveur3: fix round 1/5 (1 Important addressed; minor partial — stale « 5 000 » comments remain in correlation.ts, dv360 push routes, custom-geo export, anfr-import; transport-stats .limit(5000) code bug); fix round 2/5 dispatched incl. check for paginations that stop after first 1 000-row page
Task 13: implemented 09e7cbef (base 784b610e), DONE_WITH_CONCERNS (servers killed by low memory: missing React dark captures, step ④ Angular light, A6 54-vs-55 remeasure; memory not measured; zone labels along contours not in React; legende-carte.component.ts 431 l. → T22); review dispatched (opus)
Ruling: T13 missing browser captures (memory-killed servers) are routed to T21 (full parity pass) rather than blocking — six banner figures already matched React — cost if wrong: a visual gap found later at T21
Task 13: review → Spec ✅, Needs fixes (opus): 1 Important (I1 legend block duplicated from carte-risque.component: JETON_NIVEAU, NIVEAUX.map, trait convention sentence; niveau-* tokens repeated in zones-risque.service)
Ruling: radius labels along zone contours NOT shown on the main map (React parity: 3 layers, no labels) — cost if wrong: one layer to re-enable
Task 13: minor (deferred): captures on different basemaps (Liberty vs Clair); roadmap claims A6 lifted without remeasure; no `inert` on map under module; risques imports carte/pont-carte.ts; legende-carte 430 l. → T22
Task 13: fix round 1/5 dispatched (resume implementer)
T-serveur3: fix round 2 implemented 5fc7ab2b..35490566 — REAL code bugs found behind stale « 5 000 » comments: custom-geo export + both DV360 push routes read only 1 000 zone codes (1 641-CP zone sent amputated to DV360); transport-stats 1 000/1 434; anfr-import paginated by 5 000 → stopped after first 1 000 page (11 704 of 12 704 emitters never reconciled); scoped re-review dispatched (opus)
Task-serveur: minor (deferred, new): admin/sources/[id]/export .limit(50000) → exports max 1 000 rows per source; needs a chosen bound (sources up to 285 000 rows) before lireTout
Task 13: fix round 1 implemented c9cdc40d (risques/logique/legende-niveaux.ts shared; etiquettes option off on main map; inert on map zone); scoped re-review dispatched (sonnet)
Task 13: fix round 1/5 (3 addressed, 0 open; commits 09e7cbef..c9cdc40d)
Task 13: complete (commits 784b610e..c9cdc40d, review clean); fast-forwarded feat/angular-lot0, pushed
T-serveur3: fix round 2/5 (6 files addressed; NEW Important: anfr-import now sees 12 704 emitters → DELETE phase can cascade-delete irreplaceable emetteur_radio_stations links (569 698 repatriated 19/09), no proportion guard, deletion errors ignored, deleted count not exact)
Ruling: ANFR import never deletes an emitter that carries radio links (reported as « retiré de l'ANFR, conservé car lié ») and aborts the delete phase if it would remove > 5 % of emitters; errors logged; { count: 'exact' } — irreplaceable data outranks ANFR mirroring — cost if wrong: stale emitters kept in base until owner decides
T-serveur3: fix round 3/5 dispatched (ANFR guard + bidding strategies export :95 + custom-geo/[id] :60 caps)
Task 14: dispatched (opus) in isolated worktree, base c9cdc40d; carries T5 minor (orgChangee not wired on /carte)
T-serveur3: fix round 3 implemented 8af47ded..03e5f8f6 (ANFR guard: linked emitters kept, >5% abort, exact count, LIAISONS step; strategy export + custom-geo/[id] caps fixed); national strategy export paginates without order() — noted; scoped re-review dispatched (opus)
T-serveur3: fix round 3/5 (2 addressed, 0 open); minor (deferred): race radio-matcher link creation between ANFR link read and DELETE (needs RPC DELETE … WHERE NOT EXISTS); national strategy export paginates without order()
T-serveur3: complete (review clean); rebased by controller onto c9cdc40d (no conflict; db/docs/api unit tests green except known), fast-forwarded feat/angular-lot0, pushed; sql/246 LOCAL only
Ruling: PARKED for owner — lib/radio/radio-matcher.ts:51 wipes ALL 569 698 emetteur_radio_stations links before rebuilding (irreplaceable data, repatriated 19/09) — not fixed autonomously (destructive admin action, owner decision: guard/backup or forbid) — cost if wrong: one admin click erases the radio links
Task 14: rebase onto new lot0 head needed at integration (server3 landed meanwhile; T14 told not to touch custom-geo/[id] & export routes)
Task 14: implemented a3d178e8 (base c9cdc40d), rebased cleanly by controller onto c799629a → 2944a203, DONE_WITH_CONCERNS (specs after code, 6 mutations; battle legend/max tier → T17; Créer une zone placeholder → T16; 4 components without own spec); review dispatched (opus)
Task 15: dispatched (opus) in isolated worktree, base 2944a203 (T14 under review; rebase at integration)
Task 14: review → Spec ✅, Needs fixes (opus): 2 Important (org change handled on mousedown only → keyboard change leaves mg-mes-zones on old org, op writes old org_id; bbox loop duplicated in zone-du-lien.ts vs bboxDeGeometrie)
Task 14: minor (deferred): light-theme captures of liste/zone-affichee missing; Échap/voile of dialog, export success, link failure untested; BatailleService categorie/legende without reader until T17 (+ 12 minors in task-14-review.md)
Task 14: fix round 1/5 dispatched (resume implementer)
Task 14: fix round 1 implemented 216b9d41; scoped re-review dispatched (sonnet)
Task 14: fix round 1/5 (2 addressed + minors, 0 open; commits 2944a203..216b9d41)
Task 14: complete (commits c799629a..216b9d41, review clean); fast-forwarded feat/angular-lot0, pushed
Task 15: implemented 02f0e3e4 (base 2944a203), rebased by controller onto 216b9d41 → 7aea9ad0 (conflicts ARCHITECTURE + carte.page.spec resolved keeping both; ng test 1 703 green), DONE_WITH_CONCERNS (React defect kept for parity: stored plan line without weight = 0 %, footer sums absent rows; spec of plan-media.ts not seen RED; some captures dark only; mg-tableau-plan-media no own spec); review dispatched (opus)
Task 16: dispatched (opus) in isolated worktree, base 7aea9ad0 (T15 under review; rebase at integration)
Task 15: review → Spec ✅, Needs fixes (opus): 2 Important (React defect kept for parity shows FALSE numbers: campaign plan on other zones → every line 0 % while footer says 100 %, and Save writes zero weights to DB + export snapshot freezes them; local number formatters duplicate core/format/nombre.ts)
Ruling: Angular FIXES the stored-weights defect (keep only weights of present lines, fill the rest pro rata, renormalise to 100) — « jamais d'information fausse » + data written to DB outranks parity; React keeps the bug (frozen, removed at lot 7) and it is listed for the owner — cost if wrong: Angular plan differs from React on that edge case
Task 15: minor (deferred): loose typing of instantane; superfluous ternary in ExportZoneService; DSP export continues after panel close; $any cast on cible; no own spec for the table
Task 15: fix round 1/5 dispatched (resume implementer)
Task 15: fix round 1 implemented 2a3370f3; scoped re-review dispatched (sonnet)
Task 15: fix round 1/5 (2 addressed + minors, 0 open; commits 7aea9ad0..2a3370f3)
Task 15: minor (deferred): unrenormalised complete stored plan can sum to 99.9/100.1 (React behaviour); formaterDecimal shows « — » for NaN
Task 15: complete (commits 216b9d41..2a3370f3, review clean); fast-forwarded feat/angular-lot0, pushed
Task 17: dispatched (opus) in isolated worktree, base 2a3370f3 (parallel with T16); carries T14 BatailleService minimal (categorie/legende without reader) + battle legend/max tier on customZone link; Voronoï absent from Analyse (owner)
Task 16: implemented efff61e6 (base 7aea9ad0), rebased by controller onto 2a3370f3 → 93dcd5c6 (conflicts zones-custom.api.ts imports + ARCHITECTURE.md, both kept; ng test 1 775 green, tsc 0), DONE_WITH_CONCERNS (React radius/drawing never worked — first map click closes Zones panel — fixed; server bug: adjacent CP lists (13001+13002) → create_custom_geo_zone union = GeometryCollection → /save 400, React too; part_retenue shown after save like React; no « Modifier » mode); review dispatched (opus)
T-serveur4: dispatched (opus) — create_custom_geo_zone GeometryCollection on adjacent CP unions (/save 400); admin/sources/[id]/export 1 000 cap (choose a bound); national strategy export pagination without order()
Task 16: review → Spec ✅, Needs fixes (opus): 1 Important (double-click on first vertex / second rectangle corner erases the just-closed shape, dessin.ts:55-62, untested)
Ruling: part_retenue shown after save (React parity) instead of before (brief) — showing it live would add one DB call per slider step (I/O rule) — cost if wrong: one preview call to add later
Task 16: minor (deferred): generic save error message (server message dropped, like React); no own Escape in drawing (Escape closes panel, loses shape); radius and drawing can catch same click; radius preview rebuilt each step (+5 in task-16-review.md)
Task 16: fix round 1/5 dispatched (resume implementer)
Task 17: implemented b4d8ec20 (base 2a3370f3), DONE_WITH_CONCERNS; review dispatched (opus)
Ruling: CP/zone filter passes the guard but sends no territory → battle on whole metropole, as React — kept for parity, listed for owner — cost if wrong: a battle broader than the user expects
Ruling: battle state at page level, closing the panel no longer cancels a running computation (React cancels) — accepted: the result is not lost — cost if wrong: one ORS call not cancelled
Ruling: Voronoï absent from Analyse (owner decision 04/10) outranks brief « shown disabled »
Task-serveur: minor (deferred, new): POI region « PACA » vs referential « Provence-Alpes-Côte d'Azur » → region filter returns 0 POI (React too) — data normalisation task
Task 17: review → Spec ✅, Needs fixes (opus): 3 Important (V1 lancer/appliquer share `flux` → orphan stream not cancelled by Tout effacer/destroy; V2 chained after ORS fill re-reads context without re-checking the guard; poisDeBataille fallback duplicates poisDesAnneaux)
Task 17: minor (deferred): light captures of bataille-v1 and application missing
Task 17: fix round 1/5 dispatched (resume implementer)
Task 16: fix round 1 implemented 6d1c29d1; scoped re-review dispatched (sonnet)
Task 16: fix round 1/5 (1 Important + 3 minors addressed, 0 open; commits 93dcd5c6..6d1c29d1)
Task 16: minor (deferred): closed-shape guard ignores clicks within 8 px of ANY ring vertex (benign)
Task 16: complete (commits 2a3370f3..6d1c29d1, review clean); fast-forwarded feat/angular-lot0, pushed
Task 17: fix round 1 implemented facb7626; scoped re-review dispatched (sonnet)
Task 17: fix round 1/5 (3 addressed, 0 open; commits b4d8ec20..facb7626); rebase onto 6d1c29d1 conflicts (carte.page.ts, bataille.service(.spec).ts, ARCHITECTURE) → sent back to implementer
Task 17: rebased by implementer onto 6d1c29d1 → 7ff0136b..483d41e1 (capture declaration rewritten on T17 signals; V2 not captured = React parity, checked); complete (review clean); fast-forwarded feat/angular-lot0, pushed
Task 17: minor (deferred): capture metadata battle_features = styled rings (React raw features), category '' before first cut; battle capture declaration has no spec coverage
PAUSED 2026-10-11 (usage limit). feat/angular-lot0 = 483d41e1 (pushed): T1-T17 + T-serveur 1-3 integrated.
In flight: T-serveur4 (agent af7693016d741836d, isolated worktree, base 2a3370f3: adjacent-CP GeometryCollection 400, admin source export cap, national strategy export order) — on resume: read its report, review, rebase onto lot0 head, integrate.
Remaining: T18 (Analyse II), T19-T20 (clustering), T21 (parity pass + deferred captures), T22 (propreté/reprise: split >400-line files incl. legende-carte 430 l., READMEs), final whole-branch review.
Owner items to report at the end: radio-matcher wipes all 569 698 links (parked); React keeps plan-media 0 % bug (fixed in Angular); PACA vs Provence-Alpes-Côte d'Azur POI region mismatch; get_strategy_comparison_data 306 150 rows cut at 1 000; ANFR import guard; santé ingestion not rerun (tables still 100 CP).
T-serveur4: implemented 247bbcc5..4f346ec8 (base 2a3370f3; sql/247 ST_CollectionExtract on degenerate holes — 470 of 6 187 CP; admin source export paged, bound 50 000, truncation stated; national strategy export ordered) — NOT yet reviewed nor integrated. On resume: review, rebase onto 483d41e1, integrate.
⚠ To check on resume: integration test zone-risque now fails at 42 409 940 (was 41 025 366 known failure) — did sql/240-247 change it, or the shared DB? Investigate before final review.
Task-serveur: minor (deferred, new): /api/custom-geo/save reads request.json() without lireCorps, English « Internal server error »
RESUMED 2026-10-11. T-serveur4 review dispatched (opus); Task 18: dispatched (opus) in isolated worktree, base 483d41e1
T-serveur4: review → Spec ✅, Approved (opus), minors (cost comment for 10-50k sources; page failure returns raw English PostgREST msg; double cast; ARCHITECTURE places 2 RPC in wrong section; pre-existing: create_custom_geo_zone_with_subzones executable by PUBLIC/anon, by_zone_set branch orders on postal_code only)
T-serveur4: complete; rebased cleanly onto 483d41e1, fast-forwarded feat/angular-lot0, pushed; sql/247 LOCAL only
Ruling: zone-risque integration expectation — 42 409 940 is exactly the 19/09 value (before Docker wipe), sql/240-247 don't touch it; it's DB state (precomputed coverage table matches old grid again) — NOT touched autonomously (test expectation vs rebuilding coverage is an owner/data decision); listed for owner — cost if wrong: one known failing integration test stays red
Task 19: dispatched (opus) in isolated worktree, base 63e72022 (parallel with T18)
Task 18: implementer DONE_WITH_CONCERNS (commit 49d59a7b, base 483d41e1); rebased cleanly onto 63e72022 → ffcecfa1; review dispatched (opus), package review-63e72022..ffcecfa1.diff
Owner items from T18: correlation route saves every run into "Mes analyses" (server); national score "Créer la zone" → 400 (source route capped at 3 000 CP); legende-carte.component.ts 436 l. → T22
Task 18: review → Spec ✅, Needs fixes (opus): 1 Important (correlation selects lose displayed value after collapse/reopen) + minors (in-flight score not cancelled, stale header comment, Rejouer guard comment); GET /api/analyses/[id] not built (no caller) accepted
Task 18: fix round 1/5 dispatched (resumed implementer)
Ruling: tests/unit/db/suppressions-sans-garde.test.ts red on app/api/radio/data/route.ts (pre-existing, not T18) — route to a server fix batch (T-serveur5) before final review, so the root suite is green at lot end — cost if wrong: one small extra server task
Task 19: implementer DONE_WITH_CONCERNS (commit d4c5e3a5, base 63e72022); review dispatched (opus), package review-63e72022..d4c5e3a5.diff
Owner items from T19: no cluster model at 30/45/60 min in DB (both are 15 min) → "Charger les clusters" shows nothing in React and Angular (Angular says so); Gemini cluster analysis not ported (no AI); 2 routes read poi_clusters unpaginated (95 rows today)
Task 18: fix round 1/5 done (commit bcd7d38c); scoped re-review dispatched (sonnet)
Task 18: re-review 1 → all 4 addressed, no new issue (sonnet)
Task 18: complete (commits ffcecfa1..bcd7d38c); fast-forwarded feat/angular-lot0, pushed
Task 19: review → Spec ✅, Needs fixes (opus): 2 Important (ECharts lifecycle duplicated in graphique.component vs courbe; basculerHistorique race/no cancel) + 8 minors; fix round 1/5 dispatched (resumed implementer, incl. rebase onto bcd7d38c)
Ruling (supersedes T-serveur5 ruling): suppressions-sans-garde failure is NOT a code defect — app/api/radio/data/route.ts exists only on the main checkout, gitignored by `data/` (.gitignore:45, already documented ARCHITECTURE.md:1277/1472); the test passes on the main checkout and fails in every clean worktree. Tracking it would publish a route that wipes emetteurs_radio/radios (cascading the 569 698 irreplaceable links) → owner decision (track+guard or delete the route + its admin button); no T-serveur5 — cost if wrong: test stays red in worktrees only
Task 19: fix round 1/5 done (rebased → 915656c3, fix 429a4ca0); scoped re-review dispatched (sonnet)
Ruling: T20 "launch a run only with explicit agreement" — owner granted full autonomy ("tu es en autonomie totale") and the standing DB-test rule ([ESSAI]-style small write, deleted after) covers it: ONE small run (one POI category, one département) allowed, model deleted afterwards with before/after SQL counts; never touch the 2 existing models — cost if wrong: one test model to delete by hand
Task 19: re-review 1 → 9/10 addressed, rebase OK, no regression on courbe/nuage (sonnet); M8 (partial TDD on panneau.ts/radar.ts) is process-only — light capture now provided — parked
Task 19: complete (commits 915656c3..429a4ca0); fast-forwarded feat/angular-lot0, pushed
Task 20: dispatched (opus) in isolated worktree, base 429a4ca0, ports :3001/:4201
Task 20: implementer DONE_WITH_CONCERNS (commit 7fd0fd7b, base 429a4ca0); real run done and deleted (DB back to 2 models); review dispatched (opus)
Server defects found by T20 (→ T-serveur5): /api/poi-clusters/poi-types reads poi_france unpaginated → cut at 1 000 of 390 029 (step 1 offers only arret_transport, React too); all-16-variables launch sends features:null → script never runs full-retrain, no model trained (route comment says otherwise)
T-serveur5: dispatched (opus) in isolated worktree, base 429a4ca0, Next :3003 (poi-types truncation, features:null no-train, poi_clusters unpaginated reads)
Task 20: review → Spec ✅, Needs fixes (opus): 1 Important (duration field rewrites keystrokes — React defect #9 not actually fixed) + 5 minors; DB verified back to 2 models/0 job
Ruling: T20 review finding 4 (UI doesn't flag server defects) — no UI warnings for defects T-serveur5 is fixing; only the false « Lancez --mode full-retrain » text fixed in Angular — cost if wrong: one warning to add if T-serveur5 can't fix the route
Task 20: fix round 1/5 dispatched (resumed implementer)
Task 20: fix round 1/5 done (commit 0f4a4fe6 on worktree-agent-a8c164248bca63e27, base 7fd0fd7b); NEXT: scoped re-review of 7fd0fd7b..0f4a4fe6 (sonnet), then ff-merge lot0 + push
PAUSED 2026-10-11 (usage limit). T-serveur5 still running in its worktree (may have been cut off — check its report/branch on resume, base 429a4ca0). Then T21, T22, final review, owner report.
RESUMED 2026-10-11 after limit: T-serveur5 resumed in place; T20 scoped re-review dispatched (sonnet)
Task 20: re-review 1 → 6/6 addressed (sonnet); new nit parked: "012" rewritten to "12" (harmless)
Task 20: complete (commits 7fd0fd7b..0f4a4fe6); fast-forwarded feat/angular-lot0, pushed
Task 21: dispatched (opus) in isolated worktree, base 0f4a4fe6, ports :3001/:4201 (+AIDA host ≥4300), with task-21-addendum.md
T-serveur5: implementer DONE_WITH_CONCERNS (sql/248 types_poi_clustering jsonb LOCAL only; features null→ALL_FEATURES; poi_clusters via lireTout + .in() batches of 150); rebased onto 0f4a4fe6 → 1eff47d1 (ARCHITECTURE conflict resolved: kept T20 /count row + server poi-types row); review dispatched (opus); fix round will also update stale Angular texts (clustering.api.ts:26 truncation warning, wizard end message for "all variables")
T-serveur5: review → Spec ✅, server approved, Needs fixes (opus): I-1 Angular end message/comments made stale by the fix; I-2 script CHECK 7 positional labels (wrong labels, IndexError <16 vars, pre-existing); minors M-3..M-8 (M-7 134 sequential round trips at 20k POI accepted: super_admin-only route; M-8 flaky export-source-borne/espaces-comptes → final review)
T-serveur5: fix round 1/5 dispatched (resumed implementer)
T-serveur5: fix round 1/5 done (8d78063b..31e905ac); scoped re-review dispatched (sonnet)
T-serveur5: re-review 1 → I-1, I-2, doc, test-silence, version-after-training all addressed (finding labels shifted in report; content verified); 134 sequential round trips accepted (super_admin route); nit: missing period ARCHITECTURE /run line
T-serveur5: complete (a6a7f85c..31e905ac); fast-forwarded feat/angular-lot0, pushed; sql/248 LOCAL only
Task 22: brief written (task-22-brief.md); dispatch after T21 lands (both touch Angular files widely)
Ruling: essai-carte removed in T22 (lot 2/Rendu proof page superseded by real carte + risques; shared mg-carte/mg-courbe kept); catalogue kept as living component guide — cost if wrong: page restorable from git
Task 21: implementer DONE_WITH_CONCERNS (9210e371, a9257836, c5460eb8 on base 0f4a4fe6); report copied from worktree; rebased onto 31e905ac → HEAD 7c4c96eb (no conflict); review package review-31e905ac..7c4c96eb.diff; opus task review dispatched
Task 21 review 1: SPEC ✅ w/ reserves, quality approved pending 2 Important (roadmap still lists T-serveur5 defects as owner; A6 header) + 5 minors → task-21-fix1.md, fix round 1 resumes implementer
Ruling: A6 module-risque header (whitespace-nowrap added by Angular on bouton-voir-carte/bouton-export) fixed in T21 fix round, not T22 — T22 is behaviour-neutral with no browser parity pass, the defect would never be re-checked — cost if wrong: one small extra round
Ruling: correlation 500 on concurrent first runs (indicator_cp_values_pkey) reclassified from owner item to server code defect (ON CONFLICT DO NOTHING) — goes to next server-fix batch — cost if wrong: none, listed either way
PAUSE 2026-10-11 (owner asked to stop): T21 fix round 1 interrupted mid-way. State: worktree agent-a88a8eae0695d9eca, branch worktree-agent-a88a8eae0695d9eca HEAD 4ad51a3e = 7c4c96eb + WIP commit (nowrap removed on bouton-voir-carte/bouton-export, UNVERIFIED, specs touched, tests not run). Backup pushed to origin/sauvegarde-t21-ronde1-2026-10-11. proxy.conf.json restored; agent servers :3001/:4201 killed. RESUME: re-dispatch fix round 1 (task-21-fix1.md) on that branch — point 2 browser check still to do, points 1,3-7 not started. feat/angular-lot0 untouched at 31e905ac (pushed).
RESUMED 2026-10-12 (owner in meeting, full autonomy): Docker + local stack restarted; T21 fix round 1/5 re-dispatched (opus, fresh implementer — original agent gone with session) on worktree-agent-a88a8eae0695d9eca from 4ad51a3e (WIP audited by implementer)
Task 21: fix round 1/5 done (opus): 7/7 claimed, WIP 4ad51a3e replaced; commits 7c4c96eb..75334603 (87d926e8 header 80px, 34de2c4f, 75334603); AIDA prod build proof passed; React now shows 55 sites not 57 (view-dependent, Angular matches); scoped re-review dispatched (sonnet)
Task 21: minor (deferred): « Exporter le profil » fits on 2 lines with zero margin — a busier header (lot 5) would push it to 3
Task 21: re-review 1 → 7/7 addressed, no Critical/Important (sonnet); minors noted: Voir-sur-la-carte 89px vs 85 (icon kept 13px, intended); spec tied to label split
Task 21: minor (deferred): T21-08-module-dark-angular.png and T21-08-module-sites-dark-angular.png identical size (443 573 B) — likely duplicate capture
Task 21: complete (commits 0a8318ce..75334603); fast-forwarded feat/angular-lot0, pushed
Task 22: dispatched (opus) in isolated worktree, base 75334603; rulings carried: essai-carte deleted, catalogue kept, T21 label split kept; priority §2>§1>§4>§3
Task 22: implementer DONE_WITH_CONCERNS (12 commits 12f1eb92..88b4e3b2 on worktree-agent-a6f28f385284d6d78, base 75334603); templates extracted to sibling .html rather than child components (DOM identity); CP light before-capture taken mid-load; ng test 2036→2048; review dispatched (opus)
Task 22: review → Spec ✅, quality approved (opus); 0 Critical/Important
Ruling: T22 templates extracted to sibling .html (+ logic to logique/) instead of child components with input()/output() as the brief said — accepted: the brief's goal (≤400 lines, one responsibility, readable) is met with a DOM proven identical; child components would add shadow-root style/@Input plumbing and parity risk for no user gain — cost if wrong: a later split of 4 templates into children
Task 22: minor (deferred): taille-fichiers.test.ts:39-43 counts 'a\nb' as 2 lines, comment says "wc -l" (1)
Task 22: minor (deferred): logique/panneau-campagne.ts:101 comment says "< 90 % de leur part" but filter also keeps null-index basins
Task 22: minor (deferred): logique/carte-campagne.ts & carte-codes-postaux.ts pure fns tested from component specs, no colocated spec
Task 22: minor (deferred): §3 header pass loose — ~190 files in carte/ risques/ open on a constant's doc, not a file header; >5-line headers not shortened
Task 22: minor (deferred): CP light before-capture taken mid-load, no pixel pair
Task 22: complete (commits 12f1eb92..88b4e3b2); fast-forwarded feat/angular-lot0, pushed
Final review: dispatched (opus) in isolated worktree at 88b4e3b2 — measured suites + cross-task integration + triage of 96 ledger lines (final-review-triage.txt) + doc; base f6dc2ce7, 138 commits
Final review: à corriger (opus): ng test 2046/2048 (2 timeouts under host load, pass alone 37/37), build clean, tsc clean, test:unit 2242/2243 (known radio/data); I-1 ordre-couches.ts only orders score among post-load layers (ICPE/PPRT/civique/santé/zones/dessin/aperçu rayon go under IRIS/carreaux/POI turned on later); I-2 correlation 500 race (no ON CONFLICT, sql/106) never batched + /api/map/transport `tronque` ignored by Angular while roadmap calls 5 000 truncation "parity"; 5 minors; triage 0 blocking
Ruling: I-2 fixed now in the final fix wave rather than "next lot" — correlation race = new LOCAL migration CREATE OR REPLACE (no DROP, patron jumelle not needed since return type unchanged); `tronque` surfaced in Angular with a sober notice (React defect corrected, recorded as such in roadmap) — cost if wrong: one notice React doesn't show
Ruling: ledger line 71 reversed per final review — a CP/zone filter that passes the perimeter guard but is not sent must be REFUSED with a message, not silently run on metropolitan France — cost if wrong: one guard to relax
Final review: ONE fix wave dispatched (opus): I-1, I-2, line 71, minors 15s→30s timeouts + roadmap date; other minors deferred to lot 5+
Final fix wave: done (opus) 88b4e3b2..e3ca0c86 (7 commits; sql/249 LOCAL: advisory lock per indicator + ON CONFLICT DO UPDATE); implementer's full ng test killed by host memory → controller ran it: 265 files, 2058/2058, exit 0; no browser proof (RAM); scoped re-review dispatched (opus)
Final fix wave: re-review → 5/5 addressed, no Critical/Important (opus); minors: avantDe calls getStyle() per pose (getLayersOrder lighter); zones-risque.service.ts:84 "trois couches" true only because etiquettes:false; suivi/diffusion React layers not ported (out of scope)
Final fix wave: complete (88b4e3b2..e3ca0c86); fast-forwarded feat/angular-lot0, pushed. sql/249 LOCAL only. Browser proof of I-1/I-2b pending (RAM) → dispatched separately
Final browser proof (sonnet): I-1 PROVEN (Angular iris-fill 55 < risques-point 61; React 76 < 92; dark+light), I-2b PROVEN (tronque:true, legend notice); captures-final/. LOT 4 CLOSED 2026-10-12 at e3ca0c86 (pushed).
