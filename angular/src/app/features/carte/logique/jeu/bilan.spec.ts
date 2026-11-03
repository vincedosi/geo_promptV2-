import type { ResultatCouverture } from '../analyses/couverture';
import {
  type ResultatCercles, bilanDe, choixASimuler, choixDeBase, cleCouverture, daterCouvertures, defautsDe, lectureRequise, parPlateforme, rangerCouverture,
} from './bilan';
import { REGLAGES_DEFAUT_REPLI } from './conversion-defaut';
import { taillesBlocs, texteAvertissement, texteBlocs, texteChevauchement, texteDefaut } from './ecran';
import type { PlateformeGeo } from './plateformes';

const ligne = (p: Partial<PlateformeGeo> & Pick<PlateformeGeo, 'plateforme' | 'maille'>): PlateformeGeo => ({
  libelle: 'x', natif: true, disponible: true, limites: {}, doc_url: null, releve_le: '2026-10-14', a_verifier: false,
  note: null, ordre: 0, ...p,
});
const couverture = (decoupage: string, zone_maj: string, population = 1000) => ({
  decoupage, zone_maj, population, surface_km2: 10,
  lignes: [{ code: 'a', nom: null, commune: null, n_carreaux: 1, pop_en_zone: 600, pop_totale: 1000, part: 60, part_brute: 60 }],
} as unknown as ResultatCouverture);
/** B15 : une liste de CP telle que la base l'écrit (sql/320 : unités dérivées des codes, aucun groupe partiel). */
const liste = (codes: string[]) => ({ v: 1, type: 'codes_postaux', codes, unites_constitutives: { maille: 'cp', codes, groupes_partiels: 0 } }) as const;
const pavage = { rayon_m: 5000, seuil: 20, n_cercles: 3, n_candidates: 9, couverte: 900, achetee: 1200, manques: 100, hors_zone: 300, taux_utile: 75 } as ResultatCercles;

describe('bilan d’un choix (logique pure de ⑤)', () => {
  const cp = ligne({ plateforme: 'dv360', maille: 'cp' });
  const cercle = ligne({ plateforme: 'meta', maille: 'cercle', limites: { max_unites: 2 } });
  // Disque entier en France (`part_retenue` = 1, posée par la base, sql/307) : le cercle de la recette est exact (A3).
  const point = { v: 1, type: 'rayon_point', lon: 5, lat: 43, rayon_m: 5000, part_retenue: 1 } as const;

  it('la lecture requise : découpage, forme pour une maille exacte, pavage pour un cercle calculé', () => {
    expect(lectureRequise({ maille: 'cp', seuil: 20 }, cp, null)).toBe('cp');
    expect(lectureRequise({ maille: 'polygone', seuil: 20 }, ligne({ plateforme: 'ttd', maille: 'polygone' }), null)).toBe('forme');
    expect(lectureRequise({ maille: 'cp', seuil: 20 }, cp, liste(['13001']))).toBe('forme');
    expect(lectureRequise({ maille: 'cercle', seuil: 20, rayon_m: 5000 }, cercle, point)).toBe('forme');
    expect(lectureRequise({ maille: 'cercle', seuil: 20, rayon_m: 8000 }, cercle, point)).toBe('cercles');
  });
  it('maille territoriale : le seuil se rejoue sur la couverture ; exacte : aucune perte ; rien de lu : null', () => {
    expect(bilanDe({ maille: 'cp', seuil: 20 }, cp, null, couverture('cp', 'v1'))?.resume).toMatchObject({ n_unites: 1, couverte: 600, manques: 400 });
    expect(bilanDe({ maille: 'cp', seuil: 70 }, cp, null, couverture('cp', 'v1'))?.resume).toMatchObject({ n_unites: 0, manques: 1000 });
    expect(bilanDe({ maille: 'cp', seuil: 20 }, cp, liste(['1', '2', '2']), couverture('forme', 'v1'))?.resume)
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
      + 'achetés par la plateforme sans être comptés. Cercle exact → non exact : la perte est calculée. '
      // Revue T6 (I-4) : un DROM est ciblé comme un pays distinct (Q-2) — « FR » couperait toute l'audience de La Réunion.
      + 'Restreignez la campagne au pays du territoire : FR en métropole, sinon le DROM, ciblé comme un pays distinct (GP, MQ, GF, RE, YT).');
    // Une autre maille : ses unités sont françaises, rien à dire.
    expect(bilanDe({ maille: 'cp', seuil: 20 }, cp, strasbourg, couverture('cp', 'v1'))?.avertissements).toEqual([]);
  });
  it('B8 (ARB-5) : recette 500 m sur DV360 (minimum 1 km) → rayon 1 km, message avant/après, maille non exacte', () => {
    // Borne de test, de la forme de la ligne DV360 (la vraie se lit dans `plateformes_geo`).
    const dv360 = ligne({ plateforme: 'dv360', maille: 'cercle', limites: { rayon_min_m: 1000 } });
    const recette = { v: 1, type: 'rayon_point', lon: 3.087, lat: 45.7772, rayon_m: 500, part_retenue: 1 } as const;
    const c = choixDeBase(null, [dv360], recette).dv360!;
    expect(c).toEqual({ maille: 'cercle', seuil: 20, rayon_m: 1000 });
    expect(lectureRequise(c, dv360, recette)).toBe('cercles');
    const b = bilanDe(c, dv360, recette, { ...pavage, rayon_m: 1000 });
    expect(b?.resume.exacte).toBe(false);
    expect(b?.avertissements).toEqual([{ code: 'rayon_min', limite: 1000, valeur: 500, rayon_m: 1000, plateforme: 'dv360' }]);
    expect(texteAvertissement(b!.avertissements[0], 'cercle').replace(/\s/g, ' '))
      .toBe('Rayon ajusté de 500 m à 1 km (minimum DV360) : maille non exacte, perte calculée.');
    // Un rayon choisi au-delà de la borne, et une borne « à vérifier » (E9) : dits tels quels.
    expect(texteAvertissement({ code: 'rayon_min', limite: 1000, valeur: 500, rayon_m: 3000, plateforme: 'dv360', a_verifier: true }, 'cercle').replace(/\s/g, ' '))
      .toBe('Rayon de la recette (500 m) hors des bornes : minimum DV360 1 km (à vérifier), cercles de 3 km : maille non exacte, perte calculée.');
    expect(texteAvertissement({ code: 'rayon_max', limite: 80000, valeur: 100000, rayon_m: 80000, plateforme: 'meta' }, 'cercle').replace(/\s/g, ' '))
      .toBe('Rayon ajusté de 100 km à 80 km (maximum Meta) : maille non exacte, perte calculée.');
  });
  it('B13 : cercle exact de 1 km à 300 habitants sur DV360 — le refus du registre, en tête, et le défaut l’écarte', () => {
    // Ligne de test de la forme du relevé (sql/318) : 1 000 par cercle, `refus`, comportement « à vérifier ».
    const dv360 = ligne({
      plateforme: 'dv360', maille: 'cercle', limites: { rayon_min_m: 1000, pop_min_unite: 1000 },
      pop_min_unite_comportement: 'refus', parametres_a_verifier: ['pop_min_unite_comportement'],
    });
    const recette = { v: 1, type: 'rayon_point', lon: 3.087, lat: 45.7772, rayon_m: 1000, part_retenue: 1 } as const;
    const c = { maille: 'cercle' as const, seuil: 20, rayon_m: 1000 };
    expect(lectureRequise(c, dv360, recette)).toBe('forme');
    const b = bilanDe(c, dv360, recette, couverture('forme', 'v1', 300));
    expect(b?.resume).toMatchObject({ exacte: true, achetee: 300 });
    expect(b?.avertissements).toEqual([
      { code: 'pop_min_unite', limite: 1000, valeur: 300, n: 1, plateforme: 'dv360', a_verifier: true, refus: true },
    ]);
    expect(texteAvertissement(b!.avertissements[0], 'cercle').replace(/\s/g, ' ')).toBe(
      'Refusé : le cercle compte 300 habitants, sous le minimum de 1 000 (à vérifier) par cercle de la plateforme : '
      + 'élargissez le rayon ou choisissez une autre maille.');
    // À 1 000 habitants, le cercle passe.
    expect(bilanDe(c, dv360, recette, couverture('forme', 'v1', 1000))?.avertissements).toEqual([]);
  });
  it('C24 round 1 (I-1) : cible 18-24 ans — le minimum compare la population TOTALE (cercle exact, cercles pavés)', () => {
    const dv360 = ligne({
      plateforme: 'dv360', maille: 'cercle', limites: { rayon_min_m: 1000, pop_min_unite: 1000 }, pop_min_unite_comportement: 'refus',
    });
    const recette = { v: 1, type: 'rayon_point', lon: 3.087, lat: 45.7772, rayon_m: 1000, part_retenue: 1 } as const;
    const forme = { ...couverture('forme', 'v1', 300), population_ind: 3000 } as ResultatCouverture;
    const b = bilanDe({ maille: 'cercle', seuil: 20, rayon_m: 1000 }, dv360, recette, forme);
    expect(b?.resume).toMatchObject({ exacte: true, achetee: 300, diffusion_population_totale: 3000 });
    expect(b?.avertissements).toEqual([]);
    const pavage = {
      zone_id: 'z', cible: 'ind_18_24', rayon_m: 5000, seuil: 20, n_candidates: 2, n_cercles: 1, population: 300, couverte: 300,
      manques: 0, hors_zone: 0, achetee: 300, taux_utile: 100, n_carreaux: 5, motif_vide: null,
      cercles: [{ lon: 3, lat: 45, pop_en_zone: 300, pop_totale: 300, pop_totale_ind: 3000, part: 100 }],
    };
    expect(bilanDe({ maille: 'cercle', seuil: 20, rayon_m: 5000 }, dv360, null, pavage as never)?.avertissements).toEqual([]);
  });
  it('B13 (relecture I-1) : cercle exact non carroyé (Mayotte) sur DV360 — population inconnue, minimum non vérifiable, aucun refus', () => {
    const dv360 = ligne({
      plateforme: 'dv360', maille: 'cercle', limites: { rayon_min_m: 1000, pop_min_unite: 1000 }, pop_min_unite_comportement: 'refus',
    });
    const recette = { v: 1, type: 'rayon_point', lon: 45.1662, lat: -12.7806, rayon_m: 1000, part_retenue: 1 } as const;
    const forme = {
      ...couverture('forme', 'v1', 0), lignes: [], motif_vide: 'territoire_non_carroye', territoires_non_carroyes: [{ code: '976', nom: 'Mayotte' }],
    } as unknown as ResultatCouverture;
    const b = bilanDe({ maille: 'cercle', seuil: 20, rayon_m: 1000 }, dv360, recette, forme);
    expect(b?.resume).toMatchObject({ exacte: true, n_inconnues: 1 });
    expect(b?.avertissements).toEqual([{ code: 'pop_min_unite', limite: 1000, valeur: 0, n: 1, non_verifiable: true, plateforme: 'dv360' }]);
    expect(texteAvertissement(b!.avertissements[0], 'cercle').replace(/\s/g, ' '))
      .toBe('Population inconnue, minimum non vérifiable : 1 cercle à population inconnue (minimum de 1 000 habitants par cercle).');
  });
  it('B13 (relecture I-2) : groupe à part inconnue — « non vérifiable », la part connue dite', () => {
    expect(texteAvertissement({ code: 'pop_min_groupe', limite: 1000, valeur: 500, n: 1, non_verifiable: true }, 'commune').replace(/\s/g, ' '))
      .toBe('Minimum de 1 000 personnes par groupe non vérifiable (1 commune à population inconnue) : 500 personnes connues.');
  });
  it('B13 : TikTok — le groupe sous le minimum avertit (registre) ; Meta — aucun minimum', () => {
    const tiktok = ligne({
      plateforme: 'tiktok', maille: 'departement', limites: { pop_min_groupe: 1000 }, pop_min_groupe_comportement: 'avertissement',
    });
    const b = bilanDe({ maille: 'departement', seuil: 20 }, tiktok, null, couverture('departement', 'v1', 900));
    // Le département retenu compte 1 000 habitants : la borne est admise.
    expect(b?.avertissements).toEqual([]);
    const petit = { ...couverture('departement', 'v1', 500), lignes: [{ code: '01', nom: null, commune: null, n_carreaux: 1, pop_en_zone: 500, pop_totale: 800, part: 62.5, part_brute: 62.5 }] } as unknown as ResultatCouverture;
    const p = bilanDe({ maille: 'departement', seuil: 20 }, tiktok, null, petit);
    expect(p?.avertissements).toEqual([{ code: 'pop_min_groupe', limite: 1000, valeur: 800, plateforme: 'tiktok' }]);
    expect(texteAvertissement(p!.avertissements[0], 'departement').replace(/\s/g, ' '))
      .toBe('Palier sous 1 000 personnes : 800 achetées, la plateforme peut refuser la diffusion.');
    const meta = ligne({ plateforme: 'meta', maille: 'cercle', limites: { rayon_min_m: 1000 } });
    const recette = { v: 1, type: 'rayon_point', lon: 3.087, lat: 45.7772, rayon_m: 1000, part_retenue: 1 } as const;
    expect(bilanDe({ maille: 'cercle', seuil: 20, rayon_m: 1000 }, meta, recette, couverture('forme', 'v1', 5))?.avertissements).toEqual([]);
  });
  it('B13 : cercles écartés au pavage par le minimum — dits avant/après (règle 5)', () => {
    const dv360 = ligne({ plateforme: 'dv360', maille: 'cercle', limites: { pop_min_unite: 1000 }, pop_min_unite_comportement: 'refus' });
    const b = bilanDe({ maille: 'cercle', seuil: 20, rayon_m: 5000 }, dv360, null, { ...pavage, ecartes_pop_min: { n_cercles: 2, population_max: 900 } });
    expect(b?.avertissements).toEqual([{ code: 'pop_min_unite', limite: 1000, valeur: 900, n: 2, ecartes: true, plateforme: 'dv360' }]);
    expect(texteAvertissement(b!.avertissements[0], 'cercle').replace(/\s/g, ' '))
      .toBe('2 cercles au seuil écartés : moins de 1 000 habitants, le minimum par cercle de la plateforme (le plus peuplé : 900).');
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

describe('B9 (ARB-7) — la maille par défaut sur les simulations en mémoire', () => {
  const regles = [ligne({ plateforme: 'dv360', maille: 'cp' }), ligne({ plateforme: 'dv360', maille: 'cercle', limites: { rayon_min_m: 1500 } })];
  const anneau = { v: 1, type: 'combinaison', operation: 'difference', zones: ['a', 'b'] } as const;
  // Un anneau de 1 km : aucun CP n'atteint 20 % (couverture nulle), les cercles de 10 km couvrent 90 % à 75 %.
  const cpVide = { ...couverture('cp', 'v1'), lignes: [{ code: 'a', nom: null, commune: null, n_carreaux: 1, pop_en_zone: 100, pop_totale: 9000, part: 1.1, part_brute: 1.1 }] } as unknown as ResultatCouverture;
  const pavage10 = { ...pavage, rayon_m: 10_000 } as ResultatCercles;
  it('choixASimuler : chaque maille requise telle que le défaut la deviendrait (seuil par défaut, rayon par défaut)', () => {
    expect(choixASimuler(regles, 'dv360', anneau).map((s) => s.choix)).toEqual([{ maille: 'cp', seuil: 20 }, { maille: 'cercle', seuil: 20, rayon_m: 10_000 }]);
  });
  it('anneau de 1 km sur DV360 : provisoire au CP, puis cercles une fois les deux simulations lues ; la ligne le dit', () => {
    const rien = () => undefined;
    const attente = defautsDe(regles, anneau, undefined, (_p, c) => (c.maille === 'cp' ? cpVide : undefined), () => false).dv360!;
    expect(attente).toMatchObject({ maille: 'cp', critere: 'en_attente' });
    expect(texteDefaut(attente)).toBe('Codes postaux par défaut (export manuel), provisoirement : simulation des autres mailles en cours.');
    const d = defautsDe(regles, anneau, undefined, (_p, c) => (c.maille === 'cp' ? cpVide : pavage10), () => false).dv360!;
    expect(d).toMatchObject({ maille: 'cercle', critere: 'couverture_cible', simulation: { couverture: 90, taux_utile: 75 } });
    expect(texteDefaut(d)).toBe('Cercles par défaut (export manuel) : couverture 90 %, taux utile 75 %, contre 0 % / — en codes postaux (export manuel).');
    expect(choixDeBase(null, regles, anneau, { dv360: d })).toEqual({ dv360: { maille: 'cercle', seuil: 20, rayon_m: 10_000 } });
    // Le pavage refusé : la maille sort de la course, les CP restent, sous la cible.
    const refus = defautsDe(regles, anneau, REGLAGES_DEFAUT_REPLI, (_p, c) => (c.maille === 'cp' ? cpVide : rien()), (_p, c) => c.maille === 'cercle').dv360!;
    expect(texteDefaut(refus)).toBe('Codes postaux par défaut (export manuel) : couverture 0 %, taux utile — (aucune maille n’atteint 80 % de couverture).');
  });
});

describe('B16 — le défaut dit son mode de poussée', () => {
  // La forme du registre au 02/11 (sql/322) : DV360 / CP poussé par API, son script de poids non branché (E2) ; cercles
  // DV360 en export manuel. Lignes de test : les vraies valeurs se lisent dans `plateformes_geo` / `plateformes_poids`.
  const regles = [ligne({ plateforme: 'dv360', maille: 'cp', poussee_branchee: true }), ligne({ plateforme: 'dv360', maille: 'cercle' })];
  const poids = [{ plateforme: 'dv360', maille: 'cp', mecanisme: 'script', branche: false }] as const;
  const rayon5km = { v: 1, type: 'rayon_point', lon: 3.087, lat: 45.7772, rayon_m: 5000, part_retenue: 1 } as const;

  it('rayon 5 km sur DV360 : le CP, poussé par API, se simule ; la ligne du défaut dit le mode de chacune', () => {
    expect(choixASimuler(regles, 'dv360', rayon5km, null, [...poids]).map((s) => s.choix)).toEqual([{ maille: 'cp', seuil: 20 }]);
    const attente = defautsDe(regles, rayon5km, undefined, () => undefined, () => false, null, [...poids]).dv360!;
    // Provisoire (round 1) : aucun taux connu, l'exactitude passe avant la poussée — les cercles exacts.
    expect(texteDefaut(attente)).toBe('Cercles par défaut (export manuel), provisoirement : simulation des autres mailles en cours.');
    const d = defautsDe(regles, rayon5km, undefined, () => couverture('cp', 'v1'), () => false, null, [...poids]).dv360!;
    expect(d).toMatchObject({ maille: 'cercle', poussee: 'manuel', comparee: { maille: 'cp', poussee: 'ciblage_api' } });
    expect(texteDefaut(d)).toBe('Cercles par défaut (export manuel) : couverture 100 %, taux utile 100 %, contre 60 % / 60 % en '
      + 'codes postaux (ciblage par API, poids en export manuel).');
    // Un script branché : le CP part entièrement par API.
    const api = defautsDe(regles, rayon5km, undefined, () => couverture('cp', 'v1'), () => false, null, [{ ...poids[0], branche: true }]).dv360!;
    expect(texteDefaut(api)).toContain('en codes postaux (poussée API).');
  });
});

describe('B14 (ARB-6 = A) : au-delà de la limite d’unités, le découpage en blocs est annoncé', () => {
  // Ligne de test de la forme du registre (TikTok à la commune) ; la vraie limite se lit dans `plateformes_geo`.
  const tiktok = ligne({ plateforme: 'tiktok', maille: 'commune', limites: { max_unites: 3000 } });
  const lignes = Array.from({ length: 3500 }, (_, i) => ({
    code: String(10000 + i), nom: null, commune: null, n_carreaux: 1, pop_en_zone: 1, pop_totale: 2, part: 50, part_brute: 50,
  }));
  const zone = { decoupage: 'commune', zone_maj: 'v1', population: 3500, surface_km2: 9000, lignes } as unknown as ResultatCouverture;

  it('3 500 communes sur TikTok : 2 blocs, de 3 000 puis 500', () => {
    const b = bilanDe({ maille: 'commune', seuil: 20 }, tiktok, null, zone);
    expect(b?.avertissements).toEqual([{ code: 'max_unites', limite: 3000, valeur: 3500, n: 2 }]);
    expect(texteAvertissement(b!.avertissements[0], 'commune').replace(/\s/g, ' ')).toBe(
      '3 500 communes pour 3 000 admis par la plateforme : découpage automatique en 2 blocs, triés par part décroissante (3 000 + 500).');
  });
  it('les tailles de blocs : pleins à la limite, le reste au dernier ; au-delà de trois, en abrégé', () => {
    expect(taillesBlocs({ limite: 3000, valeur: 9000, n: 3 }).replace(/\s/g, ' ')).toBe('3 000 + 3 000 + 3 000');
    expect(taillesBlocs({ limite: 1000, valeur: 4500, n: 5 }).replace(/\s/g, ' ')).toBe('4 × 1 000 + 500');
    // Relecture B14 (M-1) : un multiple exact.
    expect(taillesBlocs({ limite: 1000, valeur: 5000, n: 5 }).replace(/\s/g, ' ')).toBe('5 × 1 000');
  });
  it('round 1 (I-1) : le minimum de groupe d’un bloc nomme le bloc', () => {
    expect(texteAvertissement({ code: 'pop_min_groupe', limite: 1000, valeur: 450, bloc: 2, plateforme: 'tiktok' }, 'commune').replace(/\s/g, ' '))
      .toBe('Bloc 2 : palier sous 1 000 personnes : 450 achetées, la plateforme peut refuser la diffusion.');
  });
  it('le découpage figé se dit dans la liste des versions, bloc par bloc ; rien sans découpage', () => {
    const d = { limite: 3000, blocs: [{ numero: 1, n_unites: 3000, taux_utile: 52.1 }, { numero: 2, n_unites: 500, taux_utile: 31.4 }] };
    expect(texteBlocs(d)?.replace(/\s/g, ' ')).toBe('2 blocs de 3 000 au plus : bloc 1 3 000 (taux d’utile 52,1 %), bloc 2 500 (31,4 %)');
    expect(texteBlocs(undefined)).toBeNull();
  });
  it('un cercle n’est pas découpé : il garde sa consigne', () => {
    expect(texteAvertissement({ code: 'max_unites', limite: 200, valeur: 481 }, 'cercle').replace(/\s/g, ' '))
      .toBe('481 cercles pour 200 admis par la plateforme : augmentez le rayon ou le seuil.');
  });
});

describe('B15 — exactitude par composition à l’écran', () => {
  const cp = ligne({ plateforme: 'meta', maille: 'cp' });
  const SCORE = { indicateurs: [{ code: 'taux_pauvrete', poids: 1, sens: 'croissant' as const }], maille: 'cp' as const, seuil_score: 60 };
  const CODES_25 = Array.from({ length: 25 }, (_, i) => `750${String(i + 1).padStart(2, '0')}`);

  it('capture de score au CP de 25 codes : la forme se lit, maille exacte, 25 codes, taux utile 100 %', () => {
    const capture = { v: 1, type: 'capture', source_type: 'score', parametres: SCORE, unites_constitutives: { maille: 'cp', codes: CODES_25, groupes_partiels: 0 } } as const;
    expect(lectureRequise({ maille: 'cp', seuil: 20 }, cp, capture)).toBe('forme');
    expect(bilanDe({ maille: 'cp', seuil: 20 }, cp, capture, couverture('forme', 'v1'))?.resume)
      .toMatchObject({ exacte: true, n_unites: 25, taux_utile: 100, manques: 0, hors_zone: 0 });
  });

  it('un seul membre d’un groupe de 3 : la couverture CP se lit, la perte se calcule, l’ajustement est dit avant/après', () => {
    const codes = [...CODES_25.slice(0, 24), '35000'];
    const capture = { v: 1, type: 'capture', source_type: 'score', parametres: SCORE, unites_constitutives: { maille: 'cp', codes, groupes_partiels: 1 } } as const;
    expect(lectureRequise({ maille: 'cp', seuil: 20 }, cp, capture)).toBe('cp');
    const lu = {
      decoupage: 'cp', zone_maj: 'v1', population: 90_000, surface_km2: 10,
      lignes: [{ code: '35000', nom: null, commune: null, n_carreaux: 9, pop_en_zone: 90_000, pop_totale: 90_000, part: 100, part_brute: 100, membres: ['35000', '35200', '35700'] }],
    } as unknown as ResultatCouverture;
    const b = bilanDe({ maille: 'cp', seuil: 20 }, cp, capture, lu);
    expect(b?.resume).toMatchObject({ exacte: false, n_codes: 3 });
    // Round 1 (M-1) : la liste (25) plus les seuls membres que le groupe ajoute (35200, 35700).
    expect(b?.avertissements).toEqual([{ code: 'groupes_cp_partiels', limite: 25, valeur: 27, n: 1 }]);
    expect(texteAvertissement(b!.avertissements[0], 'cp')).toBe(
      '1 groupe de codes postaux indiscernables présent en partie dans la liste, acheté entier : 25 codes de la liste → 27 avec le groupe entier. '
      + 'Maille non exacte : la perte est calculée.');
  });
});
