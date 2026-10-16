/**
 * sql/261 — campagnes multi-média (spec 2026-10-16-ooh-campagnes § 4.2) : contraintes et suppressions en cascade, et
 * le RESTRICT qui interdit de supprimer en silence un panneau réservé par une campagne.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerClientTest } from './_client';

const admin = creerClientTest();
const SOURCE = `essai-campagnes-${Date.now()}`;
let org = '';
let ds = '';
let panneau = '';

beforeAll(async () => {
  const { data: o, error: eo } = await admin.from('organizations')
    .insert({ name: '[ESSAI ooh] Campagnes', slug: `essai-ooh-campagnes-${Date.now()}` }).select('id').single();
  if (eo || !o) throw new Error(`espace : ${eo?.message}`);
  org = o.id as string;
  const { data: d, error: ed } = await admin.from('data_sources')
    .insert({ organization_id: org, name: '[ESSAI ooh] source', type: 'panneaux', visibilite: 'privee' }).select('id').single();
  if (ed || !d) throw new Error(`source : ${ed?.message}`);
  ds = d.id as string;
  const { data: p, error: ep } = await admin.from('panneaux_affichage')
    .insert({ lat: 47.9, lng: 1.9, source: SOURCE, source_ref: '1', data_source_id: ds, organization_id: org }).select('id').single();
  if (ep || !p) throw new Error(`panneau : ${ep?.message}`);
  panneau = p.id as string;
});

afterAll(async () => {
  const { error: e1 } = await admin.from('campagnes').delete().eq('organization_id', org);
  if (e1) throw new Error(`nettoyage campagnes : ${e1.message}`);
  const { error: e2 } = await admin.from('panneaux_affichage').delete().eq('source', SOURCE);
  if (e2) throw new Error(`nettoyage panneaux : ${e2.message}`);
  const { error: e3 } = await admin.from('organizations').delete().eq('id', org);
  if (e3) throw new Error(`nettoyage espace : ${e3.message}`);
});

async function creerCampagne(cle: string | null): Promise<string> {
  const { data, error } = await admin.from('campagnes')
    .insert({ organization_id: org, nom: `[ESSAI] ${cle ?? 'sans clé'}`, cle_import: cle }).select('id').single();
  if (error || !data) throw new Error(`campagne : ${error?.message}`);
  return data.id as string;
}

describe('sql/261 — campagnes, lignes, panneaux de ligne', () => {
  it('une clé d import est unique dans un espace ; sans clé, rien n est contraint', async () => {
    await creerCampagne('essai-unique');
    const { error } = await admin.from('campagnes').insert({ organization_id: org, nom: 'doublon', cle_import: 'essai-unique' });
    expect(error?.code).toBe('23505');
    await creerCampagne(null);
    await creerCampagne(null);
  });

  it('le média d une ligne est l un des cinq, l ordre est unique dans la campagne', async () => {
    const c = await creerCampagne('essai-media');
    const { error: e1 } = await admin.from('campagne_lignes').insert({ campagne_id: c, media: 'affichage', ordre: 1 });
    expect(e1?.code).toBe('23514');
    for (const media of ['digital', 'ooh', 'tv', 'radio', 'presse']) {
      const { error } = await admin.from('campagne_lignes').insert({ campagne_id: c, media, ordre: ['digital', 'ooh', 'tv', 'radio', 'presse'].indexOf(media) + 1 });
      expect(error, media).toBeNull();
    }
    const { error: e2 } = await admin.from('campagne_lignes').insert({ campagne_id: c, media: 'ooh', ordre: 1 });
    expect(e2?.code).toBe('23505');
  });

  it('une date de fin avant le début est refusée', async () => {
    const { error } = await admin.from('campagnes')
      .insert({ organization_id: org, nom: 'dates', date_debut: '2026-09-20', date_fin: '2026-09-19' });
    expect(error?.code).toBe('23514');
  });

  it('supprimer une campagne emporte ses lignes et leurs panneaux de ligne, pas les panneaux', async () => {
    const c = await creerCampagne('essai-cascade');
    const { data: l, error: el } = await admin.from('campagne_lignes')
      .insert({ campagne_id: c, media: 'ooh', ordre: 1, data_source_id: ds }).select('id').single();
    if (el || !l) throw new Error(`ligne : ${el?.message}`);
    const { error: elien } = await admin.from('campagne_ligne_panneaux').insert({ ligne_id: l.id, panneau_id: panneau, nb_ecrans: 2, formats: ['WW'] });
    expect(elien).toBeNull();
    const { error: ed } = await admin.from('campagnes').delete().eq('id', c);
    expect(ed).toBeNull();
    const { data: liens } = await admin.from('campagne_ligne_panneaux').select('ligne_id').eq('ligne_id', l.id);
    expect(liens).toEqual([]);
    const { data: restant } = await admin.from('panneaux_affichage').select('id').eq('id', panneau);
    expect(restant).toHaveLength(1);
  });

  it('un panneau réservé par une campagne ne se supprime pas en silence (RESTRICT)', async () => {
    const c = await creerCampagne('essai-restrict');
    const { data: l } = await admin.from('campagne_lignes').insert({ campagne_id: c, media: 'ooh', ordre: 1 }).select('id').single();
    await admin.from('campagne_ligne_panneaux').insert({ ligne_id: l!.id, panneau_id: panneau });
    const { error } = await admin.from('panneaux_affichage').delete().eq('id', panneau);
    expect(error?.code).toBe('23503');
    const { error: ed } = await admin.from('campagnes').delete().eq('id', c);
    expect(ed).toBeNull();
  });

  it('updated_at suit la dernière modification', async () => {
    const c = await creerCampagne('essai-maj');
    const { data: avant } = await admin.from('campagnes').select('updated_at').eq('id', c).single();
    await new Promise((r) => setTimeout(r, 20));
    await admin.from('campagnes').update({ vague: 'TF4' }).eq('id', c);
    const { data: apres } = await admin.from('campagnes').select('updated_at').eq('id', c).single();
    expect(new Date(apres!.updated_at as string).getTime()).toBeGreaterThan(new Date(avant!.updated_at as string).getTime());
  });
});
