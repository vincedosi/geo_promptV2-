import { describe, it, expect, vi } from 'vitest';

/**
 * `getSourcesPropresEspace` — les sources PROPRES à l'espace actif (spec
 * droits-sur-la-carte, R6) : privées, possédées par l'espace ou partagées avec
 * lui, jamais le socle. Elle sert à ranger une catégorie dans « Données de
 * l'espace » sur la carte ; ce n'est pas une règle d'autorisation
 * (`getOrgSourceIds` le reste).
 */

type Filtre = { methode: string; argument: unknown };

const filtresObserves: Filtre[] = [];
const reponse: { data: { id: string }[] | null; error: { message: string } | null } = { data: [], error: null };

// Chaîne « thenable » : chaque filtre la rend, l'`await` final lit `reponse`.
function fausseChaine() {
  const chaine = {
    select() { return chaine; },
    eq(colonne: string, valeur: unknown) {
      filtresObserves.push({ methode: 'eq', argument: `${colonne}=${String(valeur)}` });
      return chaine;
    },
    neq(colonne: string, valeur: unknown) {
      filtresObserves.push({ methode: 'neq', argument: `${colonne}=${String(valeur)}` });
      return chaine;
    },
    or(expression: string) {
      filtresObserves.push({ methode: 'or', argument: expression });
      return chaine;
    },
    then<T>(ok: (r: typeof reponse) => T) { return Promise.resolve(reponse).then(ok); },
  };
  return chaine;
}

vi.mock('@/lib/auth', () => ({
  createAdminClient: () => ({ from: () => fausseChaine() }),
}));

const { getSourcesPropresEspace } = await import('@/lib/auth/getOrgSourceIds');

const ORG_UUID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const session = (o: Record<string, unknown>) => o as never;

function dernierOu(): string {
  return filtresObserves.filter(f => f.methode === 'or').at(-1)?.argument as string;
}

describe('getSourcesPropresEspace', () => {
  it('espace actif → sources privées de l\'espace ou partagées avec lui, socle exclu', async () => {
    filtresObserves.length = 0;
    reponse.data = [{ id: 'p' }]; reponse.error = null;
    expect(await getSourcesPropresEspace(session({ role: 'super_admin', orgId: ORG_UUID }))).toEqual(['p']);
    expect(filtresObserves).toContainEqual({ methode: 'eq', argument: 'visibilite=privee' });
    // Non supprimées, au sens de la base (`is distinct from 'deleted'`).
    expect(filtresObserves).toContainEqual({ methode: 'or', argument: 'status.is.null,status.neq.deleted' });
    expect(dernierOu()).toBe(`organization_id.eq.${ORG_UUID},shared_with.cs.{${ORG_UUID}}`);
    expect(dernierOu()).not.toContain('socle');
  });

  it('sans espace actif → [] sans lecture', async () => {
    filtresObserves.length = 0;
    expect(await getSourcesPropresEspace(session({ role: 'client', orgId: null }))).toEqual([]);
    expect(await getSourcesPropresEspace(null)).toEqual([]);
    expect(filtresObserves).toHaveLength(0);
  });

  it('n interpole jamais une organisation qui n est pas un UUID → [] sans lecture', async () => {
    filtresObserves.length = 0;
    for (const suspect of ["' or true--", 'org-1', '']) {
      expect(await getSourcesPropresEspace(session({ role: 'client', orgId: suspect }))).toEqual([]);
    }
    expect(filtresObserves).toHaveLength(0);
  });

  it('lecture en échec → []', async () => {
    reponse.data = null; reponse.error = { message: 'x' };
    expect(await getSourcesPropresEspace(session({ role: 'client', orgId: ORG_UUID }))).toEqual([]);
    reponse.error = null;
  });
});
