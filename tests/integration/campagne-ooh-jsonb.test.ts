/**
 * sql/263 — lecture d'une campagne OOH en UN scalaire jsonb (spec 2026-10-16-ooh-campagnes § 4.5) : TF4 dépasse les
 * 1 000 lignes que PostgREST laisse passer d'une RPC tabulaire. On vérifie la forme, le cloisonnement par `p_org` et la
 * borne écrite (`p_limite + 1` lus, `tronque`).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerClientTest } from './_client';

const admin = creerClientTest();
const SOURCE = `essai-ooh-jsonb-${Date.now()}`;
let orgA = '';
let orgB = '';
let campagne = '';
let ligneGares = '';
let ligneDrom = '';

async function espace(nom: string): Promise<string> {
  const { data, error } = await admin.from('organizations')
    .insert({ name: `[ESSAI ooh] ${nom}`, slug: `essai-ooh-jsonb-${nom}-${Date.now()}` }).select('id').single();
  if (error || !data) throw new Error(`espace ${nom} : ${error?.message}`);
  return data.id as string;
}

beforeAll(async () => {
  orgA = await espace('a');
  orgB = await espace('b');
  const { data: ds } = await admin.from('data_sources')
    .insert({ organization_id: orgA, name: '[ESSAI] gares', type: 'panneaux', visibilite: 'privee' }).select('id').single();
  const { data: c } = await admin.from('campagnes').insert({
    organization_id: orgA, nom: '[ESSAI] Campagne A', vague: 'V1', date_debut: '2026-09-20', date_fin: '2026-10-02', cle_import: SOURCE,
  }).select('id').single();
  campagne = c!.id as string;
  const { data: lignes } = await admin.from('campagne_lignes').insert([
    { campagne_id: campagne, media: 'ooh', ordre: 1, regie: 'MEDIATRANSPORTS', reseau: 'DOOH GARE', nb_ecrans: 6, data_source_id: ds!.id,
      details: { non_places: [{ nom: 'GARE INCONNUE', raison: 'gare introuvable dans le référentiel SNCF' }], nb_lieux_plan: 4, unite_lieux_plan: 'gares' } },
    { campagne_id: campagne, media: 'ooh', ordre: 2, regie: 'MEDIAOUTREMER', territoire: 'LA REUNION', nb_ecrans: 200, details: {} },
    { campagne_id: campagne, media: 'tv', ordre: 3, regie: 'CHAINE', details: {} },
  ]).select('id, ordre');
  ligneGares = lignes!.find((l) => l.ordre === 1)!.id as string;
  ligneDrom = lignes!.find((l) => l.ordre === 2)!.id as string;
  const { data: panneaux } = await admin.from('panneaux_affichage').insert([1, 2, 3].map((i) => ({
    lat: 48 + i / 100, lng: 2 + i / 100, source: SOURCE, source_ref: String(i), data_source_id: ds!.id, organization_id: orgA,
    nom_lieu: `Gare ${i}`, reseau: 'DOOH gare', type_lieu: 'gare', numerique: true, nb_ecrans: 2, formats: ['solo 9/16'],
    geoloc_methode: 'referentiel_gares', geoloc_qualite: i === 3 ? 'a_verifier' : 'sure', geoloc_score: 1,
    metadata: { onglet: 'LISTING GARE', lignes: [{ numero: 5 + i, cellules: { SITES: `GARE ${i}` } }] },
  }))).select('id');
  await admin.from('campagne_ligne_panneaux').insert(panneaux!.map((p) => ({ ligne_id: ligneGares, panneau_id: p.id, nb_ecrans: 2 })));
  // Une campagne sans ligne OOH : absente de la liste.
  await admin.from('campagnes').insert({ organization_id: orgA, nom: '[ESSAI] TV seule', cle_import: `${SOURCE}-tv` })
    .select('id').single().then(async ({ data }) => { await admin.from('campagne_lignes').insert({ campagne_id: data!.id, media: 'tv', ordre: 1 }); });
});

afterAll(async () => {
  for (const org of [orgA, orgB]) {
    const { error } = await admin.from('campagnes').delete().eq('organization_id', org);
    if (error) throw new Error(`nettoyage campagnes : ${error.message}`);
  }
  const { error: ep } = await admin.from('panneaux_affichage').delete().eq('source', SOURCE);
  if (ep) throw new Error(`nettoyage panneaux : ${ep.message}`);
  for (const org of [orgA, orgB]) {
    const { error } = await admin.from('organizations').delete().eq('id', org);
    if (error) throw new Error(`nettoyage espace : ${error.message}`);
  }
});

describe('campagne_ooh_jsonb', () => {
  it('rend la campagne, ses lignes OOH dans l ordre du plan et ses emplacements en GeoJSON', async () => {
    const { data, error } = await admin.rpc('campagne_ooh_jsonb', { p_campagne: campagne, p_org: orgA });
    expect(error).toBeNull();
    expect(data.campagne).toMatchObject({ id: campagne, nom: '[ESSAI] Campagne A', vague: 'V1', date_debut: '2026-09-20', date_fin: '2026-10-02' });
    expect(data.lignes.map((l: { ordre: number }) => l.ordre)).toEqual([1, 2]);
    expect(data.lignes[0]).toMatchObject({
      id: ligneGares, media: 'ooh', regie: 'MEDIATRANSPORTS', a_des_emplacements: true, nb_places: 3, nb_a_verifier: 1, nb_non_places: 1,
    });
    expect(data.lignes[1]).toMatchObject({ id: ligneDrom, territoire: 'LA REUNION', a_des_emplacements: false, nb_places: 0, nb_non_places: 0 });
    expect(data.emplacements).toHaveLength(3);
    expect(data.emplacements[0].geometry.type).toBe('Point');
    expect(data.emplacements[0].properties).toMatchObject({ ligne_id: ligneGares, reseau: 'DOOH gare', nb_ecrans: 2, formats: ['solo 9/16'] });
    expect(data.emplacements[0].properties.metadata.onglet).toBe('LISTING GARE');
    expect(data.tronque).toBe(false);
  });

  it('une campagne d un autre espace rend null', async () => {
    const { data, error } = await admin.rpc('campagne_ooh_jsonb', { p_campagne: campagne, p_org: orgB });
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it('au-delà de la borne : p_limite emplacements et tronque', async () => {
    const { data } = await admin.rpc('campagne_ooh_jsonb', { p_campagne: campagne, p_org: orgA, p_limite: 2 });
    expect(data.emplacements).toHaveLength(2);
    expect(data.tronque).toBe(true);
  });

  it('une borne nulle ou négative est refusée', async () => {
    const { error } = await admin.rpc('campagne_ooh_jsonb', { p_campagne: campagne, p_org: orgA, p_limite: 0 });
    expect(error?.code).toBe('22023');
  });
});

describe('campagnes_ooh_jsonb', () => {
  it('les campagnes de l espace ayant une ligne OOH, avec leurs lignes OOH seules', async () => {
    const { data, error } = await admin.rpc('campagnes_ooh_jsonb', { p_org: orgA });
    expect(error).toBeNull();
    expect(data.tronque).toBe(false);
    expect(data.campagnes).toHaveLength(1);
    expect(data.campagnes[0]).toMatchObject({ id: campagne, nom: '[ESSAI] Campagne A' });
    expect(data.campagnes[0].lignes).toEqual([
      { id: ligneGares, ordre: 1, media: 'ooh', regie: 'MEDIATRANSPORTS', reseau: 'DOOH GARE', territoire: null, nb_ecrans: 6, nb_places: 3, nb_non_places: 1 },
      { id: ligneDrom, ordre: 2, media: 'ooh', regie: 'MEDIAOUTREMER', reseau: null, territoire: 'LA REUNION', nb_ecrans: 200, nb_places: 0, nb_non_places: 0 },
    ]);
  });

  it('un autre espace ne voit rien', async () => {
    const { data } = await admin.rpc('campagnes_ooh_jsonb', { p_org: orgB });
    expect(data).toEqual({ campagnes: [], tronque: false });
  });

  it('borne : tronque quand l espace a plus de campagnes OOH', async () => {
    const { data: c } = await admin.from('campagnes').insert({ organization_id: orgA, nom: '[ESSAI] Seconde', cle_import: `${SOURCE}-2` }).select('id').single();
    await admin.from('campagne_lignes').insert({ campagne_id: c!.id, media: 'ooh', ordre: 1 });
    const { data } = await admin.rpc('campagnes_ooh_jsonb', { p_org: orgA, p_limite: 1 });
    expect(data.campagnes).toHaveLength(1);
    expect(data.tronque).toBe(true);
  });
});
