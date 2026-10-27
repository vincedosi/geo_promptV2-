# SDD ledger — plan: docs/superpowers/plans/2026-10-27-carte-en-parcours-lot-8-live.md
Spec : docs/superpowers/specs/2026-10-13-carte-en-parcours-design.md (§ 19 fait foi). Worktree .claude/worktrees/carte-live, branche feat/carte-live depuis feat/carte-activation b3610369. Mode accéléré, agents opus.

- RESUME HERE (27/10) : plan écrit et commité ; ATTENDRE les réponses de Vincent à Q-1..Q-7 (le plan applique les recommandations à défaut) ; puis pré-vol du plan (table de conflits produit → consommé, comme le lot 7) ; puis dispatcher le groupe A (T1+T2).

## Faits mesurés le 27/10 (base locale)
- Aucune API de plateforme branchable : DV360 bouchon `skipped` (lib/dsp/report/dv360.ts), connexion DV360 unique en `error` ; TikTok OAuth seul ; TTD et Meta rien.
- Campagnes lancées en ⑥ (4935811d…, ba49acd8…) : 0 ligne de livraison, is_demo = false, période 4935811d = 01/11 → 30/11/2026 (future).
- dsp_campaign_data ≈ 1,04 M lignes / 394 Mo, 5 campagnes, toutes seed / simulation / import Adform ; campaign_dsp_report 2 131 lignes toutes `simulated`.
- Extraction 2fc8fd52 : DV360 72 CP bruts (63 unités retenues), Meta 53 cercles, TikTok 1 dépt, TTD 1 polygone ; PACA 87 CP + Occitanie 1.
- Échelle nationale (table synthétique, transaction annulée) : agrégat 24 ms / ≈ 2 060 buffers pour 79 470 lignes ; relevé 30 j × 2 595 CP = 1 557 lots de 50.
- « Mode pays » : ne bloque pas ⑧ (aucune RPC bornée à 100 000 km²) ; bloque en amont ④/⑤ — pas de tâche dans ce lot.
- Prochain numéro SQL libre : 288 (à reconfirmer : d'autres worktrees peuvent l'avoir pris).

## Questions ouvertes (Vincent)
- Q-1 simulation démo seulement · Q-2 TTD rapport à la région « à vérifier » · Q-3 écart de répartition (React) · Q-4 grande carte au lieu des vignettes · Q-5 histogramme CP seul · Q-6 bouton de relevé, pas d'Inngest · Q-7 pas de fichiers d'adaptateur vides.

## Tâches
- [ ] T1 serveur : table, adaptateurs, relevé simulé
- [ ] T2 serveur : noyau + GET …/live
- [ ] Relecture 1
- [ ] T3 Angular : API, état, squelette, relevé, bandeau
- [ ] T4 Angular : rythme, coût, plateformes, alignement
- [ ] Relecture 2
- [ ] T5 Angular : maille, territoires, dispersion, alertes, carte
- [ ] Relecture 3
- [ ] T6 revue finale + preuve deux thèmes
