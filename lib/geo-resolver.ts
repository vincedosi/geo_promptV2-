/**
 * GENESIS — Geo Resolver
 * Resolves flexible user inputs (department names/codes, city names, region aliases)
 * to exact DB values for POI filtering.
 */

/** Normalize string: lowercase, remove accents, trim */
function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

// ----- DEPARTMENT RESOLVER -----
const DEPT_CODE_TO_NAME: Record<string, string> = {
  '01': 'Ain', '02': 'Aisne', '03': 'Allier', '04': 'Alpes-de-Haute-Provence',
  '05': 'Hautes-Alpes', '06': 'Alpes-Maritimes', '07': 'Ardèche', '08': 'Ardennes',
  '09': 'Ariège', '10': 'Aube', '11': 'Aude', '12': 'Aveyron',
  '13': 'Bouches-du-Rhône', '14': 'Calvados', '15': 'Cantal', '16': 'Charente',
  '17': 'Charente-Maritime', '18': 'Cher', '19': 'Corrèze', '2A': 'Corse-du-Sud',
  '2B': 'Haute-Corse', '21': 'Côte-d\'Or', '22': 'Côtes-d\'Armor', '23': 'Creuse',
  '24': 'Dordogne', '25': 'Doubs', '26': 'Drôme', '27': 'Eure',
  '28': 'Eure-et-Loir', '29': 'Finistère', '30': 'Gard', '31': 'Haute-Garonne',
  '32': 'Gers', '33': 'Gironde', '34': 'Hérault', '35': 'Ille-et-Vilaine',
  '36': 'Indre', '37': 'Indre-et-Loire', '38': 'Isère', '39': 'Jura',
  '40': 'Landes', '41': 'Loir-et-Cher', '42': 'Loire', '43': 'Haute-Loire',
  '44': 'Loire-Atlantique', '45': 'Loiret', '46': 'Lot', '47': 'Lot-et-Garonne',
  '48': 'Lozère', '49': 'Maine-et-Loire', '50': 'Manche', '51': 'Marne',
  '52': 'Haute-Marne', '53': 'Mayenne', '54': 'Meurthe-et-Moselle', '55': 'Meuse',
  '56': 'Morbihan', '57': 'Moselle', '58': 'Nièvre', '59': 'Nord',
  '60': 'Oise', '61': 'Orne', '62': 'Pas-de-Calais', '63': 'Puy-de-Dôme',
  '64': 'Pyrénées-Atlantiques', '65': 'Hautes-Pyrénées', '66': 'Pyrénées-Orientales',
  '67': 'Bas-Rhin', '68': 'Haut-Rhin', '69': 'Rhône', '70': 'Haute-Saône',
  '71': 'Saône-et-Loire', '72': 'Sarthe', '73': 'Savoie', '74': 'Haute-Savoie',
  '75': 'Paris', '76': 'Seine-Maritime', '77': 'Seine-et-Marne', '78': 'Yvelines',
  '79': 'Deux-Sèvres', '80': 'Somme', '81': 'Tarn', '82': 'Tarn-et-Garonne',
  '83': 'Var', '84': 'Vaucluse', '85': 'Vendée', '86': 'Vienne',
  '87': 'Haute-Vienne', '88': 'Vosges', '89': 'Yonne', '90': 'Territoire de Belfort',
  '91': 'Essonne', '92': 'Hauts-de-Seine', '93': 'Seine-Saint-Denis',
  '94': 'Val-de-Marne', '95': 'Val-d\'Oise',
  '971': 'Guadeloupe', '972': 'Martinique', '973': 'Guyane', '974': 'La Réunion', '976': 'Mayotte',
};

const DEPT_NAME_TO_CODE: Record<string, string> = {};
for (const [code, name] of Object.entries(DEPT_CODE_TO_NAME)) {
  DEPT_NAME_TO_CODE[normalize(name)] = code;
}

function resolveDepartement(input: string, fieldValues?: string[]): string | null {
  const trimmed = input.trim();

  // If it's a number/code, resolve to department name
  if (DEPT_CODE_TO_NAME[trimmed]) {
    const deptName = DEPT_CODE_TO_NAME[trimmed];
    if (fieldValues) {
      const match = fieldValues.find(v => v === deptName)
        || fieldValues.find(v => normalize(v) === normalize(deptName))
        || fieldValues.find(v => v === trimmed);
      if (match) return match;
    }
    return deptName;
  }

  // If it's a name, try matching
  const normalizedInput = normalize(trimmed);

  // Direct match against fieldValues
  if (fieldValues) {
    const exact = fieldValues.find(v => normalize(v) === normalizedInput);
    if (exact) return exact;
    const partial = fieldValues.find(v => normalize(v).includes(normalizedInput) || normalizedInput.includes(normalize(v)));
    if (partial) return partial;
  }

  // Try resolving via our map
  const code = DEPT_NAME_TO_CODE[normalizedInput];
  if (code && DEPT_CODE_TO_NAME[code]) {
    const name = DEPT_CODE_TO_NAME[code];
    if (fieldValues) {
      const match = fieldValues.find(v => normalize(v) === normalize(name));
      if (match) return match;
    }
    return name;
  }

  // Special cases
  if (normalizedInput === 'paris') return fieldValues?.find(v => normalize(v) === 'paris') || 'Paris';

  return trimmed;
}

// ----- REGION RESOLVER -----
const REGION_ALIASES: Record<string, string> = {
  'idf': 'Île-de-France', 'ile de france': 'Île-de-France', 'ile-de-france': 'Île-de-France',
  'paca': 'Provence-Alpes-Côte d\'Azur', 'provence': 'Provence-Alpes-Côte d\'Azur',
  'rhone alpes': 'Auvergne-Rhône-Alpes', 'auvergne rhone alpes': 'Auvergne-Rhône-Alpes',
  'rhone-alpes': 'Auvergne-Rhône-Alpes', 'ara': 'Auvergne-Rhône-Alpes',
  'bretagne': 'Bretagne', 'normandie': 'Normandie',
  'grand est': 'Grand Est', 'alsace': 'Grand Est', 'lorraine': 'Grand Est', 'champagne': 'Grand Est',
  'hauts de france': 'Hauts-de-France', 'hdf': 'Hauts-de-France', 'nord pas de calais': 'Hauts-de-France', 'picardie': 'Hauts-de-France',
  'nouvelle aquitaine': 'Nouvelle-Aquitaine', 'aquitaine': 'Nouvelle-Aquitaine',
  'occitanie': 'Occitanie', 'languedoc': 'Occitanie', 'midi pyrenees': 'Occitanie',
  'pays de la loire': 'Pays de la Loire', 'pdl': 'Pays de la Loire',
  'centre val de loire': 'Centre-Val de Loire', 'centre': 'Centre-Val de Loire',
  'bourgogne franche comte': 'Bourgogne-Franche-Comté', 'bourgogne': 'Bourgogne-Franche-Comté',
  'corse': 'Corse',
};

function resolveRegion(input: string, fieldValues?: string[]): string | null {
  const normalizedInput = normalize(input);

  // Try alias first
  const alias = REGION_ALIASES[normalizedInput];
  if (alias) {
    if (fieldValues) {
      const match = fieldValues.find(v => normalize(v) === normalize(alias));
      if (match) return match;
    }
    return alias;
  }

  // Direct match against fieldValues
  if (fieldValues) {
    const exact = fieldValues.find(v => normalize(v) === normalizedInput);
    if (exact) return exact;
    const partial = fieldValues.find(v => normalize(v).includes(normalizedInput) || normalizedInput.includes(normalize(v)));
    if (partial) return partial;
  }

  return input.trim();
}

// ----- CODE POSTAL RESOLVER -----
function resolveCodePostal(input: string): string | null {
  const cleaned = input.replace(/\s/g, '');
  if (/^\d{5}$/.test(cleaned)) return cleaned;
  // Handle "75016" style already = fine
  // Handle "16ème de Paris" type → "75016"
  const arrMatch = cleaned.match(/^(\d{1,2})(e|eme|ème)?$/i);
  if (arrMatch) {
    const arr = parseInt(arrMatch[1]);
    if (arr >= 1 && arr <= 20) return `75${String(arr).padStart(3, '0')}`;
  }
  return cleaned;
}

/**
 * Resolve all filters from Mistral output to exact DB values.
 * Handles both string and array values for multi-location queries.
 */
export function resolveFilters(
  rawFilters: Record<string, string | string[]>,
  availableFilterValues?: Record<string, string[]>
): Record<string, string | string[]> {
  const resolved: Record<string, string | string[]> = {};

  for (const [field, rawValue] of Object.entries(rawFilters)) {
    const normalizedField = normalize(field);
    const fieldValues = availableFilterValues?.[field]
      || availableFilterValues?.[normalizedField]
      || Object.entries(availableFilterValues || {}).find(([k]) => normalize(k) === normalizedField)?.[1];

    const values = Array.isArray(rawValue) ? rawValue.map(v => String(v)) : [String(rawValue)];

    if (normalizedField === 'departement' || normalizedField === 'code_departement') {
      const resolvedValues = values
        .map(v => resolveDepartement(v, fieldValues as string[] | undefined))
        .filter((v): v is string => v !== null);
      if (resolvedValues.length > 0) {
        resolved['departement'] = resolvedValues.length === 1 ? resolvedValues[0] : resolvedValues;
        console.log(`[geo-resolver] Resolved departement: ${JSON.stringify(rawValue)} → ${JSON.stringify(resolved['departement'])}`);
      }
    } else if (normalizedField === 'ville') {
      const resolvedValues = values.map(v => {
        const trimmed = v.trim();
        if (fieldValues) {
          const normalizedValue = normalize(trimmed);
          const match = (fieldValues as string[]).find(fv => fv === trimmed)
            || (fieldValues as string[]).find(fv => normalize(fv) === normalizedValue)
            || (fieldValues as string[]).find(fv => normalize(fv).includes(normalizedValue) || normalizedValue.includes(normalize(fv)));
          if (match) return match;
        }
        return trimmed.split(/[\s-]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(trimmed.includes('-') ? '-' : ' ');
      });
      resolved['ville'] = resolvedValues.length === 1 ? resolvedValues[0] : resolvedValues;
      console.log(`[geo-resolver] Resolved ville: ${JSON.stringify(rawValue)} → ${JSON.stringify(resolved['ville'])}`);
    } else if (normalizedField === 'region') {
      const resolvedValues = values
        .map(v => resolveRegion(v, fieldValues as string[] | undefined))
        .filter((v): v is string => v !== null);
      if (resolvedValues.length > 0) {
        resolved['region'] = resolvedValues.length === 1 ? resolvedValues[0] : resolvedValues;
        console.log(`[geo-resolver] Resolved region: ${JSON.stringify(rawValue)} → ${JSON.stringify(resolved['region'])}`);
      }
    } else if (normalizedField === 'code_postal' || normalizedField === 'arrondissement') {
      const resolvedValues = values
        .map(v => resolveCodePostal(v))
        .filter((v): v is string => v !== null);
      if (resolvedValues.length > 0) {
        resolved['code_postal'] = resolvedValues.length === 1 ? resolvedValues[0] : resolvedValues;
        console.log(`[geo-resolver] Resolved code_postal: ${JSON.stringify(rawValue)} → ${JSON.stringify(resolved['code_postal'])}`);
      }
    } else {
      const resolvedValues = values.map(value => {
        if (fieldValues) {
          const normalizedValue = normalize(value);
          const match = (fieldValues as string[]).find(v => v === value)
            || (fieldValues as string[]).find(v => normalize(v) === normalizedValue)
            || (fieldValues as string[]).find(v => normalize(v).includes(normalizedValue) || normalizedValue.includes(normalize(v)));
          return match || value;
        }
        return value;
      });
      resolved[field] = resolvedValues.length === 1 ? resolvedValues[0] : resolvedValues;
      console.log(`[geo-resolver] Resolved ${field}: ${JSON.stringify(rawValue)} → ${JSON.stringify(resolved[field])}`);
    }
  }

  return resolved;
}