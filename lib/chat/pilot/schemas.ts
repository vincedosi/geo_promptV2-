/** Schémas Zod des outils de pilotage — injectés dans streamText via /api/pilot. */
import { z } from 'zod';
import { demarrerPilotage, mesurer, corrigerEnchere, reinitialiser } from './tools';

export function buildPilotTools(userId: string) {
  return {
    demarrer_pilotage: {
      description: "Démarre (ou redémarre) la campagne fictive de pilotage : fige le plan v1 et simule la première période. Retourne le diagnostic initial (écart par item). À appeler en premier.",
      inputSchema: z.object({}),
      execute: () => demarrerPilotage(userId),
    },
    mesurer: {
      description: "Lit le diagnostic de pilotage (écart cible vs réel par item, sous/sur-servi, écart moyen, converged). Version optionnelle ; par défaut la dernière.",
      inputSchema: z.object({ version: z.number().optional().describe('Numéro de version (déf : dernière).') }),
      execute: (args: Record<string, unknown>) => mesurer(userId, typeof args.version === 'number' ? args.version : undefined),
    },
    corriger_enchere: {
      description: "Applique une correction d'enchère (rebid) : relève les items sous-servis, abaisse les sur-servis, resimule la période suivante. Retourne le nouveau diagnostic. À rappeler tant que non conforme.",
      inputSchema: z.object({}),
      execute: () => corrigerEnchere(userId),
    },
    reinitialiser: {
      description: "Efface toute la délivrance et les versions de la campagne fictive (retour à zéro). N'appeler que si l'utilisateur le demande.",
      inputSchema: z.object({}),
      execute: () => reinitialiser(userId),
    },
  };
}
