import type { FiltreActif } from '../filtre';
import {
  MAX_INDICATEURS, type IndicateurChoisi, type IndicateurRegistre, ajouterIndicateur, compteAuDessus, corpsRejeuScore, corpsScore,
  libelleIndicateur, libelleRetenus, libelleScore, messageZoneScore, nomZoneScore, parametresIndicateurs,
} from './score';

const CATALOGUE: IndicateurRegistre[] = [
  { indicator_code: 'rev_median', label: 'Revenu médian', famille: 'Revenus', unit: '€' },
  { indicator_code: 'part_15_29', label: 'Part des 15-29 ans', famille: 'Âge', unit: '%' },
  { indicator_code: 'sans_famille', label: 'Sans famille', famille: null, unit: null },
];
const DEPT_13: FiltreActif = { type: 'departement', code: '13', label: 'Bouches-du-Rhône' };

describe('logique/analyses/score (ScoreCompositeTool.tsx)', () => {
  it('libellé d’option : « famille — label », le label seul sans famille', () => {
    expect(CATALOGUE.map(libelleIndicateur)).toEqual(['Revenus — Revenu médian', 'Âge — Part des 15-29 ans', 'Sans famille']);
  });

  it('ajouter : poids 1, « croissant » ; refuse un doublon, un code inconnu et un septième indicateur', () => {
    const un = ajouterIndicateur([], CATALOGUE, 'rev_median');
    expect(un).toEqual([{ code: 'rev_median', label: 'Revenu médian', poids: 1, sens: 'croissant' }]);
    expect(ajouterIndicateur(un!, CATALOGUE, 'rev_median')).toBeNull();
    expect(ajouterIndicateur(un!, CATALOGUE, 'inconnu')).toBeNull();
    const six = Array.from({ length: MAX_INDICATEURS }, (_, i): IndicateurChoisi => ({ code: `c${i}`, label: `C${i}`, poids: 1, sens: 'croissant' }));
    expect(ajouterIndicateur(six, CATALOGUE, 'rev_median')).toBeNull();
  });

  it('corps exact du POST /api/analyses/score (ScoreCompositeTool.tsx:161-166)', () => {
    const choisis: IndicateurChoisi[] = [
      { code: 'rev_median', label: 'Revenu médian', poids: 1.5, sens: 'croissant' },
      { code: 'part_15_29', label: 'Part des 15-29 ans', poids: 1, sens: 'decroissant' },
    ];
    expect(corpsScore(choisis, { filtre: DEPT_13 }, false)).toEqual({
      indicateurs: [{ code: 'rev_median', poids: 1.5, sens: 'croissant' }, { code: 'part_15_29', poids: 1, sens: 'decroissant' }],
      perimetre: { type: 'departement', code: '13' },
      enregistrer: false,
      nom: 'Score composite — Bouches-du-Rhône',
    });
    expect(parametresIndicateurs(choisis)).toEqual(corpsScore(choisis, { filtre: DEPT_13 }, true).indicateurs);
  });

  it('zone analysée : le périmètre est la zone, sans nom (la route nomme)', () => {
    const choisis: IndicateurChoisi[] = [{ code: 'rev_median', label: 'Revenu médian', poids: 1, sens: 'croissant' }];
    const attendu = {
      indicateurs: [{ code: 'rev_median', poids: 1, sens: 'croissant' }],
      perimetre: { type: 'zone', code: 'z-1' },
      enregistrer: false,
    };
    expect(corpsScore(choisis, { zone: 'z-1' }, false)).toEqual(attendu);
  });

  it('libellé du score, compte au-dessus du seuil (≥), pluriels de « code postal retenu »', () => {
    expect(libelleScore(['Revenu médian', 'Part des 15-29 ans'])).toBe('Revenu médian × Part des 15-29 ans');
    const scores = [{ code: 'a', score: 70, n_indicateurs: 2 }, { code: 'b', score: 69.9, n_indicateurs: 2 }, { code: 'c', score: 100, n_indicateurs: 1 }];
    expect(compteAuDessus(scores, 70)).toBe(2);
    expect([0, 1, 2, 1234].map(libelleRetenus)).toEqual([
      '0 code postal retenu', '1 code postal retenu', '2 codes postaux retenus', '1 234 codes postaux retenus',
    ]);
  });

  it('nom de la zone créée, coupé à 200 caractères', () => {
    const choisis: IndicateurChoisi[] = [{ code: 'x', label: 'L'.repeat(300), poids: 1, sens: 'croissant' }];
    expect(nomZoneScore(70, [{ code: 'a', label: 'A', poids: 1, sens: 'croissant' }, { code: 'b', label: 'B', poids: 1, sens: 'croissant' }]))
      .toBe('Score ≥ 70 — A × B');
    expect(nomZoneScore(70, choisis)).toHaveLength(200);
  });

  it('messages d’échec de la zone (ScoreCompositeTool.tsx:211-215)', () => {
    expect(messageZoneScore({ status: 400, error: { error: 'empty_selection', count: 0 } })).toBe('Aucun code postal ne passe ce seuil.');
    expect(messageZoneScore({ status: 400, error: { error: 'selection_too_large', count: 1834 } }))
      .toBe('Sélection trop large (1 834 CP). Remontez le seuil.');
    expect(messageZoneScore({ status: 500, error: { error: 'score_failed' } })).toBe('Erreur (500)');
  });

  it('rejeu d’un score enregistré : la LISTE de CP rejouée, sans nouvel enregistrement', () => {
    expect(corpsRejeuScore({
      type: 'score', nom: 'Score composite — Bouches-du-Rhône (rejoué)',
      parametres: { indicateurs: [{ code: 'rev_median', poids: 1, sens: 'croissant' }] },
      perimetre: { codes_postaux: ['13001', '13002'], filtre: { type: 'departement', code: '13' }, bbox: null },
    })).toEqual({
      indicateurs: [{ code: 'rev_median', poids: 1, sens: 'croissant' }],
      codes_postaux: ['13001', '13002'],
      enregistrer: false,
      nom: 'Score composite — Bouches-du-Rhône (rejoué)',
    });
    // Sans liste (ligne ancienne) : le filtre d'origine ; sans paramètres lisibles : pas de rejeu.
    expect(corpsRejeuScore({
      type: 'score', nom: 'n', parametres: { indicateurs: [{ code: 'x', poids: 1, sens: 'croissant' }] },
      perimetre: { filtre: { type: 'departement', code: '13' } },
    })).toMatchObject({ perimetre: { type: 'departement', code: '13' } });
    expect(corpsRejeuScore({ type: 'score', nom: 'n', parametres: {}, perimetre: null })).toBeNull();
    expect(corpsRejeuScore({ type: 'correlation', nom: 'n', parametres: { indicateurs: [] }, perimetre: null })).toBeNull();
  });
});
