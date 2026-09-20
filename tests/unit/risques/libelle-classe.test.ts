/**
 * `libelleClasse` — nommer une classe de zone sans jamais inventer ni mentir.
 *
 * ── LE DÉFAUT QUE CE FICHIER VERROUILLE ───────────────────────────────────
 *
 * Constaté à l'écran le 2026-09-20, sur le bloc « Pression par classe » du
 * Suivi : les bandes s'affichaient **« Seveso seuil haut — NaN km à ? »**.
 *
 * La cause n'était pas dans le calcul : les indices affichés juste à côté
 * étaient justes. Le bloc montre les classes d'un jeu ENREGISTRÉ, et ne
 * disposait pas du profil de rayons qui les avait produites — `libelleRayon`
 * recevait donc `undefined`.
 *
 * Un « NaN » dans une interface n'informe de rien et fait douter de tout le
 * tableau, y compris de ce qui est exact. Ces tests exigent qu'un rayon
 * inconnu se dise, jamais qu'il se devine.
 */
import { describe, it, expect } from 'vitest';
import { libelleClasse, anneauxParNiveau } from '@/lib/risques/libelle-classe';
import { normaliserProfil, type Niveau } from '@/lib/risques/profil';

const PROFIL = normaliserProfil({
  haut: [1000, 2000, 5000],
  bas: [500, 1000],
  autres: [],
  lie: false,
  inclurePPRT: true,
});

const ANNEAUX = anneauxParNiveau(PROFIL);
const VIDE = { haut: [], bas: [], autres: [] } as Record<Niveau, number[]>;

describe('libelleClasse', () => {
  it('nomme une bande par ses deux bornes', () => {
    expect(libelleClasse('haut:1', ANNEAUX)).toBe('Seveso seuil haut — 0 à 1 km');
    expect(libelleClasse('haut:2', ANNEAUX)).toBe('Seveso seuil haut — 1 km à 2 km');
    expect(libelleClasse('haut:3', ANNEAUX)).toBe('Seveso seuil haut — 2 km à 5 km');
    expect(libelleClasse('bas:1', ANNEAUX)).toBe('Seveso seuil bas — 0 à 500 m');
    expect(libelleClasse('bas:2', ANNEAUX)).toBe('Seveso seuil bas — 500 m à 1 km');
  });

  it('nomme le périmètre PPRT sans borne — il n en a pas', () => {
    // Une servitude publiée par l'État a la forme qu'elle a : lui prêter un
    // rayon la ferait passer pour une zone que nous aurions calculée.
    expect(libelleClasse('haut:pprt', ANNEAUX)).toBe('Seveso seuil haut — périmètre PPRT');
  });

  it('nomme le hors-zone', () => {
    expect(libelleClasse('hors', ANNEAUX)).toBe('Hors des anneaux');
  });

  it('SANS profil, nomme la bande par son rang — jamais « NaN »', () => {
    // LE test de ce fichier.
    for (const classe of ['haut:1', 'haut:2', 'haut:3', 'bas:1', 'autres:4']) {
      const l = libelleClasse(classe, VIDE);
      expect(l, `${classe} produit un NaN`).not.toMatch(/NaN/);
      expect(l).toMatch(/bande \d/);
    }
    expect(libelleClasse('haut:2', VIDE)).toBe('Seveso seuil haut — bande 2');
  });

  it('avoue une borne manquante plutôt que d en inventer une', () => {
    /*
     * Cas réel : un jeu enregistré porte quatre bandes, le profil courant n'en
     * a plus que deux. La dernière borne n'est plus connue — on l'écrit `?`.
     * Afficher une valeur plausible serait pire : elle serait crue.
     */
    const court = { haut: [1000], bas: [], autres: [] } as Record<Niveau, number[]>;
    expect(libelleClasse('haut:2', court)).toBe('Seveso seuil haut — 1 km à ?');
    expect(libelleClasse('haut:2', court)).not.toMatch(/NaN/);
  });

  it('un niveau inconnu garde son code plutôt que de disparaître', () => {
    // Une classe qu'on ne sait pas nommer doit rester VISIBLE : la masquer
    // ferait disparaître sa population du tableau sans rien dire.
    expect(libelleClasse('chimere:1', ANNEAUX)).toContain('chimere');
  });
});

describe('anneauxParNiveau', () => {
  it('rend les trois niveaux, même vides', () => {
    expect(Object.keys(ANNEAUX).sort()).toEqual(['autres', 'bas', 'haut']);
    expect(ANNEAUX.autres).toEqual([]);
  });

  it('rend les anneaux triés, tels que le profil les porte', () => {
    expect(ANNEAUX.haut).toEqual([1000, 2000, 5000]);
    expect(ANNEAUX.bas).toEqual([500, 1000]);
  });
});
