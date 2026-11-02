/**
 * B8, tour 3 (N-2) : `refusActivationServeur` lit les recettes des zones SOURCES d'une combinaison en UNE requête par
 * niveau d'imbrication (jamais une par zone), et refuse dès qu'une source, à toute profondeur, a un rayon trop fin.
 */
import { describe, it, expect } from 'vitest';
import { refusActivationServeur } from '@/lib/zones/activation-serveur';

const PER = { type: 'departement', code: '35' };
const poi = (rayon_m: number) => ({ v: 1, type: 'rayon_poi', categorie: 'lycee', rayon_m, perimetre: PER });
const combi = (operation: string, zones: string[]) => ({ v: 1, type: 'combinaison', operation, zones });
const A = '3f2504e0-4f89-11d3-9a0c-0305e82c33a1';
const B = '3f2504e0-4f89-11d3-9a0c-0305e82c33b2';
const C = '3f2504e0-4f89-11d3-9a0c-0305e82c33c3';
const D = '3f2504e0-4f89-11d3-9a0c-0305e82c33d4';

/** Une base factice : chaque lecture `in('id', …)` est notée, et rend les zones demandées de `base`. */
function client(base: Record<string, { name: string; recette: unknown }>, erreur: { message: string } | null = null) {
  const lectures: { ids: string[]; org: string | null }[] = [];
  return {
    lectures,
    supabase: {
      from(table: string) {
        expect(table).toBe('custom_geo_zones');
        const l = { ids: [] as string[], org: null as string | null };
        lectures.push(l);
        const q = {
          select: () => q,
          in: (_c: string, ids: string[]) => { l.ids = ids; return q; },
          eq: (_c: string, v: string) => { l.org = v; return q; },
          limit: () => q,
          then: (ok: (v: unknown) => unknown) => Promise.resolve(erreur
            ? { data: null, error: erreur }
            : { data: l.ids.filter((id) => base[id]).map((id) => ({ id, ...base[id] })), error: null }).then(ok),
        };
        return q;
      },
    } as never,
  };
}

const REFUS = (nom: string, r: number) => `La zone « ${nom} » (rayon de ${r} m) est trop fine pour être activée (minimum 250 m) : `
  + 'cette combinaison est gardée pour l’analyse uniquement.';

describe('refusActivationServeur', () => {
  it('une zone non combinée : aucune lecture ; un rayon trop fin se refuse avec sa valeur', async () => {
    const c = client({});
    expect(await refusActivationServeur(c.supabase, 'o', poi(100)))
      .toBe('Rayon de 100 m : trop fin pour être activé (minimum 250 m). Gardé pour l’analyse uniquement.');
    expect(await refusActivationServeur(c.supabase, 'o', poi(5000))).toBeNull();
    expect(await refusActivationServeur(c.supabase, 'o', { v: 1, type: 'dessin' })).toBeNull();
    expect(c.lectures).toEqual([]);
  });

  it.each(['union', 'intersection', 'difference'])('%s avec une source à 100 m : refusée, la zone nommée, UNE lecture dans l’espace', async (op) => {
    const c = client({ [A]: { name: 'Lycées 5 km', recette: poi(5000) }, [B]: { name: 'Lycées 100 m', recette: poi(100) } });
    expect(await refusActivationServeur(c.supabase, 'o', combi(op, [A, B]))).toBe(REFUS('Lycées 100 m', 100));
    expect(c.lectures).toEqual([{ ids: [A, B], org: 'o' }]);
  });

  it('combinaison de combinaison : une lecture par niveau, la source fautive trouvée au second', async () => {
    const c = client({
      [A]: { name: 'Lycées 5 km', recette: poi(5000) }, [C]: { name: 'Sous-union', recette: combi('union', [A, D]) },
      [D]: { name: 'Pharmacies 200 m', recette: poi(200) },
    });
    expect(await refusActivationServeur(c.supabase, 'o', combi('union', [A, C]))).toBe(REFUS('Pharmacies 200 m', 200));
    expect(c.lectures.map((l) => l.ids)).toEqual([[A, C], [D]]);
  });

  it('sources toutes activables : null ; une erreur de lecture lève (l’appelant répond 500)', async () => {
    const c = client({ [A]: { name: 'A', recette: poi(5000) }, [B]: { name: 'B', recette: { v: 1, type: 'dessin' } } });
    expect(await refusActivationServeur(c.supabase, 'o', combi('union', [A, B]))).toBeNull();
    await expect(refusActivationServeur(client({}, { message: 'boum' }).supabase, 'o', combi('union', [A, B]))).rejects.toThrow('boum');
  });
});
