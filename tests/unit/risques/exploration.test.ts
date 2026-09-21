/**
 * L'exploration locale du tableau de couverture.
 *
 * ── CE QUE CES TESTS PROTÈGENT ────────────────────────────────────────────
 *
 * La consigne du lot est une NÉGATION : « le clic NE DOIT PAS modifier le
 * filtre global Territoire ». Une négation ne se vérifie pas à l'œil — l'écran
 * a exactement la même apparence que le filtre bouge ou non, jusqu'au moment
 * où l'on change d'étape et où les chiffres ont changé sans raison visible.
 *
 * Elle se vérifie ici : ces fonctions ne reçoivent le périmètre global qu'en
 * LECTURE, et ne peuvent donc pas l'écrire.
 */
import { describe, it, expect } from 'vitest';
import {
  mailleExploree, perimetreExplore, peutDescendre, peutRemonter,
  descendre, remonter, type SegmentExploration,
} from '@/lib/risques/exploration';

const PACA: SegmentExploration = { niveau: 'region', code: '93', nom: 'Provence-Alpes-Côte d’Azur' };
const BDR: SegmentExploration = { niveau: 'departement', code: '13', nom: 'Bouches-du-Rhône' };

describe('mailleExploree', () => {
  it('laisse la maille de la barre tant qu on n explore pas', () => {
    // Hors exploration, on n'impose rien : l'utilisateur a choisi sa maille.
    expect(mailleExploree([], 'commune')).toBe('commune');
    expect(mailleExploree([], 'region')).toBe('region');
  });

  it('liste les departements sous une region', () => {
    expect(mailleExploree([PACA], 'region')).toBe('departement');
  });

  it('liste les communes sous un departement', () => {
    expect(mailleExploree([PACA, BDR], 'region')).toBe('commune');
  });

  it('respecte le code postal comme maille fine quand c est le choix de la barre', () => {
    // Commune et code postal sont SŒURS, pas imbriquées : descendre de l'une
    // à l'autre changerait de découpage sans changer d'échelle.
    expect(mailleExploree([PACA, BDR], 'code_postal')).toBe('code_postal');
  });
});

describe('perimetreExplore', () => {
  const global = { region: null, parent: null };

  it('rend le perimetre GLOBAL tant qu on n explore pas', () => {
    expect(perimetreExplore([], { region: '93', parent: null })).toEqual({ region: '93', parent: null });
  });

  it('restreint a la region exploree', () => {
    expect(perimetreExplore([PACA], global)).toEqual({ region: '93', parent: null });
  });

  it('le departement PRIME sur la region, jamais les deux', () => {
    // Envoyer les deux ferait filtrer deux fois la même chose ; et surtout,
    // `region` et `parent` sont deux arguments distincts de la RPC parce que
    // 18 codes INSEE désignent à la fois une région et un département.
    expect(perimetreExplore([PACA, BDR], global)).toEqual({ region: null, parent: '13' });
  });

  it('n ECRIT jamais dans le perimetre global', () => {
    // La garantie du lot : le filtre Territoire n'est lu que pour servir de
    // point de départ. Si cet objet était muté, le filtre bougerait au clic.
    const g = { region: '93', parent: null };
    const copie = { ...g };
    perimetreExplore([BDR], g);
    expect(g).toEqual(copie);
  });

  it('part du perimetre global et le RESTREINT', () => {
    // Explorer un département dans un filtre national a un sens ; l'inverse —
    // explorer une autre région dans un filtre départemental — n'en a pas, et
    // ne peut pas arriver : les lignes affichées sont déjà celles du filtre.
    expect(perimetreExplore([BDR], { region: '93', parent: null }).parent).toBe('13');
  });
});

describe('peutDescendre / peutRemonter', () => {
  it('ne descend que depuis la region et le departement', () => {
    expect(peutDescendre('region')).toBe(true);
    expect(peutDescendre('departement')).toBe(true);
    expect(peutDescendre('commune')).toBe(false);
    expect(peutDescendre('code_postal')).toBe(false);
  });

  it('ne remonte pas depuis la racine', () => {
    expect(peutRemonter([])).toBe(false);
    expect(peutRemonter([PACA])).toBe(true);
  });
});

describe('descendre / remonter', () => {
  it('empile l unite cliquee', () => {
    expect(descendre([], 'region', '93', 'PACA')).toEqual([
      { niveau: 'region', code: '93', nom: 'PACA' },
    ]);
  });

  it('rend le MEME chemin quand la descente n a pas de sens', () => {
    // Même référence, donc aucun rendu ni requête déclenchés pour rien.
    const chemin: SegmentExploration[] = [PACA, BDR];
    expect(descendre(chemin, 'commune', '13001', 'Marseille')).toBe(chemin);
  });

  it('depile un cran', () => {
    expect(remonter([PACA, BDR])).toEqual([PACA]);
  });

  it('rend le MEME chemin a la racine', () => {
    const vide: SegmentExploration[] = [];
    expect(remonter(vide)).toBe(vide);
  });

  it('descendre puis remonter rend un chemin equivalent', () => {
    const depart: SegmentExploration[] = [PACA];
    expect(remonter(descendre(depart, 'departement', '13', 'Bouches-du-Rhône'))).toEqual(depart);
  });
});
