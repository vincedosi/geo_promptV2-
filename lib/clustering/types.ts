/**
 * @file lib/clustering/types.ts
 *
 * Formes de données partagées du clustering POI × Filosofi.
 *
 * `GeminiAnalysis` vivait dans `components/ClusteringPDFReport.tsx`, alors
 * qu'elle décrit la réponse d'un modèle de langage stockée en base
 * (`clustering_models.analysis`) et lue par au moins trois consommateurs :
 * la route `models/[version]/analysis`, le panneau de détail, et le rapport
 * PDF. Un contrat de données n'a pas à dépendre du composant qui l'affiche —
 * c'est d'ailleurs ce qui a rendu le retrait du rapport PDF plus coûteux qu'il
 * n'aurait dû l'être le 2026-09-12.
 */

/**
 * Analyse rédigée par Gemini pour un modèle de clustering.
 *
 * Produite par `scripts/clustering_poi_filosofi.py` (mode `generate-analysis`)
 * et stockée telle quelle dans `clustering_models.analysis`. Le script impose
 * ce schéma à Gemini ; toute évolution doit être faite des deux côtés.
 */
export interface GeminiAnalysis {
  titre:              string;
  synthese_executive: string;
  clusters: {
    id:             number;
    titre:          string;
    analyse:        string;
    recommandation: string;
    /** Les POI du cluster qui s'écartent du profil — `null` s'il n'y en a pas. */
    atypiques:      string | null;
  }[];
  comparaison_france:  string;
  points_attention:    string[];
  methodologie_resume: string;
}
