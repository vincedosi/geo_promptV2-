/**
 * data.gouv.fr MCP — opt-in integration
 *
 * Activated only when the user's message contains data.gouv keywords.
 * Uses native fetch (Streamable HTTP JSON-RPC) — no MCP SDK needed.
 */
import { jsonSchema } from 'ai';

const MCP_URL     = 'https://mcp.data.gouv.fr/mcp';
const MCP_TIMEOUT = 5_000; // ms — must stay fast (runs before Mistral call)

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

interface JsonRpcResult { data: unknown; sessionId: string | null }

/** Subset of JSON Schema used by data.gouv MCP tools */
interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  required?: string[];
  description?: string;
  [key: string]: unknown;
}

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
    // Parse SSE: find first line that is valid JSON (skip [DONE], empty, etc.)
    const text  = await res.text();
    const lines = text.split('\n').filter(l => l.startsWith('data: '));
    data = null;
    for (const line of lines) {
      try { data = JSON.parse(line.slice(6)); break; } catch { /* skip */ }
    }
  } else if (res.status === 202 || res.headers.get('content-length') === '0') {
    data = null; // notification ACK — no body expected
  } else {
    try { data = await res.json(); } catch { data = null; }
  }

  return { data, sessionId: newSession };
}

// ── Schema sanitizer (Gemini compat) ──────────────────────────────────────────

/**
 * Strips JSON Schema features unsupported by Gemini's function calling:
 * additionalProperties, $ref, $schema, allOf/anyOf/oneOf, default, examples…
 * Converts "integer" → "number", flattens anyOf nullable unions to base type.
 * Ensures every object has { type: 'object', properties: {} } at minimum.
 */
function sanitizeSchema(s: unknown): unknown {
  if (!s || typeof s !== 'object') return s;
  if (Array.isArray(s)) return s.map(sanitizeSchema);

  const schema = s as JsonSchema;

  // Handle anyOf nullable pattern: anyOf: [{type:"string"},{type:"null"}] → {type:"string"}
  if (schema.anyOf && Array.isArray(schema.anyOf)) {
    const nonNull = schema.anyOf.filter(x => x?.type !== 'null');
    if (nonNull.length === 1) {
      // Flatten to the single non-null type, preserve other keys (description, etc.)
      const { anyOf: _, ...rest } = schema;
      return sanitizeSchema({ ...rest, ...nonNull[0] });
    }
  }

  const out: JsonSchema = {};
  for (const [k, v] of Object.entries(schema)) {
    // Drop keys Gemini rejects
    if (['additionalProperties', '$ref', '$schema', 'allOf', 'anyOf', 'oneOf',
         'default', 'examples', 'example', '$id', '$comment', 'title'].includes(k)) continue;
    out[k] = sanitizeSchema(v);
  }
  // Gemini uses "number" not "integer"
  if (out.type === 'integer') out.type = 'number';
  // Ensure top-level has type
  if (out.properties && !out.type) out.type = 'object';
  return out;
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
    if (!initData?.result) {
      throw new Error(`MCP init: unexpected response: ${JSON.stringify(initData)}`);
    }
    console.log(`[data.gouv MCP] initialized, session=${sessionId}, server=${initData.result?.serverInfo?.name ?? '?'}`);

    // 2. List tools (skip notifications/initialized — optional per spec)
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
      const inputSchema     = sanitizeSchema(t.inputSchema ?? { type: 'object', properties: {} });

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
          } catch (err: unknown) {
            return { error: `data.gouv MCP: ${err instanceof Error ? err.message : 'Erreur inconnue'}` };
          }
        },
      };
    }

    console.log(`[data.gouv MCP] ${mcpTools.length} tools loaded`);
    return tools;
  } catch (err: unknown) {
    console.warn('[data.gouv MCP] Skipped (non-blocking):', err instanceof Error ? err.message : err);
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
   Utilise les mots-clés exacts de l'utilisateur. N'ajoute PAS de termes supplémentaires.
→ get_dataset_info(dataset_id) : Détails d'un jeu de données (ID ou slug depuis search_datasets).
→ list_dataset_resources(dataset_id) : Liste les fichiers/ressources d'un jeu de données.
→ query_resource_data(resource_id) : Interroge les données d'une ressource.
→ search_dataservices(query) : Recherche des API/services de données.
→ get_metrics : Métriques d'utilisation data.gouv.fr.

EXEMPLES OBLIGATOIRES :
- "jeux de données logement" → search_datasets(query:"logement")
- "données mobilité" → search_datasets(query:"mobilité")
- "dataset revenus communes" → search_datasets(query:"revenus communes")
- "statistiques chômage" → search_datasets(query:"chômage")
- "bornes électriques" → search_datasets(query:"bornes électriques")

PRIORITÉ AFFICHAGE :
→ Les résultats sont automatiquement triés par ordre de priorité :
   1. Données géographiques (🌍 GEO)
   2. Données françaises vs internationales (🇫🇷 FR)
   3. Plus récentes (🔥 RÉCENT si < 90 jours)
→ Tri intelligent côté client selon ces critères.

FORMAT DE RÉPONSE (OBLIGATOIRE) :
- Les résultats détaillés sont AUTOMATIQUEMENT affichés dans une carte visuelle — ne les répète PAS.
- Ta réponse texte doit être TRÈS COURTE : 1-2 phrases max.
- Exemple : "Voici les jeux de données trouvés sur data.gouv.fr concernant [sujet]." ou "J'ai trouvé [N] datasets pertinents."
- Si pertinent, ajoute UN conseil ou UNE observation (ex: "Le dataset [titre] semble le plus complet avec [N] ressources").
- NE PAS copier les résultats bruts (titres, URLs, IDs) — l'interface les affiche déjà.
`.trim();
