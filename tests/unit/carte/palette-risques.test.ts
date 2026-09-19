import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  COULEURS_MAPLIBRE,
  COULEURS_CSS,
  ORDRE_TYPES,
  LIBELLE_TYPE,
  TYPE_PAR_PREFIXE,
  typeRisqueDepuisPrefixes,
  expressionCouleurRisque,
  typeRisqueDepuisLibelle,
  librellesDuType,
} from '@/lib/carte/palette-risques';
import { FAMILLES_ICPE_SEED } from '@/lib/import/georisques/familles';

const CSS = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');

/**
 * Deux copies de la même palette existent, et c'est assumé : MapLibre ne
 * résout pas `var()` dans `paint`, la légende ne veut pas d'un hex en dur.
 * Ce test est ce qui empêche les deux de divergent — même rôle que
 * `palette-divergente-css.test.ts`.
 */
describe('palette des types de risque — les deux copies concordent', () => {
  it('chaque jeton CSS référencé est défini dans les DEUX thèmes', () => {
    const bloc = (selecteur: string) => {
      const i = CSS.indexOf(selecteur);
      expect(i, `bloc ${selecteur} introuvable dans globals.css`).toBeGreaterThan(-1);
      return CSS.slice(i, i + 9000);
    };
    const sombre = bloc(':root');
    const clair = bloc('html.light');

    for (const ref of Object.values(COULEURS_CSS)) {
      const nom = ref.replace(/^var\(/, '').replace(/\)$/, '');
      expect(sombre, `${nom} absent du thème sombre`).toContain(`${nom}:`);
      expect(clair, `${nom} absent du thème clair`).toContain(`${nom}:`);
    }
  });

  it('les hex MapLibre du thème sombre sont ceux déclarés dans :root', () => {
    const i = CSS.indexOf(':root');
    const sombre = CSS.slice(i, CSS.indexOf('html.light'));
    for (const [type, hex] of Object.entries(COULEURS_MAPLIBRE.dark)) {
      if (type === 'non_precise') continue;
      expect(sombre.toLowerCase(), `--risque-${type} devrait valoir ${hex} en sombre`)
        .toContain(hex.toLowerCase());
    }
  });

  it('les hex MapLibre du thème clair sont ceux déclarés dans html.light', () => {
    const clair = CSS.slice(CSS.indexOf('html.light'));
    for (const [type, hex] of Object.entries(COULEURS_MAPLIBRE.light)) {
      if (type === 'non_precise') continue;
      expect(clair.toLowerCase(), `--risque-${type} devrait valoir ${hex} en clair`)
        .toContain(hex.toLowerCase());
    }
  });
});

describe('palette des types de risque — bornes de lisibilité', () => {
  it('ne déclare QUE quatre couleurs, plus le neutre', () => {
    // Le validateur de palette refuse cinq teintes sur une carte (mode
    // --pairs all) : à 5, vert↔aqua tombe à ΔE 11,9 en vision normale sur fond
    // sombre. Ajouter un type coloré ici sans re-valider ferait mentir la
    // légende.
    const colores = ORDRE_TYPES.filter((t) => t !== 'non_precise');
    expect(colores).toHaveLength(4);
  });

  it('le non-précisé porte le gris neutre du projet, pas une teinte de la palette', () => {
    expect(COULEURS_CSS.non_precise).toBe('var(--donnee-absente)');
    expect(COULEURS_MAPLIBRE.dark.non_precise).toBe(COULEURS_MAPLIBRE.light.non_precise);
  });

  it('chaque type a un libellé, et aucun n est vide', () => {
    for (const t of ORDRE_TYPES) expect(LIBELLE_TYPE[t].trim().length).toBeGreaterThan(0);
  });
});

describe('regroupement des familles de rubriques', () => {
  it('TOUTES les familles du registre sont rattachées à un type', () => {
    // Sans ça, une famille ajoutée au registre tomberait silencieusement en
    // « non précisé » et disparaîtrait de la lecture par couleur.
    const orphelines = FAMILLES_ICPE_SEED
      .map((f) => f.prefixe)
      .filter((p) => !TYPE_PAR_PREFIXE[p]);
    expect(orphelines).toEqual([]);
  });

  it('retient le type le plus grave quand un site en cumule plusieurs', () => {
    expect(typeRisqueDepuisPrefixes(['25', '41'])).toBe('toxique');
    expect(typeRisqueDepuisPrefixes(['29', '47'])).toBe('inflammable');
    expect(typeRisqueDepuisPrefixes(['25', '27'])).toBe('pollution');
    expect(typeRisqueDepuisPrefixes(['25', '29'])).toBe('autres');
  });

  it('ne dépend pas de l ordre des préfixes reçus', () => {
    expect(typeRisqueDepuisPrefixes(['41', '25'])).toBe(typeRisqueDepuisPrefixes(['25', '41']));
  });

  it('rend non_precise sur une liste vide, nulle ou inconnue', () => {
    expect(typeRisqueDepuisPrefixes([])).toBe('non_precise');
    expect(typeRisqueDepuisPrefixes(null)).toBe('non_precise');
    expect(typeRisqueDepuisPrefixes(['99'])).toBe('non_precise');
  });
});

describe('expression MapLibre', () => {
  it('couvre les quatre types et porte une valeur par défaut', () => {
    const expr = expressionCouleurRisque('dark') as unknown[];
    expect(expr[0]).toBe('match');
    for (const t of ['toxique', 'inflammable', 'pollution', 'autres']) {
      expect(expr).toContain(t);
    }
    // Dernier élément = défaut, et c'est le gris : une feature dont le type
    // serait inconnu doit se peindre en « pas d'information », jamais en
    // toxique par accident.
    expect(expr[expr.length - 1]).toBe(COULEURS_MAPLIBRE.dark.non_precise);
  });

  it('rend des couleurs différentes selon le thème', () => {
    const sombre = JSON.stringify(expressionCouleurRisque('dark'));
    const clair = JSON.stringify(expressionCouleurRisque('light'));
    expect(sombre).not.toBe(clair);
  });
});

describe('accord entre la couleur et le filtre', () => {
  it('le libellé stocké en base donne le même type que son préfixe', () => {
    expect(typeRisqueDepuisLibelle('Toxicité aiguë', FAMILLES_ICPE_SEED)).toBe('toxique');
    expect(typeRisqueDepuisLibelle('GPL et produits pétroliers', FAMILLES_ICPE_SEED)).toBe('inflammable');
    expect(typeRisqueDepuisLibelle('Déchets', FAMILLES_ICPE_SEED)).toBe('pollution');
    expect(typeRisqueDepuisLibelle('Matériaux et minéraux', FAMILLES_ICPE_SEED)).toBe('autres');
  });

  it('« Nature non précisée » et l inconnu tombent sur le neutre', () => {
    expect(typeRisqueDepuisLibelle('Nature non précisée', FAMILLES_ICPE_SEED)).toBe('non_precise');
    expect(typeRisqueDepuisLibelle(null, FAMILLES_ICPE_SEED)).toBe('non_precise');
    expect(typeRisqueDepuisLibelle('Inventé', FAMILLES_ICPE_SEED)).toBe('non_precise');
  });

  it('les libellés d un type couvrent exactement les familles de ce type', () => {
    // C'est cette liste que le serveur passe au `.in()` : si elle divergeait de
    // la couleur, un point filtré « toxique » pourrait se peindre autrement.
    const libelles = librellesDuType('inflammable', FAMILLES_ICPE_SEED);
    expect(libelles).toContain('GPL et produits pétroliers');
    expect(libelles).toContain('Explosibles');
    expect(libelles).not.toContain('Déchets');
    for (const l of libelles) {
      expect(typeRisqueDepuisLibelle(l, FAMILLES_ICPE_SEED)).toBe('inflammable');
    }
  });

  it('les quatre types réunis couvrent tout le registre, sans recouvrement', () => {
    const tous = (['toxique', 'inflammable', 'pollution', 'autres'] as const)
      .flatMap((t) => librellesDuType(t, FAMILLES_ICPE_SEED));
    expect(new Set(tous).size).toBe(tous.length);
    expect(tous).toHaveLength(FAMILLES_ICPE_SEED.length);
  });
});
