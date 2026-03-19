/**
 * lib/chat/tools/schemas.ts
 * Schémas Zod de tous les outils IA — injectés dans streamText.
 */

import { z }             from 'zod';
import { executeToolCall } from './index';

export function buildTools(
  categoriesList:  string[],
  forceRecalculate: boolean,
) {
  const catsDesc = `Type exact parmi : ${categoriesList.join(', ')}`;

  return {
    analyser_zone_pois: {
      description: 'Affiche POI sur carte géographique.',
      inputSchema: z.object({
        ville:             z.string().optional().describe('Ville française.'),
        region:            z.string().optional().describe('Région française.'),
        departement:       z.string().optional().describe('Département ou code.'),
        categorie_poi:     z.string().optional().describe(catsDesc),
        rayon_metres:      z.number().optional().describe('Rayon km autour ville.'),
        rayon_poi_metres:  z.number().optional().describe('Rayon autour chaque POI.'),
        isochrone_minutes: z.number().optional().describe('Durée isochrone (min).'),
        isochrone_mode:    z.enum(['walk', 'drive', 'bike']).optional().describe('walk/drive/bike.'),
        couleur:           z.string().optional().describe('Couleur CSS marqueurs.'),
      }),
      execute: (args: Record<string, unknown>) =>
        executeToolCall('analyser_zone_pois', args, categoriesList, { forceRecalculate }),
    },

    voronoi_analysis: {
      description: "Polygones de Voronoï / zones d'influence territoriales.",
      inputSchema: z.object({
        category:       z.string().describe(catsDesc),
        ville:          z.string().optional().describe('Ville (opt).'),
        region:         z.string().optional().describe('Région (opt).'),
        departement:    z.string().optional().describe('Département (opt).'),
        metropolitaine: z.boolean().optional().describe('true=métropole, false=+DROM.'),
      }),
      execute: (args: Record<string, unknown>) =>
        executeToolCall('voronoi_analysis', args, categoriesList, {}),
    },

    afficher_carreaux: {
      description: 'Carte thermique carreaux INSEE Filosofi 200m.',
      inputSchema: z.object({
        indicateur:       z.string().describe('Colonne Filosofi (ind_18_24, Ind, rev_median…).'),
        indicateur_label: z.string().describe('Label lisible.'),
        ville:            z.string().optional().describe('Ville centre.'),
        rayon_km:         z.number().optional().describe('Rayon km (déf 4.5).'),
      }),
      execute: (args: Record<string, unknown>) =>
        executeToolCall('afficher_carreaux', args, categoriesList, {}),
    },

    isochrone_battle_v2: {
      description: 'Sectorisation ST_Difference depuis cache ORS (rapide, sans calcul). Paliers libres.',
      inputSchema: z.object({
        category:       z.string().describe(catsDesc),
        paliers:        z.array(z.number()).optional().describe('Paliers min (ex: [10,20,30,60]). Déf: [10,20,30,60,90].'),
        mode:           z.enum(['drive', 'walk', 'bike']).optional().describe('Mode (déf drive).'),
        ville:          z.string().optional().describe('Filtre ville.'),
        region:         z.string().optional().describe('Filtre région.'),
        metropolitaine: z.boolean().optional().describe('true=métropole (déf).'),
      }),
      execute: (args: Record<string, unknown>) =>
        executeToolCall('isochrone_battle_v2', args, categoriesList, {}),
    },

    isochrone_battle: {
      description: 'Sectorisation ORS live (calcul ~1-2 min). Utiliser si cache absent.',
      inputSchema: z.object({
        category:       z.string().describe(catsDesc),
        mode:           z.enum(['drive', 'walk', 'bike']).optional().describe('Mode (déf drive).'),
        ville:          z.string().optional().describe('Filtre ville.'),
        region:         z.string().optional().describe('Filtre région.'),
        departement:    z.string().optional().describe('Filtre département.'),
        metropolitaine: z.boolean().optional().describe('true=métropole.'),
        max_minutes:    z.number().optional().describe('Durée max min (déf 120).'),
      }),
      execute: (args: Record<string, unknown>) =>
        executeToolCall('isochrone_battle', args, categoriesList, { forceRecalculate }),
    },

    analyser_panneaux: {
      description: 'Affiche panneaux OOH sur carte.',
      inputSchema: z.object({
        regie:        z.string().optional().describe('Régie (ex: JCDecaux).'),
        ville:        z.string().optional().describe('Ville.'),
        region:       z.string().optional().describe('Région.'),
        departement:  z.string().optional().describe('Département.'),
        type_panneau: z.string().optional().describe('Format panneau.'),
        couleur:      z.string().optional().describe('Couleur CSS.'),
      }),
      execute: (args: Record<string, unknown>) =>
        executeToolCall('analyser_panneaux', args, categoriesList, {}),
    },

    classer_panneaux_audience: {
      description: 'Classe panneaux OOH par audience démographique.',
      inputSchema: z.object({
        ville:         z.string().describe('Ville (requis).'),
        target_column: z.string().describe('Colonne Filosofi (ind_18_24, Ind…).'),
        target_label:  z.string().describe('Label cible.'),
        rayon_metres:  z.number().optional().describe('Rayon m/panneau (déf 500).'),
        limit:         z.number().optional().describe('Max panneaux (déf 10).'),
        regie:         z.string().optional().describe('Régie.'),
      }),
      execute: (args: Record<string, unknown>) =>
        executeToolCall('classer_panneaux_audience', args, categoriesList, {}),
    },

    scorer_panneaux_ooh: {
      description: 'Score multi-critères panneaux OOH (audience × contexte POI).',
      inputSchema: z.object({
        ville:          z.string().describe('Ville (requis).'),
        target_column:  z.string().describe('Colonne Filosofi (ind_18_24, Ind…).'),
        target_label:   z.string().describe('Label cible.'),
        rayon_metres:   z.number().optional().describe('Rayon m (déf 500).'),
        poids_demo:     z.number().optional().describe('Poids démo [0-1] (déf 0.65).'),
        poids_contexte: z.number().optional().describe('Poids POI [0-1] (déf 0.35).'),
        limit:          z.number().optional().describe('Max panneaux (déf 10).'),
        regie:          z.string().optional().describe('Régie.'),
      }),
      execute: (args: Record<string, unknown>) =>
        executeToolCall('scorer_panneaux_ooh', args, categoriesList, {}),
    },

    exporter_rapport_ooh: {
      description: "Export rapport Excel OOH complet d'une ville.",
      inputSchema: z.object({
        ville:          z.string().describe('Ville (requis).'),
        target_column:  z.string().describe('Colonne Filosofi.'),
        target_label:   z.string().describe('Label cible.'),
        rayon_metres:   z.number().optional().describe('Rayon m (déf 500).'),
        poids_demo:     z.number().optional().describe('Poids démo (déf 0.65).'),
        poids_contexte: z.number().optional().describe('Poids POI (déf 0.35).'),
        regie:          z.string().optional().describe('Régie.'),
      }),
      execute: (args: Record<string, unknown>) =>
        executeToolCall('exporter_rapport_ooh', args, categoriesList, {}),
    },

    analyze_poi_synergy: {
      description: "Panneaux OOH proches d'un POI ET à forte densité démographique.",
      inputSchema: z.object({
        poi_category:      z.string().describe(catsDesc),
        ville:             z.string().describe('Ville (requis).'),
        target_demo_col:   z.string().describe('Colonne Filosofi.'),
        target_demo_label: z.string().describe('Label cible.'),
        max_distance_m:    z.number().optional().describe('Rayon POI m (déf 500).'),
        min_audience:      z.number().optional().describe('Audience min (déf 0).'),
        buffer_radius_m:   z.number().optional().describe('Visibilité panneau m (déf 300).'),
      }),
      execute: (args: Record<string, unknown>) =>
        executeToolCall('analyze_poi_synergy', args, categoriesList, {}),
    },

    calculate_audience_coverage: {
      description: "Nb de personnes d'une cible dans un isochrone autour d'un lieu.",
      inputSchema: z.object({
        location_name:       z.string().describe('Lieu ou ville.'),
        travel_time_minutes: z.number().describe('Durée trajet min.'),
        target_column:       z.string().describe('Colonne Filosofi (Ind, ind_18_24…).'),
        target_label:        z.string().describe('Label cible.'),
        mode:                z.enum(['drive', 'walk', 'bike']).optional().describe('Mode (déf drive).'),
      }),
      execute: (args: Record<string, unknown>) =>
        executeToolCall('calculate_audience_coverage', args, categoriesList, {}),
    },
  };
}
