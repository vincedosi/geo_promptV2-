/**
 * /api/admin/carreaux-gen-schema
 * 
 * Génère le SQL CREATE TABLE basé sur les colonnes sélectionnées
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';

interface GenerateSchemaRequest {
  tableName: string;
  geomColumn: string;
  idColumn: string;
  selectedColumns: string[];  // Colonnes INSEE à inclure
}

export async function POST(request: NextRequest) {
  try {
    // ── Vérifier admin ──
    const user = await requireAdmin();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const { tableName, geomColumn, idColumn, selectedColumns } = await request.json() as GenerateSchemaRequest;

    if (!tableName || !geomColumn || !idColumn) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400 }
      );
    }

    // ── Valider nom table ──
    if (!/^[a-z_][a-z0-9_]*$/.test(tableName)) {
      return new Response(
        JSON.stringify({ error: 'Invalid table name. Use lowercase and underscores only.' }),
        { status: 400 }
      );
    }

    // ── Mapping colonnes INSEE → types SQL ──
    const INSEE_TYPES: Record<string, string> = {
      idcar: 'TEXT UNIQUE NOT NULL',
      
      // Numérique
      Ind: 'NUMERIC',
      Ind_0_3: 'NUMERIC',
      Ind_3_5: 'NUMERIC',
      Ind_6_10: 'NUMERIC',
      Ind_11_17: 'NUMERIC',
      Ind_18_24: 'NUMERIC',
      Ind_25_39: 'NUMERIC',
      Ind_40_54: 'NUMERIC',
      Ind_55_64: 'NUMERIC',
      Ind_65_79: 'NUMERIC',
      Ind_80p: 'NUMERIC',
      
      Men: 'NUMERIC',
      Men_pauv: 'NUMERIC',
      Men_1ind: 'NUMERIC',
      Men_5ind: 'NUMERIC',
      Men_prop: 'NUMERIC',
      Men_loc: 'NUMERIC',
      
      Ind_snv: 'NUMERIC',
      revenu_moyen: 'NUMERIC',
      pct_pauvres: 'NUMERIC',
      
      Log: 'NUMERIC',
      Log_ap: 'NUMERIC',
      Log_mais: 'NUMERIC',
      Log_av45: 'NUMERIC',
      Log_45_70: 'NUMERIC',
      Log_70_90: 'NUMERIC',
      Log_ap90: 'NUMERIC',
      Log_surf: 'NUMERIC',
      
      densite: 'NUMERIC',
      pct_jeunes: 'NUMERIC',
      pct_actifs: 'NUMERIC',
      pct_seniors: 'NUMERIC',
    };

    // ── Mapping colonne → label ──
    const INSEE_LABELS: Record<string, string> = {
      idcar: 'Identifiant carreau',
      Ind: 'Population totale',
      Ind_0_3: 'Individus 0-3 ans',
      Ind_18_24: 'Jeunes 18-24 ans',
      Men: 'Nombre de ménages',
      Men_pauv: 'Ménages pauvres',
      revenu_moyen: 'Revenu moyen',
      pct_jeunes: '% jeunes 0-24 ans',
      pct_actifs: '% actifs 25-54 ans',
      pct_seniors: '% seniors 65+ ans',
      densite: 'Densité population',
      Log: 'Nombre de logements',
    };

    // ── Construire les colonnes SQL ──
    const columns: string[] = [];
    
    // UUID primary key
    columns.push('  id UUID PRIMARY KEY DEFAULT gen_random_uuid()');
    
    // Géométrie
    columns.push(`  ${geomColumn} GEOMETRY(Polygon, 4326) NOT NULL`);
    
    // Identifiant (si différent de idcar col sélectionnée)
    if (idColumn !== geomColumn) {
      const idType = INSEE_TYPES[idColumn] || 'TEXT';
      columns.push(`  ${idColumn} ${idType}`);
    }
    
    // Colonnes INSEE sélectionnées
    for (const col of selectedColumns) {
      const sqlType = INSEE_TYPES[col] || 'NUMERIC';
      const colDef = `  ${col} ${sqlType}`;
      columns.push(colDef);
    }
    
    // Métadonnées & traçabilité
    columns.push('  metadata JSONB');
    columns.push('  date_import TIMESTAMPTZ DEFAULT NOW()');
    columns.push('  source TEXT DEFAULT \'INSEE Filosofi 200m\'');
    
    // ── Construire le SQL ──
    const sql = `-- Table carreaux générée automatiquement
-- Colonnes sélectionnées: ${selectedColumns.join(', ')}
-- Générée: ${new Date().toISOString()}

CREATE TABLE IF NOT EXISTS ${tableName} (
${columns.join(',\n')}
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_${tableName}_geom 
ON ${tableName} USING GIST(${geomColumn});

CREATE INDEX IF NOT EXISTS idx_${tableName}_${idColumn} 
ON ${tableName}(${idColumn});

-- Commentaires
COMMENT ON TABLE ${tableName} IS 'Carreaux INSEE Filosofi 200m - données socio-démographiques';
COMMENT ON COLUMN ${tableName}.${geomColumn} IS 'Géométrie polygone WGS84 (EPSG:4326)';
COMMENT ON COLUMN ${tableName}.${idColumn} IS 'Identifiant carreau';
COMMENT ON COLUMN ${tableName}.metadata IS 'Toutes les colonnes brutes en JSON';`;

    console.log('[carreaux-gen-schema]', { tableName, colCount: selectedColumns.length });

    return new Response(
      JSON.stringify({
        success: true,
        sql,
        tableName,
        columnCount: selectedColumns.length + 5, // +5 pour id, geom, metadata, date, source
        selectedColumns,
      }),
      { status: 200 }
    );
  } catch (err: any) {
    console.error('[carreaux-gen-schema] Error:', err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500 }
    );
  }
}
