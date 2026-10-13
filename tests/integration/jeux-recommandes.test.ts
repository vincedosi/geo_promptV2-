/**
 * La sélection recommandée d'un espace (spec carte-en-parcours § 7.2) : une RPC qui REMPLACE la liste en une
 * transaction (jamais un DELETE suivi d'un INSERT côté route, qui doublerait ou viderait sur une erreur à moitié).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { creerClientTest } from './_client';

const admin = creerClientTest();
let org = '';

async function remplacer(cles: string[]) {
  return admin.rpc('remplacer_jeux_recommandes', { p_organization_id: org, p_cles: cles });
}
async function lire(): Promise<string[]> {
  const { data, error } = await admin.from('espace_jeux_recommandes').select('cle_jeu').eq('organization_id', org).order('cle_jeu');
  if (error) throw new Error(error.message);
  return (data ?? []).map((l) => l.cle_jeu as string);
}

beforeAll(async () => {
  const { data, error } = await admin.from('organizations')
    .insert({ name: '[ESSAI parcours] Recommandés', slug: `essai-parcours-reco-${Date.now()}` }).select('id').single();
  if (error || !data) throw new Error(`création de l'espace : ${error?.message}`);
  org = data.id as string;
});
afterAll(async () => {
  const { error } = await admin.from('organizations').delete().eq('id', org);
  if (error) throw new Error(`nettoyage : ${error.message}`);
});

describe('remplacer_jeux_recommandes', () => {
  it('remplace, dédoublonne et trie', async () => {
    const { data, error } = await remplacer(['poi:lycee', 'iris:socio-demo', 'poi:lycee']);
    expect(error).toBeNull();
    expect(data).toEqual({ cles: ['iris:socio-demo', 'poi:lycee'] });
    expect(await lire()).toEqual(['iris:socio-demo', 'poi:lycee']);
  });
  it('une seconde liste REMPLACE la première', async () => {
    await remplacer(['tmja:comptages']);
    expect(await lire()).toEqual(['tmja:comptages']);
  });
  it('une clé mal formée est refusée et la liste précédente reste intacte (transaction)', async () => {
    await remplacer(['iris:socio-demo']);
    const { error } = await remplacer(['iris:socio-demo', 'Pas Une Clé']);
    expect(error?.code).toBe('23514');
    expect(await lire()).toEqual(['iris:socio-demo']);
  });
  it('plus de 200 clés : refusé', async () => {
    const { error } = await remplacer(Array.from({ length: 201 }, (_, i) => `poi:c${i}`));
    expect(error?.code).toBe('22023');
  });
  it('une liste vide efface tout', async () => {
    await remplacer([]);
    expect(await lire()).toEqual([]);
  });
  it('supprimer l’espace emporte ses recommandations', async () => {
    const { data } = await admin.from('organizations')
      .insert({ name: '[ESSAI parcours] Cascade', slug: `essai-parcours-cascade-${Date.now()}` }).select('id').single();
    const id = data!.id as string;
    await admin.rpc('remplacer_jeux_recommandes', { p_organization_id: id, p_cles: ['meteo:zones'] });
    const { error } = await admin.from('organizations').delete().eq('id', id);
    expect(error).toBeNull();
    const { count } = await admin.from('espace_jeux_recommandes').select('cle_jeu', { count: 'exact', head: true }).eq('organization_id', id);
    expect(count).toBe(0);
  });
});
