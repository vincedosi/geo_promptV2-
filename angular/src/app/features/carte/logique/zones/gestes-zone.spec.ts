import { HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { MESSAGE_REPONSE_PERDUE, avecId, estRefusReferencee, issueDuplication, nomDeCopie, sansId } from './gestes-zone';
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

  it('ensembles immuables : ajout et retrait rendent un nouvel ensemble', () => {
    const a = new Set(['x']);
    const b = avecId(a, 'y');
    expect([...b]).toEqual(['x', 'y']);
    expect([...a]).toEqual(['x']);
    expect([...sansId(b, 'x')]).toEqual(['y']);
  });
});
