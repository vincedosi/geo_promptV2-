import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Régression sécurité : `departement` (argument function-calling LLM, non
 * validé) ne doit plus jamais être interpolé brut dans un `.or()` postgrest
 * (postgrest-js n'échappe rien dans `.or()` → injection de clauses de filtre
 * arbitraires). On vérifie que analyserZone() utilise désormais deux appels
 * paramétrés distincts (.ilike() puis .eq() en repli) et n'appelle jamais
 * `.or()`, quelle que soit la valeur fournie.
 */

type Call = { method: string; args: unknown[] };

class FakeQuery implements PromiseLike<{ data: unknown[] | null; error: null }> {
  calls: Call[] = [];
  constructor(private readonly resolve_: (calls: Call[]) => { data: unknown[] | null; error: null }) {}
  private record(method: string, args: unknown[]) {
    this.calls.push({ method, args });
    return this;
  }
  select(...a: unknown[]) { return this.record('select', a); }
  ilike(...a: unknown[]) { return this.record('ilike', a); }
  eq(...a: unknown[]) { return this.record('eq', a); }
  or(...a: unknown[]) { return this.record('or', a); }
  in(...a: unknown[]) { return this.record('in', a); }
  gte(...a: unknown[]) { return this.record('gte', a); }
  lte(...a: unknown[]) { return this.record('lte', a); }
  range(...a: unknown[]) { return this.record('range', a); }
  limit(...a: unknown[]) { return this.record('limit', a); }
  then<TResult1, TResult2>(
    onfulfilled?: ((value: { data: unknown[] | null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.resolve_(this.calls)).then(onfulfilled, onrejected);
  }
}

const allQueries: { table: string; calls: Call[] }[] = [];

const matchRow = {
  id: 'poi-1', nom: 'Mairie', lat: 48.1, lng: -1.6,
  categorie: 'administration', sous_categorie: null, adresse: null, ville: 'Rennes',
};

function makeFakeSupabase() {
  return {
    from: (table: string) => {
      const q = new FakeQuery((calls) => {
        allQueries.push({ table, calls });
        const eqCode = calls.find(c => c.method === 'eq' && c.args[0] === 'code_departement');
        // Le repli par code ne renvoie une ligne que si l'appel .eq() existe
        // (simule : aucune correspondance par nom, une correspondance par code).
        if (eqCode) return { data: [matchRow], error: null };
        return { data: [], error: null };
      });
      return q;
    },
  };
}

vi.mock('@/lib/auth', () => ({
  createAdminClient: () => makeFakeSupabase(),
}));

import { analyserZone } from '@/lib/chat/tools/analyserZone';

beforeEach(() => {
  allQueries.length = 0;
});

describe('analyserZone — filtre departement', () => {
  it("n'utilise jamais .or() et garde la valeur littérale, même avec une charge d'injection", async () => {
    const payload = '35,ville.eq.Paris'; // tentative d'injecter une clause OR supplémentaire
    const result = await analyserZone({ departement: payload }, []);

    // Aucun appel .or() nulle part dans les requêtes générées
    for (const { calls } of allQueries) {
      expect(calls.some(c => c.method === 'or')).toBe(false);
    }

    // Premier passage : ilike sur le nom, valeur passée telle quelle (littérale)
    const ilikeCalls = allQueries.flatMap(q => q.calls.filter(c => c.method === 'ilike' && c.args[0] === 'departement'));
    expect(ilikeCalls.length).toBeGreaterThan(0);
    expect(ilikeCalls[0].args[1]).toBe(`%${payload}%`);

    // Repli : eq sur le code, valeur littérale (uppercased), pas de split sur la virgule
    const eqCalls = allQueries.flatMap(q => q.calls.filter(c => c.method === 'eq' && c.args[0] === 'code_departement'));
    expect(eqCalls.length).toBeGreaterThan(0);
    expect(eqCalls[0].args[1]).toBe(payload.toUpperCase());

    // Le repli a bien remonté le résultat mocké
    expect(result.nb_pois).toBe(1);
    expect(result.pois[0].id).toBe('poi-1');
  });

  it('résout un code département simple (2A/2B, DROM) sans .or()', async () => {
    const result = await analyserZone({ departement: '2A' }, []);
    for (const { calls } of allQueries) {
      expect(calls.some(c => c.method === 'or')).toBe(false);
    }
    expect(result.departement).toBe('2A');
    expect(result.nb_pois).toBe(1); // repli .eq('code_departement', '2A') matché par le mock
  });
});
