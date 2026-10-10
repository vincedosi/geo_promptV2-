/**
 * Import ANFR, phase DIFF : la liste des émetteurs DÉJÀ en base doit être lue
 * en entier.
 *
 * La boucle d'origine paginait par pages de 5 000 et s'arrêtait dès qu'une page
 * en rendait moins de 5 000. Or PostgREST coupe toute requête de table à
 * `db-max-rows` = 1 000 : la PREMIÈRE page rendait 1 000 lignes, la boucle
 * concluait « dernière page » et s'arrêtait. Sur les 12 704 émetteurs en base
 * (2026-10-10), 11 704 étaient invisibles au diff : jamais supprimés quand
 * l'ANFR les retire, et comptés « nouveaux » à chaque import.
 *
 * Le faux client reproduit le plafond (au plus 1 000 lignes par requête, en
 * respectant `.range()`).
 */
import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const MAX_ROWS = 1000;
let enBase: string[] = [];
let fichier: string[] = [];
const supprimes: string[] = [];

vi.mock('@/lib/radio/anfr-parser', () => ({
  downloadAndParseAnfr: async () => ({
    snapshotDate: '2026-10-01',
    emetteurs: fichier.map((sta) => ({
      sta_nm_anfr: sta, systeme: 'FM', frequence_mhz: 100, puissance_w: 100, hauteur_m: 30,
      exploitant: null, adresse: null, commune: null, departement: null,
      lat: 45, lon: 4, snapshot_date: '2026-10-01',
    })),
  }),
}));
vi.mock('@/lib/radio/import-logger', () => ({
  ImportLogger: class {
    async info() {}
    async warn() {}
    async error() {}
    async success() {}
    async phase<T>(_n: string, fn: () => Promise<T>) { return fn(); }
  },
}));

function client(): SupabaseClient {
  const from = (table: string) => {
    let de = 0;
    let a = Number.POSITIVE_INFINITY;
    let suppression = false;
    const c: Record<string, unknown> = {};
    c.insert = () => c;
    c.update = () => c;
    c.select = () => c;
    c.eq = () => c;
    c.order = () => c;
    c.single = () => Promise.resolve({ data: { id: 'log' }, error: null });
    c.range = (x: number, y: number) => { de = x; a = y; return c; };
    c.limit = (n: number) => { a = Math.min(a, de + n - 1); return c; };
    c.delete = () => { suppression = true; return c; };
    c.in = (_col: string, valeurs: string[]) => {
      if (suppression) supprimes.push(...valeurs);
      return c;
    };
    c.upsert = async (rows: unknown[]) => ({ error: null, count: rows.length });
    c.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      const source = table === 'emetteurs_radio' && !suppression ? enBase.map((s) => ({ sta_nm_anfr: s })) : [];
      const fin = Math.min(a + 1, de + MAX_ROWS, source.length);
      return Promise.resolve({ data: source.slice(de, Math.max(de, fin)), error: null }).then(ok, ko);
    };
    return c;
  };
  return { from, rpc: async () => ({ data: null, error: null }) } as unknown as SupabaseClient;
}

const { importAnfrData } = await import('@/lib/radio/anfr-import');

describe('import ANFR — diff contre TOUTE la base', () => {
  it('3 000 émetteurs en base, 2 500 encore au fichier : 500 supprimés, 0 nouveau', async () => {
    enBase = Array.from({ length: 3000 }, (_, i) => `S${String(i).padStart(5, '0')}`);
    // Le fichier retire les 500 DERNIERS : ceux que la première page de 1 000 ne voyait pas.
    fichier = enBase.slice(0, 2500);
    supprimes.length = 0;
    const bilan = await importAnfrData(client(), () => {});
    expect(supprimes.sort()).toEqual(enBase.slice(2500));
    expect(bilan.deleted).toBe(500);
    expect(bilan.inserted).toBe(0);
    expect(bilan.updated).toBe(2500);
  });
});
