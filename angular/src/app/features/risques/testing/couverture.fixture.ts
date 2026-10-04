import type { Bandes } from '../data/profil-risque.api';

/**
 * Réponse RÉELLE de la RPC qui sert `/api/risques/profil/bandes`, profil par défaut (haut 1/2/5 km, bas
 * 500 m/1 km, PPRT inclus), cible `ind`, maille RÉGION, France entière — base locale, 2026-10-04 :
 * `select population_par_classe(<profil par défaut>, 'ind', 'region', null, 200, null, null)`.
 * 15 régions (dont la Martinique et La Réunion, seules d'outre-mer carroyées). Total 14 103 578.
 *
 * Convertie et non typée : la réponse porte des champs que le type `Bandes` ne déclare pas
 * (`calculable`, `natures`…), et l'inférence de ses `classes` hétérogènes ne rejoint pas `Record<string, number>`.
 */
const BRUT = {
  cible: 'ind',
  total: 14103578,
  maille: 'region',
  parent: null,
  region: null,
  unites: [
    {
      nom: 'Île-de-France',
      total: 3076627,
      unite: '11',
      classes: {
        'bas:1': 34458,
        'bas:2': 147766,
        'haut:1': 74214,
        'haut:2': 423801,
        'haut:3': 2383099,
        'haut:pprt': 13291
      },
      pop_totale: 11834764,
      'surface_km2': 12060.6655136181
    },
    {
      nom: 'Auvergne-Rhône-Alpes',
      total: 2230730,
      unite: '84',
      classes: {
        'bas:1': 14563,
        'bas:2': 53959,
        'haut:1': 131538,
        'haut:2': 440236,
        'haut:3': 1536538,
        'haut:pprt': 53898
      },
      pop_totale: 7701055,
      'surface_km2': 70895.6065585226
    },
    {
      nom: 'Hauts-de-France',
      total: 2022160,
      unite: '32',
      classes: {
        'bas:1': 6650,
        'bas:2': 26119,
        'haut:1': 82606,
        'haut:2': 398064,
        'haut:3': 1486117,
        'bas:pprt': 450,
        'haut:pprt': 22156
      },
      pop_totale: 5718373,
      'surface_km2': 31910.4655668757
    },
    {
      nom: 'Occitanie',
      total: 1213364,
      unite: '76',
      classes: {
        'bas:1': 2289,
        'bas:2': 15809,
        'haut:1': 30928,
        'haut:2': 167808,
        'haut:3': 991992,
        'haut:pprt': 4539
      },
      pop_totale: 5709879,
      'surface_km2': 73383.9234028565
    },
    {
      nom: 'Grand Est',
      total: 1150839,
      unite: '44',
      classes: {
        'bas:1': 7076,
        'bas:2': 28763,
        'haut:1': 37525,
        'haut:2': 164486,
        'haut:3': 889040,
        'bas:pprt': 6,
        'haut:pprt': 23944
      },
      pop_totale: 5227747,
      'surface_km2': 57676.4220369811
    },
    {
      nom: 'Normandie',
      total: 811103,
      unite: '28',
      classes: {
        'bas:1': 2306,
        'bas:2': 11387,
        'haut:1': 25060,
        'haut:2': 137882,
        'haut:3': 569781,
        'haut:pprt': 64689
      },
      pop_totale: 3198102,
      'surface_km2': 30058.4537844405
    },
    {
      nom: 'Nouvelle-Aquitaine',
      total: 718561,
      unite: '75',
      classes: {
        'bas:1': 10574,
        'bas:2': 40164,
        'haut:1': 42021,
        'haut:2': 110294,
        'haut:3': 502230,
        'bas:pprt': 238,
        'haut:pprt': 13041
      },
      pop_totale: 5830140,
      'surface_km2': 84753.7686864515
    },
    {
      nom: "Provence-Alpes-Côte d'Azur",
      total: 681502,
      unite: '93',
      classes: {
        'bas:1': 9234,
        'bas:2': 19261,
        'haut:1': 30933,
        'haut:2': 124502,
        'haut:3': 471917,
        'haut:pprt': 25656
      },
      pop_totale: 4911110,
      'surface_km2': 31664.7790029717
    },
    {
      nom: 'Centre-Val de Loire',
      total: 580937,
      unite: '24',
      classes: {
        'bas:1': 7023,
        'bas:2': 16920,
        'haut:1': 20034,
        'haut:2': 98210,
        'haut:3': 436549,
        'bas:pprt': 7,
        'haut:pprt': 2195
      },
      pop_totale: 2479479,
      'surface_km2': 39512.4006361281
    },
    {
      nom: 'Bretagne',
      total: 527146,
      unite: '53',
      classes: {
        'bas:1': 3458,
        'bas:2': 10722,
        'haut:1': 20738,
        'haut:2': 69723,
        'haut:3': 420680,
        'haut:pprt': 1826
      },
      pop_totale: 3305458,
      'surface_km2': 27407.2337781711
    },
    {
      nom: 'Bourgogne-Franche-Comté',
      total: 430710,
      unite: '27',
      classes: {
        'bas:1': 5650,
        'bas:2': 22299,
        'haut:1': 17690,
        'haut:2': 87113,
        'haut:3': 290601,
        'haut:pprt': 7358
      },
      pop_totale: 2658819,
      'surface_km2': 48032.8256645045
    },
    {
      nom: 'Pays de la Loire',
      total: 412618,
      unite: '52',
      classes: {
        'bas:1': 2124,
        'bas:2': 11863,
        'haut:1': 9477,
        'haut:2': 49403,
        'haut:3': 335493,
        'haut:pprt': 4259
      },
      pop_totale: 3760391,
      'surface_km2': 32391.2983747509
    },
    {
      nom: 'Martinique',
      total: 115608,
      unite: '02',
      classes: {
        'bas:1': 897,
        'bas:2': 2110,
        'haut:1': 430,
        'haut:2': 17294,
        'haut:3': 93030,
        'haut:pprt': 1847
      },
      pop_totale: 306745,
      'surface_km2': 1085.45299789098
    },
    {
      nom: 'Corse',
      total: 94536,
      unite: '94',
      classes: {
        'bas:1': 17,
        'bas:2': 608,
        'haut:1': 3583,
        'haut:2': 36548,
        'haut:3': 53350,
        'haut:pprt': 432
      },
      pop_totale: 257344,
      'surface_km2': 8713.80302727045
    },
    {
      nom: 'La Réunion',
      total: 37139,
      unite: '04',
      classes: {
        'bas:1': 103,
        'bas:2': 2896,
        'haut:1': 100,
        'haut:2': 12135,
        'haut:3': 21903,
        'haut:pprt': 3
      },
      pop_totale: 884165,
      'surface_km2': 2514.1499133851
    }
  ],
  natures: [],
  n_unites: 15,
  tronquee: false,
  hors_zone: 26980106,
  calculable: true,
  n_carreaux: 215646,
  par_classe: {
    'bas:1': 106419,
    'bas:2': 410641,
    'haut:1': 526874,
    'haut:2': 2337495,
    'haut:3': 10482317,
    'bas:pprt': 701,
    'haut:pprt': 239131
  },
  n_codes_postaux: 1927,
  pop_unites_touchees: 63783571,
  population_reference: 63783569,
  filtre_natures_applique: false
};

export const BANDES_REGIONS_REELLES = BRUT as unknown as Bandes;

/**
 * Réponse RÉELLE du SECOND calcul, celui d'une exploration de Provence-Alpes-Côte d'Azur depuis la France entière :
 * même profil, maille DÉPARTEMENT, `region = '93'` (base locale, 2026-10-04) —
 * `select population_par_classe(<profil par défaut>, 'ind', 'departement', null, 200, null, '93')`. 6 départements.
 */
const BRUT_PACA = {
  cible: 'ind',
  total: 681503,
  maille: 'departement',
  parent: null,
  region: '93',
  unites: [
    {
      nom: 'Bouches-du-Rhone',
      total: 388271,
      unite: '13',
      classes: {
        'bas:1': 8647,
        'bas:2': 17956,
        'haut:1': 6217,
        'haut:2': 77796,
        'haut:3': 254539,
        'haut:pprt': 23117
      },
      pop_totale: 1918748,
      surface_km2: 5077.82838154214
    },
    {
      nom: 'Alpes-Maritimes',
      total: 115358,
      unite: '06',
      classes: {
        'bas:1': 463,
        'bas:2': 865,
        'haut:1': 6099,
        'haut:2': 20973,
        'haut:3': 86960
      },
      pop_totale: 1107427,
      surface_km2: 4293.83966063093
    },
    {
      nom: 'Var',
      total: 67732,
      unite: '83',
      classes: {
        'bas:1': 44,
        'bas:2': 270,
        'haut:1': 2722,
        'haut:2': 4607,
        'haut:3': 59483,
        'haut:pprt': 607
      },
      pop_totale: 1051307,
      surface_km2: 6026.92900528706
    },
    {
      nom: 'Vaucluse',
      total: 62143,
      unite: '84',
      classes: {
        'bas:1': 80,
        'bas:2': 171,
        'haut:1': 6355,
        'haut:2': 7660,
        'haut:3': 46401,
        'haut:pprt': 1478
      },
      pop_totale: 553751,
      surface_km2: 3577.90026288202
    },
    {
      nom: 'Alpes-de-Hte-Provence',
      total: 47962,
      unite: '04',
      classes: {
        'haut:1': 9542,
        'haut:2': 13464,
        'haut:3': 24502,
        'haut:pprt': 455
      },
      pop_totale: 146962,
      surface_km2: 6996.79843774421
    },
    {
      nom: 'Hautes-Alpes',
      total: 37,
      unite: '05',
      classes: {
        'haut:2': 3,
        'haut:3': 34
      },
      pop_totale: 132916,
      surface_km2: 5691.48325488536
    }
  ],
  natures: [],
  n_unites: 6,
  tronquee: false,
  hors_zone: 2334984,
  calculable: true,
  n_carreaux: 13505,
  par_classe: {
    'bas:1': 9234,
    'bas:2': 19261,
    'haut:1': 30933,
    'haut:2': 124502,
    'haut:3': 471917,
    'haut:pprt': 25656
  },
  n_codes_postaux: 111,
  pop_unites_touchees: 4911111,
  population_reference: 4911110,
  filtre_natures_applique: false
};

export const BANDES_PACA_REELLES = BRUT_PACA as unknown as Bandes;
