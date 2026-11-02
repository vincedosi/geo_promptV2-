/**
 * B15 (sql/320) contre la vraie base locale : l'exactitude PAR COMPOSITION.
 *
 * - `zone_seuil_territoire` rend les codes retenus (triés), autant que `compte` ;
 * - round 1 (I-2, sql/321) : les unités vivent dans la COLONNE `custom_geo_zones.unites_constitutives`, jamais dans le
 *   JSON `recette` (que d'autres branches relisent en `.strict()`) ; le trigger y déplace une clé reçue dans la recette ;
 * - le trigger d'écriture dérive les unités d'une liste de CP, compte les groupes de CP indiscernables présents EN
 *   PARTIE (Rennes : 35000, 35200, 35700 — sql/228), écrase la valeur du client, retire la clé d'une recette qui n'en
 *   porte pas ;
 * - `remplacer_geometrie_zone_unites` remplace forme ET unités dans la même transaction ;
 * - relue par le schéma serveur, la recette est exacte au CP seulement sans groupe partiel.
 *
 * Un espace `[ESSAI B15]` est créé puis supprimé (ses zones partent en cascade).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerClientTest } from './_client';
import { exactitude } from '@/lib/zones/conversion';
import { lireRecette, recetteVue } from '@/lib/zones/recette-schema';
import { psql } from './_psql';
import type { Recette } from '@/lib/zones/recette';

const sb = creerClientTest();
const LONG = 120_000;
const RENNES_ENTIER = ['35000', '35200', '35700'];
let org = '';

async function formeDe(codes: string[]): Promise<string> {
  const { data, error } = await sb.rpc('get_admin_filter_geometry', { p_scale: 'cp', p_codes: codes });
  if (error) throw new Error(error.message);
  return JSON.stringify((data as { geometry: unknown }).geometry);
}

async function creer(nom: string, recette: Record<string, unknown>, codes: string[]): Promise<string> {
  const { data, error } = await sb.rpc('creer_zone_recette', {
    p_nom: nom, p_org_id: org, p_cree_par: null, p_recette: recette, p_geometry_geojson: await formeDe(codes),
  });
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

async function ligne(id: string): Promise<{ recette: Record<string, unknown>; unites: unknown }> {
  const { data, error } = await sb.from('custom_geo_zones').select('recette, unites_constitutives').eq('id', id).single();
  if (error || !data) throw new Error(error?.message);
  return { recette: data.recette as Record<string, unknown>, unites: data.unites_constitutives };
}

/** La colonne ; et le JSON recette n'en porte JAMAIS la clé (I-2). */
async function brute(id: string): Promise<{ unites_constitutives: unknown }> {
  const l = await ligne(id);
  expect(l.recette).not.toHaveProperty('unites_constitutives');
  return { unites_constitutives: l.unites };
}

async function recetteDe(id: string): Promise<Recette> {
  const l = await ligne(id);
  const lue = lireRecette(recetteVue(l.recette, l.unites));
  if (!lue.ok) throw new Error(lue.message);
  return lue.recette;
}

const SCORE = { indicateurs: [{ code: 'taux_pauvrete', poids: 1, sens: 'croissant' }], maille: 'cp', seuil_score: 60 };

beforeAll(async () => {
  const o = await sb.from('organizations').insert({ name: '[ESSAI B15] unités constitutives', slug: `essai-b15-${Date.now()}` }).select('id').single();
  if (o.error || !o.data) throw new Error(o.error?.message);
  org = o.data.id as string;
}, LONG);

afterAll(async () => {
  if (!org) return;
  const { error } = await sb.from('organizations').delete().eq('id', org);
  if (error) throw new Error(`nettoyage : ${error.message}`);
}, LONG);

describe('B15 — zone_seuil_territoire rend ses codes', () => {
  it('CP : abstention ≥ 25 % dans les Bouches-du-Rhône — autant de codes que `compte`, triés', async () => {
    const { data, error } = await sb.rpc('zone_seuil_territoire', {
      p_indicateur: 'abstention_pres_2022', p_operateur: '>=', p_seuil: 25, p_perimetre_type: 'departement', p_perimetre_code: '13',
      p_org_id: null, p_max_territoires: 5000,
    });
    expect(error).toBeNull();
    const z = data as { compte: number; maille: string; codes: string[] };
    expect(z.maille).toBe('cp');
    expect(z.codes).toHaveLength(z.compte);
    expect(z.codes).toEqual([...z.codes].sort());
  }, LONG);
});

describe('B15 — le trigger pose les unités constitutives', () => {
  it('liste de CP avec un seul membre du groupe de Rennes : unités dérivées, 1 groupe partiel, non exacte', async () => {
    const id = await creer('Liste partielle', { v: 1, type: 'codes_postaux', codes: ['35000', '75001'] }, ['35000', '75001']);
    expect((await brute(id)).unites_constitutives).toEqual({ maille: 'cp', codes: ['35000', '75001'], groupes_partiels: 1 });
    expect(exactitude(await recetteDe(id), 'cp')).toBe('calculee');
  }, LONG);

  it('liste de CP avec le groupe entier : 0 groupe partiel, exacte au CP', async () => {
    const id = await creer('Liste entière', { v: 1, type: 'codes_postaux', codes: [...RENNES_ENTIER, '75001'] }, [...RENNES_ENTIER, '75001']);
    expect((await brute(id)).unites_constitutives).toEqual({ maille: 'cp', codes: [...RENNES_ENTIER, '75001'], groupes_partiels: 0 });
    expect(exactitude(await recetteDe(id), 'cp')).toBe('exacte');
  }, LONG);

  it('capture de score : un `groupes_partiels` envoyé par le client est écrasé', async () => {
    const id = await creer('Capture menteuse', {
      v: 1, type: 'capture', source_type: 'score', parametres: SCORE,
      unites_constitutives: { maille: 'cp', codes: ['35200', '75001'], groupes_partiels: 0 },
    }, ['35200', '75001']);
    expect((await brute(id)).unites_constitutives).toEqual({ maille: 'cp', codes: ['35200', '75001'], groupes_partiels: 1 });
    expect(exactitude(await recetteDe(id), 'cp')).toBe('calculee');
  }, LONG);

  it('seuil sur territoires à l’IRIS : aucun compte de groupes ; une recette sans unités n’en reçoit pas', async () => {
    const seuil = await creer('Seuil IRIS', {
      v: 1, type: 'seuil_territoire', indicateur: 'taux_pauvrete', operateur: '>=', seuil: 20, perimetre: { type: 'departement', code: '35' },
      unites_constitutives: { maille: 'iris', codes: ['352380101'], groupes_partiels: 3 },
    }, ['35000']);
    expect((await brute(seuil)).unites_constitutives).toEqual({ maille: 'iris', codes: ['352380101'] });
    const dessin = await creer('Dessin', { v: 1, type: 'dessin', unites_constitutives: { maille: 'cp', codes: ['35000'] } }, ['35000']);
    expect(await ligne(dessin)).toEqual({ recette: { v: 1, type: 'dessin' }, unites: null });
  }, LONG);

  it('remplacer_geometrie_zone_unites : forme et unités remplacées ensemble, groupes recomptés', async () => {
    const id = await creer('Seuil CP', {
      v: 1, type: 'seuil_territoire', indicateur: 'abstention_pres_2022', operateur: '>=', seuil: 25, perimetre: { type: 'departement', code: '35' },
      unites_constitutives: { maille: 'cp', codes: ['75001'] },
    }, ['75001']);
    const { data, error } = await sb.rpc('remplacer_geometrie_zone_unites', {
      p_zone_id: id, p_org_id: org, p_geometry_geojson: await formeDe(['35000']), p_unites: { maille: 'cp', codes: ['35000'] },
    });
    expect(error).toBeNull();
    expect(data).toEqual({ remplace: true });
    expect((await brute(id)).unites_constitutives).toEqual({ maille: 'cp', codes: ['35000'], groupes_partiels: 1 });
  }, LONG);
});

describe('B15 round 1 (I-2) — la colonne, sans toucher le JSON recette', () => {
  it('une liste de CP écrite par une branche sans B15 garde une recette lisible en .strict() ; la colonne est dérivée', async () => {
    const id = await creer('Liste stricte', { v: 1, type: 'codes_postaux', codes: ['75001'] }, ['75001']);
    expect((await ligne(id)).recette).toEqual({ v: 1, type: 'codes_postaux', codes: ['75001'] });
    expect((await ligne(id)).unites).toEqual({ maille: 'cp', codes: ['75001'], groupes_partiels: 0 });
  }, LONG);

  it('une forme réécrite SANS unités (recalcul d’une branche sans B15) efface celles d’un seuil : jamais périmées', async () => {
    const id = await creer('Seuil réécrit', {
      v: 1, type: 'seuil_territoire', indicateur: 'abstention_pres_2022', operateur: '>=', seuil: 25, perimetre: { type: 'departement', code: '35' },
      unites_constitutives: { maille: 'cp', codes: ['75001'] },
    }, ['75001']);
    expect((await ligne(id)).unites).toEqual({ maille: 'cp', codes: ['75001'], groupes_partiels: 0 });
    const { error } = await sb.rpc('remplacer_geometrie_zone', { p_zone_id: id, p_org_id: org, p_geometry_geojson: await formeDe(['35000']) });
    expect(error).toBeNull();
    expect((await ligne(id)).unites).toBeNull();
    // Un nom changé, la forme intacte : les unités restent.
    const autre = await creer('Seuil renommé', {
      v: 1, type: 'seuil_territoire', indicateur: 'abstention_pres_2022', operateur: '>=', seuil: 25, perimetre: { type: 'departement', code: '35' },
      unites_constitutives: { maille: 'cp', codes: ['75001'] },
    }, ['75001']);
    psql(`update public.custom_geo_zones set name = 'Renommé' where id = '${autre}';`);
    expect((await ligne(autre)).unites).toEqual({ maille: 'cp', codes: ['75001'], groupes_partiels: 0 });
  }, LONG);

  it('dupliquer_zone copie la colonne d’une capture', async () => {
    const id = await creer('Capture à copier', {
      v: 1, type: 'capture', source_type: 'score', parametres: SCORE, unites_constitutives: { maille: 'cp', codes: ['75001'] },
    }, ['75001']);
    const { data, error } = await sb.rpc('dupliquer_zone', { p_zone_id: id, p_org_id: org, p_nom: 'Copie', p_cree_par: null });
    expect(error).toBeNull();
    expect((await ligne((data as { id: string }).id)).unites).toEqual({ maille: 'cp', codes: ['75001'], groupes_partiels: 0 });
  }, LONG);

  it('codes_postaux_inconnus nomme les codes absents du référentiel, triés, sans doublon', async () => {
    const { data, error } = await sb.rpc('codes_postaux_inconnus', { p_codes: ['99998', '75001', '00000', '99998'] });
    expect(error).toBeNull();
    expect(data).toEqual(['00000', '99998']);
  }, LONG);
});
