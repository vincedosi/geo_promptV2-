/**
 * data.gouv.fr MCP — opt-in integration
 *
 * Activated only when the user's message contains data.gouv keywords.
 * Uses native fetch (Streamable HTTP JSON-RPC) — no MCP SDK needed.
 */
import { jsonSchema } from 'ai';

const MCP_URL     = 'https://mcp.data.gouv.fr/mcp';
const MCP_TIMEOUT = 12_000; // ms

// ── Keywords that trigger the data.gouv MCP ──────────────────────────────────

const DATAGOUV_KW = [
  'data.gouv', 'datagouv',
  'dataset', 'datasets',
  'jeu de données', 'jeux de données',
  'données ouvertes', 'open data', 'opendata',
  'données publiques', 'data gouvernement',
  'catalogue national', 'ressource publique',
];

export function hasDatagouvKeywords(text: string): boolean {
  const lower = text.toLowerCase();
  return DATAGOUV_KW.some(kw => lower.includes(kw));
}

// ── Minimal JSON-RPC over Streamable HTTP ─────────────────────────────────────

interface JsonRpcResult { data: any; sessionId: string | null }

async function mcpPost(
  sessionId: string | null,
  body: object
): Promise<JsonRpcResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;

  const res = await fetch(MCP_URL, {
    method:  'POST',
    headers,
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(MCP_TIMEOUT),
  });

  const newSession = res.headers.get('Mcp-Session-Id') ?? sessionId;
  const ct         = res.headers.get('Content-Type') ?? '';

  let data: any;
  if (ct.includes('text/event-stream')) {
    // Read all SSE lines, keep last data: frame
    const text  = await res.text();
    const lines = text.split('\n').filter(l => l.startsWith('data: '));
    data = lines.length ? JSON.parse(lines[lines.length - 1].slice(6)) : null;
  } else {
    data = await res.json();
  }

  return { data, sessionId: newSession };
}

// ── Public loader ─────────────────────────────────────────────────────────────

/**
 * Returns AI-SDK–compatible tool definitions fetched from data.gouv.fr MCP.
 * Returns {} if the server is unreachable (non-blocking).
 */
export async function loadDatagouvTools(): Promise<Record<string, unknown>> {
  try {
    // 1. Initialize
    const { data: initData, sessionId } = await mcpPost(null, {
      jsonrpc: '2.0',
      id:      0,
      method:  'initialize',
      params:  {
        protocolVersion: '2024-11-05',
        capabilities:    {},
        clientInfo:      { name: 'genesis-app', version: '1.0.0' },
      },
    });

    if (initData?.error) {
      throw new Error(`MCP init: ${initData.error.message ?? JSON.stringify(initData.error)}`);
    }

    // 2. Confirm initialized (fire-and-forget — ignore response)
    await mcpPost(sessionId, {
      jsonrpc: '2.0',
      method:  'notifications/initialized',
    }).catch(() => {});

    // 3. List tools
    const { data: listData } = await mcpPost(sessionId, {
      jsonrpc: '2.0',
      id:      1,
      method:  'tools/list',
      params:  {},
    });

    const mcpTools: any[] = listData?.result?.tools ?? [];
    if (!mcpTools.length) throw new Error('tools/list returned empty');

    // 4. Convert to AI-SDK tool format
    const tools: Record<string, unknown> = {};
    for (const t of mcpTools) {
      const capturedSession = sessionId; // closure per tool
      const inputSchema     = t.inputSchema ?? { type: 'object', properties: {} };

      tools[t.name] = {
        description: t.description ?? t.name,
        inputSchema: jsonSchema(inputSchema),
        execute: async (args: Record<string, unknown>) => {
          try {
            const { data } = await mcpPost(capturedSession, {
              jsonrpc: '2.0',
              id:      Date.now(),
              method:  'tools/call',
              params:  { name: t.name, arguments: args },
            });

            if (data?.error) return { error: data.error.message ?? 'MCP error' };

            const content: any[] = data?.result?.content ?? [];
            const text = content
              .filter((c: any) => c.type === 'text')
              .map((c: any) => c.text)
              .join('\n');

            return text || JSON.stringify(data?.result ?? {});
          } catch (err: any) {
            return { error: `data.gouv MCP: ${err.message}` };
          }
        },
      };
    }

    console.log(`[data.gouv MCP] ${mcpTools.length} tools loaded`);
    return tools;
  } catch (err: any) {
    console.warn('[data.gouv MCP] Skipped (non-blocking):', err.message);
    return {};
  }
}

/** System prompt addendum injected when data.gouv tools are active. */
export const DATAGOUV_SYSTEM_ADDENDUM = `
═══ OUTILS data.gouv.fr ═══
Tu as accès à des outils MCP qui interrogent DIRECTEMENT le catalogue data.gouv.fr.
RÈGLE ABSOLUE : NE JAMAIS dire que tu ne peux pas accéder à data.gouv.fr — utilise les outils ci-dessous.

DÉCLENCHER OBLIGATOIREMENT pour :
- "data.gouv", "dataset(s)", "jeux de données", "données ouvertes", "open data"
- "statistiques [sujet]", "données publiques [sujet]", "catalogue national"

OUTILS DISPONIBLES :
→ search_datasets(query) : PRINCIPAL. Recherche des jeux de données par mots-clés. Appeler en PREMIER.
→ get_dataset_info(dataset_id) : Détails d'un jeu de données (ID ou slug depuis search_datasets).
→ list_dataset_resources(dataset_id) : Liste les fichiers/ressources d'un jeu de données.
→ query_resource_data(resource_id) : Interroge les données d'une ressource.
→ search_dataservices(query) : Recherche des API/services de données.
→ get_metrics : Métriques d'utilisation data.gouv.fr.

EXEMPLES OBLIGATOIRES :
- "data.gouv statistiques chômage" → search_datasets(query:"chômage")
- "jeux de données logement" → search_datasets(query:"logement")
- "données open data mobilité" → search_datasets(query:"mobilité")
- "dataset revenus communes" → search_datasets(query:"revenus communes")

FORMAT DE RÉPONSE :
Après search_datasets, présente les 3 meilleurs résultats : titre, organisation, description courte, lien.
`.trim();
