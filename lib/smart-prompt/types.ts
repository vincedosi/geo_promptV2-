/**
 * lib/smart-prompt/types.ts
 * Types partagés du routeur multi-agents GEO.Prompt
 */

// Agents disponibles
export type AgentName =
  | 'demographie'
  | 'poi_clustering'
  | 'panneaux'
  | 'isochrone_battle'
  | 'benchmark'
  | 'unknown';

// Entrée du registre de données
export interface RegistryEntry {
  slug:        string;
  label:       string;
  category:    string;
  description: string | null;
  metadata:    Record<string, unknown>;
}

// Décision de routage retournée par Mistral
export interface RouterDecision {
  agent:       AgentName;
  params:      Record<string, unknown>;
  explication: string;
  confidence:  number; // 0.0 - 1.0
}

// Résultat d'un agent
export interface AgentResult {
  agent:        AgentName;
  success:      boolean;
  data?:        unknown;
  error?:       string;
  explication?: string;
  markdown?:    string; // Texte mis en forme pour affichage direct
}

// Réponse complète de l'API smart-prompt
export interface SmartPromptResponse {
  decision:      RouterDecision;
  result:        AgentResult;
  registry_used: number; // nb entrées chargées depuis data_registry
}

// Paramètres géographiques extraits par le routeur
export interface GeoParams {
  ville?:    string;
  region?:   string;
  rayon_km?: number;
  lat?:      number;
  lng?:      number;
}

// Résultat de stats démographiques
export interface DemoStats {
  indicateur:        string;
  rayon_km:          number;
  nb_carreaux:       number;
  total:             number;
  moyenne:           number;
  mediane:           number;
  max:               number;
  min:               number;
  revenu_moyen_pers: number; // SUM(ind_snv)/SUM(ind) — valide seulement pour ind_snv
  error?:            string;
}

// Résultat de stats POI
export interface PoiStats {
  categorie:  string;
  ville:      string | null;
  total:      number;
  nb_villes:  number;
  nb_regions: number;
  top_villes: Array<{ ville: string; count: number }>;
}
