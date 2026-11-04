# SDD ledger — plan: docs/superpowers/plans/2026-10-27-carte-en-parcours-lot-8-live.md
Spec : docs/superpowers/specs/2026-10-13-carte-en-parcours-design.md (§ 19 fait foi). Worktree .claude/worktrees/carte-live, branche feat/carte-live depuis feat/carte-activation b3610369. Mode accéléré, agents opus.

- RESUME HERE (28/10) : plan RÉVISÉ (réponses de Vincent + sa CORRECTION du 28/10 : aucun connecteur codé, ⑧ s'arrête au contrat lireLivraison + registre vide) et commité. Attendre Q-8, Q-9, Q-12, Q-13 (le plan applique les recommandations à défaut) ; puis pré-vol du plan (table de conflits produit → consommé) ; puis dispatcher le groupe A (T1+T2+T3).

## Décisions de Vincent (28/10)
- Q-1 NON : aucune simulation, aucun mode démo, aucune donnée de démo ; état vide « Aucune donnée remontée — plateforme non connectée ».
- Q-2 : TTD mis de côté — « connecteur à venir ».
- Q-3 oui (écart de répartition). Q-4 oui (grande carte zoomable).
- Q-5 : pas d'histogramme ; descente région → département → CP → IRIS / polygone, plafonnée à la maille rapportée ; liste des plus en retard ; clic = descendre.
- Q-6 : Inngest quotidien (un step par campagne) + bouton « Relever maintenant » (même service).
- CORRECTION : les adaptateurs DV360 / Meta / TikTok / TTD sont écrits par un DÉVELOPPEUR HUMAIN (section « À faire par le développeur » du plan). Ce lot livre le contrat documenté, le registre VIDE, la table, les agrégats, les routes, l'écran, la tâche Inngest.

## Questions ouvertes (28/10)
- Q-8 preuve remplie au premier adaptateur (specs + intégration sur lignes de test d'ici là) · Q-9 dépense du contrat = coût total annonceur en EUR · Q-12 re-relève des 3 derniers jours · Q-13 prévu IRIS = prévu du CP × population des IRIS du CP.

## Faits mesurés (27-28/10, base locale)
- Aucune API branchée ; campagnes ⑥ : 0 ligne de livraison ; `links` vides sur 4935811d.
- Descente nationale région/dépt/CP (2 595 CP, un passage) : 37 ms, ≈ 1 680 buffers dont 1 552 seq scan ref_codes_postaux (index couvrant à mesurer en T1).
- CP → IRIS (point intérieur, GIST) : 1 CP = 19 IRIS, 33 ms, ≈ 71 buffers ; dépt 13 = 1 126 IRIS, 171 ms, ≈ 6 800 buffers → IRIS à la demande par CP.
- Agrégats livraison : 24 ms / 14 ms, ≈ 2 060 buffers. Relevé quotidien national ≈ 52 lots.
- « Mode pays » : ne bloque pas ⑧ (en amont ④/⑤). Prochain SQL : 288, à reconfirmer.

## Tâches
- [ ] T1 table, maille_rapport, contrat + registre vide, lireCampagneLive
- [ ] T2 noyau + GET …/live (+ …/live/iris)
- [ ] T3 relevé : service, bouton, Inngest
- [ ] Relecture 1
- [ ] T4 Angular état/squelette/relevé/bandeau · [ ] T5 chiffres · [ ] T6 descente + carte
- [ ] Relecture 2
- [ ] T7 revue finale + preuve (états vides, deux thèmes)
