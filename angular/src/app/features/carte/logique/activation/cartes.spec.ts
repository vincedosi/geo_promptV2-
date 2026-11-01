import type { MotifPrevol, Prevol } from '../../data/activation.api';
import type { ExtractionJeu, ResumeExtraction } from '../../data/jeux.api';
import type { PlateformeGeo } from '../jeu/plateformes';
import {
  AVERTISSEMENT_SENSIBLE_META, MESSAGE_HORS_EXTRACTION, MESSAGE_META_RISQUE, cartesActivation, formatsDe, messageRisqueNonAchete,
  messageSansJeu,
} from './cartes';

/** L'extraction de démonstration (base locale, jeu 66061937, v1), réduite à ce que les cartes lisent. */
const RESUMES: ResumeExtraction[] = [
  { plateforme: 'dv360', maille: 'cp', seuil: 20, rayon_m: null, exacte: false, n_unites: 63, taux_utile: 95, avertissements: [] },
  { plateforme: 'meta', maille: 'cercle', seuil: 20, rayon_m: 5000, exacte: false, n_unites: 53, taux_utile: 89, avertissements: [] },
  { plateforme: 'tiktok', maille: 'departement', seuil: 20, rayon_m: null, exacte: false, n_unites: 1, taux_utile: 81.5, avertissements: [] },
  { plateforme: 'ttd', maille: 'polygone', seuil: 20, rayon_m: null, exacte: true, n_unites: 1, taux_utile: 100, avertissements: [] },
];
const extraction = (plateformes: ResumeExtraction[] | null): ExtractionJeu => ({
  id: 'x1', version: 1, origine: 'initiale', commentaire: '', seuil_couverture_cp: 20, mode_plan: 'zone', n_cp: 79, n_retenus: 63,
  taux_utile: 95, part_plan_en_zone: null, created_at: '2026-10-25T10:00:00Z', plateformes,
});
const ligne = (plateforme: PlateformeGeo['plateforme'], maille: PlateformeGeo['maille'], ordre: number, limites: PlateformeGeo['limites'] = {}): PlateformeGeo => ({
  plateforme, maille, libelle: '', natif: true, disponible: true, limites, doc_url: null, releve_le: '2026-10-01', a_verifier: false, note: null, ordre,
});
const REGISTRE = [ligne('dv360', 'cp', 10), ligne('ttd', 'polygone', 20), ligne('meta', 'cercle', 30), ligne('tiktok', 'departement', 40)];
const prevol = (mode: Prevol['mode_dv360'], motifs: MotifPrevol[] = [], n = 63): Prevol => ({
  strategie: { id: 's1', nom: 'p', statut: 'active', scope: 'custom_zone', zone_id: null, cpm_previsionnel: null, budget: null },
  version_publiee: 1, zones_modifiees: [], n_codes_postaux: 80, canaux_connectes: [], mode_dv360: mode, n_cp_dv360: n,
  extraction: { zone_set_id: 'j1', version: 1 }, motifs, blocages: motifs.map((m) => m.message), activable: motifs.length === 0,
});
const TOUS = ['dv360', 'ttd', 'meta', 'tiktok'];

describe('cartesActivation — l’extraction de démonstration', () => {
  const cartes = cartesActivation({ canaux: ['tiktok', 'meta', 'ttd', 'dv360'], extraction: extraction(RESUMES), prevol: prevol('reel'), registre: REGISTRE });

  it('quatre cartes, dans l’ordre du registre', () => {
    expect(cartes.map((c) => c.canal)).toEqual(TOUS);
  });

  it('les natures disent la conversion en unités retenues (A-5)', () => {
    expect(cartes.map((c) => c.nature)).toEqual([
      '63 CP — conversion de la zone (95,0 % d’utile)', '1 polygone exact', '53 cercles de 5 km', '1 département',
    ]);
  });

  it('DV360 au CP pousse par l’API ; les autres sont en fichier, chacun avec ses formats', () => {
    expect(cartes.map((c) => [c.mode, c.formats])).toEqual([
      ['api', ['cp', 'sdf']], ['fichier', ['polygone']], ['fichier', ['cercles']], ['fichier', ['territoires']],
    ]);
    expect(cartes.every((c) => c.motifs.length === 0)).toBe(true);
  });

  it('avertissements réglementaires sur Meta et TikTok, rien sur DV360 et TTD (A-13)', () => {
    expect(cartes[0].avertissements).toEqual([]);
    expect(cartes[1].avertissements).toEqual([]);
    expect(cartes[2].avertissements).toEqual(['Publicité politique interdite chez Meta dans l’Union européenne.', AVERTISSEMENT_SENSIBLE_META]);
    expect(cartes[3].avertissements).toEqual(['Publicité politique interdite chez TikTok dans l’Union européenne.']);
  });
});

describe('cartesActivation — le mode de DV360', () => {
  const dv = (mode: Prevol['mode_dv360'], motifs: MotifPrevol[] = []) =>
    cartesActivation({ canaux: ['dv360'], extraction: extraction(RESUMES), prevol: prevol(mode, motifs), registre: REGISTRE })[0];

  it('réel → api ; démo sans connexion → simulé ; indisponible → fichier, avec son motif, fichiers gardés en repli', () => {
    expect(dv('reel').mode).toBe('api');
    expect(dv('simule').mode).toBe('simule');
    const sans = dv('indisponible', [{ code: 'aucune_connexion', message: 'Aucune connexion DV360 active dans cet espace : téléchargez le fichier SDF.' }]);
    expect(sans).toMatchObject({ mode: 'fichier', formats: ['cp', 'sdf'], motifs: ['Aucune connexion DV360 active dans cet espace : téléchargez le fichier SDF.'] });
  });

  it('les motifs du pré-vol sont réécrits sans le mot « stratégie »', () => {
    const c = dv('reel', [{ code: 'jamais_publiee', message: 'La stratégie n’a jamais été publiée — publiez-la pour figer le périmètre poussé.' }]);
    expect(c.motifs).toEqual(['Le plan n’a jamais été publié — publiez-le pour figer le périmètre poussé.']);
  });

  it('DV360 en cercles : fichier seulement, sans motif de poussée', () => {
    const c = cartesActivation({
      canaux: ['dv360'], extraction: extraction([{ ...RESUMES[1], plateforme: 'dv360' }]),
      prevol: prevol('reel', [{ code: 'aucun_cp_dv360', message: 'Cette extraction n’achète pas DV360 au code postal : rien à pousser.' }], 0),
      registre: REGISTRE,
    })[0];
    expect(c).toMatchObject({ mode: 'fichier', formats: ['cercles'], motifs: [], nature: '53 cercles de 5 km' });
  });
});

describe('cartesActivation — Review Focus 1 : Meta et TikTok seuls', () => {
  const motif = { code: 'aucun_cp_dv360', message: 'Cette extraction n’achète pas DV360 au code postal : rien à pousser.' };
  const cartes = cartesActivation({
    canaux: ['dv360', 'meta', 'tiktok'], extraction: extraction([RESUMES[1], RESUMES[2]]),
    prevol: prevol('reel', [motif], 0), registre: REGISTRE,
  });

  it('la carte DV360 dit « rien à pousser », sans erreur ; Meta et TikTok offrent leurs fichiers', () => {
    expect(cartes[0]).toMatchObject({ canal: 'dv360', motifs: [motif.message], formats: [], unites: 0 });
    expect(cartes[1]).toMatchObject({ canal: 'meta', formats: ['cercles'], motifs: [] });
    expect(cartes[2]).toMatchObject({ canal: 'tiktok', formats: ['territoires'], motifs: [] });
  });
});

describe('cartesActivation — cas aux bords', () => {
  it('une plateforme cochée hors de l’extraction : rien à envoyer (V-6 du lot 6)', () => {
    const [c] = cartesActivation({ canaux: ['ttd'], extraction: extraction([RESUMES[0]]), prevol: prevol('reel'), registre: REGISTRE });
    expect(c).toMatchObject({ canal: 'ttd', motifs: [MESSAGE_HORS_EXTRACTION], formats: [], maille: null });
  });

  it('un canal sans plateforme de ⑤ : rien à envoyer, nommé par son code, placé après le registre', () => {
    const c = cartesActivation({ canaux: ['xandr', 'dv360'], extraction: extraction(RESUMES), prevol: prevol('reel'), registre: REGISTRE });
    expect(c.map((x) => x.canal)).toEqual(['dv360', 'xandr']);
    expect(c[1]).toMatchObject({ libelle: 'xandr', motifs: [MESSAGE_HORS_EXTRACTION] });
  });

  it('Review Focus 2 — jeu RISQUE : CP pour DV360 et TTD, Meta « à vérifier » sans fichier, TikTok ne les achète pas', () => {
    const c = cartesActivation({ canaux: TOUS, extraction: extraction(null), prevol: prevol('simule'), registre: REGISTRE });
    expect(c.map((x) => [x.canal, x.nature, x.formats, x.motifs])).toEqual([
      ['dv360', '63 CP — conversion de la zone (95,0 % d’utile)', ['cp', 'sdf'], []],
      ['ttd', '63 CP — conversion de la zone (95,0 % d’utile)', ['cp'], []],
      ['meta', '63 CP — conversion de la zone (95,0 % d’utile)', [], [MESSAGE_META_RISQUE]],
      ['tiktok', '', [], [messageRisqueNonAchete('TikTok')]],
    ]);
    expect(c[0].mode).toBe('simule');
  });

  it('un plan sans extraction (zone d’avant le lot 7) : DV360 compte les CP du pré-vol, les autres n’ont rien', () => {
    const p = { ...prevol('reel', [], 12), extraction: null };
    const c = cartesActivation({ canaux: ['dv360', 'meta'], extraction: null, prevol: p, registre: REGISTRE });
    expect(c[0]).toMatchObject({ nature: '12 CP', mode: 'api', formats: [], motifs: [] });
    expect(c[1].motifs).toEqual([messageSansJeu('Meta')]);
  });

  it('pré-vol ou extraction pas encore lus : des cartes muettes, jamais un faux « rien à envoyer »', () => {
    for (const p of [null, prevol('reel')]) {
      const c = cartesActivation({ canaux: ['dv360', 'meta'], extraction: null, prevol: p, registre: REGISTRE });
      expect(c.map((x) => [x.nature, x.motifs, x.formats])).toEqual([['', [], []], ['', [], []]]);
    }
  });

  it('max_unites :l’avertissement figé est repris, et le registre courant ajoute le sien s’il est dépassé', () => {
    const fige = cartesActivation({
      canaux: ['meta'], prevol: null, registre: REGISTRE,
      extraction: extraction([{ ...RESUMES[1], avertissements: [{ code: 'max_unites', limite: 50, valeur: 53 }] }]),
    })[0];
    expect(fige.avertissements).toContain('53 cercles pour 50 admis par la plateforme : augmentez le rayon ou le seuil.');
    const courant = cartesActivation({
      canaux: ['dv360'], prevol: prevol('reel'), extraction: extraction(RESUMES),
      registre: [ligne('dv360', 'cp', 10, { max_unites: 60 })],
    })[0];
    expect(courant.avertissements).toEqual(['63 codes postaux pour 60 admis par la plateforme.']);
  });

  it('A1 : écrêtages du plan (avant / après, « à vérifier » à côté de la borne) et envois découpés, dits sur la carte', () => {
    const c = cartesActivation({
      canaux: ['dv360'], prevol: prevol('reel'), registre: REGISTRE,
      extraction: extraction([{
        ...RESUMES[0],
        avertissements: [
          { code: 'multiplicateur_max', limite: 10, valeur: 14.2, n: 3, a_verifier: true },
          { code: 'multiplicateur_min', limite: 0.1, valeur: 0.02, n: 1, a_verifier: true },
          { code: 'nb_max_entrees', limite: 2000, valeur: 6000, n: 3, mecanisme: 'script', a_verifier: true },
        ],
      }]),
    })[0];
    expect(c.avertissements).toEqual([
      '3 codes postaux ramenés à ×10 (à vérifier), le maximum admis par la plateforme (×14,2 calculé au plus extrême).',
      '1 code postal ramené à ×0,1 (à vérifier), le minimum admis par la plateforme (×0,02 calculé).',
      `${(6000).toLocaleString('fr-FR')} codes postaux pour ${(2000).toLocaleString('fr-FR')} (à vérifier) par envoi au script de custom bidding : découpés en 3 envois.`,
    ]);
  });

  it('A7 : la perte de la simplification du polygone, figée dans l’extraction, est dite sur la carte TTD', () => {
    const c = cartesActivation({
      canaux: ['ttd'], prevol: prevol('reel'), registre: REGISTRE,
      extraction: extraction([{ ...RESUMES[3], avertissements: [{ code: 'perte_simplification', limite: 0.1, valeur: 4.25, n: 1234 }] }]),
    })[0];
    expect(c.avertissements).toEqual([
      `Polygone simplifié avant l’envoi : ${(1234).toLocaleString('fr-FR')} habitants de la zone (4,25 %) sont hors de la forme envoyée (perte dite au-delà de 0,1 %).`,
    ]);
  });

  it('« à vérifier » : lu dans la règle (plateforme, maille) du registre, jamais sur une carte muette (T5)', () => {
    const registre = [ligne('dv360', 'cp', 10), { ...ligne('ttd', 'polygone', 20), a_verifier: true }];
    const c = cartesActivation({ canaux: ['dv360', 'ttd'], extraction: extraction(RESUMES), prevol: prevol('reel'), registre });
    expect(c.map((x) => x.aVerifier)).toEqual([false, true]);
    const muette = cartesActivation({ canaux: ['ttd'], extraction: null, prevol: null, registre })[0];
    expect(muette.aVerifier).toBe(false);
  });

  it('formatsDe : une maille sans fichier (IRIS) n’en offre aucun', () => {
    expect(formatsDe('dv360', 'iris')).toEqual([]);
  });
});

describe('cartesActivation — une extraction nationale au pays (⑤ finitions, T4)', () => {
  const motif = { code: 'aucun_cp_dv360', message: 'Cette extraction n’achète pas DV360 au code postal : rien à pousser.' };
  const auPays = (plateforme: ResumeExtraction['plateforme'], n: number, aVerifier = false): ResumeExtraction => ({
    plateforme, maille: 'pays', seuil: 20, rayon_m: null, exacte: true, n_unites: n, taux_utile: 100, avertissements: [],
    ...(aVerifier ? { pays_a_verifier: true as const } : {}),
  });
  const registre = [ligne('dv360', 'pays', 10), ligne('meta', 'pays', 30)];

  it('DV360 au pays : le fichier « pays » offert, et la raison du serveur — rien à pousser au code postal', () => {
    const [c] = cartesActivation({ canaux: ['dv360'], extraction: extraction([auPays('dv360', 1)]), prevol: prevol('reel', [motif], 0), registre });
    expect(c).toMatchObject({ mode: 'fichier', formats: ['pays'], motifs: [motif.message], nature: '1 pays exact' });
  });
  it('« à vérifier » : France entière (résumé figé `pays_a_verifier`) seulement, jamais la métropole', () => {
    const fr = cartesActivation({ canaux: ['meta'], extraction: extraction([auPays('meta', 6, true)]), prevol: null, registre })[0];
    const metro = cartesActivation({ canaux: ['meta'], extraction: extraction([auPays('meta', 1)]), prevol: null, registre })[0];
    expect([fr.aVerifier, metro.aVerifier]).toEqual([true, false]);
    expect(fr.nature).toBe('6 pays exacts');
  });
});
