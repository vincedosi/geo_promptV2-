/**
 * sql/264 — les panneaux d'un plan OOH (`source like 'plan-ooh:%'`) partent avec leur source privée. Sans le
 * déclencheur, `data_source_id` passait à null (`on delete set null`) et `source_visible(null)` les rendait lisibles
 * par tous les espaces. Trois cas : la source seule, l'espace entier (cascades), et une source qui n'est PAS de plan
 * (comportement inchangé : `set null`).
 * Données SYNTHÉTIQUES écrites par `ecrirePlan` (aucun appel réseau).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ecrirePlan, sourcePanneaux, type EntreeEcriture } from '@/lib/ooh/plan/ecrire';
import type { EmplacementPlace, LignePlan } from '@/types/campagnes-media';
import { creerClientTest } from './_client';

const admin = creerClientTest();
const T = Date.now();
const espaces: string[] = [];
const sourcesHorsPlan: string[] = [];
/** Les `source` de panneaux de plan écrites par ce fichier, pour le nettoyage. */
const sourcesPlan: string[] = [];
const SOURCE_HORS_PLAN = `essai-sql264-hors-plan-${T}`;

const ligne: LignePlan = {
  ordre: 1, media: 'ooh', regie: 'BASIC FIT', reseau: 'DOOH SALLE', territoire: null, nb_ecrans: 2, format: 'DOOH',
  nb_diffusions: null, date_debut: '2026-09-20', date_fin: '2026-10-03', duree_libelle: null, rang_option: null,
  plage_horaire: null, montant_brut: null, montant_net: null, frais: null, honoraires: null, total_ttc: null,
  contacts_15_plus: null, contacts_18_24: null, details: {},
};

const club = (code: string): EmplacementPlace => ({
  adaptateur: 'basic-fit', cle: code, nom_lieu: `Basic-Fit Essai ${code}`, type_lieu: 'salle de sport', reseau: 'DOOH salle de sport',
  numerique: true, nb_ecrans: 1, formats: [], adresse: null, code_postal: null, ville: null, reference_panneau: code,
  contacts_semaine: null, contacts_18_25_semaine: null,
  recherche: { type: 'adresse', adresse: 'Rue Essai', code_postal: null, ville: 'Villetest', commune_seule: false },
  metadata: { onglet: 'LISTING BASIC FIT', lignes: [] }, source_ref: code, lat: 47.9, lng: 1.9, code_insee: null, code_departement: null,
  geoloc_methode: 'adresse_ban', geoloc_qualite: 'sure', geoloc_score: 0.9, geoloc_libelle: 'Rue Essai Villetest',
});

const entree = (organizationId: string, cle: string): EntreeEcriture => ({
  organizationId,
  campagne: { nom: '[ESSAI] sql/264', annonceur: null, vague: null, cle_import: cle, date_debut: null, date_fin: null, budget_total_ttc: null, metadata: {} },
  lignes: [ligne],
  emplacements: new Map([[1, { adaptateur: 'basic-fit' as const, places: [club('1'), club('2')], non_places: [] }]]),
});

async function creerEspace(nom: string): Promise<string> {
  const { data, error } = await admin.from('organizations')
    .insert({ name: `[ESSAI sql264] ${nom}`, slug: `essai-sql264-${nom}-${T}` }).select('id').single();
  if (error || !data) throw new Error(`espace : ${error?.message}`);
  espaces.push(data.id as string);
  return data.id as string;
}

async function compterPanneaux(source: string): Promise<number> {
  const { count, error } = await admin.from('panneaux_affichage').select('id', { count: 'exact', head: true }).eq('source', source);
  if (error) throw new Error(error.message);
  return count ?? -1;
}

let espaceA = '';

beforeAll(async () => {
  espaceA = await creerEspace('a');
});

// Nettoyage jusqu'au bout, erreurs réunies et levées à la fin.
afterAll(async () => {
  const erreurs: string[] = [];
  const { error: e0 } = await admin.from('panneaux_affichage').delete().eq('source', SOURCE_HORS_PLAN);
  if (e0) erreurs.push(`panneaux hors plan : ${e0.message}`);
  if (sourcesHorsPlan.length > 0) {
    const { error } = await admin.from('data_sources').delete().in('id', sourcesHorsPlan);
    if (error) erreurs.push(`sources hors plan : ${error.message}`);
  }
  if (sourcesPlan.length > 0) {
    const { error: e1 } = await admin.from('panneaux_affichage').delete().in('source', sourcesPlan);
    if (e1) erreurs.push(`panneaux de plan : ${e1.message}`);
  }
  if (espaces.length > 0) {
    const { error } = await admin.from('organizations').delete().in('id', espaces);
    if (error) erreurs.push(`espaces : ${error.message}`);
  }
  if (erreurs.length > 0) throw new Error(`nettoyage incomplet — ${erreurs.join(' ; ')}`);
});

describe('sql/264 — panneaux de plan et suppression de leur source', () => {
  it('supprimer la source privée retire ses panneaux et leurs liens ; la ligne reste, sans source', async () => {
    const cle = `essai-sql264-source-${T}`;
    sourcesPlan.push(sourcePanneaux(cle, 'basic-fit'));
    const bilan = await ecrirePlan(admin, entree(espaceA, cle));
    expect(bilan).toMatchObject({ panneaux_ecrits: 2, liens: 2, erreurs: [] });
    const source = sourcePanneaux(cle, 'basic-fit');
    const { data: l, error: eL } = await admin.from('campagne_lignes').select('id, data_source_id').eq('campagne_id', bilan.campagne_id).single();
    expect(eL).toBeNull();

    const { error } = await admin.from('data_sources').delete().eq('id', l!.data_source_id);
    expect(error).toBeNull();

    expect(await compterPanneaux(source)).toBe(0);
    const { count: liens, error: eLiens } = await admin.from('campagne_ligne_panneaux').select('panneau_id', { count: 'exact', head: true }).eq('ligne_id', l!.id);
    expect(eLiens).toBeNull();
    expect(liens).toBe(0);
    const { data: apres, error: eApres } = await admin.from('campagne_lignes').select('id, data_source_id').eq('id', l!.id).single();
    expect(eApres).toBeNull();
    expect(apres!.data_source_id).toBeNull();
  });

  it('supprimer l espace entier : aucune erreur, aucun panneau de plan ne reste', async () => {
    const espaceB = await creerEspace('b');
    const cle = `essai-sql264-espace-${T}`;
    sourcesPlan.push(sourcePanneaux(cle, 'basic-fit'));
    const bilan = await ecrirePlan(admin, entree(espaceB, cle));
    expect(bilan).toMatchObject({ panneaux_ecrits: 2, liens: 2, erreurs: [] });

    const { error } = await admin.from('organizations').delete().eq('id', espaceB);
    expect(error).toBeNull();

    expect(await compterPanneaux(sourcePanneaux(cle, 'basic-fit'))).toBe(0);
    const { count: campagnes } = await admin.from('campagnes').select('id', { count: 'exact', head: true }).eq('id', bilan.campagne_id);
    expect(campagnes).toBe(0);
  });

  it('une source qui n est pas de plan garde l ancien comportement : ses panneaux restent, sans source', async () => {
    const { data: ds, error: eDs } = await admin.from('data_sources')
      .insert({ organization_id: espaceA, name: '[ESSAI sql264] hors plan', type: 'panneaux', visibilite: 'privee' }).select('id').single();
    expect(eDs).toBeNull();
    sourcesHorsPlan.push(ds!.id as string);
    const { error: eP } = await admin.from('panneaux_affichage')
      .insert({ lat: 48.1, lng: -1.6, source: SOURCE_HORS_PLAN, source_ref: '1', data_source_id: ds!.id, organization_id: espaceA });
    expect(eP).toBeNull();

    const { error } = await admin.from('data_sources').delete().eq('id', ds!.id);
    expect(error).toBeNull();

    const { data: p, error: eLu } = await admin.from('panneaux_affichage').select('data_source_id').eq('source', SOURCE_HORS_PLAN);
    expect(eLu).toBeNull();
    expect(p).toEqual([{ data_source_id: null }]);
  });
});
