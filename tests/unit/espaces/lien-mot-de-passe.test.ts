/**
 * Lien de mot de passe : une seule fonction pour toutes les routes qui en
 * génèrent (création de compte, onglet Membres d'un espace…).
 *
 * Le 2026-10-10, le lien généré en local menait à la RACINE de l'application et
 * non à `/reset-password` : GoTrue refusait le `redirectTo` (absent de sa liste
 * blanche) et retombait sur `site_url`. La liste blanche est corrigée dans
 * `supabase/config.toml` ; ce fichier tient le côté code — la destination est
 * construite à un seul endroit.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const appels: { email: string; redirectTo: string }[] = [];

vi.mock('@/lib/auth', () => ({
  createAdminClient: () => ({
    auth: {
      admin: {
        generateLink: async (p: { email: string; options: { redirectTo: string } }) => {
          appels.push({ email: p.email, redirectTo: p.options.redirectTo });
          return { data: { properties: { action_link: 'https://lien.test/secret' } }, error: null };
        },
      },
    },
  }),
}));

const { origineApplication, genererLienMotDePasse } = await import('@/lib/espaces/lien-mot-de-passe');
const { createAdminClient } = await import('@/lib/auth');

beforeEach(() => {
  appels.length = 0;
  vi.unstubAllEnvs();
});

describe('origineApplication', () => {
  it('prend l origine de la requête sans NEXT_PUBLIC_APP_URL', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    expect(origineApplication('http://localhost:3000/api/admin/users')).toBe('http://localhost:3000');
  });

  it('NEXT_PUBLIC_APP_URL fait autorité, barre finale retirée', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://explore.exemple.test/');
    expect(origineApplication('http://localhost:3000/x')).toBe('https://explore.exemple.test');
  });
});

describe('genererLienMotDePasse', () => {
  it('vise /reset-password de l origine et rend le lien', async () => {
    const r = await genererLienMotDePasse(createAdminClient(), 'Quelqu.Un@Exemple.test', 'http://localhost:3000');
    expect(r).toEqual({ lien: 'https://lien.test/secret', erreur: null });
    expect(appels).toEqual([{ email: 'quelqu.un@exemple.test', redirectTo: 'http://localhost:3000/reset-password' }]);
  });
});

describe('une seule construction du redirectTo', () => {
  it.each([
    'app/api/admin/users/route.ts',
    'app/api/admin/organizations/[id]/members/reset-password/route.ts',
  ])('%s passe par genererLienMotDePasse', (fichier) => {
    const source = readFileSync(fichier, 'utf8');
    expect(source).toContain('genererLienMotDePasse(');
    expect(source).not.toMatch(/generateLink\(/);
    expect(source).not.toMatch(/\}\/reset-password`/);
  });
});
