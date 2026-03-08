'use client';

/**
 * DataGouvCard — Renders data.gouv.fr MCP tool results as structured cards.
 * Parses the text output from search_datasets/get_dataset_info/etc.
 */

interface DataGouvPart {
  type: string;
  output: string | { error?: string };
}

interface Dataset {
  rank: number;
  title: string;
  id: string;
  org: string;
  tags: string[];
  resources: number;
  url: string;
  lastUpdate?: Date;
  isGeo: boolean;
  isFrance: boolean;
}

const GEO_KEYWORDS = ['géographique', 'geographique', 'géolocalisation', 'geolocalisation', 
                      'cartographie', 'latitude', 'longitude', 'coordonnées', 'coordonnees',
                      'spatial', 'géospatial', 'geospatial', 'adresse', 'commune', 'département', 
                      'departement', 'région', 'region', 'territoire', 'sig', 'shapefile', 
                      'geojson', 'wgs84', 'lambert', 'localisation', 'gps', 'carte', 'plan',
                      'cadastre', 'parcelle', 'iris', 'epci', 'canton', 'arrondissement',
                      'quartier', 'code postal', 'insee', 'géocodage', 'geocodage'];

const FRANCE_KEYWORDS = ['france', 'français', 'francais', 'commune', 'département', 'departement',
                         'région', 'region', 'insee', 'metropole', 'métropole', 'métropolitain',
                         'metropolitain', 'national', 'territoire français', 'hexagone', 'drom',
                         'outre-mer', 'préfecture', 'prefecture', 'ministère', 'ministere',
                         'gouvernement français', 'république française', 'etat français'];

function parseSearchResults(text: string): { total: number; datasets: Dataset[] } {
  const totalMatch = text.match(/Found (\d+) dataset/);
  const total = totalMatch ? parseInt(totalMatch[1]) : 0;

  const datasets: Dataset[] = [];
  // Each block: "N. Title\n   ID: ...\n   Organization: ...\n   Tags: ...\n   Resources: N\n   URL: ..."
  const blocks = text.split(/\n(?=\d+\.\s)/);
  for (const block of blocks) {
    const titleMatch = block.match(/^(\d+)\.\s+(.+)/m);
    if (!titleMatch) continue;
    const idMatch = block.match(/ID:\s*(.+)/);
    const orgMatch = block.match(/Organization:\s*(.+)/);
    const tagsMatch = block.match(/Tags:\s*(.+)/);
    const resMatch = block.match(/Resources:\s*(\d+)/);
    const urlMatch = block.match(/URL:\s*(https?:\/\/\S+)/);
    const dateMatch = block.match(/Updated:\s*(.+)/);

    const tags = tagsMatch?.[1]?.split(',').map(t => t.trim()) ?? [];
    const title = titleMatch[2].trim();
    const org = orgMatch?.[1]?.trim() ?? 'Inconnu';
    const fullText = (title + ' ' + tags.join(' ') + ' ' + org).toLowerCase();
    const isGeo = GEO_KEYWORDS.some(kw => fullText.includes(kw));
    const isFrance = FRANCE_KEYWORDS.some(kw => fullText.includes(kw));

    let lastUpdate: Date | undefined;
    if (dateMatch) {
      try {
        lastUpdate = new Date(dateMatch[1].trim());
      } catch {
        // ignore invalid dates
      }
    }

    datasets.push({
      rank: parseInt(titleMatch[1]),
      title,
      id: idMatch?.[1]?.trim() ?? '',
      org,
      tags,
      resources: resMatch ? parseInt(resMatch[1]) : 0,
      url: urlMatch?.[1]?.trim() ?? '',
      lastUpdate,
      isGeo,
      isFrance,
    });
  }

  // Tri : 1. Datasets GEO, 2. France, 3. Plus récents
  datasets.sort((a, b) => {
    // Prio 1: GEO
    if (a.isGeo && !b.isGeo) return -1;
    if (!a.isGeo && b.isGeo) return 1;
    // Prio 2: France
    if (a.isFrance && !b.isFrance) return -1;
    if (!a.isFrance && b.isFrance) return 1;
    // Prio 3: Date (plus récent = valeur plus grande)
    if (a.lastUpdate && b.lastUpdate) {
      return b.lastUpdate.getTime() - a.lastUpdate.getTime();
    }
    if (a.lastUpdate && !b.lastUpdate) return -1;
    if (!a.lastUpdate && b.lastUpdate) return 1;
    // Prio 4: rank original
    return a.rank - b.rank;
  });

  return { total, datasets };
}

export function DataGouvCard({ parts }: { parts: DataGouvPart[] }) {
  // Collect all tool outputs
  const toolResults: { toolName: string; output: string }[] = [];
  for (const p of parts) {
    const toolName = p.type.replace(/^tool-/, '');
    const raw = typeof p.output === 'string' ? p.output : '';
    if (raw) toolResults.push({ toolName, output: raw });
  }

  if (toolResults.length === 0) return null;

  // Try to parse search_datasets results
  const searchResult = toolResults.find(t => t.toolName === 'search_datasets');

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(0,85,164,0.12), rgba(0,85,164,0.06))',
      border: '1px solid rgba(0,85,164,0.3)',
      borderRadius: 10,
      padding: '12px 14px',
      marginBottom: 8,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 16 }}>🇫🇷</span>
        <span style={{ color: '#60a5fa', fontWeight: 700, fontSize: 13 }}>data.gouv.fr</span>
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontFamily: 'JetBrains Mono, monospace' }}>
          MCP · {toolResults.length} requête{toolResults.length > 1 ? 's' : ''}
        </span>
      </div>

      {/* Search results */}
      {searchResult && (() => {
        const { total, datasets } = parseSearchResults(searchResult.output);
        const hasGeo = datasets.some(ds => ds.isGeo);
        const hasFrance = datasets.some(ds => ds.isFrance);
        return (
          <>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 8, fontFamily: 'JetBrains Mono, monospace' }}>
              {total.toLocaleString('fr-FR')} jeux de données trouvés
              {hasGeo && <span style={{ marginLeft: 8, color: '#34d399' }}>· 🌍 GEO</span>}
              {hasFrance && <span style={{ marginLeft: 8, color: '#60a5fa' }}>· 🇫🇷 France</span>}
              <span style={{ marginLeft: 8, color: 'rgba(251,191,36,0.7)' }}>· 🔥 Récents</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {datasets.slice(0, 5).map((ds, i) => (
                <div key={i} style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 8,
                  padding: '10px 12px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                    <span style={{
                      background: 'rgba(96,165,250,0.2)',
                      color: '#60a5fa',
                      fontFamily: 'JetBrains Mono, monospace',
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '2px 6px',
                      borderRadius: 4,
                      flexShrink: 0,
                    }}>#{i + 1}</span>
                    {ds.isGeo && (
                      <span style={{
                        background: 'rgba(52,211,153,0.2)',
                        color: '#34d399',
                        fontFamily: 'JetBrains Mono, monospace',
                        fontSize: 9,
                        fontWeight: 700,
                        padding: '2px 6px',
                        borderRadius: 4,
                        flexShrink: 0,
                      }}>🌍 GEO</span>
                    )}
                    {ds.isFrance && (
                      <span style={{
                        background: 'rgba(96,165,250,0.15)',
                        color: '#60a5fa',
                        fontFamily: 'JetBrains Mono, monospace',
                        fontSize: 9,
                        fontWeight: 700,
                        padding: '2px 6px',
                        borderRadius: 4,
                        flexShrink: 0,
                      }}>🇫🇷 FR</span>
                    )}
                    {ds.lastUpdate && (Date.now() - ds.lastUpdate.getTime()) < 90 * 24 * 3600 * 1000 && (
                      <span style={{
                        background: 'rgba(251,191,36,0.2)',
                        color: '#fbbf24',
                        fontFamily: 'JetBrains Mono, monospace',
                        fontSize: 9,
                        fontWeight: 700,
                        padding: '2px 6px',
                        borderRadius: 4,
                        flexShrink: 0,
                      }}>🔥 RÉCENT</span>
                    )}
                    <a
                      href={ds.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: '#93c5fd',
                        fontSize: 13,
                        fontWeight: 600,
                        textDecoration: 'none',
                        lineHeight: 1.3,
                        flex: 1,
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                      onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
                    >
                      {ds.title}
                    </a>
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginBottom: 4, paddingLeft: 2 }}>
                    📌 {ds.org}
                    {ds.resources > 0 && <span style={{ marginLeft: 10 }}>📦 {ds.resources} ressource{ds.resources > 1 ? 's' : ''}</span>}
                    {ds.lastUpdate && (
                      <span style={{ marginLeft: 10, color: 'rgba(251,191,36,0.6)', fontSize: 10 }}>
                        🕒 {new Intl.DateTimeFormat('fr-FR', { year: 'numeric', month: 'short', day: 'numeric' }).format(ds.lastUpdate)}
                      </span>
                    )}
                  </div>
                  {ds.tags.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, paddingLeft: 2 }}>
                      {ds.tags.slice(0, 5).map((tag, j) => (
                        <span key={j} style={{
                          background: 'rgba(96,165,250,0.1)',
                          color: 'rgba(96,165,250,0.7)',
                          fontSize: 9,
                          padding: '1px 6px',
                          borderRadius: 3,
                          fontFamily: 'JetBrains Mono, monospace',
                        }}>{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {datasets.length > 5 && (
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 6, textAlign: 'center' }}>
                + {datasets.length - 5} autres résultats…
              </div>
            )}
          </>
        );
      })()}

      {/* Non-search results (dataset info, resources, metrics...) */}
      {!searchResult && toolResults.map((tr, i) => (
        <div key={i} style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 8,
          padding: '8px 10px',
          marginBottom: i < toolResults.length - 1 ? 6 : 0,
        }}>
          <div style={{ fontSize: 10, color: '#60a5fa', marginBottom: 4, fontFamily: 'JetBrains Mono, monospace' }}>
            {tr.toolName.replace(/_/g, ' ')}
          </div>
          <div style={{
            fontSize: 11,
            color: 'rgba(255,255,255,0.7)',
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 200,
            overflow: 'auto',
          }}>
            {tr.output.substring(0, 1500)}
            {tr.output.length > 1500 && '…'}
          </div>
        </div>
      ))}
    </div>
  );
}
