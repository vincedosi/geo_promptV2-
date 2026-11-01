import type { ResultatCouverture } from '../analyses/couverture';
import { type ResultatCercles, bilanDe, choixDeBase, cleCouverture, daterCouvertures, lectureRequise, parPlateforme, rangerCouverture } from './bilan';
import { texteAvertissement, texteChevauchement } from './ecran';
import type { PlateformeGeo } from './plateformes';

const ligne = (p: Partial<PlateformeGeo> & Pick<PlateformeGeo, 'plateforme' | 'maille'>): PlateformeGeo => ({
  libelle: 'x', natif: true, disponible: true, limites: {}, doc_url: null, releve_le: '2026-10-14', a_verifier: false,
  note: null, ordre: 0, ...p,
});
const couverture = (decoupage: string, zone_maj: string, population = 1000) => ({
  decoupage, zone_maj, population, surface_km2: 10,
  lignes: [{ code: 'a', nom: null, commune: null, n_carreaux: 1, pop_en_zone: 600, pop_totale: 1000, part: 60, part_brute: 60 }],
} as unknown as ResultatCouverture);
const pavage = { rayon_m: 5000, seuil: 20, n_cercles: 3, n_candidates: 9, couverte: 900, achetee: 1200, manques: 100, hors_zone: 300, taux_utile: 75 } as ResultatCercles;

describe('bilan d’un choix (logique pure de ⑤)', () => {
  const cp = ligne({ plateforme: 'dv360', maille: 'cp' });
  const cercle = ligne({ plateforme: 'meta', maille: 'cercle', limites: { max_unites: 2 } });
  // Disque entier en France (`part_retenue` = 1, posée par la base, sql/307) : le cercle de la recette est exact (A3).
  const point = { v: 1, type: 'rayon_point', lon: 5, lat: 43, rayon_m: 5000, part_retenue: 1 } as const;

  it('la lecture requise : découpage, forme pour une maille exacte, pavage pour un cercle calculé', () => {
    expect(lectureRequise({ maille: 'cp', seuil: 20 }, cp, null)).toBe('cp');
    expect(lectureRequise({ maille: 'polygone', seuil: 20 }, ligne({ plateforme: 'ttd', maille: 'polygone' }), null)).toBe('forme');
    expect(lectureRequise({ maille: 'cp', seuil: 20 }, cp, { v: 1, type: 'codes_postaux', codes: ['13001'] })).toBe('forme');
    expect(lectureRequise({ maille: 'cercle', seuil: 20, rayon_m: 5000 }, cercle, point)).toBe('forme');
    expect(lectureRequise({ maille: 'cercle', seuil: 20, rayon_m: 8000 }, cercle, point)).toBe('cercles');
  });
  it('maille territoriale : le seuil se rejoue sur la couverture ; exacte : aucune perte ; rien de lu : null', () => {
    expect(bilanDe({ maille: 'cp', seuil: 20 }, cp, null, couverture('cp', 'v1'))?.resume).toMatchObject({ n_unites: 1, couverte: 600, manques: 400 });
    expect(bilanDe({ maille: 'cp', seuil: 70 }, cp, null, couverture('cp', 'v1'))?.resume).toMatchObject({ n_unites: 0, manques: 1000 });
    expect(bilanDe({ maille: 'cp', seuil: 20 }, cp, { v: 1, type: 'codes_postaux', codes: ['1', '2', '2'] }, couverture('forme', 'v1'))?.resume)
      .toMatchObject({ exacte: true, n_unites: 2, manques: 0 });
    expect(bilanDe({ maille: 'cp', seuil: 20 }, cp, null, undefined)).toBeNull();
  });
  it('cercles : le pavage vaut pour SON rayon et SON seuil ; les limites de la ligne avertissent', () => {
    const b = bilanDe({ maille: 'cercle', seuil: 20, rayon_m: 5000 }, cercle, null, pavage);
    expect(b?.resume).toMatchObject({ exacte: false, n_unites: 3, n_touchees: 9, taux_utile: 75 });
    expect(b?.avertissements).toEqual([{ code: 'max_unites', limite: 2, valeur: 3 }]);
    expect(bilanDe({ maille: 'cercle', seuil: 40, rayon_m: 5000 }, cercle, null, pavage)).toBeNull();
    expect(bilanDe({ maille: 'cercle', seuil: 20, rayon_m: 6000 }, cercle, null, pavage)).toBeNull();
  });
  it('A6 : cercles — la somme des disques passe dans le bilan, et la note de chevauchement la compare à la diffusion achetée', () => {
    const b = bilanDe({ maille: 'cercle', seuil: 20, rayon_m: 5000 }, cercle, null, { ...pavage, somme_disques: 1500, chevauchement: 300 });
    expect(b?.resume).toMatchObject({ achetee: 1200, hors_zone: 300, couverte: 900, somme_disques: 1500 });
    // `formaterNombre` sépare les milliers par une espace fine insécable : normalisée pour la comparaison.
    expect(texteChevauchement(b!.resume)?.replace(/\s/g, ' ')).toBe(
      'Les disques voisins se chevauchent : la somme des cercles (1 500 habitants) dépasse la diffusion achetée (1 200), '
      + 'où chaque habitant n’est compté qu’une fois.');
    // Aucun chevauchement (un seul disque), ou une réponse sans la somme : pas de note.
    expect(texteChevauchement(bilanDe({ maille: 'cercle', seuil: 20, rayon_m: 5000 }, cercle, null, { ...pavage, somme_disques: 1200 })!.resume)).toBeNull();
    expect(texteChevauchement(bilanDe({ maille: 'cercle', seuil: 20, rayon_m: 5000 }, cercle, null, pavage)!.resume)).toBeNull();
    // Une autre maille ne porte pas de somme de disques.
    expect(texteChevauchement(bilanDe({ maille: 'cp', seuil: 20 }, cp, null, couverture('cp', 'v1'))!.resume)).toBeNull();
  });
  it('A3 : disque tronqué (Strasbourg 20 km, 65,9 % en France) — pavage au rayon de la recette, avertissement avant/après', () => {
    const strasbourg = { v: 1, type: 'rayon_point', lon: 7.7521, lat: 48.5734, rayon_m: 5000, part_retenue: 0.6586 } as const;
    expect(lectureRequise({ maille: 'cercle', seuil: 20, rayon_m: 5000 }, cercle, strasbourg)).toBe('cercles');
    const b = bilanDe({ maille: 'cercle', seuil: 20, rayon_m: 5000 }, cercle, strasbourg, pavage);
    expect(b?.resume).toMatchObject({ exacte: false, manques: 100, hors_zone: 300 });
    expect(b?.avertissements).toEqual([{ code: 'max_unites', limite: 2, valeur: 3 }, { code: 'disque_hors_france', limite: 100, valeur: 65.9 }]);
    expect(texteAvertissement(b!.avertissements[1], 'cercle')).toBe(
      'Disque partiellement hors de France : 65,9 % de sa surface est en France, 34,1 % en mer ou à l’étranger, '
      + 'achetés par la plateforme sans être comptés. Cercle exact → non exact : la perte est calculée. Restreignez la campagne au pays FR.');
    // Une autre maille : ses unités sont françaises, rien à dire.
    expect(bilanDe({ maille: 'cp', seuil: 20 }, cp, strasbourg, couverture('cp', 'v1'))?.avertissements).toEqual([]);
  });
  it('la clé porte la date de mise à jour : une zone recalculée se relit', () => {
    expect(cleCouverture('z', 'm1', 'ind', 'cp')).not.toBe(cleCouverture('z', 'm2', 'ind', 'cp'));
    expect(cleCouverture('z', null, 'ind', 'cp')).toBe('z||ind|cp');
  });
  it('ranger : une autre version de la forme purge les entrées de la MÊME zone, pas celles d’une autre', () => {
    const avant = new Map([
      [cleCouverture('z', null, 'ind', 'forme'), couverture('forme', 'v1')],
      [cleCouverture('y', null, 'ind', 'cp'), couverture('cp', 'w1')],
    ]);
    const r = rangerCouverture(avant, cleCouverture('z', null, 'ind', 'cp'), couverture('cp', 'v2'));
    expect(r.purgee).toBe(true);
    expect([...r.cache.keys()].sort()).toEqual(['y||ind|cp', 'z||ind|cp']);
    const memeVersion = rangerCouverture(avant, cleCouverture('z', null, 'ind', 'cp'), couverture('cp', 'v1'));
    expect([memeVersion.purgee, memeVersion.cache.size]).toEqual([false, 3]);
  });
  it('par plateforme : seules les plateformes au registre, valeurs absentes omises', () => {
    const regle = (p: string) => (p === 'dv360' ? cp : undefined);
    expect(parPlateforme({ dv360: { maille: 'cp', seuil: 20 }, ttd: { maille: 'cp', seuil: 20 } }, regle, () => 1)).toEqual({ dv360: 1 });
    expect(parPlateforme({ dv360: { maille: 'cp', seuil: 20 } }, regle, () => null)).toEqual({});
  });
  it('daterCouvertures : les entrées SANS date de la zone passent sous la clé datée ; les autres ne bougent pas', () => {
    const c = new Map([
      [cleCouverture('z1', null, 'ind', 'cp'), couverture('cp', 'v1')],
      [cleCouverture('z2', null, 'ind', 'cp'), couverture('cp', 'v1')],
      [cleCouverture('z1', 'avant', 'ind', 'iris'), couverture('iris', 'v1')],
    ]);
    expect([...daterCouvertures(c, 'z1', 'd1').keys()]).toEqual([
      cleCouverture('z1', 'd1', 'ind', 'cp'), cleCouverture('z2', null, 'ind', 'cp'), cleCouverture('z1', 'avant', 'ind', 'iris'),
    ]);
  });
  it('choixDeBase : ceux du jeu ouvert tels quels ; sinon la maille par défaut, seuil par défaut, un rayon au cercle seul', () => {
    expect(choixDeBase([{ plateforme: 'meta', maille: 'cercle', seuil: 30, rayon_m: 9000 }, { plateforme: 'dv360', maille: 'cp', seuil: 10, rayon_m: null }], [], null))
      .toEqual({ meta: { maille: 'cercle', seuil: 30, rayon_m: 9000 }, dv360: { maille: 'cp', seuil: 10 } });
    const regles = [cp, ligne({ plateforme: 'meta', maille: 'cercle', limites: { rayon_min_m: 20000 } })];
    expect(choixDeBase(null, regles, null)).toEqual({ dv360: { maille: 'cp', seuil: 20 }, meta: { maille: 'cercle', seuil: 20, rayon_m: 20000 } });
  });
});

describe('bilan d’une zone pays (⑤ finitions, T4)', () => {
  const CODES = { METRO: ['FR'], FR: ['FR', 'GP', 'MQ', 'GF', 'RE', 'YT'] };
  const pays = ligne({ plateforme: 'meta', maille: 'pays', codes_pays: CODES, pays_a_verifier: ['FR'] });
  const metro = { v: 1, type: 'pays', code: 'METRO' } as const;
  const france = { v: 1, type: 'pays', code: 'FR' } as const;
  // La couverture par département de « France entière » : 972 et 974 carroyés, 971 sans dénominateur (E10).
  const departements = {
    decoupage: 'departement', zone_maj: 'v1', population: 64_000_000, surface_km2: 640_000,
    lignes: [
      { code: '13', nom: null, commune: null, n_carreaux: 1, pop_en_zone: 2_000_000, pop_totale: 2_000_000, part: 100, part_brute: 100 },
      { code: '971', nom: null, commune: null, n_carreaux: 0, pop_en_zone: 0, pop_totale: null, part: null, part_brute: null },
      { code: '972', nom: null, commune: null, n_carreaux: 1, pop_en_zone: 300_000, pop_totale: 300_000, part: 100, part_brute: 100 },
      { code: '974', nom: null, commune: null, n_carreaux: 1, pop_en_zone: 800_000, pop_totale: 800_000, part: 100, part_brute: 100 },
    ],
  } as unknown as ResultatCouverture;

  it('la lecture requise : la forme pour la métropole (le seul code FR) ; les départements dès qu’un DROM est ciblé', () => {
    expect(lectureRequise({ maille: 'pays', seuil: 20 }, pays, metro)).toBe('forme');
    expect(lectureRequise({ maille: 'pays', seuil: 20 }, pays, france)).toBe('departement');
  });
  it('« France métropolitaine » : exacte, une unité FR, la population de la zone', () => {
    const b = bilanDe({ maille: 'pays', seuil: 20 }, pays, metro, couverture('forme', 'v1', 62_528_975))!;
    expect(b.resume).toMatchObject({ exacte: true, n_unites: 1, population: 62_528_975, manques: 0, taux_utile: 100 });
    expect(b.pays).toEqual([{ code: 'FR', nom: 'France', population: 62_528_975 }]);
  });
  it('« France entière » : six unités ; FR = la zone moins les DROM ; un DROM non carroyé vaut null, jamais 0 (E10)', () => {
    const b = bilanDe({ maille: 'pays', seuil: 20 }, pays, france, departements)!;
    expect(b.resume).toMatchObject({ exacte: true, n_unites: 6, population: 64_000_000 });
    expect(b.pays).toEqual([
      { code: 'FR', nom: 'France', population: 62_900_000 }, { code: 'GP', nom: 'Guadeloupe', population: null },
      { code: 'MQ', nom: 'Martinique', population: 300_000 }, { code: 'GF', nom: 'Guyane', population: null },
      { code: 'RE', nom: 'La Réunion', population: 800_000 }, { code: 'YT', nom: 'Mayotte', population: null },
    ]);
  });
  it('une autre maille n’a pas d’unités pays', () => {
    expect(bilanDe({ maille: 'cp', seuil: 20 }, ligne({ plateforme: 'dv360', maille: 'cp' }), metro, couverture('cp', 'v1'))?.pays).toBeUndefined();
  });
});
