/**
 * Le code d'un profil : la forme courte qui sert de clé de cache et d'URL.
 *
 * ── POURQUOI UN CODE RÉVERSIBLE ET NON UNE EMPREINTE ──────────────────────
 *
 * `docs/PROMPT.md` demande un `profil_hash`. Une empreinte au sens strict —
 * md5, sha — serait à sens unique : pour savoir à quoi correspond une tuile en
 * cache, il faudrait interroger une table. Un code réversible dit tout seul ce
 * qu'il désigne, ce qui rend diagnosticable une carte qui n'affiche pas ce
 * qu'on attend.
 *
 * Et surtout il ne peut pas entrer en collision. Deux profils différents qui
 * partageraient une empreinte serviraient l'un pour l'autre, en silence — la
 * famille exacte du défaut que sql/196 a corrigé sur `exposition_cache`, où le
 * résultat d'un calcul précédent repartait avec une date d'apparence légitime.
 */
import { describe, it, expect } from 'vitest';
import { codeProfil, profilDepuisCode } from '@/lib/risques/code-profil';
import { normaliserProfil, PROFIL_DEFAUT, type ProfilRayons } from '@/lib/risques/profil';

const profil: ProfilRayons = normaliserProfil({
  haut: [1000, 2000, 5000],
  bas: [500, 1000],
  autres: [],
  lie: false,
  inclurePPRT: true,
});

describe('codeProfil', () => {
  it('rend un code stable pour un meme profil', () => {
    expect(codeProfil(profil)).toBe(codeProfil(profil));
  });

  it('deux saisies equivalentes donnent le MEME code', () => {
    // C'est la propriété dont dépend la mémorisation : un ordre de saisie
    // différent ne doit pas relancer un calcul de plusieurs secondes.
    const autre = normaliserProfil({ ...profil, haut: [5000, 1000, 2000, 2000] });
    expect(codeProfil(autre)).toBe(codeProfil(profil));
  });

  it('un anneau different donne un code different', () => {
    const autre = normaliserProfil({ ...profil, haut: [1000, 2000, 6000] });
    expect(codeProfil(autre)).not.toBe(codeProfil(profil));
  });

  it('inclurePPRT change le code — il change les chiffres', () => {
    // Un réglage qui change le résultat sans changer la clé est la définition
    // du cache empoisonné.
    const sans = normaliserProfil({ ...profil, inclurePPRT: false });
    expect(codeProfil(sans)).not.toBe(codeProfil(profil));
  });

  it('ne contient que des caracteres surs dans une URL et un nom de fichier', () => {
    expect(codeProfil(profil)).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it('reste court — il voyage dans chaque requete de tuile', () => {
    const maxi = normaliserProfil({
      haut: [1000, 2000, 5000, 9900], bas: [100, 500, 1000, 2000],
      autres: [], lie: false, inclurePPRT: true,
    });
    expect(codeProfil(maxi).length).toBeLessThanOrEqual(64);
  });
});

describe('profilDepuisCode', () => {
  it('fait l aller-retour sans perte', () => {
    expect(profilDepuisCode(codeProfil(profil))).toEqual(profil);
  });

  it('fait l aller-retour sur le profil par defaut', () => {
    expect(profilDepuisCode(codeProfil(PROFIL_DEFAUT))).toEqual(PROFIL_DEFAUT);
  });

  it('fait l aller-retour avec les niveaux lies', () => {
    const lie = normaliserProfil({ ...profil, lie: true });
    expect(profilDepuisCode(codeProfil(lie))).toEqual(lie);
  });

  it('fait l aller-retour avec un niveau vide', () => {
    const sansBas = normaliserProfil({ ...profil, bas: [] });
    expect(profilDepuisCode(codeProfil(sansBas))).toEqual(sansBas);
  });

  it('rend null sur un code illisible plutot que de lever', () => {
    // Le code vient de l'URL, donc de l'extérieur. Lever ici casserait la page
    // sur un lien tronqué par un client de messagerie ; rendre null laisse
    // l'appelant retomber sur le profil par défaut.
    expect(profilDepuisCode('n importe quoi')).toBeNull();
    expect(profilDepuisCode('')).toBeNull();
  });

  it('rend null sur un code bien forme mais hors bornes', () => {
    // 20 km dépasse le plafond du pré-calcul. Le code est syntaxiquement
    // valide : seule la validation Zod l'attrape.
    expect(profilDepuisCode('h20000_b500_a_L0_P1')).toBeNull();
  });
});
