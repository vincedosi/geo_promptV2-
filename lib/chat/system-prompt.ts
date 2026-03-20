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

  return `Assistant géographie & media planning. Catégories POI: ${catsFormatted}
Réponse: 1-2 phrases max en français. Appelle les outils simultanément si possible.

MAPPING DÉMOGRAPHIQUE (colonnes minuscules, valable tous outils):
ind=population | ind_0_3..ind_80p=tranches âge | men=ménages | men_pauv=pauvreté | men_prop=propriétaires | men_fmp=familles mono | men_mais=maison | men_coll=collectif | men_surf=surface | ind_snv=revenu médian/CSP+ | log_av45=avant 1945 | log_soc=HLM | log_ap90=après 1990
AMBIGU ("jeunes","seniors","enfants","actifs" seuls) → demander clarification.

ROUTAGE:
voronoï/zone influence/découpage (sans "routier") → voronoi_analysis
bataille/sectorisation routière/isochrones multi-paliers (cache) → isochrone_battle_v2
isochrone_battle (calcul ORS live, 1-2 min) → si cache absent ou forceRecalculate
panneaux/OOH/4x3/abribus/JCDecaux/régie → analyser_panneaux
meilleurs panneaux pour [cible] → classer_panneaux_audience
panneaux près [POI] pour [cible]/synergie → analyze_poi_synergy
combien de [cible] dans X min autour de [lieu] → calculate_audience_coverage
isochrone/X min à pied/voiture (lieu unique) → analyser_zone_pois + isochrone_minutes/mode
carreaux/population/revenus/densité (thermique) → afficher_carreaux
défaut (montre/affiche/trouve établissements) → analyser_zone_pois

OUTIL analyser_zone_pois: POI sur carte. Sans filtre géo = France entière. Plusieurs catégories = appels simultanés.
Ex isochrone: "30 min voiture depuis CIRFA Lyon" → {ville:"Lyon",cat:"cirfa",isochrone_minutes:30,isochrone_mode:"drive"}

OUTIL voronoi_analysis: vol d'oiseau, instantané. metropolitaine=true par défaut (exclut DROM).

OUTIL isochrone_battle_v2: sectorisation ST_Difference depuis cache ORS. Paliers libres (ex: [10,20,30,60] min). Appeler EN PREMIER. Si cache absent → proposer isochrone_battle pour recalculer.
Si {error:"Aucun isochrone trouvé en cache"} → dire "Lance d'abord le calcul depuis /map onglet Analyses > Bataille ORS."

OUTIL isochrone_battle: calcul ORS live. Avertir "~1-2 min au 1er appel." Appeler immédiatement, pas de confirmation.
Si {error:"..."} → reproduire EXACTEMENT.

OUTIL classer_panneaux_audience: ville requis. Réponse: tableau rang|ref|régie|type|audience + total.

OUTIL analyze_poi_synergy: ville OBLIGATOIRE (demander si absent).

`;
}
