import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';
import { requireAdmin, adminUnauthorized } from '@/lib/api/middleware';
import { rpcJson } from '@/lib/supabase/rpc-json';

export const dynamic = 'force-dynamic';

// Noms des départements (non stockés dans la table iris — référentiel statique INSEE)
const DEPT_NOMS: Record<string, string> = {
  '01':'Ain','02':'Aisne','03':'Allier','04':'Alpes-de-Haute-Provence','05':'Hautes-Alpes',
  '06':'Alpes-Maritimes','07':'Ardèche','08':'Ardennes','09':'Ariège','10':'Aube',
  '11':'Aude','12':'Aveyron','13':'Bouches-du-Rhône','14':'Calvados','15':'Cantal',
  '16':'Charente','17':'Charente-Maritime','18':'Cher','19':'Corrèze','2A':'Corse-du-Sud',
  '2B':'Haute-Corse','21':"Côte-d'Or",'22':"Côtes-d'Armor",'23':'Creuse','24':'Dordogne',
  '25':'Doubs','26':'Drôme','27':'Eure','28':'Eure-et-Loir','29':'Finistère',
  '30':'Gard','31':'Haute-Garonne','32':'Gers','33':'Gironde','34':'Hérault',
  '35':'Ille-et-Vilaine','36':'Indre','37':'Indre-et-Loire','38':'Isère','39':'Jura',
  '40':'Landes','41':'Loir-et-Cher','42':'Loire','43':'Haute-Loire','44':'Loire-Atlantique',
  '45':'Loiret','46':'Lot','47':'Lot-et-Garonne','48':'Lozère','49':'Maine-et-Loire',
  '50':'Manche','51':'Marne','52':'Haute-Marne','53':'Mayenne','54':'Meurthe-et-Moselle',
  '55':'Meuse','56':'Morbihan','57':'Moselle','58':'Nièvre','59':'Nord',
  '60':'Oise','61':'Orne','62':'Pas-de-Calais','63':'Puy-de-Dôme','64':'Pyrénées-Atlantiques',
  '65':'Hautes-Pyrénées','66':'Pyrénées-Orientales','67':'Bas-Rhin','68':'Haut-Rhin',
  '69':'Rhône','70':'Haute-Saône','71':'Saône-et-Loire','72':'Sarthe','73':'Savoie',
  '74':'Haute-Savoie','75':'Paris','76':'Seine-Maritime','77':'Seine-et-Marne',
  '78':'Yvelines','79':'Deux-Sèvres','80':'Somme','81':'Tarn','82':'Tarn-et-Garonne',
  '83':'Var','84':'Vaucluse','85':'Vendée','86':'Vienne','87':'Haute-Vienne',
  '88':'Vosges','89':'Yonne','90':'Territoire de Belfort','91':'Essonne',
  '92':'Hauts-de-Seine','93':'Seine-Saint-Denis','94':'Val-de-Marne','95':"Val-d'Oise",
  '971':'Guadeloupe','972':'Martinique','973':'Guyane','974':'La Réunion','976':'Mayotte',
};

// Les 15 départements les plus fournis ne sont plus écrits ici : la RPC les
// calcule. La liste qui y figurait ('59','62','76','75','57','02','31','80',
// '13','33','21','60','77','69','51') s'est révélée exacte au moment de la
// bascule — même codes, même ordre — mais elle n'était vraie que par hasard,
// et elle serait devenue fausse au premier ré-import.

export async function GET(req: NextRequest) {
  const profile = await requireAdmin(req);
  if (!profile) return adminUnauthorized();

  const sb = createAdminClient();

  // UNE requête, au lieu des 21 d'avant (5 count par type + 1 select + 15 count
  // par département, en deux vagues de Promise.all). Mesuré : une SEULE de ces
  // 21 requêtes coûtait 714 ms en balayage complet d'une table de 221 Mo, soit
  // ~15 s de travail base par ouverture de page — le motif exact de l'incident
  // du 2026-03-28. La RPC fait tout en 112 ms. Voir sql/131.
  const { data, error } = await sb.rpc('get_iris_admin_stats');

  if (error || !data) {
    return NextResponse.json(
      { success: false, error: error?.message ?? 'Statistiques indisponibles' },
      { status: 500 },
    );
  }

  const s = rpcJson<{
    total: number; type_h: number; type_a: number; type_d: number; type_z: number;
    nb_depts: number; nb_communes: number; with_geom: number;
    table_size: string; index_size: string;
    top_depts: { code: string; nb: number }[];
  }>(data)!;

  const top_depts = s.top_depts.map(({ code, nb }) => ({
    code,
    nom: DEPT_NOMS[code] ?? code,
    nb,
  }));

return NextResponse.json({
    success: true,
    stats: {
      total:       s.total,
      nb_depts:    s.nb_depts,
      nb_communes: s.nb_communes,
      type_h:      s.type_h,
      type_a:      s.type_a,
      type_d:      s.type_d,
      type_z:      s.type_z,
      with_geom:   s.with_geom,
      table_size:  s.table_size,
      index_size:  s.index_size,
    },
    top_depts,
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
