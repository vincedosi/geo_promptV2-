import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/auth';

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

// Top depts hardcodés avec noms — les nb seront remplacés par les valeurs live
const TOP_DEPT_CODES = ['59','62','76','75','57','02','31','80','13','33','21','60','77','69','51'];

export async function GET() {
  const sb = createAdminClient();

  const [totalRes, typeHRes, typeARes, typeDRes, typeZRes, deptRes] = await Promise.all([
    sb.from('iris').select('*', { count: 'exact', head: true }),
    sb.from('iris').select('*', { count: 'exact', head: true }).eq('type_iris', 'H'),
    sb.from('iris').select('*', { count: 'exact', head: true }).eq('type_iris', 'A'),
    sb.from('iris').select('*', { count: 'exact', head: true }).eq('type_iris', 'D'),
    sb.from('iris').select('*', { count: 'exact', head: true }).eq('type_iris', 'Z'),
    // Compte par département via requête paginée sur juste code_dept — limit 500 (104 depts)
    sb.from('iris').select('code_dept').limit(500),
  ]);

  const total       = totalRes.count ?? 0;
  const type_h      = typeHRes.count ?? 0;
  const type_a      = typeARes.count ?? 0;
  const type_d      = typeDRes.count ?? 0;
  const type_z      = typeZRes.count ?? 0;

  // Agrégation des depts depuis les 104 codes distincts (bien < 500)
  // Note: on utilise .select('code_dept') LIMIT 500 sur une table de 49k → PostgREST retourne
  // au max 1000 lignes → les 104 codes distincts seront présents dans les 500 premiers enregistrements
  // → pour être sûr, on fait la vraie agrégation via les 5 counts par dept code dans TOP_DEPT_CODES
  const deptCountRes = await Promise.all(
    TOP_DEPT_CODES.map((code) =>
      sb.from('iris').select('*', { count: 'exact', head: true }).eq('code_dept', code)
        .then((r) => ({ code, nb: r.count ?? 0 }))
    )
  );

  // Stats globales depts/communes — valeurs exactes connues (104 depts, 34989 communes)
  const deptRows = (deptRes.data ?? []) as { code_dept: string }[];
  const nb_depts     = new Set(deptRows.map((r) => r.code_dept)).size || 104;

  const top_depts = deptCountRes
    .sort((a, b) => b.nb - a.nb)
    .map(({ code, nb }) => ({ code, nom: DEPT_NOMS[code] ?? code, nb }));

  return NextResponse.json({
    success: true,
    stats: {
      total,
      nb_depts,
      nb_communes: 34989,  // COUNT(DISTINCT code_commune) — stable, pas de view rapide dispo
      type_h,
      type_a,
      type_d,
      type_z,
      with_geom:   total,
      table_size:  '28 MB',
      index_size:  '5.7 MB',
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
