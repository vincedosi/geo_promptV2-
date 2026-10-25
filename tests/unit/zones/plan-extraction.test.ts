import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGE_AUCUN_CP, planExtraction } from '@/lib/zones/plan-extraction';

/**
 * `planExtraction` (lot 6, T6 ; relecture 3, M7) avec un client factice : la règle « 0 CP » que la vraie route
 * d'extraction ne sait pas produire dans tous ses cas. 0 CP est refusé (409) dès qu'une plateforme du résumé achète
 * au CP, ou sans résumé (jeu risque) ; il est accepté (plan sans CP) quand aucune n'y achète.
 */
const JEU = { id: '3f2504e0-4f89-11d3-9a0c-0305e82c3302', nom: 'Lyon', version: 2 } as never;
const X = '3f2504e0-4f89-11d3-9a0c-0305e82c3303';

let plateformes: unknown;
let cp: Array<{ code_postal: string; code_canonique: string; multiplicateur: number; classe: string; retenu: boolean }>;

const client = {
  from(table: string) {
    const q = {
      select: () => q, eq: () => q, gt: () => q, order: () => q,
      range: async () => ({ data: table === 'zone_set_extraction_cp' ? cp : [], error: null }),
      maybeSingle: async () => ({
        data: { id: X, version: 1, mode_plan: 'pondere', seuil_couverture_cp: 20, n_retenus: 0, taux_utile: null, part_plan_en_zone: null, plateformes },
        error: null,
      }),
    };
    return q;
  },
} as never;

beforeEach(() => {
  cp = [];
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('planExtraction — 0 CP', () => {
  it('une plateforme au CP et 0 CP : 409 « aucun code postal »', async () => {
    plateformes = [{ plateforme: 'dv360', maille: 'cp' }, { plateforme: 'meta', maille: 'cercle' }];
    const r = await planExtraction(client, JEU, X);
    expect('reponse' in r && r.reponse.status).toBe(409);
    if ('reponse' in r) expect((await r.reponse.json()).error).toBe(MESSAGE_AUCUN_CP);
  });

  it('jeu risque (sans résumé) et 0 CP : 409', async () => {
    plateformes = null;
    const r = await planExtraction(client, JEU, X);
    expect('reponse' in r && r.reponse.status).toBe(409);
  });

  it('aucune plateforme au CP : plan SANS ligne, résumé recopié', async () => {
    plateformes = [{ plateforme: 'tiktok', maille: 'commune' }];
    const r = await planExtraction(client, JEU, X);
    expect('reponse' in r).toBe(false);
    if (!('reponse' in r)) {
      expect(r.lignes).toEqual([]);
      expect(r.source).toMatchObject({ extraction_id: X, plateformes });
    }
  });

  it('des CP : recopiés tels quels', async () => {
    plateformes = [{ plateforme: 'dv360', maille: 'cp' }];
    cp = [{ code_postal: '69001', code_canonique: '69001', multiplicateur: 1.2, classe: 'zone', retenu: true }];
    const r = await planExtraction(client, JEU, X);
    expect('reponse' in r ? null : r.lignes).toEqual([{ code_postal: '69001', multiplicateur: 1.2, classe: 'zone', retenu: true }]);
  });
});
