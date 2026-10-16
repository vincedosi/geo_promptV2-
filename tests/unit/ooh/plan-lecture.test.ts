import { describe, expect, it } from 'vitest';
import { lireClasseur } from '@/lib/ooh/plan/classeur';
import { ajouterJours, dateFinLigne, lireDuree, periodeDuTitre } from '@/lib/ooh/plan/durees';
import { fusionnerEmplacements } from '@/lib/ooh/plan/fusion';
import { cellulesNommees, codePostal, departementDeInsee, entier, nombre, normaliser, texte } from '@/lib/ooh/plan/texte';
import type { EmplacementBrut } from '@/types/campagnes-media';
import { classeurEssai } from './_classeur';

describe('texte', () => {
  it('normaliser : majuscules sans accents, ponctuation en espace, ST et STE développés', () => {
    expect(normaliser("  Gare d'Évry — St-Michel / Ste Foy ")).toBe('GARE D EVRY SAINT MICHEL SAINTE FOY');
    expect(normaliser('STRIDE ')).toBe('STRIDE');
  });
  it('texte, nombre, entier, codePostal', () => {
    expect(texte('  Basic  ')).toBe('Basic');
    expect(texte('   ')).toBeNull();
    expect(nombre('1 603 636')).toBe(1603636);
    expect(nombre('12,5')).toBe(12.5);
    expect(nombre(36116.3)).toBe(36116.3);
    expect(nombre('2nd OPTION')).toBeNull();
    expect(entier(489.6)).toBe(490);
    expect(codePostal(13008)).toBe('13008');
    expect(codePostal(1000)).toBe('01000');
    expect(codePostal('75001')).toBe('75001');
    expect(codePostal('Marseille')).toBeNull();
  });
  it('departementDeInsee : deux caractères en métropole et en Corse, trois outre-mer', () => {
    expect(departementDeInsee('75105')).toBe('75');
    expect(departementDeInsee('2A004')).toBe('2A');
    expect(departementDeInsee('97411')).toBe('974');
  });
  it('cellulesNommees : par en-tête, « colonne N » sans en-tête, doublons suffixés, vides sans en-tête omises', () => {
    expect(cellulesNommees(['A', '', 'A'], ['x', null, 'z'])).toEqual({ A: 'x', 'A (2)': 'z' });
    expect(cellulesNommees(['A'], ['x', 'y'])).toEqual({ A: 'x', 'colonne 2': 'y' });
  });
});

describe('lireClasseur', () => {
  it('rend chaque feuille, ses lignes non vides avec leur numéro Excel, et les dates en ISO', async () => {
    const c = await classeurEssai({ Essai: [['titre'], [], [null, 'b', 42, new Date(Date.UTC(2026, 8, 21))]] });
    const f = c.feuilles.get('Essai')!;
    expect(f.lignes.map((l) => l.numero)).toEqual([1, 3]);
    expect(f.lignes[1].cellules).toEqual([null, 'b', 42, '2026-09-21']);
  });
  it('un contenu qui n est pas un .xlsx lève un message français', async () => {
    await expect(lireClasseur(Buffer.from('pas un classeur'))).rejects.toThrow('Classeur illisible');
  });
});

describe('durées', () => {
  it.each([
    ['2 semaines', { jours: 14, jours_diffusion: 14 }],
    ['7 jours', { jours: 7, jours_diffusion: 7 }],
    ['14 jours', { jours: 14, jours_diffusion: 14 }],
    ['2*5 jours', { jours: 14, jours_diffusion: 10 }],
    ['9 jrs dont 2 offert', { jours: 9, jours_diffusion: 9 }],
  ])('%s', (libelle, attendu) => {
    expect(lireDuree(libelle)).toEqual(attendu);
  });
  it('une durée illisible rend null', () => {
    expect(lireDuree('deux semaines')).toBeNull();
    expect(lireDuree(null)).toBeNull();
  });
  it('date de fin = départ + durée − 1 jour, en UTC', () => {
    expect(ajouterJours('2026-09-28', 5)).toBe('2026-10-03');
    expect(dateFinLigne('2026-09-21', '2 semaines')).toBe('2026-10-04');
    expect(dateFinLigne('2026-09-24', '9 jrs dont 2 offert')).toBe('2026-10-02');
    expect(dateFinLigne(null, '7 jours')).toBeNull();
  });
  it('la période d un titre de plan, l année passant si la fin précède le début', () => {
    expect(periodeDuTitre('ESSAI CAMPAGNE - 20/09 - 02/10', 2026)).toEqual({ debut: '2026-09-20', fin: '2026-10-02' });
    expect(periodeDuTitre('ESSAI - 20/12 - 05/01', 2026)).toEqual({ debut: '2026-12-20', fin: '2027-01-05' });
    expect(periodeDuTitre('ESSAI sans période', 2026)).toBeNull();
  });
});

describe('fusionnerEmplacements', () => {
  const brut = (cle: string, nb: number, formats: string[], numero: number): EmplacementBrut => ({
    adaptateur: 'basic-fit', cle, nom_lieu: `Lieu ${cle}`, type_lieu: 'salle de sport', reseau: 'DOOH salle de sport', numerique: true,
    nb_ecrans: nb, formats, adresse: null, code_postal: null, ville: 'Villetest', reference_panneau: cle,
    contacts_semaine: null, contacts_18_25_semaine: null,
    recherche: { type: 'adresse', adresse: '', code_postal: null, ville: 'Villetest', commune_seule: true },
    metadata: { onglet: 'ESSAI', lignes: [{ numero, cellules: { A: cle } }] },
  });
  it('additionne les écrans, réunit les formats et garde toutes les lignes d origine, sans muter l entrée', () => {
    const entree = [brut('1', 1, ['WW'], 2), brut('2', 1, ['NC'], 3), brut('1', 2, ['NC', 'WW'], 4)];
    const sortie = fusionnerEmplacements(entree, (e) => e.cle);
    expect(sortie).toHaveLength(2);
    expect(sortie[0]).toMatchObject({ cle: '1', nb_ecrans: 3, formats: ['WW', 'NC'] });
    expect(sortie[0].metadata.lignes.map((l) => l.numero)).toEqual([2, 4]);
    expect(entree[0].formats).toEqual(['WW']);
    expect(entree[0].metadata.lignes).toHaveLength(1);
  });
});
