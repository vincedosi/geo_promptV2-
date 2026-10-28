# SDD ledger — plan: docs/superpowers/plans/2026-10-27-carte-en-parcours-lot-8-live.md
Spec : docs/superpowers/specs/2026-10-13-carte-en-parcours-design.md (§ 19 fait foi). Worktree .claude/worktrees/carte-live, branche feat/carte-live depuis feat/carte-activation b3610369. Mode accéléré, agents opus.

- RESUME HERE (28/10) : plan RÉVISÉ avec les réponses de Vincent (Q-1..Q-7) et commité. Attendre les réponses à Q-8..Q-12 (le plan applique les recommandations à défaut) ; puis pré-vol du plan (table de conflits produit → consommé, comme le lot 7) ; puis dispatcher le groupe A (T1+T2+T3).

## Décisions de Vincent (28/10)
- Q-1 NON : aucune simulation, aucun mode démo, aucune donnée de démo ; sans connexion → « Aucune donnée remontée — plateforme non connectée ».
- Q-2 : TTD mis de côté (doc bientôt) — « connecteur à venir », aucune tâche.
- Q-3 oui (écart de répartition). Q-4 oui (grande carte zoomable).
- Q-5 : pas d'histogramme ; descente région → département → CP (→ IRIS / polygone avec TTD), plafonnée à la maille rapportée ; liste des territoires les plus en retard ; clic = descendre.
- Q-6 NON au bouton seul : connexions réelles + Inngest quotidien (un step par campagne) ; bouton « Relever maintenant » gardé (même service).
- Q-7 : vrais adaptateurs DV360 / Meta / TikTok d'après la doc publique, testés sur réponses enregistrées (tests/fixtures, rien en base).

## Questions ouvertes (28/10)
- Q-8 preuve remplie à la première vraie connexion (specs Angular + états vides en navigateur d'ici là) · Q-9 dépense DV360 = coût total annonceur · Q-10 qui obtient app Meta / app TikTok / droits Google + reconsentement · Q-11 descente arrêtée au CP en V1 · Q-12 re-relève des 3 derniers jours.

## Faits mesurés (27-28/10, base locale)
- Aucune API branchée : DV360 bouchon + scope reporting commenté, connexion unique en `error` ; TikTok OAuth seul ; Meta rien ; TTD rien.
- Campagnes ⑥ : 0 ligne de livraison ; `links` vides sur 4935811d.
- Descente nationale (2 595 CP, 3 niveaux, un passage) : 37 ms, ≈ 1 680 buffers dont 1 552 pour un seq scan de ref_codes_postaux (index couvrant à mesurer en T1).
- Agrégats livraison : 24 ms / 14 ms, ≈ 2 060 buffers ; relevé quotidien national ≈ 52 lots, re-relève 3 j ≈ 156.
- « Mode pays » : ne bloque pas ⑧ (en amont ④/⑤). Prochain SQL : 288, à reconfirmer.

## Tâches
- [ ] T1 socle : table, maille_rapport, contrat d'adaptateur, lireCampagneLive
- [ ] T2 noyau + GET …/live (descente)
- [ ] T3 relevé : service, bouton, Inngest
- [ ] Relecture 1
- [ ] T4 DV360 reporting · [ ] T5 Meta OAuth + Insights · [ ] T6 TikTok reporting
- [ ] Relecture 2
- [ ] T7 Angular état/squelette/relevé/bandeau · [ ] T8 chiffres · [ ] T9 descente + carte
- [ ] Relecture 3
- [ ] T10 revue finale + preuve (états vides, deux thèmes)
