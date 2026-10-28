/**
 * Un indicateur peut devenir un jeu de données (lot « Catalogue et groupes », sql/288) — contre la vraie base locale.
 *
 * Un indicateur privable est une ligne `data_sources` de type `indicateur`, et `cible_indicator_registry.data_source_id`
 * pointe dessus : les règles des jeux importés (socle, privé, partagé) s'appliquent sans second modèle de droits.
 * Seule l'identité de l'appelant est simulée ; routes, PostgREST et tables sont les vrais.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { creerClientTest } from './_client';

vi.mock('@/lib/api/middleware', async (original) => ({
  ...(await original<typeof import('@/lib/api/middleware')>()),
  requireAdmin: async () => ({ id: '00000000-0000-0000-0000-00000000a11c', role: 'super_admin', organization_id: null }),
}));

const sources = await import('@/app/api/admin/sources/[id]/route');
const imports = await import('@/app/api/admin/imports/route');
const socle = await import('@/app/api/admin/espaces/socle/route');
const sb = creerClientTest();

const CODE = 'abstention_pres_2022';
let idAbstention = '';

beforeAll(async () => {
  const { data, error } = await sb.from('data_sources').select('id').eq('type', 'indicateur').eq('category', CODE);
  if (error) throw new Error(error.message);
  expect(data, 'sql/288 appliquée ? une seule ligne de catalogue pour l abstention').toHaveLength(1);
  idAbstention = data![0].id as string;
});

describe('l abstention est un jeu de données (T1, schéma)', () => {
  it('une ligne data_sources : type indicateur, socle, 6 186 codes postaux, et le registre y pointe', async () => {
    const { data, error } = await sb.from('data_sources')
      .select('type, category, visibilite, valid_count, status').eq('id', idAbstention).single();
    expect(error).toBeNull();
    expect(data).toEqual({ type: 'indicateur', category: CODE, visibilite: 'socle', valid_count: 6186, status: 'active' });

    const { data: reg, error: er } = await sb.from('cible_indicator_registry')
      .select('data_source_id').eq('indicator_code', CODE).single();
    expect(er).toBeNull();
    expect(reg?.data_source_id).toBe(idAbstention);
  });

  it('A-1 : aucun indicateur iris_column n a de source (leur colonne reste lisible par les tuiles IRIS)', async () => {
    const { data, error } = await sb.from('cible_indicator_registry')
      .select('indicator_code').eq('data_source', 'iris_column').not('data_source_id', 'is', null);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('A-3 : DELETE /api/admin/sources/<abstention> → 409, ligne intacte', async () => {
    const res = await sources.DELETE(
      new NextRequest(`http://localhost:3000/api/admin/sources/${idAbstention}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: idAbstention }) },
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain('ne se supprime pas');
    const { data, error } = await sb.from('data_sources').select('id').eq('id', idAbstention);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it('A-4 : absente de l historique des imports, présente dans la fiche Socle d Accès', async () => {
    const hist = (await (await imports.GET(new NextRequest('http://localhost:3000/api/admin/imports'))).json()) as
      { imports: { id: string }[] };
    expect(hist.imports.map((i) => i.id)).not.toContain(idAbstention);

    const fiche = (await (await socle.GET(new NextRequest('http://localhost:3000/api/admin/espaces/socle'))).json()) as
      { jeux: { id: string; type: string; nb_lignes: number }[] };
    expect(fiche.jeux.find((j) => j.id === idAbstention)).toMatchObject({ type: 'indicateur', nb_lignes: 6186 });
  });
});
