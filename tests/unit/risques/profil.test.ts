/**
 * Le modèle `ProfilRayons` — le contrat que client et serveur partagent.
 *
 * ── POURQUOI CES TESTS SONT LES PREMIERS ──────────────────────────────────
 *
 * Le profil voyage dans l'URL, dans le corps d'une requête, dans une clé de
 * cache et dans un nom de tuile. Les quatre doivent voir le MÊME objet, sinon
 * un cache est servi pour un profil qui n'est pas celui qu'on regarde — le
 * défaut exact que sql/196 a dû corriger en production sur `exposition_cache`,
 * où le résultat précédent était rendu avec une date d'apparence légitime.
 *
 * La normalisation (tri, dédoublonnage, bornes) est donc dans la MÊME fonction
 * que la validation : un profil qui passe le schéma est déjà canonique, et
 * deux profils équivalents ne peuvent pas produire deux empreintes.
 */
import { describe, it, expect } from 'vitest';
import {
  ProfilRayonsSchema,
  PROFIL_DEFAUT,
  normaliserProfil,
  RAYON_MIN_M,
  RAYON_MAX_M,
  ANNEAUX_MAX,
  anneauxDuNiveau,
  poserRayonExterieur,
  type ProfilRayons,
} from '@/lib/risques/profil';

/** Un profil valide de référence, pour n'écrire que la variation qui compte. */
const base: ProfilRayons = {
  haut: [1000, 2000, 5000],
  bas: [500, 1000],
  autres: [],
  lie: false,
  inclurePPRT: true,
};

describe('ProfilRayonsSchema', () => {
  it('accepte un profil de référence', () => {
    expect(ProfilRayonsSchema.parse(base)).toEqual(base);
  });

  it('trie les anneaux, quel que soit l ordre de saisie', () => {
    const p = ProfilRayonsSchema.parse({ ...base, haut: [5000, 1000, 2000] });
    expect(p.haut).toEqual([1000, 2000, 5000]);
  });

  it('dedoublonne : deux anneaux identiques produiraient une bande vide', () => {
    // Une bande [2000, 2000) ne contient aucun carreau. Elle s'afficherait
    // dans la légende avec une population de zéro, et le lecteur conclurait
    // que personne n'habite là — alors que la bande n'existe pas.
    const p = ProfilRayonsSchema.parse({ ...base, haut: [1000, 2000, 2000] });
    expect(p.haut).toEqual([1000, 2000]);
  });

  it('refuse un rayon sous le plancher', () => {
    expect(() => ProfilRayonsSchema.parse({ ...base, haut: [RAYON_MIN_M - 1] })).toThrow();
  });

  it('refuse un rayon au-dessus du plafond', () => {
    // 10 km est la borne du pré-calcul (sql/198). Au-delà, il n'y a pas de
    // donnée : accepter la valeur rendrait une bande vide indiscernable d'une
    // bande sans habitant.
    expect(() => ProfilRayonsSchema.parse({ ...base, haut: [RAYON_MAX_M + 100] })).toThrow();
  });

  it('refuse plus de quatre anneaux par niveau', () => {
    expect(() => ProfilRayonsSchema.parse({ ...base, haut: [500, 1000, 2000, 5000, 8000] })).toThrow();
  });

  it('accepte exactement quatre anneaux', () => {
    const p = ProfilRayonsSchema.parse({ ...base, haut: [500, 1000, 2000, 5000] });
    expect(p.haut).toHaveLength(ANNEAUX_MAX);
  });

  it('accepte un niveau sans aucun anneau', () => {
    // « Autres » est vide par défaut dans cette mission : le niveau existe dans
    // le type mais n'a aucune donnée derrière lui. Le refuser obligerait à
    // inventer un anneau factice.
    expect(ProfilRayonsSchema.parse({ ...base, autres: [] }).autres).toEqual([]);
  });

  it('refuse un rayon non entier — les paliers du pre-calcul sont des entiers', () => {
    expect(() => ProfilRayonsSchema.parse({ ...base, haut: [1500.5] })).toThrow();
  });
});

describe('normaliserProfil', () => {
  it('rend un profil deja canonique inchange', () => {
    expect(normaliserProfil(base)).toEqual(base);
  });

  it('deux saisies equivalentes donnent le MEME objet', () => {
    // C'est la propriété dont dépend toute la mémorisation : si deux profils
    // équivalents se normalisaient différemment, ils auraient deux empreintes,
    // donc deux caches, donc deux calculs pour une seule question.
    const a = normaliserProfil({ ...base, haut: [2000, 1000, 5000, 1000] });
    const b = normaliserProfil({ ...base, haut: [1000, 2000, 5000] });
    expect(a).toEqual(b);
  });

  it('lie = true : le niveau bas reprend les anneaux du haut', () => {
    // Mode comparaison. Laisser `bas` diverger pendant que l'interface annonce
    // « liés » donnerait une carte qui contredit son propre cadenas.
    const p = normaliserProfil({ ...base, lie: true });
    expect(p.bas).toEqual(p.haut);
    expect(p.autres).toEqual(p.haut);
  });

  it('lie = true puis false : les anneaux propres NE sont PAS restaures', () => {
    // Décision explicite : lier écrase. Conserver un état caché « avant
    // liaison » ferait réapparaître des anneaux que l'utilisateur ne voit nulle
    // part au moment où il décoche, ce qui se lit comme un bug.
    const lie = normaliserProfil({ ...base, lie: true });
    const delie = normaliserProfil({ ...lie, lie: false });
    expect(delie.bas).toEqual(base.haut);
  });
});

describe('anneauxDuNiveau', () => {
  it('rend les anneaux propres quand les niveaux ne sont pas lies', () => {
    expect(anneauxDuNiveau(base, 'bas')).toEqual([500, 1000]);
  });

  it('rend les anneaux du haut quand les niveaux sont lies', () => {
    expect(anneauxDuNiveau({ ...base, lie: true }, 'bas')).toEqual([1000, 2000, 5000]);
  });
});

describe('PROFIL_DEFAUT', () => {
  it('passe son propre schema', () => {
    // Un défaut invalide ne se verrait qu'au premier rendu, sous la forme d'un
    // écran vide sans message.
    expect(() => ProfilRayonsSchema.parse(PROFIL_DEFAUT)).not.toThrow();
  });

  it('donne plus d anneaux au niveau haut qu au niveau bas', () => {
    // La finalité du module est le bidding DIFFÉRENCIÉ : un défaut identique
    // sur les deux niveaux n'illustrerait pas ce que l'écran sert à faire.
    expect(PROFIL_DEFAUT.haut.length).toBeGreaterThan(PROFIL_DEFAUT.bas.length);
  });
});

/*
 * ── LA RÉGLETTE DE LA BARRE ───────────────────────────────────────────────
 *
 * Le brief compte « une réglette par niveau », ce qui suppose UN anneau par
 * niveau. Le modèle en porte jusqu'à quatre, et le profil par défaut en a
 * trois sur le seuil haut. La réglette déplace donc le BORD de la zone —
 * l'anneau extérieur — et laisse les anneaux intérieurs aux chips.
 *
 * C'est la seule lecture qui réconcilie les deux, et c'est aussi celle du
 * bandeau KPI, dont le gain marginal se lit au rayon maximal.
 */
describe('poserRayonExterieur', () => {
  it('deplace le dernier anneau, en laissant les interieurs en place', () => {
    expect(poserRayonExterieur(base, 'haut', 7000).haut).toEqual([1000, 2000, 7000]);
  });

  it('refuse de faire passer le bord SOUS un anneau interieur', () => {
    // Sans cette garde, poser 1 500 m sur [1000, 2000, 5000] donnerait
    // [1000, 1500, 2000] après tri : le bord deviendrait 2 000 m, soit
    // l'inverse du geste demandé. Pire, la bande que l'utilisateur regardait
    // aurait changé de rang sans qu'il touche à autre chose.
    expect(poserRayonExterieur(base, 'haut', 1500).haut).toEqual([1000, 2000, 2100]);
  });

  it('ramene un bord sous le minimum au plancher', () => {
    expect(poserRayonExterieur({ ...base, haut: [3000] }, 'haut', 10).haut)
      .toEqual([RAYON_MIN_M]);
  });

  it('plafonne au bord du pre-calcul', () => {
    // Au-delà de 10 km il n'y a AUCUNE donnée : une bande vide y serait
    // indiscernable d'une bande réellement sans habitant.
    expect(poserRayonExterieur({ ...base, haut: [3000] }, 'haut', 99_000).haut)
      .toEqual([RAYON_MAX_M]);
  });

  it('cree le premier anneau d un niveau qui n en a aucun', () => {
    // Sans cela, la réglette d'un niveau vide serait inerte : on la glisse et
    // rien ne bouge, ce qui se lit comme un curseur cassé.
    expect(poserRayonExterieur(base, 'autres', 3000).autres).toEqual([3000]);
  });

  it('ecrit sur le niveau HAUT quand les niveaux sont lies', () => {
    // Écrire sur `bas` serait sans effet visible : `anneauxDuNiveau` rend les
    // anneaux du haut tant que le cadenas est fermé, donc l'écran montrerait
    // un curseur qui bouge et des chiffres qui ne changent pas.
    const p = poserRayonExterieur({ ...base, lie: true }, 'bas', 8000);
    expect(p.haut[p.haut.length - 1]).toBe(8000);
    expect(anneauxDuNiveau(p, 'bas')).toEqual(p.haut);
  });

  it('rend un profil canonique, donc une empreinte stable', () => {
    const p = poserRayonExterieur(base, 'bas', 4000);
    expect(() => ProfilRayonsSchema.parse(p)).not.toThrow();
    expect(p.bas).toEqual([...p.bas].sort((a, b) => a - b));
  });
});
