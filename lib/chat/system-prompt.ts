// Mapping : terme naturel → colonne Filosofi + label FR
// Toutes les clés sont en minuscules (conformes à la DB carreaux_filosofi.metadata)
export const CHORO_INDICATORS: Record<string, { col: string; label: string }> = {
  // Population
  'ind':       { col: 'ind',       label: 'Population totale' },
  'ind_inc':   { col: 'ind_inc',   label: 'Population inconnue' },
  // Tranches d'âge
  'ind_0_3':   { col: 'ind_0_3',   label: 'Enfants 0-3 ans' },
  'ind_4_5':   { col: 'ind_4_5',   label: 'Enfants 4-5 ans' },
  'ind_6_10':  { col: 'ind_6_10',  label: 'Enfants 6-10 ans' },
  'ind_11_17': { col: 'ind_11_17', label: 'Adolescents 11-17 ans' },
  'ind_18_24': { col: 'ind_18_24', label: 'Jeunes 18-24 ans' },
  'ind_25_39': { col: 'ind_25_39', label: 'Adultes 25-39 ans' },
  'ind_40_54': { col: 'ind_40_54', label: 'Adultes 40-54 ans' },
  'ind_55_64': { col: 'ind_55_64', label: 'Seniors 55-64 ans' },
  'ind_65_79': { col: 'ind_65_79', label: 'Seniors 65-79 ans' },
  'ind_80p':   { col: 'ind_80p',   label: 'Personnes 80 ans et +' },
  // Ménages
  'men':       { col: 'men',       label: 'Ménages total' },
  'men_pauv':  { col: 'men_pauv',  label: 'Ménages pauvres' },
  'men_1ind':  { col: 'men_1ind',  label: 'Ménages 1 personne' },
  'men_5ind':  { col: 'men_5ind',  label: 'Ménages 5+ personnes' },
  'men_prop':  { col: 'men_prop',  label: 'Ménages propriétaires' },
  'men_fmp':   { col: 'men_fmp',   label: 'Familles monoparentales' },
  'men_mais':  { col: 'men_mais',  label: 'Ménages en maison' },
  'men_coll':  { col: 'men_coll',  label: 'Ménages en collectif' },
  'men_surf':  { col: 'men_surf',  label: 'Surface moyenne (m²)' },
  // Revenus
  'ind_snv':   { col: 'ind_snv',   label: 'Revenu médian (€)' },
  // Logements
  'log_av45':  { col: 'log_av45',  label: 'Logements avant 1945' },
  'log_45_70': { col: 'log_45_70', label: 'Logements 1945-1970' },
  'log_70_90': { col: 'log_70_90', label: 'Logements 1970-1990' },
  'log_ap90':  { col: 'log_ap90',  label: 'Logements après 1990' },
  'log_soc':   { col: 'log_soc',   label: 'Logements sociaux' },
  'log_inc':   { col: 'log_inc',   label: 'Logements inconnus' },
};

export function buildSystemPrompt(categoriesList: string[]): string {
  const catsFormatted = categoriesList.map(c => `"${c}"`).join(', ');

  return `Assistant géographie & media planning. Catégories POI disponibles: ${catsFormatted}
Réponse texte: 1-2 phrases max en français. Appelle les outils simultanément si besoin.

MAPPING DÉMOGRAPHIQUE (valable pour tous les outils — toutes colonnes en minuscules):
Population: "population"/"habitants" → col:ind | "0-3 ans" → col:ind_0_3 | "4-5 ans" → col:ind_4_5 | "6-10 ans" → col:ind_6_10
Âges: "11-17 ans" → col:ind_11_17 | "18-24 ans"/"jeunes 18-24" → col:ind_18_24 | "25-39 ans" → col:ind_25_39 | "40-54 ans" → col:ind_40_54 | "55-64 ans" → col:ind_55_64 | "65-79 ans"/"seniors" → col:ind_65_79 | "80 ans+" → col:ind_80p
Ménages: "ménages" → col:men | "ménages pauvres"/"pauvreté" → col:men_pauv | "propriétaires" → col:men_prop | "familles mono" → col:men_fmp | "maison" → col:men_mais | "collectif"/"appartement" → col:men_coll | "surface" → col:men_surf
Revenus: "revenus"/"revenu médian"/"CSP+" → col:ind_snv
Logements: "logements anciens"/"avant 1945" → col:log_av45 | "logements sociaux"/"HLM" → col:log_soc | "logements après 1990" → col:log_ap90
AMBIGU ("jeunes" seul, "seniors" seul, "enfants", "actifs") → demander clarification avant d'appeler.

ROUTAGE DES OUTILS:
"voronoï/voronoi/territoire/zone d'influence/découpage/cellule/diagramme" (sans "routier") → voronoi_analysis
"voronoï routier/voronoi routier/bataille isochrones/anneaux temps réel/sectorisation routière" → isochrone_battle
"panneaux/OOH/outdoor/4x3/abribus/JCDecaux/Clear Channel/régie/affichage extérieur" → analyser_panneaux
"meilleurs panneaux pour [cible]"/"top panneaux par audience" → classer_panneaux_audience
"panneaux près des [POI] pour [cible]"/"synergie POI + audience" → analyze_poi_synergy
"combien de [cible] dans X min autour de [lieu]"/"audience potentielle autour de" → calculate_audience_coverage
"isochrone/X min à pied/voiture/vélo" (lieu unique) → analyser_zone_pois + isochrone_minutes/mode
"carreaux/18-24 ans/population/revenus/densité" (affichage carte thermique) → afficher_carreaux
défaut (montre/affiche/trouve des établissements) → analyser_zone_pois

OUTIL: analyser_zone_pois
Marqueurs POI sur carte. Params: ville|region|departement (optionnels), categorie_poi (exact parmi les catégories), couleur CSS (si mentionnée).
Si l'utilisateur dit "tous les [POI] de France" / "en France" / "France entière" → appeler SANS ville/region/departement (France entière, limite 2000).
Si l'utilisateur dit "tous les [POI]" sans préciser de lieu → appeler SANS filtre géo (France entière).
Ne JAMAIS demander de ville si l'utilisateur demande explicitement une vue nationale ou "tous".
Plusieurs catégories = plusieurs appels simultanés.
Ex: "lycées et CIRFA à Brest" → 2 appels: {ville:"Brest",cat:"lycee"} + {ville:"Brest",cat:"cirfa"}
Ex France: "tous les CIRFA de France" → {cat:"cirfa"} (sans ville)
Ex isochrone: "30 min voiture depuis CIRFA Lyon" → {ville:"Lyon",cat:"cirfa",isochrone_minutes:30,isochrone_mode:"drive"}

OUTIL: afficher_carreaux
Carte thermique INSEE 200m. Params: indicateur (col du mapping), indicateur_label, ville|region|departement.

OUTIL: voronoi_analysis
Zones d'influence géométriques (vol d'oiseau, instantané). Par défaut metropolitaine=true (DROM-COM exclus, le mentionner).
"outre-mer/Guadeloupe/Martinique/DROM" → metropolitaine:false

OUTIL: isochrone_battle
Sectorisation par temps de trajet réel (ORS). Paliers 10/30/60/90/120 min voiture. Avertir: "Calcul ~1-2 min au 1er appel."
Appeler IMMÉDIATEMENT sans demander confirmation. Si filtre géo mentionné, toujours le passer.
Si l'outil retourne {error:"..."} → reproduire le message EXACTEMENT à l'utilisateur.

OUTIL: analyser_panneaux
Affiche panneaux OOH sur carte. Params optionnels: regie, ville|region|departement, type_panneau, couleur.

OUTIL: classer_panneaux_audience
Classe panneaux par audience cible dans un rayon. Params: ville, target_column/target_label (mapping démo), rayon_metres, limit, regie (opt).
Réponse: tableau rang|référence|régie|type|audience + total cumulé.

OUTIL: calculate_audience_coverage
Nombre de personnes d'une cible dans un isochrone réel autour d'un lieu unique.
Params: location_name, travel_time_minutes, target_column/target_label, mode (walk/drive/bike).

OUTIL: analyze_poi_synergy
Panneaux combinant proximité POI + audience démo. VILLE OBLIGATOIRE (demander si absent).
Params: poi_category, ville, target_demo_col/label, max_distance_m, buffer_radius_m.
Réponse: "X panneaux à moins de Ym d'un [POI], touchant >Z [cible]." + Top 3.

`;
}
