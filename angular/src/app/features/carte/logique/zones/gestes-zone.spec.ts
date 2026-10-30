import { HttpErrorResponse, HttpResponse } from '@angular/common/http';
import {
  MESSAGE_REPONSE_PERDUE, avecId, estRefusReferencee, estReponsePerdue, issueDuplication, issueRecalcul, lignesDeZones, nomDeCopie, sansId,
} from './gestes-zone';
import type { ZoneEcrite } from '../../data/zones.api';

describe('gestes-zone — Dupliquer (③ finitions, T5)', () => {
  it('nom de la copie : « <nom> (copie) », borné aux 200 caractères de la route', () => {
    expect(nomDeCopie('Ma zone')).toBe('Ma zone (copie)');
    const long = nomDeCopie('x'.repeat(250));
    expect(long).toHaveLength(200);
    expect(long.endsWith(' (copie)')).toBe(true);
  });

  it('refus d’une zone citée : 409 `zone_referencee` seulement', () => {
    expect(estRefusReferencee(new HttpErrorResponse({ status: 409, error: { refus: 'zone_referencee' } }))).toBe(true);
    expect(estRefusReferencee(new HttpErrorResponse({ status: 409, error: { refus: 'forme_figee' } }))).toBe(false);
    expect(estRefusReferencee({ status: 404 })).toBe(false);
  });

  it('issue : 200 → avis nommé ; 207 → message de la route ; 2xx sans zone_id → réponse perdue', () => {
    expect(issueDuplication(new HttpResponse({ status: 200, body: { zone_id: 'n' } }), 'Z (copie)')).toBe('Zone dupliquée : Z (copie)');
    expect(issueDuplication(new HttpResponse({ status: 207, body: { zone_id: 'n', message: 'm' } }), 'Z')).toBe('m');
    expect(issueDuplication(new HttpResponse({ status: 207, body: { zone_id: 'n' } }), 'Z')).toBe('Zone « Z » créée ; ses codes postaux n’ont pas pu être résolus.');
    expect(issueDuplication(new HttpResponse<ZoneEcrite>({ status: 200, body: null }), 'Z')).toBe(MESSAGE_REPONSE_PERDUE);
  });

  it('réponse perdue : statut 0, 502 et 504 seulement (relecture 2)', () => {
    expect([0, 502, 504].map((status) => estReponsePerdue({ status }))).toEqual([true, true, true]);
    expect([400, 404, 409, 422, 429, 500, 503].map((status) => estReponsePerdue({ status })).some(Boolean)).toBe(false);
    expect(estReponsePerdue({})).toBe(false);
  });

  it('ensembles immuables : ajout et retrait rendent un nouvel ensemble', () => {
    const a = new Set(['x']);
    const b = avecId(a, 'y');
    expect([...b]).toEqual(['x', 'y']);
    expect([...a]).toEqual(['x']);
    expect([...sansId(b, 'x')]).toEqual(['y']);
  });
});

describe('gestes-zone — Recalculer et cartes (④ finitions, T0)', () => {
  it('issue d’un recalcul : rien pour un 200 ; un 207 dit le message de la route ou nomme la zone', () => {
    expect(issueRecalcul(new HttpResponse({ status: 200, body: { zone_id: 'z' } }), 'Z')).toBeNull();
    expect(issueRecalcul(new HttpResponse({ status: 207, body: { zone_id: 'z', message: 'm' } }), 'Z')).toBe('m');
    expect(issueRecalcul(new HttpResponse({ status: 207, body: { zone_id: 'z' } }), 'Z')).toBe('Zone « Z » recalculée ; ses codes postaux n’ont pas pu être résolus.');
  });

  it('chaque carte reflète couleur, zone en cours, rang de sélection et gestes en vol', () => {
    const lignes = lignesDeZones([{ id: 'a' }, { id: 'b' }], {
      couleurs: new Map([['a', '#111']]), enCours: 'b', selection: ['b', 'a'],
      recalculs: new Set(['a']), referencees: new Set(['b']), duplications: new Set(['a']),
    });
    expect(lignes).toEqual([
      { zone: { id: 'a' }, couleur: '#111', enCours: false, rang: 1, recalcul: true, referencee: false, duplication: true },
      { zone: { id: 'b' }, couleur: null, enCours: true, rang: 0, recalcul: false, referencee: true, duplication: false },
    ]);
  });
});
