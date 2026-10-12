import { lireQuota, messageDesactivation, messageSuppression, quotaEnSaisie, texteDeConfig } from './reglages';

describe('lireQuota', () => {
  it('vide → illimité (`null`), espaces autour ignorés', () => {
    expect(lireQuota('')).toEqual({ ok: true, valeur: null });
    expect(lireQuota('  ')).toEqual({ ok: true, valeur: null });
    expect(lireQuota(' 12 ')).toEqual({ ok: true, valeur: 12 });
    expect(lireQuota('0')).toEqual({ ok: true, valeur: 0 });
  });

  it('refuse ce que `parseInt` aurait lu de travers', () => {
    for (const s of ['1.5', '12abc', '-3', '1e3', '1 000', '99999999999999999999']) {
      expect(lireQuota(s)).toEqual({ ok: false });
    }
  });
});

describe('lecture de la config', () => {
  it('texteDeConfig : une chaîne, sinon vide', () => {
    expect(texteDeConfig({ a: 'x' }, 'a')).toBe('x');
    expect(texteDeConfig({ a: null }, 'a')).toBe('');
    expect(texteDeConfig({ a: 3 }, 'a')).toBe('');
    expect(texteDeConfig({}, 'a')).toBe('');
  });

  it('quotaEnSaisie : un nombre en texte, sinon vide', () => {
    expect(quotaEnSaisie({ q: 40 }, 'q')).toBe('40');
    expect(quotaEnSaisie({ q: '40' }, 'q')).toBe('');
    expect(quotaEnSaisie({}, 'q')).toBe('');
  });
});

describe('textes des confirmations', () => {
  it('suppression : accords au singulier et au pluriel', () => {
    expect(messageSuppression(1, 1)).toBe('Son 1 membre en est retiré ; son 1 jeu privé devient sans propriétaire et n\'est plus visible que du super-administrateur.');
    expect(messageSuppression(3, 2)).toBe('Ses 3 membres en sont retirés ; ses 2 jeux privés deviennent sans propriétaire et ne sont plus visibles que du super-administrateur.');
  });

  it('désactivation : effectif connu, singulier, ou inconnu', () => {
    expect(messageDesactivation(1)).toContain('Son 1 membre y est concerné.');
    expect(messageDesactivation(4)).toContain('Ses 4 membres y sont concernés.');
    expect(messageDesactivation(undefined)).toContain('Ses membres y sont concernés.');
  });
});
