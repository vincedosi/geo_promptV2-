import { HttpErrorResponse } from '@angular/common/http';
import { messageErreurApi } from './erreurs';

const err = (status: number, error: unknown = null) => new HttpErrorResponse({ status, error });

describe('messageErreurApi', () => {
  it('reprend le message français de l\'API', () => {
    expect(messageErreurApi(err(500, { error: 'Comptage des sites indisponible.' }))).toBe('Comptage des sites indisponible.');
  });
  it('dit que la session a expiré sur un 401', () => {
    expect(messageErreurApi(err(401))).toMatch(/session a expiré/);
  });
  it('dit que l\'API ne répond pas sur une erreur réseau', () => {
    expect(messageErreurApi(err(0))).toMatch(/API ne répond pas/);
  });
  it('dit que l\'API ne répond pas quand le proxy expire', () => {
    expect(messageErreurApi(err(504))).toMatch(/API ne répond pas/);
  });
  it('dit d\'attendre sur un quota', () => {
    expect(messageErreurApi(err(429))).toMatch(/Trop de demandes/);
  });
  it('a un repli pour tout le reste', () => {
    expect(messageErreurApi(new Error('x'))).toBe('Une erreur inattendue est survenue.');
  });
  it('explique un refus de droits sans message serveur', () => {
    expect(messageErreurApi(err(403))).toBe('Votre rôle ne permet pas cette action.');
  });
  it('garde le message serveur d\'un 403 quand il existe', () => {
    expect(messageErreurApi(err(403, { error: 'Réservé au super administrateur.' }))).toBe('Réservé au super administrateur.');
  });
});
