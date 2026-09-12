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
        // `.max(12)` : cette liste vient du LLM et pilotait autrefois le nombre
        // de requêtes envoyées à la base (`PERF-005`). Elle n'en pilote plus
        // qu'une seule, mais un plafond reste la bonne hygiène — rien ne borne
        // ce qu'un modèle peut demander.
        poi_categories:  z.array(z.string()).max(12).describe('Catégories POI à inclure dans le rapport (12 au plus).'),
        poi_centre:          z.string().optional().describe('POI centre si isochrone.'),
        isochrone_minutes:   z.number().optional().describe('Durée isochrone si pertinent.'),
        isochrone_mode:      z.string().optional().describe('Mode isochrone.'),
      }),
      execute: (args: Record<string, unknown>) =>
        executeToolCall('analyse_complete', args, categoriesList, {}),
    },

    classement_territoires: {
      description: "Classe les communes ou départements sur N'IMPORTE QUEL indicateur numérique IRIS (ex: pop_15_29, taux_chomage, rev_median), en volume ou en part. Répond à « les 10 villes où il y a le plus de X, en volume et en % ». Rend un tableau ET un histogramme. Les tranches d'âge INSEE font 15 ans (pop_0_14, pop_15_29, pop_30_44, pop_45_59, pop_60_74, pop_75_plus) — il n'existe PAS de tranche 15-24 : utiliser pop_15_29 et le dire explicitement. Un tri en 'part' sur un indicateur qui n'est pas un effectif (taux, indice, revenu…) échoue — trier ces indicateurs en 'volume'.",
      inputSchema: z.object({
        indicateur: z.string().describe("Colonne numérique du palier (ex: pop_15_29, population, taux_chomage, rev_median)."),
        palier:     z.enum(['commune', 'departement']).optional().describe("Palier géographique (déf: commune). Paris/Lyon/Marseille n'existent qu'en arrondissements — voir regrouper_arrondissements."),
        tri:        z.enum(['volume', 'part']).optional().describe("volume=valeur brute (déf), part=% de la population — uniquement valable si l'indicateur est un effectif."),
        plancher_population: z.number().optional().describe("Seuil de population minimum. Indispensable pour un tri en 'part' (sinon une petite commune fausse le classement) — 20 000 appliqué par défaut si omis."),
        limite:     z.number().optional().describe("Nombre de territoires à renvoyer, 100 au plus (déf 10)."),
        regrouper_arrondissements: z.boolean().optional().describe("Reconstitue Paris/Lyon/Marseille depuis leurs arrondissements (déf true)."),
      }),
      execute: (args: Record<string, unknown>) =>
        executeToolCall('classement_territoires', args, categoriesList, {}),
    },
  };
}
