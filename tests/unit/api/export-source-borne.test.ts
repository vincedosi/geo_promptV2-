/**
 * `GET /api/admin/sources/[id]/export` — l'export CSV d'une source.
 *
 * Jusqu'au 2026-10-11 la route lisait `.limit(50000)` en un seul appel :
 * PostgREST coupe toute requête de table à `db-max-rows` = 1 000
 * (`supabase/config.toml`), et aucun `.limit()` client ne lève ce plafond. Une
 * source de 5 584 POI (la plus grosse de la base locale) sortait en 1 000
 * lignes, sans rien qui le dise.
 *
 * Le faux client reproduit le plafond (1 000 lignes au plus par requête) et
 * respecte le tri, `.gt('id', …)` et `.limit()` : une lecture qui ne pagine pas
 * sur une clé unique se voit.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const MAX_ROWS = 1000;
let poi: Record<string, unknown>[] = [];
let panneaux: Record<string, unknown>[] = [];
let typeSource = 'poi';
const requetes: { table: string; ordre: string | null; apres: string | null }[] = [];

function constructeur(table: string) {
  let limite = Number.POSITIVE_INFINITY;
  let ordre: string | null = null;
  let apres: string | null = null;
  let unique = false;
  let tete = false;
  const c: Record<string, unknown> = {};
  c.select = (_cols?: string, opts?: { head?: boolean }) => { tete = !!opts?.head; return c; };
  c.eq = () => c;
  c.order = (col: string) => { ordre = col; return c; };
  c.gt = (col: string, v: string) => { if (col === 'id') apres = v; return c; };
  c.limit = (n: number) => { limite = n; return c; };
  c.range = (x: number, y: number) => { limite = y - x + 1; return c; };
  c.single = () => { unique = true; return c; };
  c.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
    let reponse: unknown;
    if (unique) reponse = { data: { type: typeSource, name: 'Ma source' }, error: null };
    else {
      const toutes = table === 'poi_france' ? poi : table === 'panneaux_affichage' ? panneaux : [];
      if (tete) reponse = { count: toutes.length, data: null, error: null };
      else {
        requetes.push({ table, ordre, apres });
        let lignes = [...toutes];
        if (ordre) lignes.sort((x, y) => String(x[ordre!]).localeCompare(String(y[ordre!])));
        if (apres !== null) lignes = lignes.filter((l) => String(l.id) > apres!);
        reponse = { data: lignes.slice(0, Math.min(limite, MAX_ROWS)), error: null };
      }
    }
    return Promise.resolve(reponse).then(ok, ko);
  };
  return c;
}

vi.mock('@/lib/auth', () => ({
  createAdminClient: () => ({ from: (table: string) => constructeur(table) }),
}));
vi.mock('@/lib/api/middleware', () => ({
  requireAdmin: async () => ({ id: 'u', organization_id: 'o' }),
  adminUnauthorized: () => new Response(null, { status: 401 }),
}));

/** Identifiants triables et uniques, MÉLANGÉS : l'ordre d'arrivée n'est pas l'ordre de la clé. */
function lignes(n: number, champ: string): Record<string, unknown>[] {
  const l = Array.from({ length: n }, (_, i) => ({
    id: `id-${String(i).padStart(7, '0')}`,
    [champ]: `ligne ${i}`,
  }));
  return l.reverse();
}

async function exporter(): Promise<{ statut: number; csv: string; entetes: Headers }> {
  const { GET } = await import('@/app/api/admin/sources/[id]/export/route');
  const res = await GET(new NextRequest('http://localhost/api/admin/sources/s/export'), { params: Promise.resolve({ id: 's' }) });
  return { statut: res.status, csv: await res.text(), entetes: res.headers };
}

function lignesDeDonnees(csv: string): string[] {
  return csv.split('\n').slice(1).filter((l) => l !== '' && !l.startsWith('#'));
}

beforeEach(() => {
  poi = [];
  panneaux = [];
  requetes.length = 0;
});

describe('export CSV d une source admin', () => {
  it('une source de 2 500 POI sort en 2 500 lignes, chacune une seule fois', async () => {
    typeSource = 'poi';
    poi = lignes(2500, 'nom');
    const { statut, csv, entetes } = await exporter();
    expect(statut).toBe(200);
    const donnees = lignesDeDonnees(csv);
    expect(donnees).toHaveLength(2500);
    expect(new Set(donnees).size).toBe(2500);
    expect(csv).not.toContain('tronqué');
    expect(entetes.get('X-Export-Tronque')).toBe('false');
    expect(entetes.get('X-Export-Lignes')).toBe('2500');
  });

  it('pagine sur la clé unique : chaque page triée par id, reprise après le dernier id lu', async () => {
    typeSource = 'poi';
    poi = lignes(2500, 'nom');
    await exporter();
    const pages = requetes.filter((r) => r.table === 'poi_france');
    expect(pages.length).toBeGreaterThanOrEqual(3);
    for (const p of pages) expect(p.ordre).toBe('id');
    expect(pages[0].apres).toBeNull();
    expect(pages[1].apres).toBe('id-0000999');
  });

  it('panneaux : 1 434 lignes (le cas mesuré en base), pas 1 000', async () => {
    typeSource = 'panneaux';
    panneaux = lignes(1434, 'reference_panneau');
    const { csv } = await exporter();
    expect(lignesDeDonnees(csv)).toHaveLength(1434);
  });

  it('au-delà de la borne : la borne exactement, et le fichier LE DIT', async () => {
    const { BORNE_EXPORT_SOURCE } = await import('@/lib/csv/export-source');
    typeSource = 'poi';
    poi = lignes(BORNE_EXPORT_SOURCE + 1234, 'nom');
    const { csv, entetes } = await exporter();
    expect(lignesDeDonnees(csv)).toHaveLength(BORNE_EXPORT_SOURCE);
    const derniere = csv.trimEnd().split('\n').at(-1)!;
    expect(derniere.startsWith('#')).toBe(true);
    expect(derniere).toContain('tronqué');
    expect(derniere).toContain((BORNE_EXPORT_SOURCE + 1234).toLocaleString('fr-FR'));
    expect(entetes.get('X-Export-Tronque')).toBe('true');
    expect(entetes.get('Content-Disposition')).toContain('_tronque');
  });

  it('pile à la borne : rien de coupé, rien d annoncé', async () => {
    const { BORNE_EXPORT_SOURCE } = await import('@/lib/csv/export-source');
    typeSource = 'poi';
    poi = lignes(BORNE_EXPORT_SOURCE, 'nom');
    const { csv, entetes } = await exporter();
    expect(lignesDeDonnees(csv)).toHaveLength(BORNE_EXPORT_SOURCE);
    expect(csv).not.toContain('tronqué');
    expect(entetes.get('X-Export-Tronque')).toBe('false');
  });
});
