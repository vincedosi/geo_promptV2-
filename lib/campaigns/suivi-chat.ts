/**
 * Suivi campagne — chat IA : validation du body, troncature d'historique,
 * construction du system prompt à partir de données agrégées bornées.
 * Logique pure (testable Vitest), aucune dépendance Supabase/réseau.
 */
import { z } from 'zod';

export const ChatTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(4000),
});
export type ChatTurn = z.infer<typeof ChatTurnSchema>;

export const CampaignChatBodySchema = z.object({
  message: z.string().min(1).max(2000),
  history: z.array(ChatTurnSchema).max(40).optional().default([]),
});
export type CampaignChatBody = z.infer<typeof CampaignChatBodySchema>;

/** Nombre max de tours renvoyés au LLM — au-delà on tronque (les plus anciens sautent). */
export const MAX_HISTORY_TURNS = 20;

export function truncateHistory(history: ChatTurn[]): ChatTurn[] {
  return history.length > MAX_HISTORY_TURNS ? history.slice(-MAX_HISTORY_TURNS) : history;
}

export interface StatRow { label: string; tracked_ads: number; row_count: number }
export interface JournalLine { at: string; kind: string; title: string; body: string }
export interface StrategyMeta {
  name: string; status: string; algorithm_code: string; objective_code: string;
  execution_mode: string; total_budget: number | null; forecast_cpm: number | null;
  start_date: string | null; end_date: string | null;
}
export interface SuiviChatPromptInput {
  campaign: {
    name: string; dsp_source: string; date_start: string | null; date_end: string | null;
    total_tracked_ads: number; countries: string[] | null; status_override: string | null;
  };
  byCountry: StatRow[];
  byRegion: StatRow[];
  breakdownDept: Array<Record<string, unknown>>;
  strategy: StrategyMeta | null;
  journal: JournalLine[];
}

const MAX_COUNTRY_ROWS = 15;
const MAX_REGION_ROWS = 20;
const MAX_BREAKDOWN_ROWS = 30;
const MAX_JOURNAL_LINES = 50;

function fmtStatRows(rows: StatRow[], max: number): string {
  if (rows.length === 0) return '  (aucune donnée)';
  return rows.slice(0, max)
    .map((r) => `  ${r.label} : ${r.tracked_ads.toLocaleString('fr-FR')} tracked ads (${r.row_count.toLocaleString('fr-FR')} lignes)`)
    .join('\n');
}

export function buildSuiviChatSystemPrompt(input: SuiviChatPromptInput): string {
  const { campaign, byCountry, byRegion, breakdownDept, strategy, journal } = input;

  const strategyBlock = strategy
    ? `Stratégie de bidding rattachée :
- Nom : ${strategy.name} · Statut : ${strategy.status}
- Algorithme : ${strategy.algorithm_code} · Objectif : ${strategy.objective_code} · Mode : ${strategy.execution_mode}
- Budget : ${strategy.total_budget ?? '—'} € · CPM prévisionnel : ${strategy.forecast_cpm ?? '—'} €
- Période : ${strategy.start_date ?? '—'} → ${strategy.end_date ?? '—'}

Journal de pilotage (${Math.min(journal.length, MAX_JOURNAL_LINES)} dernières entrées) :
${journal.slice(-MAX_JOURNAL_LINES).map((e) => `  [${e.at.slice(0, 10)}] (${e.kind}) ${e.title} — ${e.body}`).join('\n') || '  (journal vide)'}`
    : 'Aucune stratégie de bidding rattachée à cette campagne (pas de journal de pilotage disponible).';

  return `Tu es un analyste média senior intégré au module « Suivi campagne » de MAGELIAN.
Tu réponds aux questions du media planner sur ce qu'il s'est passé pendant cette campagne DSP.

Règles :
- Réponds en français, ton factuel et concis.
- Cite les chiffres exacts depuis les données ci-dessous, ne les invente jamais.
- Si la donnée demandée est absente du contexte, dis clairement « je n'ai pas cette donnée ».
- Aucune action destructive proposée.
- Si l'utilisateur demande une recommandation d'action ET que tu identifies un ajustement concret et chiffré, termine ta réponse par UNE seule ligne, exactement au format :
[PROPOSITION_AJUSTEMENT]{"reason":"<pourquoi en une phrase>","changes":{...}}
  Clés autorisées dans changes : channel_budgets (objet code canal → € ), forecast_cpm, start_date, end_date, execution_mode (monitor_only|suggest|auto), intensity (doux|marque|fort). JSON compact sur une seule ligne, aucune autre clé. N'émets JAMAIS cette ligne pour une simple question d'analyse.

DONNÉES CAMPAGNE (seule source de vérité) :
- Nom : ${campaign.name}
- DSP source : ${campaign.dsp_source}
- Période : ${campaign.date_start ?? '—'} → ${campaign.date_end ?? '—'}
- Total tracked ads : ${campaign.total_tracked_ads.toLocaleString('fr-FR')}
- Pays : ${campaign.countries?.join(', ') ?? '—'}
- Statut forcé : ${campaign.status_override ?? 'aucun'}

Répartition par pays :
${fmtStatRows(byCountry, MAX_COUNTRY_ROWS)}

Répartition par région :
${fmtStatRows(byRegion, MAX_REGION_ROWS)}

Croisement départements × indicateur INSEE (top ${MAX_BREAKDOWN_ROWS}, JSON brut par ligne) :
${breakdownDept.slice(0, MAX_BREAKDOWN_ROWS).map((r) => `  ${JSON.stringify(r)}`).join('\n') || '  (aucune donnée)'}

${strategyBlock}`;
}

// ── Proposition d'ajustement (protocole marker dans le flux texte) ──────────────
export const ADJUST_MARKER = '[PROPOSITION_AJUSTEMENT]';

export interface AdjustProposal { reason: string; changes: Record<string, unknown> }

/** Extrait la ligne [PROPOSITION_AJUSTEMENT]{json} d'une réponse du chat. */
export function parseAdjustProposal(text: string): { clean: string; proposal: AdjustProposal | null } {
  const idx = text.lastIndexOf(ADJUST_MARKER);
  if (idx === -1) return { clean: text, proposal: null };
  const clean = text.slice(0, idx).replace(/\n+$/, '');
  try {
    const parsed = JSON.parse(text.slice(idx + ADJUST_MARKER.length).trim()) as AdjustProposal;
    if (typeof parsed.reason !== 'string' || typeof parsed.changes !== 'object' || parsed.changes === null) {
      return { clean, proposal: null };
    }
    return { clean, proposal: parsed };
  } catch {
    return { clean, proposal: null };
  }
}
