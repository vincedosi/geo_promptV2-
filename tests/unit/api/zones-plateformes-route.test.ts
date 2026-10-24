import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `GET /api/zones/plateformes` (lot 5, T2) — le registre `plateformes_geo` servi à ⑤.
 *
 * Verrouille : aucune lecture avant la session (401 / 403) ; la lecture est triée par `ordre` EN BASE et bornée par
 * écrit (une table plus grande que la borne est une erreur dite, jamais une liste coupée) ; une ligne que le schéma
 * refuse n'est pas servie ; `Cache-Control: private, max-age=300` (règles stables, propres à l'utilisateur connecté) ;
 * le détail Postgres ne sort pas de la route.
 */
type Profil = { id: string; role: string; organization_id: string | null } | null;
const ORG = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
let profil: Profil = null;
vi.mock('@/lib/api/middleware', () => ({ requireAuth: async () => profil }));

const lectures: { table: string; colonnes?: string; tri?: [string, unknown]; borne?: number }[] = [];
let reponse: { data: unknown; error: unknown } = { data: [], error: null };
vi.mock('@/lib/auth', () => ({
  createAdminClient: () => ({
    from(table: string) {
      const l: (typeof lectures)[number] = { table };
      lectures.push(l);
      const c = {
        select(colonnes: string) { l.colonnes = colonnes; return c; },
        order(col: string, o: unknown) { l.tri = [col, o]; return c; },
        limit(n: number) { l.borne = n; return Promise.resolve(reponse); },
      };
      return c;
    },
  }),
}));

const { GET } = await import('@/app/api/zones/plateformes/route');
const { MAX_PLATEFORMES_GEO } = await import('@/lib/zones/plateformes');
const requete = () => new Request('http://localhost/api/zones/plateformes') as never;

const ligne = (ordre: number, maille = 'cp') => ({
  plateforme: 'dv360', maille, libelle: 'Codes postaux', natif: true, disponible: true, limites: { max_unites: 200 },
  doc_url: 'https://developers.google.com/x', releve_le: '2026-10-14', a_verifier: false, note: null, ordre,
});

beforeEach(() => {
  profil = { id: 'u1', role: 'client', organization_id: ORG };
  reponse = { data: [ligne(10), ligne(20, 'cercle')], error: null };
  lectures.length = 0;
});

describe('GET /api/zones/plateformes', () => {
  it('401 sans session, sans aucune lecture', async () => {
    profil = null;
    const r = await GET(requete());
    expect(r.status).toBe(401);
    expect(lectures).toHaveLength(0);
  });

  it('403 sans espace actif, sans aucune lecture', async () => {
    profil = { id: 'u1', role: 'client', organization_id: null };
    expect((await GET(requete())).status).toBe(403);
    expect(lectures).toHaveLength(0);
  });

  it('200 : les lignes triées par ordre en base, bornées par écrit, avec Cache-Control', async () => {
    const r = await GET(requete());
    expect(r.status).toBe(200);
    expect(r.headers.get('Cache-Control')).toBe('private, max-age=300');
    expect(lectures).toEqual([{ table: 'plateformes_geo', colonnes: expect.any(String), tri: ['ordre', { ascending: true }],
      borne: MAX_PLATEFORMES_GEO + 1 }]);
    const corps = await r.json() as { plateformes: { ordre: number; limites: unknown }[] };
    expect(corps.plateformes.map(p => p.ordre)).toEqual([10, 20]);
    expect(corps.plateformes[0].limites).toEqual({ max_unites: 200 });
  });

  it('une table plus grande que la borne : 500 dit, pas une liste coupée', async () => {
    reponse = { data: Array.from({ length: MAX_PLATEFORMES_GEO + 1 }, (_, i) => ligne(i)), error: null };
    const r = await GET(requete());
    expect(r.status).toBe(500);
    expect(r.headers.get('Cache-Control')).toBeNull();
  });

  it('une ligne refusée par le schéma (maille inconnue) : 500, rien de servi', async () => {
    reponse = { data: [ligne(10, 'hexagone')], error: null };
    expect((await GET(requete())).status).toBe(500);
  });

  it('erreur Postgres : 500 en français, sans le détail', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    reponse = { data: null, error: { message: 'relation "plateformes_geo" does not exist' } };
    const r = await GET(requete());
    expect(r.status).toBe(500);
    const texte = await r.text();
    expect(texte).not.toContain('relation');
    expect(texte).toContain('plateformes');
    err.mockRestore();
  });
});
