/**
 * `POST /api/dev/connexion-auto` — connexion automatique du lancement Angular
 * AUTONOME en développement local (décision du 2026-11-02 : plus d'écran de
 * connexion en local, rien ne change dans AIDA).
 *
 * La route n'existe QUE sous `next dev` et seulement si les deux variables
 * serveur sont posées (`.env.development.local`, non suivi). Partout ailleurs
 * elle répond 404 SANS appeler GoTrue : l'Angular affiche alors un message en place (plus de page de connexion).
 * Les identifiants ne sortent jamais du serveur ; seuls les jetons de session
 * repartent vers le navigateur.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const connexions: { email: string; password: string }[] = [];
let reponseGoTrue: { data: { session: { access_token: string; refresh_token: string } | null }; error: { message: string } | null } = {
  data: { session: { access_token: 'jeton-acces', refresh_token: 'jeton-rafraichissement' } },
  error: null,
};

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: async (p: { email: string; password: string }) => {
        connexions.push(p);
        return reponseGoTrue;
      },
    },
  }),
}));

const { POST, dynamic } = await import('@/app/api/dev/connexion-auto/route');

function poserEnvDev() {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'cle-anon-factice');
  vi.stubEnv('DEV_CONNEXION_AUTO_EMAIL', 'compte@exemple.test');
  vi.stubEnv('DEV_CONNEXION_AUTO_MOT_DE_PASSE', 'mot-de-passe-factice');
}

beforeEach(() => {
  connexions.length = 0;
  reponseGoTrue = {
    data: { session: { access_token: 'jeton-acces', refresh_token: 'jeton-rafraichissement' } },
    error: null,
  };
  vi.unstubAllEnvs();
  poserEnvDev();
});

describe('POST /api/dev/connexion-auto', () => {
  it('est dynamique (jamais mise en cache au build)', () => {
    expect(dynamic).toBe('force-dynamic');
  });

  it('404 hors développement, sans appeler GoTrue', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const res = await POST();
    expect(res.status).toBe(404);
    expect(connexions).toEqual([]);
  });

  it('404 sous les tests aussi (NODE_ENV = test) : seul `next dev` l\'ouvre', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    expect((await POST()).status).toBe(404);
    expect(connexions).toEqual([]);
  });

  it('404 sans e-mail', async () => {
    vi.stubEnv('DEV_CONNEXION_AUTO_EMAIL', '');
    expect((await POST()).status).toBe(404);
    expect(connexions).toEqual([]);
  });

  it('404 sans mot de passe', async () => {
    vi.stubEnv('DEV_CONNEXION_AUTO_MOT_DE_PASSE', '');
    expect((await POST()).status).toBe(404);
    expect(connexions).toEqual([]);
  });

  it('200 avec les variables : ouvre la session et ne rend QUE les jetons', async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const corps = await res.json();
    expect(corps).toEqual({ access_token: 'jeton-acces', refresh_token: 'jeton-rafraichissement' });
    expect(JSON.stringify(corps)).not.toContain('mot-de-passe-factice');
    expect(connexions).toEqual([{ email: 'compte@exemple.test', password: 'mot-de-passe-factice' }]);
  });

  it('les espaces autour des variables sont retirés', async () => {
    vi.stubEnv('DEV_CONNEXION_AUTO_EMAIL', '  compte@exemple.test ');
    await POST();
    expect(connexions[0].email).toBe('compte@exemple.test');
  });

  it('502 si GoTrue refuse les identifiants (sans les répéter)', async () => {
    reponseGoTrue = { data: { session: null }, error: { message: 'Invalid login credentials' } };
    const res = await POST();
    expect(res.status).toBe(502);
    const texte = await res.text();
    expect(texte).not.toContain('mot-de-passe-factice');
    expect(texte).not.toContain('compte@exemple.test');
  });
});
