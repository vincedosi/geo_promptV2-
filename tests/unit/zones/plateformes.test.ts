/**
 * `lib/zones/plateformes.ts` — les noms et la forme d'une ligne de `plateformes_geo` (sql/274, sql/300).
 *
 * Ce que ce fichier verrouille (⑤ finitions, T1) : la maille `pays` existe, en DERNIER (l'ordre des CHECK de la base,
 * comparé par `tests/integration/plateformes-geo.test.ts`), et le schéma lit `codes_pays` — les codes ISO que la
 * plateforme cible pour une zone « France métropolitaine » (`METRO`) ou « France entière » (`FR`). Une liste mal
 * formée est refusée comme la base la refuse (même règle que le CHECK `plateformes_geo_codes_pays_valides`).
 */
import { describe, expect, it } from 'vitest';
import { MAILLES, PlateformeGeoSchema } from '@/lib/zones/plateformes';

const LIGNE = {
  plateforme: 'dv360', maille: 'pays', libelle: 'Pays', natif: true, disponible: true, limites: {},
  doc_url: 'https://developers.google.com/display-video/api/guides/concepts/targeting/geography',
  releve_le: '2026-10-30', a_verifier: false, note: null, ordre: 5,
  codes_pays: { METRO: ['FR'], FR: ['FR', 'GP', 'MQ', 'GF', 'RE', 'YT'] },
};

describe('plateformes_geo — la maille pays (sql/300)', () => {
  it('MAILLES porte « pays », en dernier', () => {
    expect([...MAILLES]).toEqual(['polygone', 'cp', 'iris', 'commune', 'departement', 'cercle', 'pays']);
  });

  it('le schéma lit les codes pays d’une ligne « pays »', () => {
    expect(PlateformeGeoSchema.parse(LIGNE).codes_pays).toEqual({ METRO: ['FR'], FR: ['FR', 'GP', 'MQ', 'GF', 'RE', 'YT'] });
  });

  it('une ligne sans codes pays (toute autre maille) les lit à null', () => {
    expect(PlateformeGeoSchema.parse({ ...LIGNE, maille: 'cp', codes_pays: null }).codes_pays).toBeNull();
  });

  it.each([
    ['un code en minuscules', { METRO: ['fr'], FR: ['FR'] }],
    ['une liste vide', { METRO: [], FR: ['FR'] }],
    ['une clé manquante', { METRO: ['FR'] }],
    ['une clé inconnue', { METRO: ['FR'], FR: ['FR'], XX: ['FR'] }],
  ])('refuse des codes pays mal formés : %s', (_cas, codes_pays) => {
    expect(PlateformeGeoSchema.safeParse({ ...LIGNE, codes_pays }).success).toBe(false);
  });
});
