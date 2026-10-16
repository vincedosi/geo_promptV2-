import { describe, expect, it, vi } from 'vitest';

/** La BAN rend `result_citycode` (code commune INSEE) : le géocodeur le transmet, pour remplir `code_insee`. */
vi.mock('@/lib/http/lecture-avec-reprise', () => ({
  fetchLectureAvecReprise: async () => new Response(
    'adresse,code_postal,ville,latitude,longitude,result_label,result_score,result_type,result_city,result_postcode,result_citycode\n'
    + '1 Rue Essai,13008,Villetest,43.3,5.4,1 Rue Essai 13008 Villetest,0.91,housenumber,Villetest,13008,13208\n',
    { status: 200 },
  ),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } }));

const { geocodeBatchDetailed } = await import('@/lib/import/geocoder');

describe('geocodeBatchDetailed — code commune INSEE', () => {
  it('rend resultCitycode', async () => {
    const [r] = await geocodeBatchDetailed([{ adresse: '1 Rue Essai', code_postal: '13008', ville: 'Villetest' }]);
    expect(r).toMatchObject({ lat: 43.3, lng: 5.4, score: 0.91, resultCity: 'Villetest', resultPostcode: '13008', resultCitycode: '13208' });
  });
});
