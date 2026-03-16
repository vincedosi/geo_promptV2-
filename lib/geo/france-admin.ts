/**
 * lib/geo/france-admin.ts
 * Données statiques : régions / départements français, types POI, métriques Filosofi.
 */

export interface Dept   { code: string; nom: string; }
export interface Region { id: string; nom: string; depts: Dept[]; }

export const REGIONS_ADMIN: Region[] = [
  { id: 'ara', nom: 'Auvergne-Rhône-Alpes', depts: [
    {code:'01',nom:'Ain'},{code:'03',nom:'Allier'},{code:'07',nom:'Ardèche'},
    {code:'15',nom:'Cantal'},{code:'26',nom:'Drôme'},{code:'38',nom:'Isère'},
    {code:'42',nom:'Loire'},{code:'43',nom:'Haute-Loire'},{code:'63',nom:'Puy-de-Dôme'},
    {code:'69',nom:'Rhône'},{code:'73',nom:'Savoie'},{code:'74',nom:'Haute-Savoie'},
  ]},
  { id: 'bfc', nom: 'Bourgogne-Franche-Comté', depts: [
    {code:'21',nom:'Côte-d\'Or'},{code:'25',nom:'Doubs'},{code:'39',nom:'Jura'},
    {code:'58',nom:'Nièvre'},{code:'70',nom:'Haute-Saône'},{code:'71',nom:'Saône-et-Loire'},
    {code:'89',nom:'Yonne'},{code:'90',nom:'Territoire de Belfort'},
  ]},
  { id: 'bre', nom: 'Bretagne', depts: [
    {code:'22',nom:'Côtes-d\'Armor'},{code:'29',nom:'Finistère'},
    {code:'35',nom:'Ille-et-Vilaine'},{code:'56',nom:'Morbihan'},
  ]},
  { id: 'cvl', nom: 'Centre-Val de Loire', depts: [
    {code:'18',nom:'Cher'},{code:'28',nom:'Eure-et-Loir'},{code:'36',nom:'Indre'},
    {code:'37',nom:'Indre-et-Loire'},{code:'41',nom:'Loir-et-Cher'},{code:'45',nom:'Loiret'},
  ]},
  { id: 'cor', nom: 'Corse', depts: [
    {code:'2A',nom:'Corse-du-Sud'},{code:'2B',nom:'Haute-Corse'},
  ]},
  { id: 'ges', nom: 'Grand Est', depts: [
    {code:'08',nom:'Ardennes'},{code:'10',nom:'Aube'},{code:'51',nom:'Marne'},
    {code:'52',nom:'Haute-Marne'},{code:'54',nom:'Meurthe-et-Moselle'},{code:'55',nom:'Meuse'},
    {code:'57',nom:'Moselle'},{code:'67',nom:'Bas-Rhin'},{code:'68',nom:'Haut-Rhin'},{code:'88',nom:'Vosges'},
  ]},
  { id: 'hdf', nom: 'Hauts-de-France', depts: [
    {code:'02',nom:'Aisne'},{code:'59',nom:'Nord'},{code:'60',nom:'Oise'},
    {code:'62',nom:'Pas-de-Calais'},{code:'80',nom:'Somme'},
  ]},
  { id: 'idf', nom: 'Île-de-France', depts: [
    {code:'75',nom:'Paris'},{code:'77',nom:'Seine-et-Marne'},{code:'78',nom:'Yvelines'},
    {code:'91',nom:'Essonne'},{code:'92',nom:'Hauts-de-Seine'},
    {code:'93',nom:'Seine-Saint-Denis'},{code:'94',nom:'Val-de-Marne'},{code:'95',nom:'Val-d\'Oise'},
  ]},
  { id: 'nor', nom: 'Normandie', depts: [
    {code:'14',nom:'Calvados'},{code:'27',nom:'Eure'},{code:'50',nom:'Manche'},
    {code:'61',nom:'Orne'},{code:'76',nom:'Seine-Maritime'},
  ]},
  { id: 'naq', nom: 'Nouvelle-Aquitaine', depts: [
    {code:'16',nom:'Charente'},{code:'17',nom:'Charente-Maritime'},{code:'19',nom:'Corrèze'},
    {code:'23',nom:'Creuse'},{code:'24',nom:'Dordogne'},{code:'33',nom:'Gironde'},
    {code:'40',nom:'Landes'},{code:'47',nom:'Lot-et-Garonne'},{code:'64',nom:'Pyrénées-Atlantiques'},
    {code:'79',nom:'Deux-Sèvres'},{code:'86',nom:'Vienne'},{code:'87',nom:'Haute-Vienne'},
  ]},
  { id: 'occ', nom: 'Occitanie', depts: [
    {code:'09',nom:'Ariège'},{code:'11',nom:'Aude'},{code:'12',nom:'Aveyron'},
    {code:'30',nom:'Gard'},{code:'31',nom:'Haute-Garonne'},{code:'32',nom:'Gers'},
    {code:'34',nom:'Hérault'},{code:'46',nom:'Lot'},{code:'48',nom:'Lozère'},
    {code:'65',nom:'Hautes-Pyrénées'},{code:'66',nom:'Pyrénées-Orientales'},
    {code:'81',nom:'Tarn'},{code:'82',nom:'Tarn-et-Garonne'},
  ]},
  { id: 'pdl', nom: 'Pays de la Loire', depts: [
    {code:'44',nom:'Loire-Atlantique'},{code:'49',nom:'Maine-et-Loire'},
    {code:'53',nom:'Mayenne'},{code:'72',nom:'Sarthe'},{code:'85',nom:'Vendée'},
  ]},
  { id: 'pac', nom: 'Provence-Alpes-Côte d\'Azur', depts: [
    {code:'04',nom:'Alpes-de-Haute-Provence'},{code:'05',nom:'Hautes-Alpes'},
    {code:'06',nom:'Alpes-Maritimes'},{code:'13',nom:'Bouches-du-Rhône'},
    {code:'83',nom:'Var'},{code:'84',nom:'Vaucluse'},
  ]},
  { id: 'dom', nom: 'DROM-COM', depts: [
    {code:'971',nom:'Guadeloupe'},{code:'972',nom:'Martinique'},
    {code:'973',nom:'Guyane'},{code:'974',nom:'La Réunion'},{code:'976',nom:'Mayotte'},
  ]},
];

export const ALL_DEPTS: Dept[] = REGIONS_ADMIN.flatMap(r => r.depts);

export const POI_TYPES = [
  { id: 'CIRFA',        label: 'CIRFA'       },
  { id: 'Lycées',       label: 'Lycées'      },
  { id: 'BTS / IUT',   label: 'BTS / IUT'   },
  { id: 'CFA',          label: 'CFA'         },
  { id: 'Gares',        label: 'Gares'       },
  { id: 'Universités',  label: 'Universités' },
  { id: 'Hôpitaux',    label: 'Hopitaux'    },
  { id: 'Pharmacies',   label: 'Pharmacies'  },
  { id: 'Supermarchés', label: 'Supermarches'},
  { id: 'Fast-foods',   label: 'Fast-foods'  },
  { id: 'Banques',      label: 'Banques'     },
  { id: 'Panneaux OOH', label: 'Panneaux OOH'},
];

export const AUDIENCE_METRICS = [
  // Population
  { id: 'ind',       label: 'Population totale'     },
  { id: 'ind_inc',   label: 'Population inconnue'   },
  // Tranches d'age
  { id: 'ind_0_3',   label: '0-3 ans'               },
  { id: 'ind_4_5',   label: '4-5 ans'               },
  { id: 'ind_6_10',  label: '6-10 ans'              },
  { id: 'ind_11_17', label: '11-17 ans'             },
  { id: 'ind_18_24', label: 'Jeunes 18-24 ans'      },
  { id: 'ind_25_39', label: 'Actifs 25-39 ans'      },
  { id: 'ind_40_54', label: 'Actifs 40-54 ans'      },
  { id: 'ind_55_64', label: '55-64 ans'             },
  { id: 'ind_65_79', label: 'Seniors 65-79 ans'     },
  { id: 'ind_80p',   label: 'Seniors 80 ans et +'   },
  // Menages
  { id: 'men',       label: 'Menages total'         },
  { id: 'men_pauv',  label: 'Menages pauvres'       },
  { id: 'men_1ind',  label: 'Menages 1 personne'    },
  { id: 'men_5ind',  label: 'Menages 5+ personnes'  },
  { id: 'men_prop',  label: 'Menages proprietaires' },
  { id: 'men_fmp',   label: 'Familles monoparent.'  },
  { id: 'men_mais',  label: 'Menages en maison'     },
  { id: 'men_coll',  label: 'Menages en collectif'  },
  { id: 'men_surf',  label: 'Surface moyenne (m2)'  },
  // Revenus
  { id: 'ind_snv',   label: 'Revenu median (€)'     },
  // Logements
  { id: 'log_av45',  label: 'Logements avant 1945'  },
  { id: 'log_45_70', label: 'Logements 1945-1970'   },
  { id: 'log_70_90', label: 'Logements 1970-1990'   },
  { id: 'log_ap90',  label: 'Logements apres 1990'  },
  { id: 'log_soc',   label: 'Logements sociaux'     },
  { id: 'log_inc',   label: 'Logements inconnus'    },
];

export const ISO_MODES = [
  { id: 'walk',  label: 'Pied'    },
  { id: 'bike',  label: 'Velo'    },
  { id: 'drive', label: 'Voiture' },
];

export const ISO_DURATIONS = [5, 10, 15, 20, 30, 60, 90, 120];
export const POI_RAYONS    = ['500m', '1km', '2km', '3km', '5km', '10km', '20km'];
