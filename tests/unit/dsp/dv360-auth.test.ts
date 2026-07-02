import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  process.env.DV360_OAUTH_CLIENT_ID = 'test-client-id';
  process.env.DV360_OAUTH_CLIENT_SECRET = 'test-secret';
  process.env.DV360_OAUTH_REDIRECT_URI = 'http://localhost:3000/api/admin/dsp/dv360/oauth/callback';
});

describe('dv360 auth', () => {
  it('parseServiceAccount accepte un JSON SA valide', async () => {
    const { parseServiceAccount } = await import('@/lib/dsp/dv360/auth');
    const sa = parseServiceAccount(JSON.stringify({
      client_email: 'sa@x.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
    }));
    expect(sa.client_email).toContain('gserviceaccount.com');
  });

  it('parseServiceAccount rejette un JSON sans private_key', async () => {
    const { parseServiceAccount } = await import('@/lib/dsp/dv360/auth');
    expect(() => parseServiceAccount('{"client_email":"a@b.com"}')).toThrow();
  });

  it('parseServiceAccount rejette un JSON malformé', async () => {
    const { parseServiceAccount } = await import('@/lib/dsp/dv360/auth');
    expect(() => parseServiceAccount('not-json')).toThrow('JSON invalide');
  });

  it('buildAuthUrl contient scope display-video, state et access_type=offline', async () => {
    const { buildAuthUrl } = await import('@/lib/dsp/dv360/auth');
    const url = buildAuthUrl('org-123');
    expect(url).toContain('accounts.google.com');
    expect(url).toContain('display-video');
    expect(url).toContain('state=org-123');
    expect(url).toContain('access_type=offline');
  });

  it('getOAuthRedirectUri privilégie la variable d’env explicite', async () => {
    const { getOAuthRedirectUri } = await import('@/lib/dsp/dv360/auth');
    expect(getOAuthRedirectUri()).toBe('http://localhost:3000/api/admin/dsp/dv360/oauth/callback');
  });

  it('getOAuthRedirectUri dérive de NEXT_PUBLIC_APP_URL sinon', async () => {
    const { getOAuthRedirectUri } = await import('@/lib/dsp/dv360/auth');
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
