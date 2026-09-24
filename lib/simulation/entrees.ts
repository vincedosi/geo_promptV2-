/**
 * Le passage d'une entrée brute (`simulation_entrees`, sql/232) à ce que le
 * générateur et l'alignement consomment.
 *
 * Isolé de `serveur.ts` pour être importable côté client : l'écran recalcule
 * la cible par zone depuis les mêmes entrées que le serveur.
 */
import type { CpSimulation } from '@/lib/simulation/types';
import type { EntreeBrute } from '@/lib/simulation/payload';

/** Une entrée brute, ramenée à ce que le générateur consomme. */
export function versCpSimulation(e: EntreeBrute): CpSimulation {
  return {
    code_postal: e.code_postal,
    code_canonique: e.code_canonique,
    cluster_id: e.cluster_id,
    retenu: e.retenu,
    multiplicateur: Number(e.multiplicateur),
    pop_en_zone: Number(e.pop_en_zone),
    pop_totale: Number(e.pop_totale),
    part_en_zone: Number(e.part_en_zone),
    surface_km2: e.surface_km2 == null ? null : Number(e.surface_km2),
    membre: e.membre,
  };
}
