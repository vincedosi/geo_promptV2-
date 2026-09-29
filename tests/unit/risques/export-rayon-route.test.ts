/**
 * La route d'export Excel de l'onglet Rayon, sans base : ses refus, et ce
 * qu'elle fait d'une fabrication qui échoue.
 *
 * Chaque refus porte un message en français que le bouton affiche tel quel —
 * un 500 nu y deviendrait « Export impossible » sans rien pour comprendre.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/risques/exposition/rayon/export/route';

const profil = { id: 'u1' };
const requireAuth = vi.fn();
vi.mock('@/lib/api/middleware', () => ({
  requireAuth: (...a: unknown[]) => requireAuth(...a),
  authUnauthorized: () => new Response(JSON.stringify({ error: 'Non authentifié.' }), { status: 401 }),
}));

const quota = vi.fn();
vi.mock('@/lib/api/rate-limit', () => ({
  createRateLimiter: () => (...a: unknown[]) => quota(...a),
  rateLimitResponse: () => new Response('{}', { status: 429 }),
}));

const rpc = vi.fn();
vi.mock('@/lib/auth', () => ({ createAdminClient: () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }));

const construire = vi.fn();
vi.mock('@/lib/risques/export-rayon/classeur', () => ({
  construireClasseurRayon: (...a: unknown[]) => construire(...a),
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

const url = (q = '') => new NextRequest(`http://localhost/api/risques/exposition/rayon/export${q}`);

/** La plus petite réponse valide de `export_couverture_rayon`. */
const reponseBase = {
  calculable: true, cible: 'ind', calcule_le: null,
  lignes: [{ d: '13', g: '*', n: '*', inc: { 0: 1 } }],
  departements: [{ code: '13', nom: 'Bouches-du-Rhône', region: '93', pop: 1 }],
  regions: [{ code: '93', nom: 'PACA', pop: 1 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  requireAuth.mockResolvedValue(profil);
  quota.mockResolvedValue({ ok: true, retrySec: 0 });
  rpc.mockResolvedValue({ data: reponseBase, error: null });
  construire.mockResolvedValue(Buffer.from('xlsx'));
});

describe('GET /api/risques/exposition/rayon/export', () => {
  it('refuse sans session', async () => {
    requireAuth.mockResolvedValue(null);
    expect((await GET(url())).status).toBe(401);
  });

  it('refuse un rayon hors de la borne du pré-calcul (10 km)', async () => {
    expect((await GET(url('?rayon_m=20000'))).status).toBe(400);
  });

  it('refuse un code de territoire qui n’a pas la forme d’un code INSEE', async () => {
    expect((await GET(url('?perim_niveau=departement&perim_code=13;DROP'))).status).toBe(400);
  });

  it('refuse au-delà du quota, AVANT toute lecture en base', async () => {
    quota.mockResolvedValue({ ok: false, retrySec: 30 });
    expect((await GET(url())).status).toBe(429);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rend 409 si le pré-calcul n’existe pas — un classeur vide se lirait « personne »', async () => {
    rpc.mockResolvedValue({ data: { ...reponseBase, lignes: [] }, error: null });
    const r = await GET(url());
    expect(r.status).toBe(409);
    expect((await r.json()).a_construire).toBe(true);
  });

  it('rend 500 avec un message si la lecture échoue', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const r = await GET(url());
    expect(r.status).toBe(500);
    expect((await r.json()).error).toMatch(/indisponible/);
  });

  it('rattrape une fabrication qui échoue — message en français, jamais un 500 nu', async () => {
    construire.mockRejectedValue(new Error('dessin déjà présent'));
    const r = await GET(url());
    expect(r.status).toBe(500);
    expect((await r.json()).error).toMatch(/fabriqué/);
  });

  it('sert le classeur, et transmet l’état de l’écran comme valeurs INITIALES', async () => {
    const r = await GET(url('?gravites=seveso_haut&natures=Explosibles&perim_niveau=region&perim_code=93&rayon_m=2300'));
    expect(r.status).toBe(200);
    expect(r.headers.get('content-disposition')).toMatch(/rayon-influence-seveso-\d{4}-\d{2}-\d{2}\.xlsx/);
    expect(construire.mock.calls[0][1]).toEqual({
      gravites: ['seveso_haut'], natures: ['Explosibles'],
      perim: { niveau: 'region', code: '93' }, rayonM: 2300,
    });
  });

  it('ne passe le territoire que si le niveau ET le code sont donnés', async () => {
    await GET(url('?perim_code=93'));
    expect(construire.mock.calls[0][1].perim).toBeNull();
  });
});
