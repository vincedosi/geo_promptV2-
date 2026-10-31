/**
 * A2 (plan de corrections du découpage des zones, 2026-10-31) — l'unité de la maille CP : le groupe de codes postaux
 * indiscernables (`lib/zones/unite-cp.ts`). Une ligne = une unité (identifiant = canonique, `membres`) ; le
 * développement rend un code par membre, dans l'ordre, en signalant le canonique (seul porteur des populations).
 */
import { describe, expect, it } from 'vitest';
import { canoniques, developperUnites, membresDe, unitesDeGroupes } from '@/lib/zones/unite-cp';

const GROUPES = new Map([['44000', ['44000', '44100', '44200', '44300']]]);

describe('membresDe', () => {
  it('les membres de la ligne font foi (sql/304)', () => {
    expect(membresDe({ code: '93200', membres: ['93200', '93210', '93380'] }, GROUPES)).toEqual(['93200', '93210', '93380']);
  });
  it('sans membres : le groupe de cp_groupe, puis le code seul', () => {
    expect(membresDe({ code: '44000' }, GROUPES)).toEqual(['44000', '44100', '44200', '44300']);
    expect(membresDe({ code: '75001' }, GROUPES)).toEqual(['75001']);
    expect(membresDe({ code: '75001', membres: [] })).toEqual(['75001']);
  });
});

describe('canoniques', () => {
  it('chaque membre pointe sur l’identifiant de son unité', () => {
    const de = canoniques([...unitesDeGroupes(GROUPES), { code: '75001', membres: ['75001'] }]);
    expect(de.get('44200')).toBe('44000');
    expect(de.get('44000')).toBe('44000');
    expect(de.get('75001')).toBe('75001');
    expect(de.get('13001')).toBeUndefined();
  });
});

describe('developperUnites', () => {
  it('une ligne par membre, la même unité recopiée, le canonique signalé', () => {
    const unites = [{ code: '44000', m: 1.5 }, { code: '75001', m: 0.5 }];
    const lignes = developperUnites(unites, (u) => membresDe(u, GROUPES), (u) => u.code);
    expect(lignes.map((l) => l.code_postal)).toEqual(['44000', '44100', '44200', '44300', '75001']);
    expect(lignes.map((l) => l.unite.m)).toEqual([1.5, 1.5, 1.5, 1.5, 0.5]);
    expect(lignes.filter((l) => l.est_canonique).map((l) => l.code_postal)).toEqual(['44000', '75001']);
  });
});
