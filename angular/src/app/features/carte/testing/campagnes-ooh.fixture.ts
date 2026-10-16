import type { DetailCampagneOoh, LigneOoh, ProprietesEmplacementOoh } from '../logique/campagnes-ooh';

export function ligneEssai(id: string, ordre: number, partiel: Partial<LigneOoh> = {}): LigneOoh {
  return {
    id, ordre, media: 'ooh', regie: 'REGIE', reseau: 'DOOH essai', territoire: null, nb_ecrans: 10, format: 'DOOH', nb_diffusions: 100,
    date_debut: '2026-09-20', date_fin: '2026-10-03', duree_libelle: '2 semaines', rang_option: '2nd OPTION', plage_horaire: null,
    montant_brut: 10, montant_net: 5, frais: 1, honoraires: 1, total_ttc: 8, contacts_15_plus: 1000, contacts_18_24: 200,
    details: {}, a_des_emplacements: true, nb_places: 2, nb_a_verifier: 1, nb_non_places: 0, ...partiel,
  };
}

export const DETAIL_ESSAI: DetailCampagneOoh = {
  campagne: { id: 'c1', nom: 'Campagne essai', annonceur: 'Annonceur', vague: 'V1', date_debut: '2026-09-20', date_fin: '2026-10-02', budget_total_ttc: 100, metadata: {} },
  lignes: [ligneEssai('l1', 1), ligneEssai('l2', 2, { regie: 'OUTREMER', reseau: null, territoire: 'LA REUNION', a_des_emplacements: false, nb_places: 0, nb_a_verifier: 0 })],
  emplacements: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [2.1, 48.1] }, properties: emplacementEssai('p1', 'l1', 'sure') },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [2.3, 48.3] }, properties: emplacementEssai('p2', 'l1', 'a_verifier') },
  ],
  tronque: false,
};

export function emplacementEssai(id: string, ligne: string, qualite: 'sure' | 'a_verifier'): ProprietesEmplacementOoh {
  return {
    id, ligne_id: ligne, nom_lieu: `Lieu ${id}`, adresse: '1 Rue Essai', ville: 'Villetest', code_postal: '45000', code_insee: '45234',
    regie: 'REGIE', reseau: 'DOOH essai', type_lieu: 'campus', type_panneau: 'DOOH essai', numerique: true, nb_ecrans: 2, formats: ['10"'],
    contacts_semaine: 6000, contacts_18_25_semaine: 5700, geoloc_methode: 'adresse_ban' as const, geoloc_qualite: qualite,
    geoloc_score: qualite === 'sure' ? 0.91 : 0.45, geoloc_libelle: '1 Rue Essai 45000 Villetest', reference_panneau: null,
    metadata: { onglet: 'LISTING CAMPUS', groupement: 'Groupe', lignes: [{ numero: 3, cellules: { Etablissement: `Lieu ${id}`, CP: '45000', Vide: null } }] },
  };
}
