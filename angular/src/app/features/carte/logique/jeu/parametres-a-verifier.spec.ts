import { texteParametresAVerifier } from './parametres-a-verifier';
import type { PlateformeGeo } from './plateformes';

const ligne = (p: Partial<PlateformeGeo> & Pick<PlateformeGeo, 'plateforme' | 'maille'>): PlateformeGeo => ({
  libelle: 'x', natif: true, disponible: true, limites: {}, doc_url: null, releve_le: '2026-10-14', a_verifier: false,
  note: null, ordre: 0, ...p,
});

describe('texteParametresAVerifier (C28, amendement E9) — chaque borne à vérifier, à côté de sa valeur', () => {
  it('DV360 cercle : les bornes non relevées se disent « non relevé », la connue garde sa valeur', () => {
    const l = ligne({ plateforme: 'dv360', maille: 'cercle', limites: { rayon_min_m: 1000 },
      parametres_a_verifier: ['max_unites', 'rayon_max_m', 'pop_min_unite_comportement'] });
    expect(texteParametresAVerifier(l)).toBe('À vérifier : cercles par liste, non relevé ; rayon maximal, non relevé.');
  });
  it('DV360 CP : le nombre de CP par liste et la règle de groupe (revue T6, I-9)', () => {
    const l = ligne({ plateforme: 'dv360', maille: 'cp', poids_groupe_cp: 'meme', parametres_a_verifier: ['poids_groupe_cp', 'max_unites'] });
    expect(texteParametresAVerifier(l)).toBe('À vérifier : codes postaux par liste, non relevé ; poids d’un groupe de codes postaux, le même pour chaque code.');
  });
  it('revue T6 (I-9) : les mécanismes de poids de la maille (`plateformes_poids`) — plage, entrées par envoi, mécanisme', () => {
    const l = ligne({ plateforme: 'dv360', maille: 'cp', poids_groupe_cp: 'meme', parametres_a_verifier: ['poids_groupe_cp', 'max_unites'] });
    const poids = [
      { plateforme: 'dv360', maille: 'cp', mecanisme: 'multiplicateur', branche: false, valeur_min: 0.1, valeur_max: 10, parametres_a_verifier: ['valeur_min', 'valeur_max', 'poids_groupe_cp'] },
      { plateforme: 'dv360', maille: 'cp', mecanisme: 'script', branche: false, nb_max_entrees: 2000, parametres_a_verifier: ['nb_max_entrees', 'poids_groupe_cp'] },
      { plateforme: 'meta', maille: 'cp', mecanisme: 'aucun', branche: false, parametres_a_verifier: ['mecanisme'] },
    ] as const;
    expect(texteParametresAVerifier(l, poids)?.replace(/\s/g, ' ')).toBe('À vérifier : codes postaux par liste, non relevé ; poids d’un groupe de codes postaux, '
      + 'le même pour chaque code ; plage du multiplicateur, ×0,1 à ×10 ; entrées par envoi du script, 2 000.');
    const ttd = [{ plateforme: 'ttd', maille: 'cp', mecanisme: 'multiplicateur', branche: false, valeur_min: null, valeur_max: null, nb_max_entrees: null,
      parametres_a_verifier: ['valeur_min', 'valeur_max', 'nb_max_entrees'] }] as const;
    expect(texteParametresAVerifier(ligne({ plateforme: 'ttd', maille: 'cp' }), ttd))
      .toBe('À vérifier : plage du multiplicateur, non relevée ; entrées par envoi du multiplicateur, non relevé.');
    expect(texteParametresAVerifier(ligne({ plateforme: 'meta', maille: 'cp' }), poids)).toBe('À vérifier : mécanisme de poids, aucun (la liste part sans poids).');
  });
  it('revue T6 (I-9) : les bornes du polygone', () => {
    const l = ligne({ plateforme: 'ttd', maille: 'polygone', polygone_sommets_max: 20000, parametres_a_verifier: ['polygone_morceaux_max', 'polygone_sommets_max'] });
    expect(texteParametresAVerifier(l)?.replace(/\s/g, ' ')).toBe('À vérifier : sommets du polygone, 20 000 ; morceaux du polygone, non relevé.');
  });
  it('une borne relevée mais à vérifier : sa valeur, en km pour un rayon', () => {
    const l = ligne({ plateforme: 'meta', maille: 'cercle', limites: { max_unites: 200, rayon_max_m: 80000 },
      parametres_a_verifier: ['max_unites', 'rayon_max_m'] });
    expect(texteParametresAVerifier(l)).toBe('À vérifier : cercles par liste, 200 ; rayon maximal, 80 km.');
  });
  it('aucun paramètre à vérifier : null', () => {
    expect(texteParametresAVerifier(ligne({ plateforme: 'dv360', maille: 'cp' }))).toBeNull();
    expect(texteParametresAVerifier(undefined)).toBeNull();
  });
});
