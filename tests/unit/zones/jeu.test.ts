/**
 * Le modèle `JeuDeZones` — ce qu'une campagne reçoit comme plan.
 *
 * ── POURQUOI CE CONTRAT EST PLUS EXIGEANT QUE CELUI DU PROFIL ────────────
 *
 * Un `ProfilRayons` décrit ce qu'on regarde. Un `JeuDeZones` décrit ce qu'on
 * ACHÈTE : il devient la part de plan de chaque code postal, donc la répartition
 * réelle du budget d'une campagne. Une erreur ici ne fait pas afficher un
 * mauvais chiffre, elle fait dépenser au mauvais endroit.
 *
 * D'où trois exigences que le profil n'a pas :
 *
 * - **Le code couvre les FILTRES autant que les anneaux.** Deux jeux de mêmes
 *   rayons mais de gravités différentes ne décrivent pas la même population.
 *   Les confondre servirait le cache de l'un pour l'autre — le défaut que
 *   sql/196 a dû corriger sur `exposition_cache`.
 * - **Les poids sont bornés.** Un multiplicateur d'enchère négatif ou de 50
 *   part vers un DSP et coûte de l'argent réel.
 * - **Le seuil de couverture est un pourcentage, pas une fraction.** 0,2 et 20
 *   ne veulent pas dire la même chose, et l'un des deux vide le plan.
 */
import { describe, it, expect } from 'vitest';
import {
  JeuDeZonesSchema,
  JEU_DEFAUT,
  normaliserJeu,
  codeJeu,
  jeuDepuisCode,
  poidsDeClasse,
  MODES_PLAN,
  POIDS_MIN,
  POIDS_MAX,
  type JeuDeZones,
} from '@/lib/zones/jeu';
import { normaliserProfil } from '@/lib/risques/profil';

const base: JeuDeZones = {
  profil: normaliserProfil({
    haut: [1000, 2000, 5000], bas: [500, 1000], autres: [],
    lie: false, inclurePPRT: true,
  }),
  cible: 'ind',
  gravites: ['seveso_haut', 'seveso_bas'],
  natures: [],
  modes: ['pprt', 'buffer'],
  territoire: null,
  mode_plan: 'pondere',
  seuil_couverture_cp: 20,
  poids: {},
};

describe('JeuDeZonesSchema', () => {
  it('accepte le jeu de reference', () => {
    expect(() => JeuDeZonesSchema.parse(base)).not.toThrow();
  });

  it('le mode de plan par defaut est « pondere »', () => {
    // Le brief le fixe, et ce n'est pas anodin : 'exclusif' met à zéro la part
    // de plan hors zone, ce qui coupe une campagne nationale du jour au
    // lendemain. Le défaut doit être celui qui ne surprend pas.
    expect(JEU_DEFAUT.mode_plan).toBe('pondere');
  });

  it('refuse un mode de plan inconnu', () => {
    expect(() => JeuDeZonesSchema.parse({ ...base, mode_plan: 'mixte' })).toThrow();
  });

  it('accepte les deux modes declares', () => {
    for (const m of MODES_PLAN) {
      expect(() => JeuDeZonesSchema.parse({ ...base, mode_plan: m })).not.toThrow();
    }
  });

  it('refuse un seuil de couverture hors de 0 a 100', () => {
    // C'est un POURCENTAGE. Accepter 0,2 en croyant lire 20 % retiendrait
    // presque tous les codes postaux — le plan perdrait tout son tranchant.
    expect(() => JeuDeZonesSchema.parse({ ...base, seuil_couverture_cp: -1 })).toThrow();
    expect(() => JeuDeZonesSchema.parse({ ...base, seuil_couverture_cp: 101 })).toThrow();
  });

  it('accepte un seuil de 0 — tout code postal touche est retenu', () => {
    expect(() => JeuDeZonesSchema.parse({ ...base, seuil_couverture_cp: 0 })).not.toThrow();
  });

  it('refuse un poids negatif ou superieur au plafond', () => {
    // Un multiplicateur d'enchère part vers un DSP et coûte de l'argent réel.
    expect(() => JeuDeZonesSchema.parse({ ...base, poids: { 'haut:1': -0.5 } })).toThrow();
    expect(() => JeuDeZonesSchema.parse({ ...base, poids: { 'haut:1': POIDS_MAX + 1 } })).toThrow();
  });

  it('accepte un poids nul — la classe existe mais ne recoit rien', () => {
    // Distinct d'une classe absente : elle reste visible dans la légende et
    // dans l'export, avec un plan à zéro. « Exclue » et « non calculée » ne se
    // disent pas pareil.
    expect(() => JeuDeZonesSchema.parse({ ...base, poids: { 'haut:1': POIDS_MIN } })).not.toThrow();
  });

  it('refuse un poids sur une classe qui n a pas la forme attendue', () => {
    expect(() => JeuDeZonesSchema.parse({ ...base, poids: { 'nimporte quoi': 1 } })).toThrow();
  });
});

describe('poidsDeClasse', () => {
  it('rend 1 pour une classe sans poids declare', () => {
    // Le défaut est la neutralité : une classe qu'on n'a pas réglée ne doit ni
    // être favorisée ni être écartée.
    expect(poidsDeClasse(base, 'haut:2')).toBe(1);
  });

  it('rend le poids declare', () => {
    expect(poidsDeClasse({ ...base, poids: { 'haut:1': 2.5 } }, 'haut:1')).toBe(2.5);
  });

  it('rend 1 hors zone en mode pondere, et 0 en mode exclusif', () => {
    // C'est la DÉFINITION des deux modes, et elle doit vivre à un seul endroit.
    expect(poidsDeClasse(base, 'hors')).toBe(1);
    expect(poidsDeClasse({ ...base, mode_plan: 'exclusif' }, 'hors')).toBe(0);
  });

  it('en mode exclusif, un poids declare sur « hors » est IGNORE', () => {
    // Sinon le mode ne garantirait plus rien : « exclusif » veut dire zéro
    // impression hors zone, pas « zéro sauf si quelqu'un a réglé autrement ».
    expect(poidsDeClasse({ ...base, mode_plan: 'exclusif', poids: { hors: 3 } }, 'hors')).toBe(0);
  });
});

describe('codeJeu', () => {
  it('deux jeux identiques donnent le meme code', () => {
    expect(codeJeu(base)).toBe(codeJeu({ ...base }));
  });

  it('un anneau different donne un code different', () => {
    const autre = normaliserJeu({
      ...base,
      profil: normaliserProfil({ ...base.profil, haut: [1000, 2000, 6000] }),
    });
    expect(codeJeu(autre)).not.toBe(codeJeu(base));
  });

  it('une GRAVITE differente donne un code different', () => {
    /*
     * Le point que le code de profil seul ne couvre pas. Deux jeux de mêmes
     * rayons mais de gravités différentes ne décrivent pas la même population :
     * les confondre servirait le cache de l'un pour l'autre.
     */
    const autre = normaliserJeu({ ...base, gravites: ['seveso_haut'] });
    expect(codeJeu(autre)).not.toBe(codeJeu(base));
  });

  it('une NATURE differente donne un code different', () => {
    const autre = normaliserJeu({ ...base, natures: ['Explosibles'] });
    expect(codeJeu(autre)).not.toBe(codeJeu(base));
  });

  it('un TERRITOIRE different donne un code different', () => {
    const autre = normaliserJeu({ ...base, territoire: '13' });
    expect(codeJeu(autre)).not.toBe(codeJeu(base));
  });

  it('le SEUIL de couverture entre dans le code — il change les CP retenus', () => {
    const autre = normaliserJeu({ ...base, seuil_couverture_cp: 40 });
    expect(codeJeu(autre)).not.toBe(codeJeu(base));
  });

  it('les POIDS n entrent PAS dans le code — ils ne changent pas la geometrie', () => {
    /*
     * Décision explicite. Le code sert de clé au cache de GÉOMÉTRIE et de
     * population ; les poids n'interviennent qu'au moment de fabriquer le plan.
     * Les inclure invaliderait des heures de calcul géométrique à chaque
     * curseur déplacé, pour un résultat rigoureusement identique.
     */
    const autre = normaliserJeu({ ...base, poids: { 'haut:1': 3 } });
    expect(codeJeu(autre)).toBe(codeJeu(base));
  });

  it('le MODE DE PLAN n entre PAS dans le code — meme raison', () => {
    const autre = normaliserJeu({ ...base, mode_plan: 'exclusif' });
    expect(codeJeu(autre)).toBe(codeJeu(base));
  });

  it('ne contient que des caracteres surs dans une URL', () => {
    // Le `%` est le marqueur du percent-encoding, donc attendu. Mais NI
    // parenthèse NI apostrophe : `encodeURIComponent` les laisse passer, et une
    // nature comme « Chimie (IED) » sortait avec les siennes.
    const code = codeJeu(normaliserJeu({ ...base, natures: ['Chimie (IED)', "L'eau"] }));
    expect(code).toMatch(/^[A-Za-z0-9._~%-]+$/);
    expect(code).not.toMatch(/[()']/);
  });
});

describe('jeuDepuisCode', () => {
  it('retrouve ce qui entre dans le code', () => {
    // ⚠ On compare au jeu NORMALISÉ, pas au brut : `base.gravites` n'est pas
    // trié, et le code l'est par construction. Comparer au brut reviendrait à
    // exiger que l'aller-retour restitue un désordre — l'inverse du contrat.
    const attendu = normaliserJeu(base);
    const relu = jeuDepuisCode(codeJeu(base));
    expect(relu).not.toBeNull();
    expect(relu!.profil).toEqual(attendu.profil);
    expect(relu!.cible).toBe(attendu.cible);
    expect(relu!.gravites).toEqual(attendu.gravites);
    expect(relu!.natures).toEqual(attendu.natures);
    expect(relu!.modes).toEqual(attendu.modes);
    expect(relu!.seuil_couverture_cp).toBe(attendu.seuil_couverture_cp);
  });

  it('fait l aller-retour sur une nature a parentheses', () => {
    const j = normaliserJeu({ ...base, natures: ['Chimie (IED)', 'Déchets'] });
    expect(jeuDepuisCode(codeJeu(j))!.natures).toEqual(j.natures);
  });

  it('rend null sur un code illisible plutot que de lever', () => {
    // Le code vient de l'URL : lever ici casserait la page sur un lien tronqué.
    expect(jeuDepuisCode('n importe quoi')).toBeNull();
    expect(jeuDepuisCode('')).toBeNull();
  });
});

describe('normaliserJeu', () => {
  it('vide les anneaux du seuil bas quand seul le seuil haut est retenu', () => {
    // La géométrie et les codes postaux ne lisent que le profil : sans ce
    // filtre, un jeu « seuil haut » achetait aussi les anneaux du seuil bas.
    const j = normaliserJeu({ ...base, gravites: ['seveso_haut'], poids: { 'bas:1': 3 } });
    expect(j.profil.bas).toEqual([]);
    expect(j.profil.haut).toEqual([1000, 2000, 5000]);
    // Un poids sur une classe que le profil ne produit plus ne survit pas.
    expect(j.poids).toEqual({});
  });

  it('trie et dedoublonne les gravites et les natures', () => {
    // Même raison que pour les anneaux : deux saisies équivalentes doivent
    // produire le même objet, donc le même code, donc un seul calcul.
    const j = normaliserJeu({
      ...base,
      gravites: ['seveso_bas', 'seveso_haut', 'seveso_bas'],
      natures: ['B', 'A', 'B'],
    });
    expect(j.gravites).toEqual(['seveso_bas', 'seveso_haut']);
    expect(j.natures).toEqual(['A', 'B']);
  });

  it('retire les poids des classes qui ne peuvent pas exister', () => {
    /*
     * Un poids sur `haut:4` alors que le niveau haut n'a que trois anneaux
     * n'aurait aucun effet, mais il survivrait à l'enregistrement et
     * reprendrait vie si un quatrième anneau était ajouté plus tard — avec une
     * valeur que personne n'a choisie pour lui.
     */
    const j = normaliserJeu({ ...base, poids: { 'haut:1': 2, 'haut:4': 3 } });
    expect(j.poids['haut:1']).toBe(2);
    expect(j.poids['haut:4']).toBeUndefined();
  });
});
