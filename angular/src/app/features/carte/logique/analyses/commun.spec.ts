import { HttpErrorResponse } from '@angular/common/http';
import { dateFr, messageErreurRequete } from './commun';

describe('logique/analyses/commun', () => {
  it('dateFr : la date française, « — » sans date', () => {
    expect(dateFr('2026-10-11T08:00:00Z')).toBe('11/10/2026');
    expect(dateFr(null)).toBe('—');
  });

  it('messageErreurRequete : `data.error`, sinon « Erreur <statut> », réseau coupé : le message commun', () => {
    expect(messageErreurRequete(new HttpErrorResponse({ status: 400, error: { error: 'Périmètre vide : aucun code postal à scorer.' } })))
      .toBe('Périmètre vide : aucun code postal à scorer.');
    expect(messageErreurRequete(new HttpErrorResponse({ status: 500, error: 'oups' }))).toBe('Erreur 500');
    expect(messageErreurRequete(new HttpErrorResponse({ status: 0 }))).toContain('L\'API ne répond pas');
    expect(messageErreurRequete(new Error('boum'))).toBe('boum');
  });
});
