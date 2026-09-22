/**
 * La génération du plan de campagne depuis un jeu de zones.
 *
 * ── CE QUE CETTE FONCTION DÉCIDE ──────────────────────────────────────────
 *
 * La part de budget de chaque code postal. C'est le seul endroit du produit
 * où une erreur ne fait pas afficher un mauvais chiffre : elle fait dépenser
 * au mauvais endroit.
 *
 * ── LA CONTRAINTE QUI FAÇONNE LA SORTIE ──────────────────────────────────
 *
 * `bidding_zone_configs.bid_multiplier` est un `numeric(6,3)` — plafonné à
 * 999,999 — et vaut 0 à 1,6 sur les données réelles (mesuré le 2026-09-20 sur
 * 11 435 lignes). C'est un MULTIPLICATEUR, pas une population : émettre
 * `population × poids` déborderait la colonne dès le premier code postal
 * peuplé.
 *
 * Le pipeline existant normalise ensuite
 * (`planned_share = bid_multiplier / SUM(bid_multiplier)`), donc seule la
 * proportion compte. On centre les multiplicateurs sur 1 — la valeur neutre —
 * pour qu'ils restent lisibles par un humain qui ouvrirait la table.
 */
import { describe, it, expect } from 'vitest';
import { genererPlanCp, regrouperParCodePostal, type CpZone } from '@/lib/zones/plan';
import { normaliserJeu, JEU_DEFAUT, type JeuDeZones } from '@/lib/zones/jeu';

const jeu = (p: Partial<JeuDeZones> = {}): JeuDeZones =>
  normaliserJeu({ ...JEU_DEFAUT, ...p });

/**
 * Quatre codes postaux : deux bien couverts, un marginal, un hors zone.
 * Les populations sont rondes pour que les parts se vérifient de tête.
 */
const cps: CpZone[] = [
  { code_postal: '13270', classe: 'haut:1', pop_en_zone: 8000, pop_totale: 10000, retenu: true },
  { code_postal: '13800', classe: 'haut:2', pop_en_zone: 3000, pop_totale: 10000, retenu: true },
  // 5 % de couverture : sous le seuil de 20 %.
  { code_postal: '13100', classe: 'bas:1', pop_en_zone: 500, pop_totale: 10000, retenu: false },
  { code_postal: '75001', classe: 'hors', pop_en_zone: 0, pop_totale: 10000, retenu: false },
];

/** Somme des parts, à l'arrondi près. */
const somme = (lignes: Array<{ part_plan: number }>) =>
  lignes.reduce((t, l) => t + l.part_plan, 0);

describe('mode « exclusif »', () => {
  const r = genererPlanCp(cps, jeu({ mode_plan: 'exclusif' }));

  it('ne retient QUE les codes postaux au-dessus du seuil', () => {
    const avecPlan = r.lignes.filter((l) => l.part_plan > 0).map((l) => l.code_postal);
    expect(avecPlan.sort()).toEqual(['13270', '13800']);
  });

  it('met la part de plan a ZERO hors zone, pas a une miette', () => {
    // « Exclusif » veut dire zéro impression hors zone. Une part résiduelle,
    // même minuscule, laisserait partir du budget là où on a décidé de ne pas
    // aller — et personne ne le verrait dans un tableau de 6 000 lignes.
    const hors = r.lignes.find((l) => l.code_postal === '75001');
    expect(hors?.part_plan).toBe(0);
    expect(hors?.multiplicateur).toBe(0);
  });

  it('repartit au prorata de la population EN ZONE, pas de la population totale', () => {
    // 8 000 contre 3 000 : les deux codes postaux ont la même population
    // totale, seule leur couverture les sépare.
    const a = r.lignes.find((l) => l.code_postal === '13270')!;
    const b = r.lignes.find((l) => l.code_postal === '13800')!;
    expect(a.part_plan / b.part_plan).toBeCloseTo(8000 / 3000, 3);
  });

  it('les parts somment a 1', () => {
    expect(somme(r.lignes)).toBeCloseTo(1, 6);
  });

  it('la part de plan en zone vaut 100 %', () => {
    expect(r.part_plan_en_zone).toBeCloseTo(100, 3);
  });
});

describe('mode « pondere »', () => {
  const r = genererPlanCp(cps, jeu({ mode_plan: 'pondere' }));

  it('donne une part a TOUS les codes postaux', () => {
    expect(r.lignes.every((l) => l.part_plan > 0)).toBe(true);
  });

  it('les parts somment a 1', () => {
    expect(somme(r.lignes)).toBeCloseTo(1, 6);
  });

  it('un code postal sous le seuil pese comme un hors-zone', () => {
    /*
     * Sans cela, le seuil de couverture n'aurait aucun effet en mode pondéré —
     * un code postal couvert à 2 % recevrait le poids de sa classe comme s'il
     * était entièrement en zone.
     */
    const marginal = r.lignes.find((l) => l.code_postal === '13100')!;
    const hors = r.lignes.find((l) => l.code_postal === '75001')!;
    // Mêmes populations totales, donc mêmes parts.
    expect(marginal.part_plan).toBeCloseTo(hors.part_plan, 6);
  });

  it('un poids de classe deplace bien le budget', () => {
    const lourd = genererPlanCp(cps, jeu({ mode_plan: 'pondere', poids: { 'haut:1': 3 } }));
    const avant = r.lignes.find((l) => l.code_postal === '13270')!.part_plan;
    const apres = lourd.lignes.find((l) => l.code_postal === '13270')!.part_plan;
    expect(apres).toBeGreaterThan(avant);
  });
});

describe('le multiplicateur respecte la colonne', () => {
  it('reste dans les bornes de numeric(6,3)', () => {
    // La colonne plafonne à 999,999. Un dépassement ferait échouer l'insert —
    // et, dans un lot, ferait échouer tout le lot.
    for (const mode of ['pondere', 'exclusif'] as const) {
      for (const l of genererPlanCp(cps, jeu({ mode_plan: mode })).lignes) {
        expect(l.multiplicateur).toBeGreaterThanOrEqual(0);
        expect(l.multiplicateur).toBeLessThanOrEqual(999.999);
      }
    }
  });

  it('ne perd JAMAIS une part non nulle dans l arrondi', () => {
    /*
     * Le multiplicateur est arrondi à trois décimales. Sur un plan national,
     * un code postal peu peuplé peut avoir une part si faible qu'elle
     * s'arrondit à 0,000 — et il disparaît du plan en silence, sans jamais
     * apparaître comme exclu.
     *
     * On force donc un plancher de 0,001 pour toute part strictement positive.
     */
    const minuscule: CpZone[] = [
      { code_postal: '75001', classe: 'haut:1', pop_en_zone: 5_000_000, pop_totale: 5_000_000, retenu: true },
      { code_postal: '09999', classe: 'haut:1', pop_en_zone: 1, pop_totale: 1, retenu: true },
    ];
    const l = genererPlanCp(minuscule, jeu({ mode_plan: 'exclusif' }))
      .lignes.find((x) => x.code_postal === '09999')!;
    expect(l.part_plan).toBeGreaterThan(0);
    expect(l.multiplicateur).toBeGreaterThan(0);
  });

  it('un multiplicateur moyen proche de 1 — la valeur neutre', () => {
    // Lisible par un humain qui ouvrirait `bidding_zone_configs`, et cohérent
    // avec les 0 à 1,6 observés sur les données réelles.
    const l = genererPlanCp(cps, jeu({ mode_plan: 'pondere' })).lignes;
    const moyenne = l.reduce((t, x) => t + x.multiplicateur, 0) / l.length;
    expect(moyenne).toBeGreaterThan(0.5);
    expect(moyenne).toBeLessThan(2);
  });
});

describe('les deux chiffres qui doivent voyager avec le plan', () => {
  it('le taux d utile rapporte la population exposee a celle des CP retenus', () => {
    /*
     * C'est LE point dur du produit : le DSP achète au code postal, un anneau
     * de 1 km est bien plus petit qu'un code postal. Sans ce taux, on croit
     * cibler 11 000 habitants alors qu'on en achète 20 000.
     */
    const r = genererPlanCp(cps, jeu({ mode_plan: 'exclusif' }));
    // Retenus : 13270 et 13800. Exposés 8 000 + 3 000 = 11 000 sur 20 000.
    expect(r.taux_utile).toBeCloseTo(55, 1);
  });

  it('le taux d utile est null quand aucun code postal n est retenu', () => {
    // Zéro sur zéro n'est pas zéro. Afficher 0 % se lirait « on n'achète que
    // du hors-cible », alors qu'on n'achète rien.
    const aucun = cps.map((c) => ({ ...c, retenu: false }));
    expect(genererPlanCp(aucun, jeu({ mode_plan: 'exclusif' })).taux_utile).toBeNull();
  });

  it('un plan exclusif sans aucun CP retenu ne produit AUCUNE part', () => {
    // Et surtout pas un plan uniforme par repli : une campagne dont le plan
    // serait devenu uniforme sans prévenir diffuserait partout en croyant
    // cibler.
    const aucun = cps.map((c) => ({ ...c, retenu: false }));
    const r = genererPlanCp(aucun, jeu({ mode_plan: 'exclusif' }));
    expect(somme(r.lignes)).toBe(0);
    expect(r.part_plan_en_zone).toBeNull();
  });

  it('la part de plan en zone est inferieure a 100 en mode pondere', () => {
    const r = genererPlanCp(cps, jeu({ mode_plan: 'pondere' }));
    expect(r.part_plan_en_zone).toBeGreaterThan(0);
    expect(r.part_plan_en_zone).toBeLessThan(100);
  });
});

describe('cas degeneres', () => {
  it('une liste vide ne leve pas et ne produit rien', () => {
    const r = genererPlanCp([], jeu());
    expect(r.lignes).toEqual([]);
    expect(r.taux_utile).toBeNull();
    expect(r.part_plan_en_zone).toBeNull();
  });

  it('des populations toutes nulles ne produisent aucune part', () => {
    // Division par zéro évitée, et surtout : pas de repli uniforme silencieux.
    const vides = cps.map((c) => ({ ...c, pop_en_zone: 0, pop_totale: 0 }));
    const r = genererPlanCp(vides, jeu({ mode_plan: 'pondere' }));
    expect(somme(r.lignes)).toBe(0);
  });
});

/**
 * ── UN CODE POSTAL À CHEVAL SUR PLUSIEURS GRAPPES (sql/225) ────────────────
 *
 * Depuis la Phase 2, `zone_set_cp` porte UNE LIGNE PAR GRAPPE. Mesuré le
 * 2026-09-22 sur le profil par défaut : 2 255 lignes pour 1 942 codes postaux,
 * **274 à cheval**, jusqu'à **6 grappes** pour un seul, et **69 portent des
 * classes différentes** selon la grappe.
 *
 * Mais `bidding_zone_configs` ne sait porter qu'UN multiplicateur par code
 * postal. Ces tests verrouillent le repli — et surtout ses deux pièges.
 */
describe('regrouperParCodePostal — le DSP ne lit qu un poids par code postal', () => {
  const deuxGrappes: CpZone[] = [
    { code_postal: '13270', classe: 'haut:1', pop_en_zone: 6000, pop_totale: 10000, retenu: true },
    { code_postal: '13270', classe: 'bas:2', pop_en_zone: 2000, pop_totale: 10000, retenu: true },
  ];

  it('somme la population exposee des grappes', () => {
    const [cp] = regrouperParCodePostal(deuxGrappes, jeu());
    expect(cp.pop_en_zone).toBe(8000);
  });

  it('⚠ NE SOMME PAS la population totale — elle est repetee sur chaque ligne', () => {
    const [cp] = regrouperParCodePostal(deuxGrappes, jeu());
    expect(
      cp.pop_totale,
      'la sommer ferait peser un CP de trois bassins trois fois dans le taux d utile',
    ).toBe(10000);
  });

  it('le poids est la moyenne des classes, ponderee par la population', () => {
    const j = jeu({ poids: { 'haut:1': 5, 'bas:2': 1 } });
    const [cp] = regrouperParCodePostal(deuxGrappes, j);
    // (6000 x 5 + 2000 x 1) / 8000 = 4
    expect(cp.poids).toBeCloseTo(4, 6);
  });

  it('un code postal a UNE SEULE ligne garde exactement son poids de classe', () => {
    // La generalisation ne doit rien changer a l existant : c est ce qui
    // permet aux 45 tests precedents de passer sans modification.
    const j = jeu({ poids: { 'haut:1': 5 } });
    const [cp] = regrouperParCodePostal(
      [{ code_postal: '13270', classe: 'haut:1', pop_en_zone: 8000, pop_totale: 10000, retenu: true }], j);
    expect(cp.poids).toBe(5);
  });

  it('la classe affichee reste la DOMINANTE, celle qui porte le plus de monde', () => {
    const [cp] = regrouperParCodePostal(deuxGrappes, jeu());
    expect(cp.classe).toBe('haut:1');
  });

  it('genererPlanCp rend UNE ligne par code postal, jamais une par grappe', () => {
    const plan = genererPlanCp([...deuxGrappes, ...cps], jeu());
    const codes = plan.lignes.map((l) => l.code_postal);
    expect(new Set(codes).size, 'un code postal apparait deux fois dans le plan').toBe(codes.length);
  });
});
