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
═══ OUTILS data.gouv.fr (MCP) ═══
Des outils supplémentaires sont disponibles pour interroger le catalogue de données ouvertes français :
- search_datasets : rechercher des jeux de données par mots-clés
- get_dataset_info : infos détaillées sur un jeu de données (par ID ou slug)
- list_dataset_resources : lister les ressources (fichiers) d'un jeu de données
- get_resource_info : infos sur une ressource spécifique
- query_resource_data : interroger les données d'une ressource
- search_dataservices : rechercher des API/services de données
- get_dataservice_info : infos sur un service de données
- get_dataservice_openapi_spec : spécification OpenAPI d'un service
- get_metrics : métriques de consultation data.gouv.fr

Utilise ces outils quand l'utilisateur demande des jeux de données publics, des statistiques gouvernementales, ou des données open data françaises.
`.trim();
