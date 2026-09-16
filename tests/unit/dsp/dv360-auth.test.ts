import { describe, it, expect, beforeAll } from 'vitest';
/**
 * Import HISSE EN TETE, volontairement — il etait `await import(...)` dans
 * chacun des six `it()`, et c'est ce qui rendait ce fichier instable.
 *
 * `@/lib/dsp/dv360/auth` importe `google-auth-library`, un paquet CJS
 * volumineux : sa resolution et sa transformation par Vite sont facturees au
 * DELAI DE 5 s du premier test qui l'importe. En passe complete (133 fichiers
 * en parallele) la contention depassait ce delai et les deux premiers cas
 * echouaient sur « Test timed out in 5000ms » ; isole, le cache Vite est chaud
 * et le fichier passe en moins de 300 ms. Le deuxieme cas echouait par
 * ricochet, en attente du meme module encore en vol.
 *
 * Hisser l'import deplace ce cout vers la phase de COLLECTE, qui n'a pas de
 * delai par test. C'est sur ici, et ce n'est pas une evidence : les quatre
 * lectures de `process.env` du module sont TOUTES a l'interieur de fonctions
 * (`getOAuthRedirectUri`, `buildOAuthClient`), aucune n'est capturee au
 * chargement — le `beforeAll` ci-dessous garde donc son effet malgre l'import
 * anticipe. Un module qui lirait `process.env` au niveau racine exigerait
 * l'inverse.
 */
import { parseServiceAccount, buildAuthUrl, getOAuthRedirectUri } from '@/lib/dsp/dv360/auth';

beforeAll(() => {
  process.env.DV360_OAUTH_CLIENT_ID = 'test-client-id';
  process.env.DV360_OAUTH_CLIENT_SECRET = 'test-secret';
  process.env.DV360_OAUTH_REDIRECT_URI = 'http://localhost:3000/api/admin/dsp/dv360/oauth/callback';
});

describe('dv360 auth', () => {
  it('parseServiceAccount accepte un JSON SA valide', () => {
    const sa = parseServiceAccount(JSON.stringify({
      client_email: 'sa@x.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
    }));
    expect(sa.client_email).toContain('gserviceaccount.com');
  });

  it('parseServiceAccount rejette un JSON sans private_key', () => {
    expect(() => parseServiceAccount('{"client_email":"a@b.com"}')).toThrow();
  });

  it('parseServiceAccount rejette un JSON malformé', () => {
    expect(() => parseServiceAccount('not-json')).toThrow('JSON invalide');
  });

  it('buildAuthUrl contient scope display-video, state et access_type=offline', () => {
    const url = buildAuthUrl('org-123');
    expect(url).toContain('accounts.google.com');
    expect(url).toContain('display-video');
    expect(url).toContain('state=org-123');
    expect(url).toContain('access_type=offline');
  });

  it('getOAuthRedirectUri privilégie la variable d’env explicite', () => {
    expect(getOAuthRedirectUri()).toBe('http://localhost:3000/api/admin/dsp/dv360/oauth/callback');
  });

  it('getOAuthRedirectUri dérive de NEXT_PUBLIC_APP_URL sinon', () => {
    const saved = process.env.DV360_OAUTH_REDIRECT_URI;
    const savedApp = process.env.NEXT_PUBLIC_APP_URL;
    try {
      delete process.env.DV360_OAUTH_REDIRECT_URI;
      process.env.NEXT_PUBLIC_APP_URL = 'https://app.magelian.com/';
      expect(getOAuthRedirectUri()).toBe('https://app.magelian.com/api/admin/dsp/dv360/oauth/callback');
      delete process.env.NEXT_PUBLIC_APP_URL;
      expect(getOAuthRedirectUri()).toBeUndefined();
    } finally {
      process.env.DV360_OAUTH_REDIRECT_URI = saved;
      if (savedApp !== undefined) process.env.NEXT_PUBLIC_APP_URL = savedApp;
    }
  });
});
