// ── Parser CSV INSEE IRIS ─────────────────────────────────────────────────────
// Format : séparateur ';', encodage UTF-8, valeur secrète 's' → null

// Colonnes géographiques — toujours garder en string (zéros initiaux !)
export const GEO_COLUMNS = new Set([
  'IRIS', 'COM', 'LIBCOM', 'LIBIRIS', 'TYP_IRIS',
  'TRIRIS', 'GRD_QUART', 'UU2020', 'REG', 'DEP',
  'ARR', 'CV', 'ZE2020', 'LIBEPCI', 'EPCI',
  'LIBUU2020', 'CATEAAV2020', 'LIBCATEAAV2020',
  'AAV2020', 'LIBAAV2020',
  // FILO spécifique
  'IDCAR_200M', 'IDCAR_1KM', 'IDCAR_NAT',
  'I_PAUVRETE',
]);

export function isGeoColumn(name: string): boolean {
  return GEO_COLUMNS.has(name.toUpperCase()) || GEO_COLUMNS.has(name);
}

export function parseInseeValue(
  value: string,
  columnName: string,
): string | number | null {
  // Colonnes géo : toujours string
  if (isGeoColumn(columnName)) {
    const v = String(value ?? '').trim();
    return v === '' ? null : v;
  }
  // Valeur vide ou secret statistique INSEE (s=secret, ns=non significatif, nd=non disponible)
  const v = String(value ?? '').trim();
  if (!v || v === 's' || v === 'S' || v === 'ns' || v === 'NS'
    || v === 'nd' || v === 'ND' || v === 'n.d.' || v === 'n.s.') return null;
  // Convertir en nombre (INSEE utilise le point comme séparateur décimal)
  const num = parseFloat(v.replace(',', '.'));
  return isNaN(num) ? v : num;
}

export function classifyColumns(headers: string[]): {
  geoColumns: string[];
  dataColumns: string[];
} {
  const geoColumns: string[] = [];
  const dataColumns: string[] = [];
  for (const h of headers) {
    if (isGeoColumn(h)) {
      geoColumns.push(h);
    } else {
      dataColumns.push(h);
    }
  }
  return { geoColumns, dataColumns };
}
