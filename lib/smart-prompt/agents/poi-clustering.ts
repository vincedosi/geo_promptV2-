/**
 * lib/smart-prompt/agents/poi-clustering.ts
 * Agent clustering — lit les modèles depuis clustering_models
 * et retourne stats + résumé de l'analyse Gemini si disponible.
 */

import { createAdminClient } from '@/lib/auth';
import type { AgentResult }  from '../types';

interface ClusteringModel {
  version:      number;
  n_clusters:   number;
  n_pois:       number;
  poi_types:    string[];
  created_at:   string;
  duration_sec: number | null;
  analysis:     Record<string, unknown> | null;
}

function buildMarkdown(model: ClusteringModel): string {
  const date    = new Date(model.created_at).toLocaleDateString('fr-FR');
  const types   = model.poi_types.join(', ') || 'tous';

  const lines: string[] = [
    `## Modèle de clustering v${model.version}`,
    `**Date :** ${date} | **Clusters :** ${model.n_clusters} | **POI :** ${model.n_pois.toLocaleString('fr-FR')}`,
    `**Catégories :** ${types}`,
  ];

  if (model.analysis) {
    const a = model.analysis as {
      titre?: string;
      synthese_executive?: string;
      clusters?: Array<{ nom: string; taille_pct: number; analyse?: string }>;
    };

    if (a.titre) {
      lines.push('', `**${a.titre}**`);
    }
    if (a.synthese_executive) {
      lines.push('', a.synthese_executive);
    }
    if (Array.isArray(a.clusters) && a.clusters.length > 0) {
      lines.push('', '### Clusters');
      for (const c of a.clusters.slice(0, 5)) {
        lines.push(`- **${c.nom}** (${c.taille_pct?.toFixed(1)}%) ${c.analyse ? '— ' + c.analyse.substring(0, 120) + '…' : ''}`);
      }
    }
  } else {
    lines.push('', '*Aucune analyse IA disponible pour ce modèle. Générez-en une depuis /clusters.*');
  }

  return lines.join('\n');
}

export async function runPoiClusteringAgent(
  params: Record<string, unknown>,
): Promise<AgentResult> {
  const sb = createAdminClient();

  // Charge le modèle demandé ou le dernier
  const version = params.model_version ? Number(params.model_version) : null;

  let query = sb
    .from('clustering_models')
    .select('version, n_clusters, n_pois, poi_types, created_at, duration_sec, analysis')
    .order('version', { ascending: false })
    .limit(1);

  if (version !== null) {
    query = query.eq('version', version);
  }

  const { data, error } = await query.single();

  if (error || !data) {
    return {
      agent:   'poi_clustering',
      success: false,
      error:   error?.message ?? 'Aucun modèle de clustering trouvé.',
    };
  }

  const model = data as ClusteringModel;

  return {
    agent:       'poi_clustering',
    success:     true,
    data:        model,
    explication: `Modèle de clustering v${model.version} — ${model.n_clusters} clusters, ${model.n_pois} POI.`,
    markdown:    buildMarkdown(model),
  };
}
