/**
 * La logique du module risque copiée dans angular/ (décision P6) rend la MÊME
 * chose que lib/risques/. Rien dans angular/ n'importe hors d'angular/ : ce test
 * est ce qui empêche la copie de dériver pendant la cohabitation (gel P5).
 */
import { describe, expect, it } from 'vitest';
import * as R from '@/lib/risques/profil';
import * as A from '../../../angular/src/app/features/risques/logique/profil';
import * as Rc from '@/lib/risques/code-profil';
import * as Ac from '../../../angular/src/app/features/risques/logique/code-profil';
import * as Ru from '@/lib/risques/etat-url';
import * as Au from '../../../angular/src/app/features/risques/logique/etat-url';
import * as Rx from '@/lib/risques/exploration';
import * as Ax from '../../../angular/src/app/features/risques/logique/exploration';
import * as Rk from '@/lib/risques/kpi';
import * as Ak from '../../../angular/src/app/features/risques/logique/kpi';
import * as Ra from '@/lib/risques/affectation';
import * as Aa from '../../../angular/src/app/features/risques/logique/affectation';
import * as Rl from '@/lib/risques/libelle-classe';
import * as Al from '../../../angular/src/app/features/risques/logique/libelle-classe';
import * as Rn from '@/lib/risques/palette-natures';
import * as An from '../../../angular/src/app/features/risques/logique/palette-natures';
import * as Re from '@/lib/risques/etape';
import * as Ae from '../../../angular/src/app/features/risques/logique/etape';
import * as Rd from '@/lib/risques/dimensions';
import * as Ad from '../../../angular/src/app/features/risques/logique/dimensions';
import * as Rg from '@/lib/risques/gravites';
import * as Ag from '../../../angular/src/app/features/risques/logique/gravites';

/** Même sortie, ou même levée (le message n'est pas comparé : Zod ≠ Error). */
function memeIssue<T>(r: () => T, a: () => T, etiquette: string) {
  let sr: unknown; let sa: unknown; let er = false; let ea = false;
  try { sr = r(); } catch { er = true; }
  try { sa = a(); } catch { ea = true; }
  expect(ea, `${etiquette} : levée`).toBe(er);
  if (!er) expect(sa, etiquette).toEqual(sr);
}

const PROFILS_BRUTS: unknown[] = [
  R.PROFIL_DEFAUT,
  { haut: [2000, 1000, 1000], bas: [500], autres: [], lie: false, inclurePPRT: true },
  { haut: [100, 10000], bas: [], autres: [], lie: true, inclurePPRT: false },
  { haut: [50], bas: [], autres: [], lie: false, inclurePPRT: true },           // sous le plancher
  { haut: [10001], bas: [], autres: [], lie: false, inclurePPRT: true },        // au-dessus
  { haut: [1500.5], bas: [], autres: [], lie: false, inclurePPRT: true },       // non entier
  { haut: [100, 200, 300, 400, 500], bas: [], autres: [], lie: false, inclurePPRT: true }, // 5 anneaux
  { haut: [1000], bas: [500], autres: [], lie: 'non', inclurePPRT: true },      // booléen faux
  { haut: [1000] },                                                             // champs manquants
  { haut: [Infinity], bas: [], autres: [], lie: false, inclurePPRT: true },     // non fini
  { haut: [NaN], bas: [], autres: [], lie: false, inclurePPRT: true },          // NaN
  { haut: ['a'], bas: [], autres: [], lie: false, inclurePPRT: true },          // texte
  null, 'h1000', 42,
];

const CODES = [
  'h1000.2000.5000_b500.1000_a_L0_P1', 'h5000_b5000_a5000_L1_P1', 'h_b_a_L0_P0',
  'h1000_b_a_L2_P1', 'x1000_b_a_L0_P1', 'h1000.abc_b_a_L0_P1', 'h1000_b_a_L0', '',
  'h50_b_a_L0_P1', 'h100.200.300.400.500_b_a_L0_P1',
];

const URLS = [
  '', 'cible=pop_65_plus', 'etape=rayon', 'onglet=territoires', 'onglet=rayons&etape=zones',
  'etape=inexistante', 'maille=arrondissement', 'maille=commune', 'chemin=13', 'chemin=84.13',
  'natures=Inflammables%20(ancienne%20nomenclature).Explosibles', 'natures=%E0%A4%A',
  'modes=pprt', 'modes=rien', 'gravites=seveso_haut', 'gravites=haut.bas', 'profil=h1000_b_a_L0_P1',
  'profil=illisible', 'jeu=0b7ece33-4903-4a0b-a57a-f6c54e78a729', 'jeu=pas-un-uuid', 'atelier=1',
  'fusion=0', 'fusion=oui', 'campagne=0b7ece33-4903-4a0b-a57a-f6c54e78a729',
];

describe('logique du risque : Angular = React', () => {
  it('profil — normaliserProfil, mêmes sorties et mêmes refus', () => {
    PROFILS_BRUTS.forEach((p, i) => memeIssue(() => R.normaliserProfil(p), () => A.normaliserProfil(p), `profil #${i}`));
  });
  it('profil — constantes', () => {
    for (const k of ['PROFIL_DEFAUT', 'NIVEAUX', 'LIBELLE_NIVEAU', 'GRAVITE_DU_NIVEAU', 'RAYON_MIN_M', 'RAYON_MAX_M', 'PAS_RAYON_M', 'ANNEAUX_MAX'] as const) {
      expect((A as Record<string, unknown>)[k], k).toEqual((R as Record<string, unknown>)[k]);
    }
  });
  it('profil — poserRayonExterieur, profilDesGravites, libelleRayon, anneauxDuNiveau', () => {
    const profils = [R.PROFIL_DEFAUT, { ...R.PROFIL_DEFAUT, lie: true }, { ...R.PROFIL_DEFAUT, bas: [] }];
    for (const p of profils) for (const n of R.NIVEAUX) {
      expect(A.anneauxDuNiveau(p, n)).toEqual(R.anneauxDuNiveau(p, n));
      for (const m of [0, 100, 450, 1999, 5000, 9999, 12000]) {
        memeIssue(() => R.poserRayonExterieur(p, n, m), () => A.poserRayonExterieur(p, n, m), `poser ${n} ${m}`);
      }
      for (const g of [[], ['seveso_haut'], ['seveso_bas'], ['seveso_haut', 'seveso_bas'], ['ied']]) {
        expect(A.profilDesGravites(p, g)).toEqual(R.profilDesGravites(p, g));
      }
    }
    for (const m of [100, 500, 1000, 1500, 2000, 10000]) expect(A.libelleRayon(m)).toBe(R.libelleRayon(m));
  });
  it('code-profil — aller et retour', () => {
    for (const c of CODES) expect(Ac.profilDepuisCode(c), c).toEqual(Rc.profilDepuisCode(c));
    expect(Ac.codeProfil(R.PROFIL_DEFAUT)).toBe(Rc.codeProfil(R.PROFIL_DEFAUT));
    for (const n of [[], ['Explosibles'], ['Toxicité aiguë', 'Explosibles'], ['Inflammables (ancienne nomenclature)']]) {
      expect(Ac.codeZonesRisque('h1000_b_a_L0_P1', n)).toBe(Rc.codeZonesRisque('h1000_b_a_L0_P1', n));
    }
  });
  it('etat-url — lecture puis écriture, URL par URL', () => {
    for (const u of URLS) {
      const r = Ru.lireEtatUrl(new URLSearchParams(u));
      const a = Au.lireEtatUrl(new URLSearchParams(u));
      expect(a, u).toEqual(r);
      expect(Au.ecrireEtatUrl(a), u).toBe(Ru.ecrireEtatUrl(r));
    }
    expect(Au.ETAT_DEFAUT).toEqual(Ru.ETAT_DEFAUT);
  });
  it('exploration — mailles, périmètres, descente, codesDessines', () => {
    const chemins = [[], [{ niveau: 'region', code: '93', nom: 'PACA' }]] as Rx.SegmentExploration[][];
    for (const c of chemins) for (const d of Rd.DIMENSIONS) {
      expect(Ax.mailleExploree(c, d)).toEqual(Rx.mailleExploree(c, d));
      expect(Ax.peutDescendre(d)).toBe(Rx.peutDescendre(d));
      expect(Ax.descendre(c, d, '13', 'Bouches-du-Rhône')).toEqual(Rx.descendre(c, d, '13', 'Bouches-du-Rhône'));
    }
    const opts = { chemin: [], exploration: chemins[1], mailleDessinee: 'departement' as const,
      unites: ['04', '05', '06', '13', '83', '84'], deptsParRegion: { '93': ['04', '05', '06', '13', '83', '84'] } };
    expect(Ax.codesDessines(opts)).toEqual(Rx.codesDessines(opts));
    expect(Ax.perimetreExplore(chemins[1], { region: null, parent: null })).toEqual(Rx.perimetreExplore(chemins[1], { region: null, parent: null }));
  });
  it('kpi — part et taux d\'utile', () => {
    const cas: [number, number | null, number | null][] = [
      [14103578, 63783571, 63783569], [388272, 1500000, 2000000], [0, 0, 100], [10, null, null], [5, 10, 20],
    ];
    for (const [t, tou, ref] of cas) {
      expect(Ak.partExposee(t, ref)).toBe(Rk.partExposee(t, ref));
      expect(Ak.tauxUtile(t, tou, ref)).toBe(Rk.tauxUtile(t, tou, ref));
    }
  });
  it('affectation, libellés de classe, natures, étapes, dimensions, gravités', () => {
    const p = R.PROFIL_DEFAUT;
    expect(Aa.classesDuProfil(p)).toEqual(Ra.classesDuProfil(p));
    for (const d of [{ d_haut_m: 800, d_bas_m: null, pprt_niveau: null }, { d_haut_m: null, d_bas_m: 400, pprt_niveau: 'bas' }, { d_haut_m: 12000, d_bas_m: 9000, pprt_niveau: null }]) {
      expect(Aa.classerCarreau(d as never, p)).toEqual(Ra.classerCarreau(d as never, p));
    }
    const ap = Rl.anneauxParNiveau(p);
    expect(Al.anneauxParNiveau(p)).toEqual(ap);
    for (const c of ['haut:1', 'haut:3', 'haut:pprt', 'bas:2', 'hors']) expect(Al.libelleClasse(c, ap)).toBe(Rl.libelleClasse(c, ap));
    const pn = { 'Toxicité aiguë': 502, 'GPL et produits pétroliers': 485, Explosibles: 79, 'Gaz et liquides inflammables': 50, 'Inflammables (ancienne nomenclature)': 46, Déchets: 45, 'Dangereux pour le milieu aquatique': 25, 'Nature non précisée': 12, 'Chimie (IED)': 4 };
    expect(An.partsDeNature(pn)).toEqual(Rn.partsDeNature(pn));
    expect(An.TEINTES_NATURE).toEqual(Rn.TEINTES_NATURE);
    expect(Ae.ETAPES).toEqual(Re.ETAPES);
    expect(Ae.ETAPES_HERITEES).toEqual(Re.ETAPES_HERITEES);
    for (const e of Re.ETAPES) {
      const parcours = { gravites: ['seveso_haut'], profil: p, chemin: ['13'], jeu: null, simulation: false };
      expect(Ae.etapeRenseignee(e, parcours)).toBe(Re.etapeRenseignee(e, parcours));
    }
    expect(Ad.LIBELLE_DIMENSION).toEqual(Rd.LIBELLE_DIMENSION);
    expect(Ad.modesValides(['pprt', 'x'])).toEqual(Rd.modesValides(['pprt', 'x']));
    expect(Ag.NIVEAUX_RISQUE).toEqual(Rg.NIVEAUX_RISQUE);
  });
  it('exploration — remonter / peutRemonter', () => {
    const c = [{ niveau: 'region', code: '93', nom: 'PACA' }, { niveau: 'departement', code: '13', nom: 'BdR' }] as Rx.SegmentExploration[];
    for (const ch of [[], c.slice(0, 1), c]) {
      expect(Ax.peutRemonter(ch)).toBe(Rx.peutRemonter(ch));
      expect(Ax.remonter(ch)).toEqual(Rx.remonter(ch));
    }
  });
  it('affectation — idClasse, HORS_ZONE', () => {
    expect(Aa.HORS_ZONE).toBe(Ra.HORS_ZONE);
    for (const c of Ra.classesDuProfil(R.PROFIL_DEFAUT)) expect(Aa.idClasse(c)).toBe(Ra.idClasse(c));
    expect(Aa.idClasse(Ra.HORS_ZONE)).toBe(Ra.idClasse(Ra.HORS_ZONE));
  });
  it('palette-natures — teinteNature, NATURES_DISTINGUABLES', () => {
    expect(An.NATURES_DISTINGUABLES).toBe(Rn.NATURES_DISTINGUABLES);
    for (const r of [0, 1, 3, 6, 7, 8, 20]) expect(An.teinteNature(r), `rang ${r}`).toBe(Rn.teinteNature(r));
  });
  it('étape — rangEtape ; gravités — libelleGravite ; dimensions — DIMENSIONS, MODES_ZONE', () => {
    for (const e of Re.ETAPES) expect(Ae.rangEtape(e)).toBe(Re.rangEtape(e));
    for (const g of ['seveso_haut', 'seveso_bas', 'ied', 'autorisation', 'inconnue', '']) {
      expect(Ag.libelleGravite(g), g).toBe(Rg.libelleGravite(g));
    }
    expect(Ad.DIMENSIONS).toEqual(Rd.DIMENSIONS);
    expect(Ad.MODES_ZONE).toEqual(Rd.MODES_ZONE);
  });
});
