'use client';

/**
 * DataGouvCard — Renders data.gouv.fr MCP tool results as structured cards.
 * Parses the text output from search_datasets / get_dataset_info / list_dataset_resources.
 *
 * v2 — Ajoute le bouton "💾 Importer dans Supabase" pour les ressources GeoJSON.
 */

import { Component, useState, type ReactNode } from 'react';
import { ImportPoiButton } from './ImportPoiButton';

// ─── Error Boundary — empêche un crash DataGouvCard de blanchir la page ──────

class DataGouvErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, fontSize: 11, color: '#f87171' }}>
          ⚠️ Erreur d'affichage data.gouv — recharge la page
        </div>
      );
    }
    return this.props.children;
  }
}

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

// ─── Ressource GeoJSON détectée dans list_dataset_resources ─────────────────

interface GeoJsonResource {
  title: string;
  url: string;
  format: string;
  sizeLabel?: string;
}

// ─── Constantes ──────────────────────────────────────────────────────────────

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

// ─── Parser : search_datasets ────────────────────────────────────────────────

function parseSearchResults(text: string): { total: number; datasets: Dataset[] } {
  const totalMatch = text.match(/Found (\d+) dataset/);
  const total = totalMatch ? parseInt(totalMatch[1]) : 0;

  const datasets: Dataset[] = [];
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
      try { lastUpdate = new Date(dateMatch[1].trim()); } catch { /* ignore */ }
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

  datasets.sort((a, b) => {
    if (a.isGeo && !b.isGeo) return -1;
    if (!a.isGeo && b.isGeo) return 1;
    if (a.isFrance && !b.isFrance) return -1;
    if (!a.isFrance && b.isFrance) return 1;
    if (a.lastUpdate && b.lastUpdate) return b.lastUpdate.getTime() - a.lastUpdate.getTime();
    if (a.lastUpdate && !b.lastUpdate) return -1;
    if (!a.lastUpdate && b.lastUpdate) return 1;
    return a.rank - b.rank;
  });

  return { total, datasets };
}

// ─── Parser : list_dataset_resources → ressources GeoJSON ────────────────────
//
// Format MCP typique :
//   1. Nom de la ressource
//      Format: geojson
//      URL: https://www.data.gouv.fr/fr/datasets/r/xxx
//      Size: 15.2 MB
//   2. Autre ressource
//      Format: csv
//      ...

function parseGeoJsonResources(text: string): GeoJsonResource[] {
  const results: GeoJsonResource[] = [];

  // Découpe par bloc numéroté
  const blocks = text.split(/\n(?=\d+[\.\)]\s)/);

  for (const block of blocks) {
    // Cherche un format GeoJSON (flexible)
    const formatMatch = block.match(/(?:Format|format|Type|type|Fmt)[^\w\n]*?[:\s]+(\w+)/i);
    const format = (formatMatch?.[1] ?? '').toLowerCase();

    // On accepte : geojson, geo+json, application/geo+json, fichier geojson…
    const isGeojson =
      format.includes('geojson') ||
      block.toLowerCase().includes('.geojson') ||
      block.toLowerCase().includes('geo+json');

    if (!isGeojson) continue;

    // Extraire l'URL (première URL trouvée dans le bloc)
    const urlMatch = block.match(/(https?:\/\/[^\s\]>"]+)/);
    if (!urlMatch) continue;

    const url = urlMatch[1].replace(/[,\.]$/, ''); // Nettoie la ponctuation finale

    // Extraire le titre (première ligne non vide du bloc, souvent "N. Titre")
    const titleLine = block.match(/^\d+[\.\)]\s+(.+)/m);
    const titleFromKey = block.match(/(?:Title|Titre|Nom|Name|titre|nom)[^\w\n]*?[:\s]+(.+)/im);
    const title = (titleLine?.[1] ?? titleFromKey?.[1] ?? 'Ressource GeoJSON').trim();

    // Taille si disponible
    const sizeMatch = block.match(/(?:Size|Taille|taille|size)[^\w\n]*?[:\s]+([\d.,]+\s*(?:MB|KB|GB|Mo|Ko|Go))/i);

    results.push({ title, url, format: 'geojson', sizeLabel: sizeMatch?.[1] });
  }

  return results;
}

// ─── Dérive une catégorie depuis le titre de la ressource ────────────────────

function deriveCategorie(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // supprime accents
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 50) || 'import_datagouv';
}

// ─── Composant principal ─────────────────────────────────────────────────────

const dgStyles = `
@keyframes dgFadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; }
}
`;

function DataGouvCardInner({ parts }: { parts: DataGouvPart[] }) {
  const [showAll, setShowAll] = useState(false);
  const toolResults: { toolName: string; output: string }[] = [];
  for (const p of parts) {
    const toolName = p.type.replace(/^tool-/, '');
    const raw = typeof p.output === 'string' ? p.output : '';
    if (raw) toolResults.push({ toolName, output: raw });
  }

  if (toolResults.length === 0) return null;

  const searchResult = toolResults.find(t => t.toolName === 'search_datasets');
  const resourcesResult = toolResults.find(t => t.toolName === 'list_dataset_resources');

  return (
    <div style={{
      background: 'rgba(0,85,164,0.06)',
      border: '0.5px solid rgba(0,85,164,0.3)',
      borderRadius: 10,
      padding: '12px 14px',
      marginBottom: 8,
    }}>
      <style>{dgStyles}</style>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 16 }}>🇫🇷</span>
        <span style={{ color: '#60a5fa', fontWeight: 700, fontSize: 13 }}>data.gouv.fr</span>
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontFamily: 'JetBrains Mono, monospace' }}>
          MCP · {toolResults.length} requête{toolResults.length > 1 ? 's' : ''}
        </span>
      </div>

      {/* ── Résultats list_dataset_resources avec boutons d'import ── */}
      {resourcesResult && (() => {
        const geojsonResources = parseGeoJsonResources(resourcesResult.output);
        return (
          <div>
            {/* Affichage brut du texte */}
            <div style={{
              fontSize: 11,
              color: 'rgba(255,255,255,0.7)',
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 200,
              overflow: 'auto',
              marginBottom: geojsonResources.length > 0 ? 10 : 0,
            }}>
              {resourcesResult.output.substring(0, 1500)}
              {resourcesResult.output.length > 1500 && '…'}
            </div>

            {/* Boutons d'import pour chaque ressource GeoJSON trouvée */}
            {geojsonResources.length > 0 && (
              <div>
                <div style={{ fontSize: 10, color: '#34d399', fontWeight: 700, marginBottom: 6, fontFamily: 'JetBrains Mono, monospace' }}>
                  🌍 {geojsonResources.length} ressource{geojsonResources.length > 1 ? 's' : ''} GeoJSON disponible{geojsonResources.length > 1 ? 's' : ''}
                </div>
                {geojsonResources.map((res, i) => (
                  <div key={i} style={{
                    background: 'rgba(52,211,153,0.05)',
                    border: '1px solid rgba(52,211,153,0.2)',
                    borderRadius: 7,
                    padding: '8px 10px',
                    marginBottom: 6,
                  }}>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', marginBottom: 2, lineHeight: 1.3 }}>
                      {res.title}
                    </div>
                    {res.sizeLabel && (
                      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', marginBottom: 4, fontFamily: 'JetBrains Mono, monospace' }}>
                        📦 {res.sizeLabel}
                      </div>
                    )}
                    <ImportPoiButton
                      geojsonUrl={res.url}
                      defaultCategorie={deriveCategorie(res.title)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Résultats search_datasets (cartes) ── */}
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
              {(showAll ? datasets : datasets.slice(0, 5)).map((ds, i) => (
                <div key={i} style={{
                  background: '#111111',
                  border: '0.5px solid #1a1a1a',
                  borderRadius: 8,
                  padding: '10px 12px',
                  animation: `dgFadeIn 0.3s ease ${i * 0.06}s both`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                    <span style={{
                      background: 'rgba(96,165,250,0.2)', color: '#60a5fa',
                      fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 700,
                      padding: '2px 6px', borderRadius: 4, flexShrink: 0,
                    }}>#{i + 1}</span>
                    {ds.isGeo && (
                      <span style={{
                        background: 'rgba(52,211,153,0.2)', color: '#34d399',
                        fontFamily: 'JetBrains Mono, monospace', fontSize: 9, fontWeight: 700,
                        padding: '2px 6px', borderRadius: 4, flexShrink: 0,
                      }}>🌍 GEO</span>
                    )}
                    {ds.isFrance && (
                      <span style={{
                        background: 'rgba(96,165,250,0.15)', color: '#60a5fa',
                        fontFamily: 'JetBrains Mono, monospace', fontSize: 9, fontWeight: 700,
                        padding: '2px 6px', borderRadius: 4, flexShrink: 0,
                      }}>🇫🇷 FR</span>
                    )}
                    {ds.lastUpdate && (Date.now() - ds.lastUpdate.getTime()) < 90 * 24 * 3600 * 1000 && (
                      <span style={{
                        background: 'rgba(251,191,36,0.2)', color: '#fbbf24',
                        fontFamily: 'JetBrains Mono, monospace', fontSize: 9, fontWeight: 700,
                        padding: '2px 6px', borderRadius: 4, flexShrink: 0,
                      }}>🔥 RÉCENT</span>
                    )}
                    <a
                      href={ds.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: '#93c5fd', fontSize: 13, fontWeight: 600,
                        textDecoration: 'none', lineHeight: 1.3, flex: 1,
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none'; }}
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
                          background: 'rgba(96,165,250,0.1)', color: 'rgba(96,165,250,0.7)',
                          fontSize: 9, padding: '1px 6px', borderRadius: 3,
                          fontFamily: 'JetBrains Mono, monospace',
                        }}>{tag}</span>
                      ))}
                    </div>
                  )}
                  {/* Indice : demander les ressources pour importer */}
                  {ds.isGeo && (
                    <div style={{ marginTop: 6, fontSize: 9, color: 'rgba(52,211,153,0.5)', fontFamily: 'JetBrains Mono, monospace' }}>
                      💡 Demandez "liste les ressources du dataset {ds.id}" pour importer les données GeoJSON
                    </div>
                  )}
                </div>
              ))}
            </div>
            {datasets.length > 5 && (
              <button
                onClick={() => setShowAll(v => !v)}
                style={{
                  marginTop: 6,
                  width: '100%',
                  padding: '5px 0',
                  background: 'rgba(96,165,250,0.07)',
                  border: '1px solid rgba(96,165,250,0.2)',
                  borderRadius: 6,
                  color: 'rgba(96,165,250,0.7)',
                  fontSize: 10,
                  cursor: 'pointer',
                  fontFamily: 'JetBrains Mono, monospace',
                  letterSpacing: '0.02em',
                  transition: 'background 0.2s ease',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(96,165,250,0.14)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(96,165,250,0.07)')}
              >
                {showAll
                  ? '▲ Réduire'
                  : `▼ Voir ${datasets.length - 5} autres résultats`}
              </button>
            )}
          </>
        );
      })()}

      {/* ── Autres résultats MCP (get_dataset_info, metrics, etc.) ── */}
      {!searchResult && !resourcesResult && toolResults.map((tr, i) => (
        <div key={i} style={{
          background: '#111111',
          border: '0.5px solid #1a1a1a',
          borderRadius: 8,
          padding: '8px 10px',
          marginBottom: i < toolResults.length - 1 ? 6 : 0,
        }}>
          <div style={{ fontSize: 10, color: '#60a5fa', marginBottom: 4, fontFamily: 'JetBrains Mono, monospace' }}>
            {tr.toolName.replace(/_/g, ' ')}
          </div>
          <div style={{
            fontSize: 11, color: 'rgba(255,255,255,0.7)', lineHeight: 1.5,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 200, overflow: 'auto',
          }}>
            {tr.output.substring(0, 1500)}
            {tr.output.length > 1500 && '…'}
          </div>
        </div>
      ))}
    </div>
  );
}

export function DataGouvCard({ parts }: { parts: DataGouvPart[] }) {
  return (
    <DataGouvErrorBoundary>
      <DataGouvCardInner parts={parts} />
    </DataGouvErrorBoundary>
  );
}
