/**
 * La règle d'affectation unique : un carreau, une classe.
 *
 * ── CE QUE CETTE RÈGLE RÉPARE ─────────────────────────────────────────────
 *
 * Les chiffres actuels du module ne s'additionnent pas, et ce n'est pas une
 * imprécision : c'est structurel. `couverture_rayon_risque` (sql/198) porte une
 * distribution MARGINALE — une ligne par gravité, chacune exacte pour sa propre
 * question. Un carreau proche d'un Seveso haut ET d'un Seveso bas est donc
 * compté dans les deux.
 *
 * Mesuré le 2026-09-19, carreaux à moins de 10 km : 586 248 pour le niveau
 * haut, 655 977 pour le bas, mais 914 154 au total réel. **328 071 carreaux
 * sont dans les deux**, soit 35,9 % des carreaux exposés.
 *
 * En attribuant chaque carreau à UN SEUL niveau, toutes les sommes redeviennent
 * additives : niveaux, bandes, territoires. C'est ce qui permet à l'écran, à la
 * carte et au classeur de montrer le même nombre.
 *
 * ── POURQUOI UNE FONCTION PURE ────────────────────────────────────────────
 *
 * Elle est appliquée à ~914 000 carreaux en SQL et à quelques dizaines dans une
 * infobulle côté client. Les deux doivent classer identiquement, sinon la
 * carte contredit le tableau. Le SQL de sql/203 transcrit cette fonction, et
 * `tests/unit/risques/affectation-sql.test.ts` vérifie que la transcription ne
 * dérive pas.
 */
import { describe, it, expect } from 'vitest';
import {
  classerCarreau,
  idClasse,
  classesDuProfil,
  HORS_ZONE,
  type DistancesCarreau,
} from '@/lib/risques/affectation';
import { normaliserProfil, type ProfilRayons } from '@/lib/risques/profil';

const profil: ProfilRayons = normaliserProfil({
  haut: [1000, 2000, 5000],
  bas: [500, 1000],
  autres: [],
  lie: false,
  inclurePPRT: true,
});

/** Un carreau loin de tout, pour ne déclarer que la distance qui compte. */
const loin: DistancesCarreau = { haut: null, bas: null, autres: null, pprt: null };

describe('classerCarreau — priorite entre niveaux', () => {
  it('Seveso haut prime sur Seveso bas quand les deux sont a portee', () => {
    // Le cas des 328 071 carreaux : aujourd'hui comptés deux fois, désormais
    // attribués au seul niveau haut.
    const c = classerCarreau({ ...loin, haut: 1500, bas: 200 }, profil);
    expect(c).toEqual({ niveau: 'haut', bande: 2 });
  });

  it('retombe sur le niveau bas quand le haut est hors de portee', () => {
    // 7 km dépasse le dernier anneau haut (5 km) : le carreau n'appartient pas
    // au niveau haut, même s'il en est « plus proche » au sens de la distance.
    const c = classerCarreau({ ...loin, haut: 7000, bas: 300 }, profil);
    expect(c).toEqual({ niveau: 'bas', bande: 1 });
  });

  it('rend hors zone quand aucun niveau n est a portee', () => {
    expect(classerCarreau({ ...loin, haut: 7000, bas: 3000 }, profil)).toBe(HORS_ZONE);
  });

  it('rend hors zone pour un carreau sans aucune distance connue', () => {
    expect(classerCarreau(loin, profil)).toBe(HORS_ZONE);
  });

  it('ignore un niveau sans anneau, meme si la distance est connue', () => {
    // « Autres » est vide dans cette mission. Un carreau à 300 m d'un site
    // « autre » ne doit pas être classé : aucune bande n'est définie pour lui.
    const c = classerCarreau({ ...loin, autres: 300 }, profil);
    expect(c).toBe(HORS_ZONE);
  });
});

describe('classerCarreau — bandes exclusives', () => {
  it('la premiere bande va de zero au premier anneau', () => {
    expect(classerCarreau({ ...loin, haut: 0 }, profil)).toEqual({ niveau: 'haut', bande: 1 });
    expect(classerCarreau({ ...loin, haut: 999 }, profil)).toEqual({ niveau: 'haut', bande: 1 });
  });

  it('la borne appartient a la bande SUPERIEURE', () => {
    // [0, 1000) puis [1000, 2000). Un carreau à exactement 1000 m est dans la
    // seconde. La convention doit être écrite quelque part : sans elle, le SQL
    // et le TypeScript peuvent choisir chacun la sienne et un carreau bascule
    // d'une bande à l'autre selon qui l'interroge.
    expect(classerCarreau({ ...loin, haut: 1000 }, profil)).toEqual({ niveau: 'haut', bande: 2 });
  });

  it('la derniere bande s arrete au dernier anneau, exclu', () => {
    expect(classerCarreau({ ...loin, haut: 4999 }, profil)).toEqual({ niveau: 'haut', bande: 3 });
    expect(classerCarreau({ ...loin, haut: 5000 }, profil)).toBe(HORS_ZONE);
  });

  it('chaque carreau tombe dans exactement une bande', () => {
    // Balayage exhaustif au mètre sur toute l'étendue du niveau haut : aucune
    // distance ne doit produire deux classes ni aucune.
    const vues = new Set<string>();
    for (let d = 0; d < 5000; d += 1) {
      const c = classerCarreau({ ...loin, haut: d }, profil);
      expect(c).not.toBe(HORS_ZONE);
      vues.add(idClasse(c));
    }
    expect([...vues].sort()).toEqual(['haut:1', 'haut:2', 'haut:3']);
  });
});

describe('classerCarreau — le PPRT', () => {
  it('le PPRT prime sur toute bande de son niveau', () => {
    // Un périmètre publié par l'État n'est pas un rayon que nous avons choisi.
    // Le ranger dans une bande calculée effacerait précisément la distinction
    // que le module existe pour porter.
    const c = classerCarreau({ ...loin, haut: 3000, pprt: 'haut' }, profil);
    expect(c).toEqual({ niveau: 'haut', bande: 'pprt' });
  });

  it('un PPRT de niveau bas ne l emporte PAS sur une bande de niveau haut', () => {
    // La priorité de NIVEAU s'applique d'abord : le carreau est haut, et dans
    // le niveau haut il n'a pas de PPRT, donc il prend sa bande.
    const c = classerCarreau({ ...loin, haut: 1500, bas: 100, pprt: 'bas' }, profil);
    expect(c).toEqual({ niveau: 'haut', bande: 2 });
  });

  it('un PPRT classe le carreau meme hors de portee des anneaux', () => {
    // Un PPRT peut s'étendre au-delà du dernier anneau choisi. L'exclure
    // ferait disparaître de la carte une servitude opposable parce qu'un
    // curseur d'interface est réglé trop bas.
    const c = classerCarreau({ ...loin, haut: 8000, pprt: 'haut' }, profil);
    expect(c).toEqual({ niveau: 'haut', bande: 'pprt' });
  });

  it('inclurePPRT desactive : le carreau retombe sur sa bande', () => {
    const sans = normaliserProfil({ ...profil, inclurePPRT: false });
    const c = classerCarreau({ ...loin, haut: 3000, pprt: 'haut' }, sans);
    expect(c).toEqual({ niveau: 'haut', bande: 3 });
  });

  it('inclurePPRT desactive et hors de portee : hors zone', () => {
    const sans = normaliserProfil({ ...profil, inclurePPRT: false });
    expect(classerCarreau({ ...loin, haut: 8000, pprt: 'haut' }, sans)).toBe(HORS_ZONE);
  });
});

describe('classerCarreau — niveaux lies', () => {
  it('le niveau bas utilise les anneaux du haut quand lie', () => {
    const lie = normaliserProfil({ ...profil, lie: true });
    // 3000 m dépasserait le dernier anneau bas (1000) s'il était propre ;
    // lié, le niveau bas hérite des anneaux du haut et 3000 tombe en bande 3.
    expect(classerCarreau({ ...loin, bas: 3000 }, lie)).toEqual({ niveau: 'bas', bande: 3 });
  });
});

describe('classesDuProfil', () => {
  it('enumere les classes dans l ordre de lecture, hors zone en dernier', () => {
    expect(classesDuProfil(profil).map(idClasse)).toEqual([
      'haut:pprt', 'haut:1', 'haut:2', 'haut:3',
      'bas:pprt', 'bas:1', 'bas:2',
      'hors',
    ]);
  });

  it('omet les classes PPRT quand inclurePPRT est desactive', () => {
    const sans = normaliserProfil({ ...profil, inclurePPRT: false });
    expect(classesDuProfil(sans).map(idClasse)).toEqual([
      'haut:1', 'haut:2', 'haut:3', 'bas:1', 'bas:2', 'hors',
    ]);
  });

  it('omet entierement un niveau sans anneau', () => {
    // « Autres » ne doit pas apparaître dans la légende avec zéro habitant :
    // un zéro se lit « personne n'habite là », pas « ce niveau n'est pas calculé ».
    expect(classesDuProfil(profil).some((c) => c !== HORS_ZONE && c.niveau === 'autres')).toBe(false);
  });

  it('toute classe rendue par classerCarreau est enumeree par classesDuProfil', () => {
    // L'invariant qui garantit qu'aucune population ne tombe dans une classe
    // absente de la légende — donc invisible tout en pesant dans le total.
    const connues = new Set(classesDuProfil(profil).map(idClasse));
    const cas: DistancesCarreau[] = [
      { ...loin, haut: 500 }, { ...loin, haut: 1500 }, { ...loin, haut: 4000 },
      { ...loin, bas: 100 }, { ...loin, bas: 700 },
      { ...loin, haut: 900, pprt: 'haut' }, { ...loin, bas: 200, pprt: 'bas' },
      loin,
    ];
    for (const d of cas) expect(connues).toContain(idClasse(classerCarreau(d, profil)));
  });
});
