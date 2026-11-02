/**
 * B14 (ARB-6 = A) : au-delà de la limite d'unités d'une maille territoriale (`plateformes_geo.limites.max_unites`), les
 * unités retenues sont découpées en N blocs numérotés, triés par part décroissante, chacun sous la limite, avec un
 * bilan par bloc. La limite se LIT dans la ligne du registre : aucune n'est écrite dans le module.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { decouperEnBlocs } from '@/lib/zones/decoupage-blocs';
import { MAILLES_DECOUPEES, verifierLimites, appliquerSeuil } from '@/lib/zones/conversion';
import type { PlateformeGeo } from '@/lib/zones/plateformes';

const ligne = (p: Partial<PlateformeGeo> & Pick<PlateformeGeo, 'plateforme' | 'maille'>): PlateformeGeo => ({
  libelle: 'x', natif: true, disponible: true, limites: {}, doc_url: null, releve_le: '2026-10-14', a_verifier: false,
  note: null, ordre: 0, ...p,
});
/** Le registre du 02/11 : TikTok à la commune, 3 000 au plus. */
const TIKTOK_COMMUNE = ligne({ plateforme: 'tiktok', maille: 'commune', limites: { max_unites: 3000, pop_min_groupe: 1000 } });

/** `n` communes, parts décroissantes de 100 vers 0,03 (la première la plus forte), codes dans l'ordre inverse. */
const communes = (n: number) => Array.from({ length: n }, (_, i) => {
  const part = Math.round(((n - i) / n) * 1000) / 10;
  return { code: String(99999 - i).padStart(5, '0'), part, part_brute: (n - i) / n * 100, pop_en_zone: 10 * (n - i), pop_totale: 20 * (n - i) };
});

describe('decouperEnBlocs — ARB-6, découpage automatique', () => {
  it('3 500 communes sur TikTok : 2 blocs, de 3 000 puis 500', () => {
    const d = decouperEnBlocs(communes(3500), TIKTOK_COMMUNE);
    expect(d).not.toBeNull();
    expect(d!.decoupage.limite).toBe(3000);
    expect(d!.decoupage.blocs.map((b) => [b.numero, b.n_unites])).toEqual([[1, 3000], [2, 500]]);
    expect(d!.blocs.size).toBe(3500);
  });

  it('triés par part décroissante : le bloc 1 porte les 3 000 plus fortes parts', () => {
    const lignes = communes(3500);
    // Mélangées : l'ordre reçu ne décide de rien.
    const melangees = [...lignes].sort((a, b) => a.code.localeCompare(b.code));
    const d = decouperEnBlocs(melangees, TIKTOK_COMMUNE)!;
    const [b1, b2] = d.decoupage.blocs;
    expect(b1.part_min).toBeGreaterThanOrEqual(b2.part_max!);
    for (const l of lignes.slice(0, 3000)) expect(d.blocs.get(l.code)).toBe(1);
    for (const l of lignes.slice(3000)) expect(d.blocs.get(l.code)).toBe(2);
  });

  it('à part égale, le code départage (ordre déterministe) ; une part inconnue va en dernier', () => {
    const regle = ligne({ plateforme: 'tiktok', maille: 'commune', limites: { max_unites: 2 } });
    const d = decouperEnBlocs([
      { code: '02000', part: 50, part_brute: 50, pop_en_zone: 1, pop_totale: 2 },
      { code: '03000', part: null, part_brute: null, pop_en_zone: null, pop_totale: null },
      { code: '01000', part: 50, part_brute: 50, pop_en_zone: 1, pop_totale: 2 },
      { code: '04000', part: 80, part_brute: 80, pop_en_zone: 4, pop_totale: 5 },
    ], regle)!;
    expect([...d.blocs.entries()]).toEqual([['04000', 1], ['01000', 1], ['02000', 2], ['03000', 2]]);
    // A4 : la population inconnue est comptée à part, dans aucun chiffre d'habitants.
    expect(d.decoupage.blocs[1]).toMatchObject({ numero: 2, n_unites: 2, n_inconnues: 1, couverte: 1, achetee: 2 });
  });

  it('le bilan par bloc somme au bilan de la maille', () => {
    const lignes = communes(3500);
    const d = decouperEnBlocs(lignes, TIKTOK_COMMUNE)!;
    const total = appliquerSeuil(lignes.map((l) => ({ ...l })), 1e9, 0);
    const somme = (k: 'couverte' | 'achetee' | 'n_unites') => d.decoupage.blocs.reduce((s, b) => s + b[k], 0);
    expect(somme('couverte')).toBe(total.couverte);
    expect(somme('achetee')).toBe(total.achetee);
    expect(somme('n_unites')).toBe(total.n_unites);
    for (const b of d.decoupage.blocs) {
      expect(b.hors_zone).toBe(b.achetee - b.couverte);
      expect(b.taux_utile).toBe(Math.round((b.couverte / b.achetee) * 1000) / 10);
    }
  });

  it('sous la limite, à la limite, sans limite, ou maille non découpée : aucun découpage', () => {
    expect(decouperEnBlocs(communes(3000), TIKTOK_COMMUNE)).toBeNull();
    expect(decouperEnBlocs(communes(10), ligne({ plateforme: 'tiktok', maille: 'commune' }))).toBeNull();
    // Cercles : refus au pavage (`trop_de_cercles`) ; CP : la limite compte des codes, le plan CP est celui de ⑥/⑦.
    expect(decouperEnBlocs(communes(10), ligne({ plateforme: 'meta', maille: 'cercle', limites: { max_unites: 2 } }))).toBeNull();
    expect(decouperEnBlocs(communes(10), ligne({ plateforme: 'meta', maille: 'cp', limites: { max_unites: 2 } }))).toBeNull();
  });

  it('la limite vient du registre : la changer change les blocs, sans livraison', () => {
    const d = decouperEnBlocs(communes(3500), { ...TIKTOK_COMMUNE, limites: { max_unites: 1000 } })!;
    expect(d.decoupage.blocs.map((b) => b.n_unites)).toEqual([1000, 1000, 1000, 500]);
  });

  it('aucune limite écrite dans le module', () => {
    const source = readFileSync('lib/zones/decoupage-blocs.ts', 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    // Les limites du registre au 02/11 (200 cercles Meta, 3 000 TikTok, 50 000 CP Meta) n'y figurent pas ; elle est lue.
    expect(source).not.toMatch(/\b(200|3_?000|50_?000)\b/);
    expect(source).toMatch(/limites\.max_unites/);
  });
});

describe('verifierLimites — le découpage est annoncé, jamais silencieux', () => {
  it('3 500 communes pour 3 000 : l’avertissement porte le nombre de blocs', () => {
    const r = appliquerSeuil(communes(3500), 1e9, 0);
    expect(verifierLimites(r, TIKTOK_COMMUNE)).toEqual([{ code: 'max_unites', limite: 3000, valeur: 3500, n: 2 }]);
  });
  it('les mailles découpées : commune, département, IRIS — ni cercle, ni CP, ni polygone, ni pays', () => {
    expect([...MAILLES_DECOUPEES]).toEqual(['commune', 'departement', 'iris']);
    const r = appliquerSeuil(communes(5), 1e9, 0);
    expect(verifierLimites(r, ligne({ plateforme: 'meta', maille: 'cercle', limites: { max_unites: 2 } })))
      .toEqual([{ code: 'max_unites', limite: 2, valeur: 5 }]);
  });
});
