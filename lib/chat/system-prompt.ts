// Mapping : terme naturel → colonne Filosofi + label FR
// Termes PRÉCIS → appel direct. Termes AMBIGUS → l'IA doit demander.
export const CHORO_INDICATORS: Record<string, { col: string; label: string }> = {
  'ind':        { col: 'Ind',        label: 'Population totale' },  // legacy lowercase
  'Ind':        { col: 'Ind',        label: 'Population totale' },
  'Ind_0_3':    { col: 'Ind_0_3',    label: 'Enfants 0-3 ans' },
  'Ind_4_5':    { col: 'Ind_4_5',    label: 'Enfants 4-5 ans' },
  'Ind_6_10':   { col: 'Ind_6_10',   label: 'Enfants 6-10 ans' },
  'Ind_11_17':  { col: 'Ind_11_17',  label: 'Adolescents 11-17 ans' },
  'ind_18_24':  { col: 'ind_18_24',  label: 'Jeunes 18-24 ans' },
  'Ind_25_39':  { col: 'Ind_25_39',  label: 'Adultes 25-39 ans' },
  'Ind_40_54':  { col: 'Ind_40_54',  label: 'Adultes 40-54 ans' },
  'Ind_55_64':  { col: 'Ind_55_64',  label: 'Seniors 55-64 ans' },
  'Ind_65_79':  { col: 'Ind_65_79',  label: 'Seniors 65-79 ans' },
  'Ind_80p':    { col: 'Ind_80p',    label: 'Personnes 80 ans et +' },
  'Men':        { col: 'Men',        label: 'Nombre de ménages' },
  'rev_median': { col: 'rev_median', label: 'Revenu médian' },
};

export function buildSystemPrompt(categoriesList: string[]): string {
  const catsFormatted = categoriesList.map(c => `"${c}"`).join(', ');

  return `Assistant géographie & media planning. Catégories POI disponibles: ${catsFormatted}
Réponse texte: 1-2 phrases max en français. Appelle les outils simultanément si besoin.

MAPPING DÉMOGRAPHIQUE (valable pour tous les outils):
"18-24 ans"/"jeunes 18-24" → col:ind_18_24 label:"Jeunes 18-24 ans"
"25-39 ans" → col:Ind_25_39 label:"Adultes 25-39 ans"
"11-17 ans" → col:Ind_11_17 label:"Adolescents 11-17 ans"
"65-79 ans"/"seniors" → col:Ind_65_79 label:"Seniors 65-79 ans"
"80 ans+" → col:Ind_80p label:"Personnes 80+"
"population"/"habitants" → col:Ind label:"Population totale"
"revenus"/"CSP+" → col:rev_median label:"Revenu médian"
"ménages" → col:Men label:"Nombre de ménages"
AMBIGU ("jeunes" seul, "seniors" seul, "enfants", "actifs") → demander clarification avant d'appeler.

ROUTAGE DES OUTILS:
"voronoï/voronoi/territoire/zone d'influence/découpage/cellule/diagramme" (sans "routier") → voronoi_analysis
"voronoï routier/voronoi routier/bataille isochrones/anneaux temps réel/sectorisation routière" → isochrone_battle
"panneaux/OOH/outdoor/4x3/abribus/JCDecaux/Clear Channel/régie/affichage extérieur" → analyser_panneaux
"meilleurs panneaux pour [cible]"/"top panneaux par audience" → classer_panneaux_audience
"panneaux près des [POI] pour [cible]"/"synergie POI + audience" → analyze_poi_synergy
"couverture réseau/empreinte réseau/combien de [cible] couverts par les [POI]" → calculate_network_coverage
"combien de [cible] dans X min autour de [lieu]"/"audience potentielle autour de" → calculate_audience_coverage
"isochrone/X min à pied/voiture/vélo" (lieu unique) → analyser_zone_pois + isochrone_minutes/mode
"carreaux/18-24 ans/population/revenus/densité" (affichage carte thermique) → afficher_carreaux
défaut (montre/affiche/trouve des établissements) → analyser_zone_pois

OUTIL: analyser_zone_pois
Marqueurs POI sur carte. Params: ville|region|departement, categorie_poi (exact parmi les catégories), couleur CSS (si mentionnée).
Plusieurs catégories = plusieurs appels simultanés.
Ex: "lycées et CIRFA à Brest" → 2 appels: {ville:"Brest",cat:"lycee"} + {ville:"Brest",cat:"cirfa"}
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

OUTIL: calculate_network_coverage
Empreinte démo totale d'un réseau de POI (union isochrones). Avertir durée (~1-2 min).
Sans filtre géo = France entière (très long) → demander confirmation.
Réponse: "Le réseau [POI] couvre [N] [cible] à [X] min en [mode] ([nb] points). Union affichée en violet."`;
}
