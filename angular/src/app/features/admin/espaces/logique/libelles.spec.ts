import { HttpErrorResponse } from '@angular/common/http';
import { messageErreur } from './libelles';

const URL = 'http://localhost:4200/api/admin/users';

describe('messageErreur', () => {
  it('rend le `error` du corps quand le serveur en donne un', () => {
    expect(messageErreur(new HttpErrorResponse({ status: 409, url: URL, error: { error: 'Email already exists' } }))).toBe('Email already exists');
  });

  it('statut 0 (aucune réponse) → message français, jamais le message anglais ni l\'URL', () => {
    const m = messageErreur(new HttpErrorResponse({ status: 0, url: URL, error: new ProgressEvent('error') }));
    expect(m).toBe('Le serveur n\'a pas répondu. Réessayez.');
  });

  it('500 au corps HTML → « Erreur du serveur (code 500). », sans URL', () => {
    const m = messageErreur(new HttpErrorResponse({ status: 500, url: URL, error: '<html>Internal Server Error</html>' }));
    expect(m).toBe('Erreur du serveur (code 500).');
    expect(m).not.toContain('http');
  });

  it('corps JSON sans `error` → code du serveur', () => {
    expect(messageErreur(new HttpErrorResponse({ status: 502, url: URL, error: { message: 'x' } }))).toBe('Erreur du serveur (code 502).');
  });

  it('erreur hors HTTP : son message, sinon « Erreur inattendue. »', () => {
    expect(messageErreur(new Error('Espace créé, mais la description n\'a pas été enregistrée'))).toBe('Espace créé, mais la description n\'a pas été enregistrée');
    expect(messageErreur(null)).toBe('Erreur inattendue.');
  });
});
