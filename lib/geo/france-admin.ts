/**
 * lib/geo/france-admin.ts
 * Données statiques : types POI, métriques Filosofi, modes/durées isochrones.
 *
 * ⚠️  RÉGIONS / DÉPARTEMENTS : supprimés de ce fichier — codes INSEE servis
 * dynamiquement depuis ref_regions + ref_departements via /api/ref/geo
 * (lib/geo/use-ref-geo.ts côté client, region-lookup-server.ts côté API).
 * Principe MAGELIAN : rien de hardcodé, tout dynamique.
 */

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
