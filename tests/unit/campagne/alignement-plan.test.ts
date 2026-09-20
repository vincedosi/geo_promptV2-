/**
 * « Pas de plan » n'est pas « plan parfaitement tenu ».
 *
 * ── LE DÉFAUT QUE CES TESTS FERMENT ───────────────────────────────────────
 *
 * Mesuré le 2026-09-20 sur la campagne de démonstration du module risque :
 * `calculer_alignement_geo` rendait `score: 100` et `conformes_pct: 0.0` sur
 * 2 000 codes postaux dont AUCUN ne portait de plan.
 *
 * Le mécanisme, ligne à ligne : `planned_share` NULL rend `plan_imps` NULL ;
 * le filtre `WHERE plan_imps > 0` écarte alors toutes les lignes (sous-pression
 * NULL, donc 0) ; et `GREATEST` ignore les NULL, donc `greatest(0, reel - NULL)`
 * vaut 0 (sur-pression 0). Score = 100 − 0 − 0. **Zéro écart à un plan qui
 * n'existe pas.**
 *
 * ── L'INVARIANT LE PLUS SIMPLE, ET LE PLUS UTILE ─────────────────────────
 *
 * Le payload se contredisait tout seul : `score: 100` ET `conformes_pct: 0.0`.
 * Un score parfait suppose tous les codes postaux conformes ; zéro conforme
 * suppose un score nul. Les deux ne peuvent pas être vrais ensemble — et cette
 * contradiction est vérifiable sans connaître les données.
 *
 * ⚠ Ces tests portent sur le JUMEAU TypeScript. Le croisement avec la RPC vit
 * dans `tests/integration/alignement-plan-sql.test.ts` : un jumeau qui passe
 * seul ne garantit rien sur ce que l'écran affiche, et c'est précisément la
 * limite que les trois jumeaux précédents du projet documentent.
 */
import { describe, it, expect } from 'vitest';
import { calculerAlignement, type UniteAlignement } from '@/lib/campagne/alignement';

/** Une campagne dont le plan couvre tout, et qui le tient. */
const planTenu: UniteAlignement[] = [
  { code: '75001', reel: 1000, plan: 1000 },
  { code: '69001', reel: 500, plan: 500 },
  { code: '13001', reel: 250, plan: 250 },
];

describe('couverture de plan NULLE', () => {
  it('ne rend PAS un score, quelle que soit la quantite d impressions', () => {
    // Le cas exact de la campagne de démonstration : des unités, du volume,
    // aucun plan. Ni 0 ni 100 — rien à juger.
    const sansPlan: UniteAlignement[] = [
      { code: '75001', reel: 1000, plan: 0 },
      { code: '69001', reel: 500, plan: 0 },
    ];
    expect(calculerAlignement(sansPlan, 10, 1)).toBeNull();
  });

  it('ne rend PAS un score sur deux mille unites — la taille ne change rien', () => {
    // 2 000 codes postaux et 1,2 Md d'impressions passaient le garde-fou
    // `n_cp = 0` sans difficulté : ce n'est pas le VOLUME qui manque.
    const beaucoup: UniteAlignement[] = Array.from({ length: 2000 }, (_, i) => ({
      code: String(10000 + i),
      reel: 598166,
      plan: 0,
    }));
    expect(calculerAlignement(beaucoup, 10, 1)).toBeNull();
  });
});

describe('couverture de plan PARTIELLE', () => {
  /**
   * Le volume parti sur une unité SANS plan n'était prévu nulle part : il
   * compte en totalité en sur-pression. C'est la règle du ruling T11-2, déjà
   * appliquée par `alignement/constats`.
   */
  it('ne produit JAMAIS un score parfait, meme si les unites planifiees sont tenues', () => {
    const partiel: UniteAlignement[] = [
      ...planTenu,
      // Hors plan, et pourtant servi. Ce volume doit se voir.
      { code: '31000', reel: 800, plan: 0 },
    ];
    const r = calculerAlignement(partiel, 10, 1);
    expect(r).not.toBeNull();
    expect(
      r!.score,
      'Une campagne qui diffuse hors de son plan ne peut pas être parfaitement alignée.',
    ).toBeLessThan(100);
    expect(r!.sur_pression_imps).toBeGreaterThan(0);
  });

  it('plus la part hors plan est grande, plus le score baisse', () => {
    const avec = (horsPlan: number) => calculerAlignement(
      [...planTenu, { code: '31000', reel: horsPlan, plan: 0 }], 10, 1,
    )!.score;
    // Monotonie : le score ne doit pas remonter quand on s'écarte davantage.
    expect(avec(2000)).toBeLessThan(avec(500));
  });

  it('une seule unite planifiee suffit a rendre le score calculable', () => {
    // La frontière : `n_cp_plan >= 1`. En dessous, non calculable ; à partir de
    // 1, calculable — même si le score est mauvais.
    const r = calculerAlignement(
      [{ code: '75001', reel: 100, plan: 100 }, { code: '69001', reel: 900, plan: 0 }],
      10, 1,
    );
    expect(r).not.toBeNull();
    expect(r!.score).toBeLessThan(100);
  });
});

describe('l invariant qui aurait attrape le defaut sans rien connaitre des donnees', () => {
  /**
   * `score` et `conformes_pct` ne peuvent pas se contredire. C'est ce que le
   * payload affichait pourtant : 100 et 0,0.
   */
  it('un score parfait implique que toutes les unites sont conformes', () => {
    const cas: Array<[string, UniteAlignement[]]> = [
      ['plan tenu', planTenu],
      ['partiel', [...planTenu, { code: '31000', reel: 800, plan: 0 }]],
      ['tout en retard', planTenu.map((u) => ({ ...u, reel: u.plan * 0.5 }))],
      ['tout en avance', planTenu.map((u) => ({ ...u, reel: u.plan * 2 }))],
      ['une seule unite', [{ code: '75001', reel: 1000, plan: 1000 }]],
    ];
    for (const [nom, unites] of cas) {
      const r = calculerAlignement(unites, 10, 1);
      if (!r) continue;
      if (r.score === 100) {
        expect(
          r.conformes_pct,
          `« ${nom} » : score 100 alors que ${r.conformes_pct} % des unités sont conformes. `
          + `Un score parfait suppose toutes les unités conformes.`,
        ).toBe(100);
      }
      if (r.conformes_pct === 0) {
        expect(
          r.score,
          `« ${nom} » : zéro unité conforme et pourtant un score de ${r.score}.`,
        ).toBeLessThan(100);
      }
    }
  });

  it('le score tenu vaut bien 100 quand le plan est reellement tenu', () => {
    // Le contrepoids : sans lui, un garde-fou trop zélé qui rendrait toujours
    // « non calculable » passerait tous les tests ci-dessus.
    const r = calculerAlignement(planTenu, 10, 1);
    expect(r).not.toBeNull();
    expect(r!.score).toBe(100);
    expect(r!.conformes_pct).toBe(100);
  });
});
