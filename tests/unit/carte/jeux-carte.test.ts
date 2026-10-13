import { describe, it, expect } from 'vitest';
import { CATEGORIES_HORS_POI, JEUX_REFERENTIELS, RE_CLE_JEU, cleJeuPoi, estCleJeuConnue } from '@/lib/carte/jeux-carte';

describe('registre des jeux de la carte', () => {
  it('10 référentiels, clés uniques et conformes au CHECK de sql/251', () => {
    expect(JEUX_REFERENTIELS).toHaveLength(10);
    const cles = JEUX_REFERENTIELS.map((j) => j.cle);
    expect(new Set(cles).size).toBe(cles.length);
    for (const c of cles) expect(RE_CLE_JEU.test(c), c).toBe(true);
  });
  it('le RE_CLE_JEU est EXACTEMENT celui du CHECK de la migration', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const f = readdirSync('sql').find((n) => /_espace_jeux_recommandes\.sql$/.test(n))!;
    expect(readFileSync(`sql/${f}`, 'utf8')).toContain(`cle_jeu ~ '${RE_CLE_JEU.source}'`);
  });
  it('cleJeuPoi : une catégorie conforme, sinon null (jamais une clé que la base refuserait)', () => {
    expect(cleJeuPoi('lycee')).toBe('poi:lycee');
    expect(cleJeuPoi('arret_transport')).toBe('poi:arret_transport');
    expect(cleJeuPoi('Lycée')).toBeNull();
    expect(cleJeuPoi('')).toBeNull();
  });
  it('estCleJeuConnue : un référentiel, ou poi:<catégorie> hors catégories rangées ailleurs', () => {
    expect(estCleJeuConnue('iris:socio-demo')).toBe(true);
    expect(estCleJeuConnue('poi:bmw')).toBe(true);
    expect(estCleJeuConnue(`poi:${CATEGORIES_HORS_POI[0]}`)).toBe(false);
    expect(estCleJeuConnue('iris:inconnu')).toBe(false);
    expect(estCleJeuConnue('n importe quoi')).toBe(false);
  });
});
