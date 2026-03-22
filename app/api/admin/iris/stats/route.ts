import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';

const STATIC_STATS = {
  nb_depts:    104,
  nb_communes: 34921,
  type_h:      15147,
  type_a:      830,
  type_d:      408,
  type_z:      32978,
  table_size:  '28 MB',
  index_size:  '5.7 MB',
};

const TOP_DEPTS = [
  { code: '59', nom: 'Nord',              nb: 1345 },
  { code: '62', nom: 'Pas-de-Calais',     nb: 1162 },
  { code: '76', nom: 'Seine-Maritime',    nb: 1035 },
  { code: '75', nom: 'Paris',             nb: 992  },
  { code: '57', nom: 'Moselle',           nb: 925  },
  { code: '02', nom: 'Aisne',             nb: 867  },
  { code: '31', nom: 'Haute-Garonne',     nb: 849  },
  { code: '80', nom: 'Somme',             nb: 843  },
  { code: '13', nom: 'Bouches-du-Rhône',  nb: 840  },
  { code: '33', nom: 'Gironde',           nb: 837  },
  { code: '21', nom: "Côte-d'Or",         nb: 814  },
  { code: '60', nom: 'Oise',              nb: 786  },
  { code: '77', nom: 'Seine-et-Marne',    nb: 762  },
  { code: '69', nom: 'Rhône',             nb: 752  },
  { code: '51', nom: 'Marne',             nb: 745  },
];

export async function GET(request: NextRequest) {
  const profile = await requireAdmin(request);
  if (!profile) return adminUnauthorized();

  const sb = createAdminClient();
  const { count } = await sb.from('iris').select('*', { count: 'exact', head: true });

  return NextResponse.json({
    success: true,
    stats: { ...STATIC_STATS, total: count ?? 49363, with_geom: count ?? 49363 },
    top_depts: TOP_DEPTS,
    source: {
      name:        'CONTOURS-IRIS-PE — IGN 2025',
      edition:     '2025-01-01',
      provider:    "Institut national de l'information géographique et forestière (IGN)",
      license:     'Licence Ouverte v2.0 (Etalab)',
      format:      'GeoPackage (GPKG), WGS84 / EPSG:4326',
      coverage:    'France entière (métropole + DOM)',
      imported_at: '2026-03-21',
      schema:      ['code_iris', 'nom_iris', 'code_commune', 'nom_commune', 'code_dept', 'type_iris', 'geom'],
    },
  });
}
