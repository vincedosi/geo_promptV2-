/**
 * La logique de navigation et de carte copiée dans angular/ (P6) rend la MÊME chose
 * que lib/navigation et lib/carte. Ce test empêche la copie de dériver pendant la
 * cohabitation (gel P5 étendu à /map au lot 4).
 */
import { describe, expect, it } from 'vitest';
import * as Rn from '@/lib/navigation/config';
import * as An from '../../../angular/src/app/features/carte/logique/navigation';
import * as Rs from '@/lib/navigation/garde-saisie';
import * as As from '../../../angular/src/app/features/carte/logique/garde-saisie';
import * as Rf from '@/lib/carte/filtre';
import * as Af from '../../../angular/src/app/features/carte/logique/filtre';
import * as Rb from '@/lib/carte/bbox-requete';
import * as Ab from '../../../angular/src/app/features/carte/logique/bbox-requete';
import * as Rd from '@/lib/carte/degrades';
import * as Ad from '../../../angular/src/app/features/carte/logique/degrades';
import * as Rc from '@/lib/carte/calques-actifs';
import * as Ac from '../../../angular/src/app/features/carte/logique/calques-actifs';
import * as Rg from '@/lib/carte/garde-perimetre';
import * as Ag from '../../../angular/src/app/features/carte/logique/garde-perimetre';
import * as Rp from '@/app/map/_components/panneaux/panneau-filtre-logique';
import * as Ap from '../../../angular/src/app/features/carte/logique/panneau-filtre-logique';
import * as Rft from '@/lib/clustering/feature-themes';
import * as Aft from '../../../angular/src/app/features/carte/logique/clustering/feature-themes';
import { FEAT_LABEL as R_FEAT_LABEL, FEAT_SHORT as R_FEAT_SHORT } from '@/components/ClusterRadar';
import * as Al from '../../../angular/src/app/features/carte/logique/clustering/libelles';
import { ICONES as ICONES_ANGULAR } from '../../../angular/src/app/ui/icone/icones';

const ICONES: Record<string, string> = {
  assistant: 'etincelles', campagne: 'porte-voix', filtre: 'entonnoir', calques: 'calques',
  analyse: 'fiole', zones: 'formes', reglages: 'reglages', aide: 'aide',
};

const FILTRES: (Rf.FiltreActif | null)[] = [
  null,
  { type: 'region', code: '93', label: 'Provence-Alpes-Côte d’Azur' },
  { type: 'departement', code: '13', label: 'Bouches-du-Rhône' },
  { type: 'commune', code: '13055', label: 'Marseille' },
  { type: 'cp', code: '13001', label: '13001' },
  { type: 'zone', code: '00000000-0000-0000-0000-000000000001', label: 'Zone', bbox: [4.8, 43.2, 5.6, 43.6] },
  { type: 'france', code: 'france', label: 'France entière' },
];

const TOUCHES = [
  { key: '1', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false },
  { key: '4', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false },
  { key: 'c', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false },
  { key: 'C', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false },
  { key: 'k', altKey: false, ctrlKey: true, metaKey: false, shiftKey: false },
  { key: 'k', altKey: false, ctrlKey: false, metaKey: true, shiftKey: false },
  { key: 'k', altKey: false, ctrlKey: true, metaKey: true, shiftKey: false },
  { key: '1', altKey: true, ctrlKey: true, metaKey: false, shiftKey: false },
  { key: '1', altKey: true, ctrlKey: false, metaKey: false, shiftKey: true },
  { key: '1', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false },
  { key: '9', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false },
];

describe('logique de navigation et de carte : Angular = React', () => {
  it('navigation — constantes et entrées (icônes à part)', () => {
    expect(An.LARGEUR_RAIL).toBe(Rn.LARGEUR_RAIL);
    expect(An.ECART_RAIL_PANNEAU).toBe(Rn.ECART_RAIL_PANNEAU);
    expect(An.LARGEUR_PANNEAU).toBe(Rn.LARGEUR_PANNEAU);
    const sans = (l: readonly { icone: unknown }[]) => l.map(({ icone: _i, ...r }) => r);
    expect(sans(An.ENTREES_NAVIGATION)).toEqual(sans(Rn.ENTREES_NAVIGATION));
    for (const e of An.ENTREES_NAVIGATION) expect(e.icone, e.id).toBe(ICONES[e.id]);
  });
  it('navigation — chaque NomIcone porte le MÊME tracé lucide que le composant React (8 entrées)', () => {
    const kebab = (pascal: string) => pascal.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    expect(An.ENTREES_NAVIGATION).toHaveLength(8);
    Rn.ENTREES_NAVIGATION.forEach((r, i) => {
      const a = An.ENTREES_NAVIGATION[i];
      const nomReact = (r.icone as unknown as { displayName: string }).displayName;
      expect(ICONES_ANGULAR[a.icone].lucide, `${r.id} (${nomReact})`).toBe(kebab(nomReact));
    });
  });
  it('navigation — raccourcis', () => {
    for (const t of TOUCHES) {
      expect(An.entreeParRaccourci(t), JSON.stringify(t)).toBe(Rn.entreeParRaccourci(t as KeyboardEvent));
    }
  });
  it('garde de saisie', () => {
    const cibles = [null, { tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'DIV', isContentEditable: true }, { tagName: 'BUTTON' }];
    for (const touche of ['Escape', 'a', '1']) for (const c of cibles) {
      expect(As.ignorerRaccourciClavier(touche, c as Element)).toBe(Rs.ignorerRaccourciClavier(touche, c as Element));
    }
  });
  it('filtre — poser, retirer, bbox', () => {
    expect(Af.BBOX_METRO).toEqual(Rf.BBOX_METRO);
    expect(Object.isFrozen(Af.BBOX_METRO)).toBe(true);
    for (const a of FILTRES) {
      expect(Af.bboxDuFiltre(a)).toEqual(Rf.bboxDuFiltre(a));
      expect(Ab.bboxPourRequete(a)).toEqual(Rb.bboxPourRequete(a));
      for (const b of FILTRES) if (b) expect(Af.poserFiltre(a, b)).toEqual(Rf.poserFiltre(a, b));
    }
    expect(Af.retirerFiltre()).toBe(Rf.retirerFiltre());
  });
  it('dégradés — libellés, activation, bascule, validation', () => {
    const ids = ['carreaux', 'iris', 'civic-indicateurs', 'civic-sante', 'meteo', 'campagne-impressions', 'score', 'diffusion', 'zones-risque'] as const;
    for (const id of ids) expect(Ad.libelleDegrade(id)).toBe(Rd.libelleDegrade(id));
    for (const actif of [null, ...ids]) for (const cible of ids) {
      expect(Ad.activerDegrade(actif, cible)).toEqual(Rd.activerDegrade(actif, cible));
      for (const next of [true, false]) expect(Ac.basculerDegrade(actif, cible, next)).toEqual(Rc.basculerDegrade(actif, cible, next));
    }
    for (const v of [...ids, 'inconnu', '', null, 3, undefined]) expect(Ac.validerDegradeId(v)).toBe(Rc.validerDegradeId(v));
  });
  it('garde de périmètre — six outils, sept filtres, zone sélectionnée ou non', () => {
    const outils = ['voronoi', 'bataille_v1', 'bataille_v2', 'application_bataille', 'clustering', 'score_composite'] as const;
    expect(Ag.MESSAGE_PERIMETRE_MANQUANT).toBe(Rg.MESSAGE_PERIMETRE_MANQUANT);
    for (const f of FILTRES) for (const z of [null, undefined, 'zone-1']) {
      expect(Ag.perimetreChoisi(f, z)).toBe(Rg.perimetreChoisi(f, z));
      expect(Ag.messageGardePerimetre(f, z)).toBe(Rg.messageGardePerimetre(f, z));
      for (const o of outils) expect(Ag.messageGardeOutil(o, f, z)).toBe(Rg.messageGardeOutil(o, f, z));
    }
    for (const o of outils) {
      expect(Ag.outilAdmetNational(o)).toBe(Rg.outilAdmetNational(o));
      expect(Ag.messageRefusNational(o)).toBe(Rg.messageRefusNational(o));
    }
  });
  it('panneau filtre — seed et composition', () => {
    for (const f of FILTRES) {
      expect(Ap.seedDepuisFiltre(f)).toEqual(Rp.seedDepuisFiltre(f));
      expect(Ap.filtreApresChangementScope(f)).toEqual(Rp.filtreApresChangementScope(f));
      for (const v of ['', 'Marseille', ' marseille ', '13001', '1300', '2A004', '75056']) {
        expect(Ap.composerFiltreVille(f, v)).toEqual(Rp.composerFiltreVille(f, v));
        expect(Ap.composerFiltreCodePostal(f, v)).toEqual(Rp.composerFiltreCodePostal(f, v));
      }
    }
  });
  it('clustering (T19) — thématiques de variables et libellés des radars', () => {
    expect(Aft.FEATURE_THEMES).toEqual(Rft.FEATURE_THEMES);
    expect(Aft.ALL_THEME_IDS).toEqual(Rft.ALL_THEME_IDS);
    expect(Aft.ALL_FEATURES).toEqual(Rft.ALL_FEATURES);
    expect(Aft.FEATURE_PRESETS).toEqual(Rft.FEATURE_PRESETS);
    expect(Aft.FEATURE_LABELS).toEqual(Rft.FEATURE_LABELS);
    const selections = [[], Rft.ALL_FEATURES, ['pct_0_17', 'pct_18_39', 'pct_40_54', 'pct_55_79', 'pct_80p'], ['revenu_moyen', 'taux_hlm'], ['taux_hlm']];
    for (const s of selections) {
      expect(Aft.featureSelectionLabel(s)).toBe(Rft.featureSelectionLabel(s));
      expect(Aft.resolveThemesFromFeatures(s)).toEqual(Rft.resolveThemesFromFeatures(s));
    }
    expect(Al.FEAT_SHORT).toEqual(R_FEAT_SHORT);
    expect(Al.FEAT_LABEL).toEqual(R_FEAT_LABEL);
  });
});
