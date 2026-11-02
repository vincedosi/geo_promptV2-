/**
 * B9 (ARB-7 = A, amendement E1, Q7 = A) — la maille par défaut au taux utile sous couverture cible, et l'« à vérifier »
 * par paramètre (amendement E9). Les lignes de règles ont la FORME de la seed de `plateformes_geo` (relevé du 02/11),
 * jamais ses valeurs lues : la règle ne lit que ce qu'on lui passe.
 */
import { describe, it, expect } from 'vitest';
import {
  REGLAGES_DEFAUT_REPLI, choisirDefaut, departageParFinesse, mailleParDefaut, mailleSure, simulationDe, simulationsRequises,
  type Departage, type Simulations,
} from '@/lib/zones/conversion-defaut';
import { appliquerSeuil, resumeExact } from '@/lib/zones/conversion';
import type { PlateformeGeo } from '@/lib/zones/plateformes';
import type { Recette } from '@/lib/zones/recette';

function ligne(p: Partial<PlateformeGeo> & Pick<PlateformeGeo, 'plateforme' | 'maille'>): PlateformeGeo {
  return {
    libelle: p.maille, natif: true, disponible: true, limites: {}, doc_url: null, releve_le: '2026-10-14',
    a_verifier: false, note: null, ordre: 0, ...p,
  };
}

/** La forme de la seed au 02/11 : DV360 (CP sûr, plage de poids seule à vérifier), Meta (CP « à vérifier »), TikTok, TTD. */
const REGLES: PlateformeGeo[] = [
  ligne({ plateforme: 'dv360', maille: 'cp', parametres_a_verifier: ['poids_groupe_cp'] }),
  ligne({ plateforme: 'dv360', maille: 'cercle', limites: { rayon_min_m: 1_500 } }),
  ligne({ plateforme: 'dv360', maille: 'polygone', natif: false, disponible: false }),
  ligne({ plateforme: 'dv360', maille: 'pays' }),
  ligne({ plateforme: 'meta', maille: 'cercle', limites: { rayon_min_m: 1_500, rayon_max_m: 70_000, max_unites: 150 } }),
  ligne({ plateforme: 'meta', maille: 'cp', a_verifier: true, parametres_a_verifier: ['poids_groupe_cp'] }),
  ligne({ plateforme: 'meta', maille: 'pays' }),
  ligne({ plateforme: 'tiktok', maille: 'departement' }),
  ligne({ plateforme: 'tiktok', maille: 'commune', a_verifier: true }),
  ligne({ plateforme: 'ttd', maille: 'polygone', a_verifier: true }),
  ligne({ plateforme: 'ttd', maille: 'cercle', a_verifier: true }),
  ligne({ plateforme: 'ttd', maille: 'cp', a_verifier: true }),
];

const ANNEAU: Recette = { v: 1, type: 'combinaison', operation: 'difference', zones: ['disque-2km', 'disque-1km'] };
const DESSIN: Recette = { v: 1, type: 'dessin' };
const LISTE_40_CP: Recette = { v: 1, type: 'codes_postaux', codes: Array.from({ length: 40 }, (_, i) => String(13_001 + i)) };
const R = REGLAGES_DEFAUT_REPLI;

describe('B9 — les trois cas du ticket', () => {
  it('anneau de 1 km sur DV360 → cercles proposés (0 CP à 20 % : couverture nulle au CP)', () => {
    // Avant B9 : l'ordre de finesse rendait le CP (constat).
    expect(mailleParDefaut(REGLES, 'dv360', ANNEAU)).toBe('cp');
    expect(simulationsRequises(REGLES, 'dv360', ANNEAU)).toEqual(['cp', 'cercle']);
    const cp = simulationDe(appliquerSeuil([{ pop_en_zone: 300, pop_totale: 9_000, part: 3.3, part_brute: 3.3 }], 1_000, 20));
    expect(cp).toEqual({ couverture: 0, taux_utile: null });
    const d = choisirDefaut(REGLES, 'dv360', ANNEAU, { cp, cercle: { couverture: 88, taux_utile: 41 } }, R);
    expect(d).toMatchObject({ maille: 'cercle', critere: 'couverture_cible', simulation: { couverture: 88, taux_utile: 41 } });
    expect(d?.comparee).toEqual({ maille: 'cp', simulation: { couverture: 0, taux_utile: null } });
  });

  it('liste de 40 CP sur Meta → CP proposé (exact, « à vérifier »), pas cercles', () => {
    // Avant B9 : « sûre avant à vérifier » d'abord, donc les cercles (constat).
    expect(mailleParDefaut(REGLES, 'meta', LISTE_40_CP)).toBe('cercle');
    expect(mailleSure(REGLES.find((l) => l.plateforme === 'meta' && l.maille === 'cp')!)).toBe(false);
    // Le CP est exact (100 / 100, sans lecture) ; seuls les cercles, sûrs, sont à simuler : le départage les mettrait devant.
    expect(simulationsRequises(REGLES, 'meta', LISTE_40_CP)).toEqual(['cercle']);
    const d = choisirDefaut(REGLES, 'meta', LISTE_40_CP, { cercle: { couverture: 93, taux_utile: 58 } }, R);
    expect(d).toMatchObject({ maille: 'cp', critere: 'couverture_cible', simulation: { couverture: 100, taux_utile: 100 } });
    expect(d?.comparee).toEqual({ maille: 'cercle', simulation: { couverture: 93, taux_utile: 58 } });
  });

  it('E1 : un CP à 95 % couvrant 10 % contre des cercles à 70 % couvrant 90 % → cercles proposés', () => {
    const cp = simulationDe(appliquerSeuil([
      { pop_en_zone: 950, pop_totale: 1_000, part: 95, part_brute: 95 },
      { pop_en_zone: 2_000, pop_totale: 40_000, part: 5, part_brute: 5 },
    ], 9_500, 20));
    expect(cp).toEqual({ couverture: 10, taux_utile: 95 });
    const d = choisirDefaut(REGLES, 'dv360', DESSIN, { cp, cercle: { couverture: 90, taux_utile: 70 } }, R);
    expect(d).toMatchObject({ maille: 'cercle', critere: 'couverture_cible', couverture_cible: 80 });
    expect(d?.comparee).toEqual({ maille: 'cp', simulation: { couverture: 10, taux_utile: 95 } });
  });
});

describe('B9 — le critère en deux temps', () => {
  it('parmi les mailles qui atteignent la cible, le taux utile maximal', () => {
    expect(choisirDefaut(REGLES, 'dv360', DESSIN, { cp: { couverture: 85, taux_utile: 80 }, cercle: { couverture: 95, taux_utile: 60 } }, R))
      .toMatchObject({ maille: 'cp', critere: 'couverture_cible' });
  });
  it('aucune n’atteint la cible : la couverture maximale', () => {
    const d = choisirDefaut(REGLES, 'dv360', DESSIN, { cp: { couverture: 40, taux_utile: 90 }, cercle: { couverture: 70, taux_utile: 30 } }, R);
    expect(d).toMatchObject({ maille: 'cercle', critere: 'couverture_max' });
    expect(d?.comparee?.maille).toBe('cp');
  });
  it('la cible et l’écart sont des PARAMÈTRES (réglages en base, sql/315)', () => {
    const sims: Simulations = { cp: { couverture: 75, taux_utile: 90 }, cercle: { couverture: 95, taux_utile: 60 } };
    expect(choisirDefaut(REGLES, 'dv360', DESSIN, sims, R)?.maille).toBe('cercle');
    expect(choisirDefaut(REGLES, 'dv360', DESSIN, sims, { ...R, couverture_cible: 70 })?.maille).toBe('cp');
  });
  it('à ± écart de taux utile, le départage par finesse (sûre, exacte, plus fine) ; au-delà, le taux', () => {
    // TikTok : département sûr à 81 %, commune « à vérifier » à 84 % — dans l'écart : la sûre.
    const tiktok = { departement: { couverture: 99, taux_utile: 81 }, commune: { couverture: 90, taux_utile: 84 } };
    expect(choisirDefaut(REGLES, 'tiktok', DESSIN, tiktok, R)?.maille).toBe('departement');
    expect(choisirDefaut(REGLES, 'tiktok', DESSIN, tiktok, { ...R, ecart_departage: 2 })?.maille).toBe('commune');
  });
  it('point d’extension B16 : un autre départage change l’ordre dans l’écart, jamais hors de l’écart', () => {
    // Sans B16 : à égalité (± 5 points), l'ordre de finesse — le CP, plus fin, devant les cercles mieux notés de 3 points.
    const sims: Simulations = { cp: { couverture: 90, taux_utile: 72 }, cercle: { couverture: 92, taux_utile: 75 } };
    const cerclesDabord: Departage = (a, b) => (a.maille === 'cercle' ? 0 : 1) - (b.maille === 'cercle' ? 0 : 1);
    expect(choisirDefaut(REGLES, 'dv360', DESSIN, sims, R)?.maille).toBe('cp');
    expect(choisirDefaut(REGLES, 'dv360', DESSIN, sims, R, cerclesDabord)?.maille).toBe('cercle');
    const ecartees: Simulations = { cp: { couverture: 90, taux_utile: 81 }, cercle: { couverture: 92, taux_utile: 75 } };
    expect(choisirDefaut(REGLES, 'dv360', DESSIN, ecartees, R, cerclesDabord)?.maille).toBe('cp');
  });
  it('simulation manquante : défaut provisoire par l’ordre de finesse, dit « en attente »', () => {
    expect(choisirDefaut(REGLES, 'dv360', DESSIN, { cp: { couverture: 90, taux_utile: 80 } }, R)).toEqual({
      maille: 'cp', critere: 'en_attente', couverture_cible: 80,
    });
  });
  it('simulation refusée (pavage refusé, lecture en échec) : la maille sort de la course', () => {
    expect(choisirDefaut(REGLES, 'dv360', DESSIN, { cp: { couverture: 30, taux_utile: 80 }, cercle: 'refusee' }, R))
      .toMatchObject({ maille: 'cp', critere: 'couverture_max' });
    expect(choisirDefaut(REGLES, 'dv360', DESSIN, { cp: 'refusee', cercle: 'refusee' }, R))
      .toEqual({ maille: 'cp', critere: 'sans_simulation', couverture_cible: 80 });
  });
  it('une maille exacte sûre ne se simule pas : rien à lire (zone pays, disque entier en France)', () => {
    const pays: Recette = { v: 1, type: 'pays', code: 'METRO' };
    expect(simulationsRequises(REGLES, 'dv360', pays)).toEqual([]);
    expect(choisirDefaut(REGLES, 'dv360', pays, {}, R)).toMatchObject({ maille: 'pays', critere: 'couverture_cible' });
    const disque: Recette = { v: 1, type: 'rayon_point', lon: 3.087, lat: 45.7772, rayon_m: 5_000, part_retenue: 1 };
    expect(simulationsRequises(REGLES, 'dv360', disque)).toEqual([]);
    expect(choisirDefaut(REGLES, 'dv360', disque, {}, R)?.maille).toBe('cercle');
    // TTD, toutes « à vérifier » : le polygone exact passe le départage devant tout, rien à simuler.
    expect(simulationsRequises(REGLES, 'ttd', DESSIN)).toEqual([]);
    expect(choisirDefaut(REGLES, 'ttd', DESSIN, {}, R)?.maille).toBe('polygone');
  });
  it('aucune maille achetable : null', () => {
    expect(choisirDefaut([], 'meta', DESSIN, {}, R)).toBeNull();
  });
  it('simulationDe : couverture = couverte / population de la zone, au dixième ; une maille exacte vaut 100 / 100', () => {
    expect(simulationDe(resumeExact(1_234, 3))).toEqual({ couverture: 100, taux_utile: 100 });
    expect(simulationDe(appliquerSeuil([{ pop_en_zone: 2, pop_totale: 3, part: 66.7, part_brute: 66.7 }], 3, 20)))
      .toEqual({ couverture: 66.7, taux_utile: 66.7 });
    expect(simulationDe(appliquerSeuil([], 0, 20))).toEqual({ couverture: 0, taux_utile: null });
  });
});

describe('E9 — « sûre » ne regarde que les paramètres qui conditionnent la maille', () => {
  it('achetable (la ligne), bornes de rayon et plafond d’unités ; pas la plage de poids', () => {
    expect(mailleSure(ligne({ plateforme: 'dv360', maille: 'cp', parametres_a_verifier: ['poids_groupe_cp'] }))).toBe(true);
    expect(mailleSure(ligne({ plateforme: 'meta', maille: 'cp', a_verifier: true }))).toBe(false);
    for (const p of ['rayon_min_m', 'rayon_max_m', 'max_unites'] as const) {
      expect(mailleSure(ligne({ plateforme: 'meta', maille: 'cercle', parametres_a_verifier: [p] })), p).toBe(false);
    }
  });
  it('le départage par finesse place une maille dont seule la plage de poids est à vérifier parmi les sûres', () => {
    const cp = ligne({ plateforme: 'dv360', maille: 'cp', parametres_a_verifier: ['poids_groupe_cp'] });
    const cercle = ligne({ plateforme: 'dv360', maille: 'cercle', parametres_a_verifier: ['rayon_min_m'] });
    expect(departageParFinesse(cp, cercle, DESSIN)).toBeLessThan(0);
    expect(mailleParDefaut([cercle, cp], 'dv360', DESSIN)).toBe('cp');
  });
});
