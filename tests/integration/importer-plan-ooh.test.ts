/**
 * Écriture d'un plan OOH en base (spec 2026-10-16-ooh-campagnes § 4.4, § 7) : campagne retrouvée par
 * (espace, cle_import), lignes et liens REMPLACÉS au rejeu, panneaux upsertés sur (source, source_ref) avec les mêmes
 * id, source PRIVÉE de l'espace par réseau, emplacement disparu de la liste retiré de la table.
 * Entrée SYNTHÉTIQUE, déjà géolocalisée : aucun appel réseau.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ecrirePlan, sourcePanneaux, type EntreeEcriture } from '@/lib/ooh/plan/ecrire';
import type { EmplacementPlace, LignePlan } from '@/types/campagnes-media';
import { creerClientTest } from './_client';

const admin = creerClientTest();
const CLE = `essai-ecriture-${Date.now()}`;
const SOURCE = sourcePanneaux(CLE, 'basic-fit');
let org = '';
let autreOrg = '';

const ligne = (ordre: number, regie: string, territoire: string | null = null): LignePlan => ({
  ordre, media: 'ooh', regie, reseau: territoire ? null : 'DOOH SALLE', territoire, nb_ecrans: 10, format: 'DOOH',
  nb_diffusions: 100, date_debut: '2026-09-20', date_fin: '2026-10-03', duree_libelle: '2 semaines', rang_option: '2nd OPTION',
  plage_horaire: null, montant_brut: 10, montant_net: 5, frais: 1, honoraires: 1, total_ttc: 8,
  contacts_15_plus: 1000, contacts_18_24: 200, details: { onglet: 'HYP1', ligne: 4 + ordre },
});

const club = (code: string, qualite: 'sure' | 'a_verifier' = 'sure'): EmplacementPlace => ({
  adaptateur: 'basic-fit', cle: code, nom_lieu: `Basic-Fit Essai ${code}`, type_lieu: 'salle de sport', reseau: 'DOOH salle de sport',
  numerique: true, nb_ecrans: 2, formats: ['WW', 'NC'], adresse: 'Rue Essai', code_postal: null, ville: 'Villetest',
  reference_panneau: code, contacts_semaine: null, contacts_18_25_semaine: null,
  recherche: { type: 'adresse', adresse: 'Rue Essai', code_postal: null, ville: 'Villetest', commune_seule: false },
  metadata: { onglet: 'LISTING BASIC FIT', club: code, lignes: [{ numero: 2, cellules: { 'CLub name': `Basic-Fit FR Villetest Rue Essai ${code} WW` } }] },
  source_ref: code, lat: 47.9 + Number(code) / 100000, lng: 1.9, code_insee: '45234', code_departement: '45',
  geoloc_methode: 'adresse_ban', geoloc_qualite: qualite, geoloc_score: qualite === 'sure' ? 0.9 : 0.45, geoloc_libelle: 'Rue Essai 45000 Villetest',
});

function entree(codes: string[], organizationId = org): EntreeEcriture {
  return {
    organizationId,
    campagne: { nom: '[ESSAI] Campagne écrite', annonceur: 'Annonceur essai', vague: 'V1', cle_import: CLE, date_debut: '2026-09-20', date_fin: '2026-10-02', budget_total_ttc: 100, metadata: { fichier: 'essai.xlsx' } },
    lignes: [ligne(1, 'BASIC FIT'), ligne(2, 'MEDIAOUTREMER', 'LA REUNION')],
    emplacements: new Map([[1, {
      adaptateur: 'basic-fit' as const,
      places: codes.map((c, i) => club(c, i === 0 ? 'a_verifier' : 'sure')),
      non_places: [{ adaptateur: 'basic-fit' as const, cle: '9999', nom: 'Basic-Fit Essai introuvable', raison: 'adresse introuvable (BAN)', metadata: { onglet: 'LISTING BASIC FIT', lignes: [] } }],
    }]]),
  };
}

async function idsPanneaux(): Promise<Record<string, string>> {
  const { data, error } = await admin.from('panneaux_affichage').select('id, source_ref').eq('source', SOURCE);
  if (error) throw new Error(error.message);
  return Object.fromEntries((data ?? []).map((p) => [p.source_ref as string, p.id as string]));
}

/**
 * Chaque lien ligne ↔ panneau pointe sur un panneau de la source PRIVÉE de sa ligne, dans l'espace de sa campagne.
 * La base ne le vérifie pas (aucune contrainte croisée) : c'est à l'écrivain de le garantir.
 */
async function verifierAppartenanceDesLiens(campagneId: string): Promise<number> {
  const { data: lignes, error: eL } = await admin.from('campagne_lignes').select('id, data_source_id, campagnes!inner(organization_id)').eq('campagne_id', campagneId);
  if (eL) throw new Error(eL.message);
  let n = 0;
  for (const l of lignes ?? []) {
    const orgCampagne = (l.campagnes as unknown as { organization_id: string }).organization_id;
    const { data: liens, error } = await admin.from('campagne_ligne_panneaux')
      .select('panneau_id, panneaux_affichage!inner(data_source_id, organization_id)').eq('ligne_id', l.id);
    if (error) throw new Error(error.message);
    for (const lien of liens ?? []) {
      const p = lien.panneaux_affichage as unknown as { data_source_id: string; organization_id: string };
      expect(p.data_source_id).toBe(l.data_source_id);
      expect(p.organization_id).toBe(orgCampagne);
      n++;
    }
  }
  return n;
}

async function creerEspace(nom: string): Promise<string> {
  const { data, error } = await admin.from('organizations')
    .insert({ name: `[ESSAI ooh] ${nom}`, slug: `essai-ooh-${nom.toLowerCase()}-${Date.now()}` }).select('id').single();
  if (error || !data) throw new Error(`espace : ${error?.message}`);
  return data.id as string;
}

beforeAll(async () => {
  org = await creerEspace('Ecriture');
  autreOrg = await creerEspace('Voisin');
});

// Le nettoyage va jusqu'au bout même si une étape échoue : les erreurs sont réunies et levées à la fin.
afterAll(async () => {
  const erreurs: string[] = [];
  const espaces = [org, autreOrg].filter((id) => id !== '');
  if (espaces.length > 0) {
    const { error: e1 } = await admin.from('campagnes').delete().in('organization_id', espaces);
    if (e1) erreurs.push(`campagnes : ${e1.message}`);
  }
  const { error: e2 } = await admin.from('panneaux_affichage').delete().eq('source', SOURCE);
  if (e2) erreurs.push(`panneaux : ${e2.message}`);
  if (espaces.length > 0) {
    const { error: e3 } = await admin.from('organizations').delete().in('id', espaces);
    if (e3) erreurs.push(`espaces : ${e3.message}`);
  }
  if (erreurs.length > 0) throw new Error(`nettoyage incomplet — ${erreurs.join(' ; ')}`);
});

describe('ecrirePlan', () => {
  let campagne = '';
  let premiersIds: Record<string, string> = {};

  it('première écriture : campagne, deux lignes, une source privée, trois panneaux, trois liens', async () => {
    const bilan = await ecrirePlan(admin, entree(['1001', '1002', '1003']));
    expect(bilan).toMatchObject({ lignes: 2, panneaux_ecrits: 3, liens: 3, panneaux_retires: 0, erreurs: [] });
    campagne = bilan.campagne_id;
    const { data: lignes } = await admin.from('campagne_lignes').select('ordre, regie, territoire, data_source_id, details').eq('campagne_id', campagne).order('ordre');
    expect(lignes).toHaveLength(2);
    expect(lignes![0].data_source_id).not.toBeNull();
    expect(lignes![1]).toMatchObject({ regie: 'MEDIAOUTREMER', territoire: 'LA REUNION', data_source_id: null });
    expect((lignes![0].details as { non_places: unknown[] }).non_places).toEqual([{ nom: 'Basic-Fit Essai introuvable', raison: 'adresse introuvable (BAN)' }]);
    const { data: ds } = await admin.from('data_sources').select('organization_id, visibilite, type').eq('id', lignes![0].data_source_id).single();
    expect(ds).toEqual({ organization_id: org, visibilite: 'privee', type: 'panneaux' });
    const { data: p } = await admin.from('panneaux_affichage')
      .select('organization_id, data_source_id, regie, reseau, nom_lieu, nb_ecrans, nb_faces, formats, geoloc_qualite, reference_panneau, metadata')
      .eq('source', SOURCE).eq('source_ref', '1001').single();
    expect(p).toMatchObject({
      organization_id: org, data_source_id: lignes![0].data_source_id, regie: 'BASIC FIT', reseau: 'DOOH salle de sport',
      nom_lieu: 'Basic-Fit Essai 1001', nb_ecrans: 2, nb_faces: 2, formats: ['WW', 'NC'], geoloc_qualite: 'a_verifier', reference_panneau: '1001',
    });
    expect((p!.metadata as { onglet: string }).onglet).toBe('LISTING BASIC FIT');
    expect(await verifierAppartenanceDesLiens(campagne)).toBe(3);
    premiersIds = await idsPanneaux();
  });

  it('rejeu identique : même campagne, mêmes id de panneaux, lignes et liens remplacés', async () => {
    const bilan = await ecrirePlan(admin, entree(['1001', '1002', '1003']));
    expect(bilan.campagne_id).toBe(campagne);
    expect(bilan).toMatchObject({ lignes: 2, panneaux_ecrits: 3, liens: 3, panneaux_retires: 0, erreurs: [] });
    expect(await idsPanneaux()).toEqual(premiersIds);
    const { count } = await admin.from('campagne_lignes').select('id', { count: 'exact', head: true }).eq('campagne_id', campagne);
    expect(count).toBe(2);
    expect(await verifierAppartenanceDesLiens(campagne)).toBe(3);
  });

  it('rejeu sans un emplacement : son panneau quitte la table, les autres gardent leur id', async () => {
    const bilan = await ecrirePlan(admin, entree(['1001', '1003']));
    expect(bilan).toMatchObject({ panneaux_ecrits: 2, liens: 2, panneaux_retires: 1, erreurs: [] });
    const ids = await idsPanneaux();
    expect(ids).toEqual({ '1001': premiersIds['1001'], '1003': premiersIds['1003'] });
    expect(await verifierAppartenanceDesLiens(campagne)).toBe(2);
  });

  it('un panneau réservé ne se supprime pas en silence', async () => {
    const ids = await idsPanneaux();
    const { error } = await admin.from('panneaux_affichage').delete().eq('id', ids['1001']);
    expect(error?.code).toBe('23503');
  });

  it('un autre espace avec la même clé ne touche pas aux panneaux du premier', async () => {
    const avant = await admin.from('panneaux_affichage').select('id, organization_id, data_source_id').eq('source', SOURCE).order('id');
    await expect(ecrirePlan(admin, entree(['1001', '1003'], autreOrg))).rejects.toThrow(/appartiennent à un autre espace/);
    const apres = await admin.from('panneaux_affichage').select('id, organization_id, data_source_id').eq('source', SOURCE).order('id');
    expect(apres.data).toEqual(avant.data);
    expect(await verifierAppartenanceDesLiens(campagne)).toBe(2);
    const { count } = await admin.from('campagne_lignes').select('id', { count: 'exact', head: true }).eq('campagne_id', campagne);
    expect(count).toBe(2);
  });
});
