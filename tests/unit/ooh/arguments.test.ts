import { describe, expect, it } from 'vitest';
import { lireArguments } from '@/lib/ooh/plan/arguments';

const BASE = ['--plan', 'plan.xlsx', '--espace', 'marine', '--campagne', 'Campagne essai', '--cle', 'essai-2026'];

describe('lireArguments', () => {
  it('les obligatoires, les facultatifs, le rapport par défaut', () => {
    expect(lireArguments([...BASE, '--vague', 'V1', '--a-blanc'], '/tmp')).toEqual({
      plan: 'plan.xlsx', espace: 'marine', campagne: 'Campagne essai', cle: 'essai-2026', vague: 'V1', annonceur: null, rapport: '/tmp', aBlanc: true,
    });
    expect(lireArguments([...BASE, '--annonceur', 'Annonceur', '--rapport', '/ailleurs'], '/tmp'))
      .toMatchObject({ annonceur: 'Annonceur', rapport: '/ailleurs', aBlanc: false, vague: null });
  });

  it('refuse une option manquante, inconnue, sans valeur, ou une clé mal formée', () => {
    expect(lireArguments(BASE.slice(2), '/tmp')).toEqual({ erreur: 'Option obligatoire absente : --plan.' });
    expect(lireArguments([...BASE, '--force'], '/tmp')).toEqual({ erreur: 'Option inconnue : --force.' });
    expect(lireArguments([...BASE, '--vague'], '/tmp')).toEqual({ erreur: 'Valeur absente pour --vague.' });
    expect(lireArguments(['--plan', 'p.xlsx', '--espace', 'marine', '--campagne', 'C', '--cle', 'Clé Invalide'], '/tmp'))
      .toEqual({ erreur: '--cle : minuscules, chiffres et tirets, 3 à 64 caractères (ex. marine-tf4-2026).' });
  });
});
