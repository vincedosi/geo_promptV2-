/**
 * Drapeaux `OPTIMISATION_PLAN_SOURCE` / `OPTIMISATION_CORRECTION_SOURCE` (tâche 1.6) : DÉFAUT `ts`, rien ne change si
 * la variable est absente ; une valeur inconnue garde le TS et le dit.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { sourceCorrection, sourcePlan } from '@/lib/optimisation/drapeaux';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe.each([
  ['OPTIMISATION_PLAN_SOURCE', sourcePlan],
  ['OPTIMISATION_CORRECTION_SOURCE', sourceCorrection],
] as const)('%s', (variable, lire) => {
  it('absente ou vide : ts', () => {
    vi.stubEnv(variable, undefined as unknown as string);
    delete process.env[variable];
    expect(lire()).toBe('ts');
    vi.stubEnv(variable, '  ');
    expect(lire()).toBe('ts');
  });

  it.each(['ts', 'ombre', 'python', ' Ombre ', 'PYTHON'])('« %s » est lue', (valeur) => {
    vi.stubEnv(variable, valeur);
    expect(lire()).toBe(valeur.trim().toLowerCase());
  });

  it('valeur inconnue : ts, signalée une seule fois', () => {
    const avert = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubEnv(variable, `shadow-${variable}`);
    expect(lire()).toBe('ts');
    expect(lire()).toBe('ts');
    expect(avert).toHaveBeenCalledTimes(1);
    expect(JSON.parse(avert.mock.calls[0][0] as string)).toMatchObject({
      evenement: 'optimisation_drapeau_inconnu', variable, retenu: 'ts',
    });
  });
});

it('les deux drapeaux sont indépendants', () => {
  vi.stubEnv('OPTIMISATION_PLAN_SOURCE', 'python');
  vi.stubEnv('OPTIMISATION_CORRECTION_SOURCE', 'ombre');
  expect([sourcePlan(), sourceCorrection()]).toEqual(['python', 'ombre']);
});
