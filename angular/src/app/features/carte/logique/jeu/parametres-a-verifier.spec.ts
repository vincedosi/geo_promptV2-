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
  it('DV360 CP : le nombre de CP par liste', () => {
    const l = ligne({ plateforme: 'dv360', maille: 'cp', parametres_a_verifier: ['poids_groupe_cp', 'max_unites'] });
    expect(texteParametresAVerifier(l)).toBe('À vérifier : codes postaux par liste, non relevé.');
  });
  it('une borne relevée mais à vérifier : sa valeur, en km pour un rayon', () => {
    const l = ligne({ plateforme: 'meta', maille: 'cercle', limites: { max_unites: 200, rayon_max_m: 80000 },
      parametres_a_verifier: ['max_unites', 'rayon_max_m'] });
    expect(texteParametresAVerifier(l)).toBe('À vérifier : cercles par liste, 200 ; rayon maximal, 80 km.');
  });
  it('aucune borne à vérifier (ou seulement des règles qui ne sont pas des bornes) : null', () => {
    expect(texteParametresAVerifier(ligne({ plateforme: 'dv360', maille: 'cp', parametres_a_verifier: ['poids_groupe_cp'] }))).toBeNull();
    expect(texteParametresAVerifier(ligne({ plateforme: 'dv360', maille: 'cp' }))).toBeNull();
    expect(texteParametresAVerifier(undefined)).toBeNull();
  });
});
