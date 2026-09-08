/**
 * @file filter-panel/use-civic-ingest.ts — ingestion nationale pollen + air
 *
 * Extrait de FilterPanel.tsx (2026-09-08). Declenche POST /api/admin/civic-ingest
 * et consomme sa reponse NDJSON ligne a ligne pour afficher la progression dans
 * la section Sante environnementale.
 *
 * La route enforce requireAdmin cote serveur : un 403 est traduit en message
 * lisible plutot qu'en erreur brute. Les lignes NDJSON partielles (buffer coupe
 * au milieu d'un chunk) sont ignorees via le garde SyntaxError — sans lui, un
 * chunk tronque ferait echouer toute l'ingestion.
 */
import { useCallback, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';

export interface CivicIngestState {
  running: boolean;
  message: string | null;
  error: string | null;
}

export interface CivicIngest {
  civicIngestState: CivicIngestState;
  runCivicIngestStream: () => Promise<void>;
}

/**
 * @param onCivicIngested Appele apres une ingestion reussie — le parent
 *   recharge la couche pour afficher les valeurs fraiches.
 */
export function useCivicIngest(onCivicIngested?: () => void): CivicIngest {
  // Ingestion santé environnementale (admin) — POST NDJSON streaming,
  // progression affichée dans le bloc. La route enforce requireAdmin (403 → message).
  const [civicIngestState, setCivicIngestState] = useState<{
    running: boolean; message: string | null; error: string | null;
  }>({ running: false, message: null, error: null });

  const runCivicIngestStream = useCallback(async () => {
    setCivicIngestState({ running: true, message: 'Démarrage…', error: null });
    try {
      const res = await adminFetch('/api/admin/civic-ingest', { method: 'POST' });
      if (res.status === 403) throw new Error('Réservé aux administrateurs.');
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const raw of lines) {
          if (!raw.trim()) continue;
          try {
            const line = JSON.parse(raw) as {
              type: string;
              message?: string;
              summary?: {
                pollen: { cps_written?: number; date?: string; error?: string };
                atmo: { cps_written?: number; date?: string; error?: string };
              };
            };
            if (line.type === 'progress' && line.message) {
              setCivicIngestState({ running: true, message: line.message, error: null });
            } else if (line.type === 'done') {
              const parts: string[] = [];
              if (line.summary?.pollen?.cps_written != null) parts.push(`pollen ${line.summary.pollen.cps_written} CP`);
              if (line.summary?.atmo?.cps_written != null) parts.push(`air ${line.summary.atmo.cps_written} CP`);
              setCivicIngestState({
                running: false,
                message: `Terminé : ${parts.join(' · ') || 'aucune donnée'}`,
                error: null,
              });
              onCivicIngested?.();
            } else if (line.type === 'error') {
              throw new Error(line.message ?? 'Erreur inconnue');
            }
          } catch (err) {
            if (err instanceof SyntaxError) continue; // ligne NDJSON partielle
            throw err;
          }
        }
      }
    } catch (err) {
      setCivicIngestState({
        running: false, message: null,
        error: err instanceof Error ? err.message : 'Erreur inconnue',
      });
    }
  }, [onCivicIngested]);

  return { civicIngestState, runCivicIngestStream };
}
