import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests de CARACTÉRISATION de `lib/import/inserter.ts`.
 *
 * Ils figent le comportement ACTUEL, bizarreries comprises. Ils ne jugent pas :
 * si le code fait quelque chose d'étrange, le test attend cette chose étrange.
 * C'est leur seul rôle — être la preuve que le lot 6 (insertion groupée,
 * `PERF-002`) n'a rien changé d'observable.
 *
 * Ce qui est figé ici :
 *  - la forme du retour `{ inserted, ignored, errors, firstError? }` ;
 *  - le fait qu'une erreur PostgreSQL `23505` compte comme « ignoré » et non
 *    comme une erreur ;
 *  - le format EXACT des lignes de journal `[OK]`, `[SKIP]`, `[ERR]`, y compris
 *    la numérotation globale et les coordonnées à 4 décimales ;
 *  - le fait que `firstError` retient la PREMIÈRE erreur et pas la dernière ;
 *  - le comportement en cas d'échec de la connexion initiale.
 *
 * Ce qui n'est volontairement PAS figé : le nombre d'appels réseau émis. C'est
 * justement ce que le lot 6 doit pouvoir changer (aujourd'hui un aller-retour
 * par ligne, demain un par lot).
 */

type Log = { niveau: string; message: string };

/** Erreur Supabase simulée : `null` = succès. */
type ErreurSimulee = { code?: string; message: string } | null;

/**
 * Fausse chaîne Supabase. `upsert` consomme une réponse programmée par appel,
 * ce qui permet de scénariser succès / doublon / erreur ligne par ligne.
 */
function fausseBase(reponses: ErreurSimulee[]) {
  const appels: { table: string; operation: string }[] = [];
  let curseur = 0;
  return {
    appels,
    client: {
      from(table: string) {
        return {
          // Sonde de connexion de insertRows : .select('id').limit(1)
          select() {
            return {
              limit() {
                appels.push({ table, operation: 'select' });
                return Promise.resolve({ data: [], error: null });
              },
            };
          },
          upsert(_row: unknown, _opts: unknown) {
            appels.push({ table, operation: 'upsert' });
            const erreur = reponses[curseur] ?? null;
            curseur += 1;
            return Promise.resolve({ error: erreur });
          },
        };
      },
    },
  };
}

const clientCourant = { valeur: fausseBase([]) };

vi.mock('@/lib/auth', () => ({
  createAdminClient: () => clientCourant.valeur.client,
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));
vi.mock('@/lib/poi/categories', () => ({ invalidateCategoriesCache: () => {} }));
vi.mock('@/lib/import/geo-enricher', () => ({
  enrichMissingGeo: async (rows: unknown[]) => rows,
}));
vi.mock('@/lib/supabase/tables', () => ({
  triggerFilled: (row: Record<string, unknown>) => row,
}));

const { insertRows } = await import('@/lib/import/inserter');

/** Une ligne minimale acceptée par l'inserter. */
function ligne(i: number) {
  return {
    id: `0000000${i}-aaaa-bbbb-cccc-dddddddddddd`,
    lat: 48.8534,
    lng: 2.3488,
    nom: `POI ${i}`,
    categorie: 'test',
  } as never;
}

describe('caractérisation — insertRows', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('compte les insertions réussies et ne remonte aucune erreur', async () => {
    clientCourant.valeur = fausseBase([null, null, null]);
    const r = await insertRows([ligne(1), ligne(2), ligne(3)], 'poi');
    expect(r.inserted).toBe(3);
    expect(r.ignored).toBe(0);
    expect(r.errors).toBe(0);
    expect(r.firstError).toBeUndefined();
  });

  it('classe une violation de contrainte 23505 en « ignoré », pas en erreur', async () => {
    // Bizarrerie assumée du code actuel : un doublon n'est pas un échec.
    clientCourant.valeur = fausseBase([null, { code: '23505', message: 'duplicate key' }, null]);
    const r = await insertRows([ligne(1), ligne(2), ligne(3)], 'poi');
    expect(r.inserted).toBe(2);
    expect(r.ignored).toBe(1);
    expect(r.errors).toBe(0);
  });

  it('compte toute autre erreur comme une erreur et retient la PREMIÈRE', async () => {
    clientCourant.valeur = fausseBase([
      { code: '42703', message: 'colonne inconnue' },
      null,
      { code: '42P01', message: 'table inconnue' },
    ]);
    const r = await insertRows([ligne(1), ligne(2), ligne(3)], 'poi');
    expect(r.inserted).toBe(1);
    expect(r.errors).toBe(2);
    expect(r.firstError).toBe('colonne inconnue');
  });

  it('produit un journal ligne par ligne au format attendu', async () => {
    clientCourant.valeur = fausseBase([null, { code: '23505', message: 'dup' }, { message: 'boum' }]);
    const journal: Log[] = [];
    await insertRows([ligne(1), ligne(2), ligne(3)], 'poi', undefined,
      (niveau: string, message: string) => { journal.push({ niveau, message }); });

    const ok = journal.find(l => l.message.startsWith('[OK]'));
    const skip = journal.find(l => l.message.startsWith('[SKIP]'));
    const err = journal.find(l => l.message.startsWith('[ERR]'));

    // Le rapport ligne par ligne est la raison d'être de la boucle actuelle :
    // le lot 6 doit le conserver à l'identique.
    expect(ok?.message).toMatch(/^\[OK\] #\d+ POI 1 \(48\.8534, 2\.3488\) → insere$/);
    expect(skip?.message).toMatch(/^\[SKIP\] #\d+ POI 2 → doublon$/);
    expect(err?.message).toMatch(/^\[ERR\] #\d+ POI 3 → boum$/);
    expect(skip?.niveau).toBe('warn');
    expect(err?.niveau).toBe('error');
  });

  it('numérote les lignes globalement, au-delà de la taille de lot de 50', async () => {
    // 60 lignes = deux lots. La numérotation ne doit pas repartir de zéro.
    clientCourant.valeur = fausseBase(Array<ErreurSimulee>(60).fill(null));
    const journal: Log[] = [];
    await insertRows(Array.from({ length: 60 }, (_, i) => ligne(i + 1)), 'poi', undefined,
      (niveau: string, message: string) => { journal.push({ niveau, message }); });

    const numeros = journal
      .filter(l => l.message.startsWith('[OK]'))
      .map(l => Number(l.message.match(/#(\d+)/)?.[1]));
    expect(numeros).toHaveLength(60);
    expect(Math.max(...numeros)).toBeGreaterThan(50);
  });

  it('rapporte la progression avec le total attendu', async () => {
    clientCourant.valeur = fausseBase(Array<ErreurSimulee>(60).fill(null));
    const etapes: number[][] = [];
    await insertRows(Array.from({ length: 60 }, (_, i) => ligne(i + 1)), 'poi',
      (traite, total, ins, ign, err) => { etapes.push([traite, total, ins, ign, err]); });

    expect(etapes.length).toBeGreaterThan(0);
    expect(etapes.every(([, total]) => total === 60)).toBe(true);
    expect(etapes[etapes.length - 1][0]).toBe(60);
  });

  it('renvoie toutes les lignes en erreur si la connexion initiale échoue', async () => {
    clientCourant.valeur = {
      appels: [],
      client: {
        from() {
          return {
            select() {
              return { limit: () => Promise.resolve({ data: null, error: { message: 'hors ligne' } }) };
            },
            upsert() { return Promise.resolve({ error: null }); },
          };
        },
      },
    } as never;
    const r = await insertRows([ligne(1), ligne(2)], 'poi');
    expect(r.inserted).toBe(0);
    expect(r.errors).toBe(2);
    expect(r.firstError).toContain('Connexion Supabase ECHOUEE');
  });
});
