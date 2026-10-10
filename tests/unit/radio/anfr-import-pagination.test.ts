/**
 * Import ANFR, phases DIFF et DELETE.
 *
 * 1. La liste des émetteurs DÉJÀ en base est lue en entier. La boucle
 *    d'origine paginait par 5 000 et s'arrêtait sur une page de moins de
 *    5 000 ; PostgREST coupant toute table à `db-max-rows` = 1 000, elle
 *    s'arrêtait après la première page : 11 704 des 12 704 émetteurs
 *    (2026-10-10) échappaient au diff.
 *
 * 2. Voir toute la table rend la suppression massive atteignable, et
 *    `emetteur_radio_stations.emetteur_id` est `ON DELETE CASCADE` : les
 *    569 698 liaisons radio rapatriées du projet supprimé sont IRREMPLAÇABLES.
 *    Décision du chef de projet (2026-10-10) :
 *    - un émetteur lié à au moins une radio n'est JAMAIS supprimé par l'import ;
 *    - si les suppressions restantes dépassent 5 % des émetteurs existants,
 *      la phase DELETE est annulée en entier (fichier ANFR probablement tronqué) ;
 *    - chaque erreur de suppression est journalisée et remontée, et `deleted`
 *      compte les lignes RÉELLEMENT supprimées (`count: 'exact'`).
 *
 * Le faux client reproduit le plafond (au plus 1 000 lignes par requête, en
 * respectant `.range()`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const MAX_ROWS = 1000;
let enBase: string[] = [];
let fichier: string[] = [];
/** emetteur (sta_nm_anfr) → radios liées. */
let liaisons: Record<string, string[]> = {};
let erreurSuppression: string | null = null;
/** Lignes que la base dit avoir supprimées pour un lot : par défaut, tout le lot. */
let compteSuppression: ((lot: string[]) => number) | null = null;
const supprimes: string[] = [];
const tablesLues: string[] = [];
const journal: { niveau: string; message: string }[] = [];

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
    // Espaces insécables de `toLocaleString('fr-FR')` ramenées à des espaces simples.
    async info(_p: string, m: string) { journal.push({ niveau: 'info', message: m.replace(/[  ]/g, ' ') }); }
    async warn(_p: string, m: string) { journal.push({ niveau: 'warn', message: m.replace(/[  ]/g, ' ') }); }
    async error(_p: string, m: string) { journal.push({ niveau: 'error', message: m.replace(/[  ]/g, ' ') }); }
    async success(_p: string, m: string) { journal.push({ niveau: 'success', message: m.replace(/[  ]/g, ' ') }); }
    async phase<T>(_n: string, fn: () => Promise<T>) { return fn(); }
  },
}));

const idDe = (sta: string) => `id-${sta}`;
const staDe = (id: string) => id.slice(3);

function client(): SupabaseClient {
  const from = (table: string) => {
    tablesLues.push(table);
    let de = 0;
    let a = Number.POSITIVE_INFINITY;
    let suppression = false;
    let filtreIds: string[] | null = null;
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
    c.in = (_col: string, valeurs: string[]) => { filtreIds = valeurs; return c; };
    c.upsert = async (rows: unknown[]) => ({ error: null, count: rows.length });
    c.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      if (suppression) {
        const lot = (filtreIds ?? []).map(staDe);
        if (erreurSuppression) return Promise.resolve({ error: { message: erreurSuppression }, count: null }).then(ok, ko);
        const n = compteSuppression ? compteSuppression(lot) : lot.length;
        supprimes.push(...lot.slice(0, n));
        return Promise.resolve({ error: null, count: n }).then(ok, ko);
      }
      let source: unknown[] = [];
      if (table === 'emetteurs_radio') source = enBase.map((s) => ({ id: idDe(s), sta_nm_anfr: s }));
      if (table === 'emetteur_radio_stations') {
        source = (filtreIds ?? []).flatMap((id) =>
          (liaisons[staDe(id)] ?? []).map((radio) => ({ emetteur_id: id, radio_id: radio })));
      }
      const fin = Math.min(a + 1, de + MAX_ROWS, source.length);
      return Promise.resolve({ data: source.slice(de, Math.max(de, fin)), error: null }).then(ok, ko);
    };
    return c;
  };
  return { from, rpc: async () => ({ data: null, error: null }) } as unknown as SupabaseClient;
}

const { importAnfrData } = await import('@/lib/radio/anfr-import');

const base = (n: number) => Array.from({ length: n }, (_, i) => `S${String(i).padStart(5, '0')}`);

beforeEach(() => {
  enBase = base(3000);
  fichier = [];
  liaisons = {};
  erreurSuppression = null;
  compteSuppression = null;
  supprimes.length = 0;
  tablesLues.length = 0;
  journal.length = 0;
});

describe('import ANFR — diff contre TOUTE la base', () => {
  it('3 000 émetteurs en base, les 100 DERNIERS retirés du fichier : les 100 supprimés, 0 nouveau', async () => {
    // Ceux que la première page de 1 000 ne voyait pas.
    fichier = enBase.slice(0, 2900);
    const bilan = await importAnfrData(client(), () => {});
    expect(supprimes.sort()).toEqual(enBase.slice(2900));
    expect(bilan.deleted).toBe(100);
    expect(bilan.inserted).toBe(0);
    expect(bilan.updated).toBe(2900);
  });
});

describe('import ANFR — les liaisons radio ne partent jamais avec l émetteur', () => {
  it('un émetteur retiré mais lié à des radios est CONSERVÉ, compté et nommé', async () => {
    fichier = enBase.slice(0, 2900);
    for (const sta of enBase.slice(2900, 2930)) liaisons[sta] = ['r1', 'r2'];
    const bilan = await importAnfrData(client(), () => {});
    expect(supprimes.sort()).toEqual(enBase.slice(2930));
    expect(supprimes.some((s) => liaisons[s])).toBe(false);
    expect(bilan.deleted).toBe(70);
    expect(bilan.retained_linked).toBe(30);
    const message = journal.find((j) => /conserv/i.test(j.message))?.message ?? '';
    expect(message).toMatch(/30 émetteurs retirés de l'ANFR, conservés car liés à des radios/);
    expect(message).toContain(`${enBase[2900]} (2 radios)`);
  });

  it('un émetteur lié à plus de 1 000 radios-liaisons est quand même vu (lecture paginée)', async () => {
    fichier = enBase.slice(0, 2999);
    liaisons[enBase[2999]] = Array.from({ length: 1500 }, (_, i) => `r${i}`);
    const bilan = await importAnfrData(client(), () => {});
    expect(supprimes).toEqual([]);
    expect(bilan.retained_linked).toBe(1);
  });
});

describe('import ANFR — garde-fou de proportion', () => {
  it('plus de 5 % des émetteurs à supprimer : RIEN n est supprimé, et le rapport le dit avec les chiffres', async () => {
    fichier = enBase.slice(0, 2800); // 200 à supprimer = 6,7 % de 3 000
    const bilan = await importAnfrData(client(), () => {});
    expect(supprimes).toEqual([]);
    expect(bilan.deleted).toBe(0);
    expect(bilan.delete_aborted).toBe(true);
    const alerte = journal.find((j) => j.niveau === 'warn' && /annulée/.test(j.message))?.message ?? '';
    expect(alerte).toMatch(/200 émetteurs à supprimer sur 3 000 \(6,7 %/);
    expect(alerte).toMatch(/fichier ANFR probablement tronqué : aucun émetteur n'a été supprimé/i);
  });

  it('les émetteurs liés et conservés ne comptent pas dans les 5 %', async () => {
    fichier = enBase.slice(0, 2800);
    for (const sta of enBase.slice(2800, 2900)) liaisons[sta] = ['r1'];
    const bilan = await importAnfrData(client(), () => {});
    expect(bilan.delete_aborted).toBe(false);
    expect(bilan.deleted).toBe(100);
  });

  it('fichier manifestement tronqué (plus de la moitié de la base à retirer) : annulé SANS lire les liaisons', async () => {
    fichier = enBase.slice(0, 1000);
    const bilan = await importAnfrData(client(), () => {});
    expect(supprimes).toEqual([]);
    expect(bilan.delete_aborted).toBe(true);
    expect(tablesLues).not.toContain('emetteur_radio_stations');
  });
});

describe('import ANFR — suppressions comptées et journalisées', () => {
  it('deleted = lignes RÉELLEMENT supprimées (count exact), pas la taille du lot', async () => {
    fichier = enBase.slice(0, 2900);
    compteSuppression = (lot) => lot.length - 3;
    const bilan = await importAnfrData(client(), () => {});
    expect(bilan.deleted).toBe(97);
  });

  it('une suppression en erreur est journalisée et remontée, jamais avalée', async () => {
    fichier = enBase.slice(0, 2900);
    erreurSuppression = 'permission denied';
    const bilan = await importAnfrData(client(), () => {});
    expect(bilan.deleted).toBe(0);
    expect(bilan.delete_errors).toBe(100);
    expect(journal.some((j) => j.niveau === 'error' && /permission denied/.test(j.message))).toBe(true);
  });
});
