import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * GET /api/map/jeux-recommandes — la sélection recommandée de l'espace ACTIF (spec carte-en-parcours § 7.2).
 * Sans session, sans espace ou avec un espace douteux : `[]`, sans aucune lecture. Lecture en échec : 500 français.
 */

type Session = { userId: string; role: string; orgId: string | null } | null;
let session: Session = null;
// La session est simulée ; la règle « espace = UUID de la session » est la VRAIE (`orgIdDeSession`).
vi.mock('@/lib/auth/getSessionOrg', async (importOriginal) => {
  const reel = await importOriginal<typeof import('@/lib/auth/getSessionOrg')>();
  return { ...reel, getSessionOrg: async () => session, orgIdActif: async () => reel.orgIdDeSession(session as never) };
});

const lues: string[] = [];
const filtres: [string, unknown][] = [];
let echec = false;
vi.mock('@/lib/auth', () => ({
  createAdminClient: () => ({
    from(table: string) {
      lues.push(table);
      const chaine = {
        select() { return chaine; },
        eq(col: string, val: unknown) { filtres.push([col, val]); return chaine; },
        order() { return chaine; },
        then<T>(ok: (r: { data: unknown; error: unknown }) => T) {
          return Promise.resolve(echec
            ? { data: null, error: { message: 'relation does not exist' } }
            : { data: [{ cle_jeu: 'iris:socio-demo' }, { cle_jeu: 'ooh:panneaux' }, { cle_jeu: 'poi:lycee' }, { cle_jeu: 'radio:emetteurs' }], error: null }).then(ok);
        },
      };
      return chaine;
    },
  }),
}));

const { GET } = await import('@/app/api/map/jeux-recommandes/route');

const ORG = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

async function appeler() {
  const res = await GET({ nextUrl: new URL('http://localhost/api/map/jeux-recommandes') } as never);
  return { status: res.status, corps: (await res.json()) as { cles?: string[]; error?: string } };
}

describe('GET /api/map/jeux-recommandes', () => {
  beforeEach(() => { lues.length = 0; filtres.length = 0; echec = false; session = null; });

  it('session avec un espace : les clés de cet espace ; une clé que la carte ne sait plus recommander (OOH, radio — T11b) est ignorée', async () => {
    session = { userId: 'u', role: 'client', orgId: ORG };
    const { status, corps } = await appeler();
    expect(status).toBe(200);
    expect(corps).toEqual({ cles: ['iris:socio-demo', 'poi:lycee'] });
    expect(lues).toEqual(['espace_jeux_recommandes']);
    expect(filtres).toContainEqual(['organization_id', ORG]);
  });

  it.each([
    ['sans session', null],
    ['session sans espace', { userId: 'u', role: 'super_admin', orgId: null }],
    ['espace non UUID', { userId: 'u', role: 'client', orgId: 'pas-un-uuid' }],
  ] as [string, Session][])('%s : [] sans lecture', async (_nom, s) => {
    session = s;
    const { status, corps } = await appeler();
    expect(status).toBe(200);
    expect(corps).toEqual({ cles: [] });
    expect(lues).toEqual([]);
  });

  it('lecture en échec : 500, message français sans le détail Postgres', async () => {
    session = { userId: 'u', role: 'client', orgId: ORG };
    echec = true;
    const erreur = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { status, corps } = await appeler();
    expect(status).toBe(500);
    expect(corps.error).toBe('Sélection recommandée indisponible.');
    expect(erreur).toHaveBeenCalled();
    erreur.mockRestore();
  });
});
