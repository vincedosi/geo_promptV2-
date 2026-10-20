import { HttpErrorResponse } from '@angular/common/http';
import { ECHEC_RESEAU, erreurDuCorps, estCoupure } from './erreurs-http';

const refus = (error: unknown, status = 400) => new HttpErrorResponse({ error, status });

describe('erreurs-http — lecture du champ `error` d’un refus HTTP (factorisation F-1)', () => {
  it('le message quand le corps JSON (objet) porte un `error` non vide', () => {
    expect(erreurDuCorps(refus({ error: 'Nom déjà pris' }, 409))).toBe('Nom déjà pris');
  });

  it('le message quand le corps est un TEXTE JSON (requête demandée en texte, flux)', () => {
    expect(erreurDuCorps(refus('{"error":"Non autorisé"}', 403))).toBe('Non autorisé');
  });

  it('`undefined` pour un objet JSON SANS `error`, avec un `error` vide ou non textuel', () => {
    expect(erreurDuCorps(refus({ success: false }))).toBeUndefined();
    expect(erreurDuCorps(refus({ error: '' }))).toBeUndefined();
    expect(erreurDuCorps(refus({ error: 42 }))).toBeUndefined();
  });

  it('`null` pour un corps vide ou illisible (HTML de passerelle)', () => {
    expect(erreurDuCorps(refus(null, 500))).toBeNull();
    expect(erreurDuCorps(refus('<html>Bad Gateway</html>', 502))).toBeNull();
    expect(erreurDuCorps(refus('', 500))).toBeNull();
  });

  it('`estCoupure` : statut 0 seulement ; `ECHEC_RESEAU` est le `String(err)` de React', () => {
    expect(estCoupure(refus(new ProgressEvent('error'), 0))).toBe(true);
    expect(estCoupure(refus({ error: 'x' }, 500))).toBe(false);
    expect(estCoupure(new Error('x'))).toBe(false);
    expect(ECHEC_RESEAU).toBe('TypeError: Failed to fetch');
  });
});
