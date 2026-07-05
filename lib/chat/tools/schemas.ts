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
      description: "Affiche POI sur carte géographique. Avec isochrone_minutes + isochrone_mode, calcule aussi les zones accessibles en X min autour des POI (ORS).",
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
      description: "Polygones de Voronoï : chaque zone appartient au POI le plus proche (vol d'oiseau). Instantané. metropolitaine=true par défaut (exclut DROM).",
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
      description: "Carte thermique carreaux INSEE Filosofi 200m. Utilise les colonnes CHORO_INDICATORS pour l'indicateur (ex: ind_18_24=jeunes, ind_snv=revenus, men_pauv=pauvreté).",
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
      description: "Sectorisation ST_Difference depuis cache ORS (rapide, sans calcul). Appeler EN PREMIER. Si cache absent → proposer isochrone_battle. Paliers libres (ex: [10,20,30,60] min).",
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
      description: "Sectorisation ORS live (calcul ~1-2 min). Utiliser si cache absent ou forceRecalculate. Avertir l'utilisateur avant d'appeler.",
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

    ask_configuration: {
      description: "Appeler cet outil quand l'utilisateur demande une analyse complète, un rapport, une étude, ou un profil d'une zone — même sans précisions supplémentaires. Retourne les options disponibles (cibles démo + catégories POI présentes dans la zone) pour configurer l'analyse. NE PAS demander de clarification : appeler directement.",
      inputSchema: z.object({
        perimetre_type:  z.enum(['ville', 'agglomeration', 'departement', 'region', 'isochrone'])
          .describe('Type de périmètre.'),
        perimetre_value: z.string().describe('Nom de la zone (ex: Brest, Finistère, Bretagne).'),
        poi_centre:          z.string().optional().describe('POI centre si isochrone.'),
        isochrone_minutes:   z.number().optional().describe('Durée isochrone si pertinent.'),
        isochrone_mode:      z.enum(['driving-car', 'foot-walking', 'cycling-regular']).optional()
          .describe('Mode isochrone.'),
      }),
      execute: (args: Record<string, unknown>) =>
        executeToolCall('ask_configuration', args, categoriesList, {}),
    },

    analyse_complete: {
      description: "Rapport complet d'une zone : démographie multi-indicateurs, panneaux OOH, POI par catégorie. Tout en 1 step. Appeler APRÈS ask_configuration quand l'utilisateur a choisi ses paramètres.",
      inputSchema: z.object({
        perimetre_type:  z.enum(['ville', 'agglomeration', 'departement', 'region', 'isochrone'])
          .describe('Type de périmètre.'),
        perimetre_value: z.string().describe('Nom de la zone.'),
        cible:           z.string().describe('Colonne Filosofi cible (ex: ind_18_24).'),
        poi_categories:  z.array(z.string()).describe('Catégories POI à inclure dans le rapport.'),
        poi_centre:          z.string().optional().describe('POI centre si isochrone.'),
        isochrone_minutes:   z.number().optional().describe('Durée isochrone si pertinent.'),
        isochrone_mode:      z.string().optional().describe('Mode isochrone.'),
      }),
      execute: (args: Record<string, unknown>) =>
        executeToolCall('analyse_complete', args, categoriesList, {}),
    },
  };
}
