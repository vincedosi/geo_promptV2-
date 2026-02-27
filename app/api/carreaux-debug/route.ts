/**
 * DEBUG API — /api/carreaux-debug
 * Retourne les 5 premières lignes brutes de Supabase + diagnostic complet.
 * But : comprendre exactement ce que Supabase retourne.
 */
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

export async function GET() {
  const logs: string[] = [];
  const log = (msg: string) => { logs.push(msg); console.log(`[carreaux-debug] ${msg}`); };

  try {
    const supabase = createAdminClient();

    // 1. Lister les sources
    log('Step 1: Listing data_sources...');
    const { data: sources, error: srcErr } = await supabase
      .from('data_sources')
      .select('id, name, type, geo_config')
      .eq('type', 'carreaux')
      .eq('status', 'active');

    if (srcErr) {
      log(`ERROR listing sources: ${srcErr.message}`);
      return NextResponse.json({ logs, error: srcErr.message });
    }

    log(`Found ${sources?.length ?? 0} sources`);
    const tableName = (sources?.[0]?.geo_config as any)?.table_name;
    log(`First source table: ${tableName}`);

    if (!tableName) {
      return NextResponse.json({ logs, error: 'No table found' });
    }

    // 2. Fetch 3 rows RAW (no parsing)
    log('Step 2: Fetching 3 raw rows...');
    const { data: rawRows, error: fetchErr } = await supabase
      .from(tableName)
      .select('*')
      .limit(3);

    if (fetchErr) {
      log(`ERROR fetching: ${fetchErr.message}`);
      return NextResponse.json({ logs, error: fetchErr.message });
    }

    log(`Got ${rawRows?.length ?? 0} raw rows`);

    const rawAnalysis = (rawRows || []).map((row, i) => {
      const columns = Object.keys(row);
      const geomRaw = row.geom;
      const geomType = typeof geomRaw;
      let geomDetail: any = null;

      if (geomType === 'object' && geomRaw !== null) {
        geomDetail = {
          isArray: Array.isArray(geomRaw),
          keys: Object.keys(geomRaw),
          type: (geomRaw as any).type,
          hasCoordinates: !!(geomRaw as any).coordinates,
          coordinatesType: typeof (geomRaw as any).coordinates,
          coordinatesIsArray: Array.isArray((geomRaw as any).coordinates),
        };
        if ((geomRaw as any).coordinates && Array.isArray((geomRaw as any).coordinates)) {
          const coords = (geomRaw as any).coordinates;
          geomDetail.coordsLength = coords.length;
          if (coords[0]) {
            geomDetail.ring0Length = Array.isArray(coords[0]) ? coords[0].length : 'not array';
            if (Array.isArray(coords[0]) && coords[0][0]) {
              geomDetail.firstPoint = coords[0][0];
              geomDetail.firstPointType = typeof coords[0][0];
              geomDetail.firstPointIsArray = Array.isArray(coords[0][0]);
              if (Array.isArray(coords[0][0])) {
                geomDetail.firstPointLength = coords[0][0].length;
                geomDetail.firstPointValues = coords[0][0];
              }
            }
            // Check last point = first point (closed ring)
            if (Array.isArray(coords[0]) && coords[0].length > 0) {
              geomDetail.lastPoint = coords[0][coords[0].length - 1];
              geomDetail.isClosed = JSON.stringify(coords[0][0]) === JSON.stringify(coords[0][coords[0].length - 1]);
            }
          }
        }
      } else if (geomType === 'string') {
        geomDetail = {
          isString: true,
          first100chars: (geomRaw as string).substring(0, 100),
          length: (geomRaw as string).length,
        };
      }

      return {
        rowIndex: i,
        columns,
        idcar: row.idcar,
        geomType,
        geomIsNull: geomRaw === null,
        geomDetail,
        metadataType: typeof row.metadata,
        metadataKeys: row.metadata ? Object.keys(row.metadata as any) : null,
        metadataSample: row.metadata ? Object.entries(row.metadata as any).slice(0, 5) : null,
        // Full raw geom for first row only
        fullGeom: i === 0 ? geomRaw : undefined,
      };
    });

    log('Step 3: Analysis complete');

    // 3. Also fetch with explicit geom cast to see if it changes anything
    log('Step 4: Trying select with ST_AsGeoJSON...');
    let stAsGeoJSON = null;
    try {
      // This uses a raw RPC or a view — but Supabase doesn't support ST_AsGeoJSON directly in select
      // Instead, let's just check what .select('geom') returns vs .select('*')
      const { data: geomOnly, error: geomErr } = await supabase
        .from(tableName)
        .select('idcar, geom')
        .limit(1);
      
      if (geomErr) {
        log(`geom-only fetch error: ${geomErr.message}`);
      } else if (geomOnly && geomOnly[0]) {
        const g = geomOnly[0].geom;
        stAsGeoJSON = {
          type: typeof g,
          value: g,
        };
        log(`geom-only result type: ${typeof g}`);
      }
    } catch (e: any) {
      log(`geom-only fetch exception: ${e.message}`);
    }

    // 4. Build a test GeoJSON from the first row to check validity
    log('Step 5: Building test GeoJSON from row 0...');
    let testFeature: any = null;
    if (rawRows && rawRows[0] && rawRows[0].geom) {
      const geom = rawRows[0].geom as any;
      if (typeof geom === 'object' && geom.type && geom.coordinates) {
        testFeature = {
          type: 'Feature',
          geometry: {
            type: geom.type,
            coordinates: geom.coordinates,
          },
          properties: { idcar: rawRows[0].idcar, test: true },
        };
        log(`Test feature built: type=${geom.type}, coords rings=${geom.coordinates?.length}`);
      } else {
        log(`Cannot build test feature: geom has type=${geom.type}, coords=${!!geom.coordinates}`);
      }
    }

    return NextResponse.json({
      logs,
      tableName,
      sourcesCount: sources?.length ?? 0,
      rawRowCount: rawRows?.length ?? 0,
      rawAnalysis,
      stAsGeoJSON,
      testFeature,
    });

  } catch (err: any) {
    log(`EXCEPTION: ${err.message}`);
    return NextResponse.json({ logs, error: err.message }, { status: 500 });
  }
}
