/**
 * @file app/api/risques/exposition/export/route.ts
 *
 * Export Excel de l'analyse de population à risque.
 *
 * ── POURQUOI CE FICHIER PORTE SES PROPRES AVERTISSEMENTS ─────────────────
 *
 * Un tableur QUITTE l'application. Il est transféré, renommé, recollé dans une
 * présentation, et relu dans six mois par quelqu'un qui n'a jamais vu l'écran.
 * Tout ce que l'interface explique — les DROM non calculables, la colonne
 * « sites » qui ne s'additionne pas, l'absence de dénominateur au code postal —
 * disparaît au moment de l'export.
 *
 * Le classeur porte donc un onglet « Méthode et limites » qui voyage avec les
 * chiffres. Ce n'est pas de la politesse : sans lui, le premier lecteur qui
 * somme la colonne « sites » obtient un total faux et n'a aucun moyen de le
 * savoir.
 *
 * ── AUCUN CALCUL ICI ──────────────────────────────────────────────────────
 *
 * La route appelle la MÊME RPC que l'écran, avec les mêmes paramètres. Un
 * export qui recalculerait autrement finirait par diverger de ce qui est
 * affiché, et c'est le tableur qu'on croirait.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { rpcJson, nullableArg } from '@/lib/supabase/rpc-json';
import { createRateLimiter, rateLimitResponse } from '@/lib/api/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * Plus serré que les 20 de `/agregats` : un export déclenche le MÊME calcul
 * (3 à 43 s) PLUS la fabrication du classeur. Compteur partagé en base.
 */
const limiteur = createRateLimiter({
  max: 6,
  window: '60 s',
  prefix: 'geo:rl:exposition-export',
});

const DIMENSIONS = ['region', 'departement', 'code_postal', 'commune', 'arrondissement'] as const;

const ParamsSchema = z.object({
  dimension: z.enum(DIMENSIONS).optional(),
  cible: z.string().regex(/^[a-z0-9_]{1,40}$/).optional(),
  gravites: z.string().max(200).optional(),
  natures: z.string().max(2000).optional(),
  modes: z.string().max(40).optional(),
  rayon_m: z.coerce.number().int().min(50).max(20000).optional(),
  forcer_rayon: z.enum(['0', '1']).optional(),
  perim_niveau: z.enum(['region', 'departement']).optional(),
  perim_codes: z.string().max(600).optional(),
  /** Libellés lisibles, fournis par l'écran pour que le fichier les porte. */
  libelle_cible: z.string().max(120).optional(),
  libelle_perim: z.string().max(120).optional(),
});

function liste(brut: string | undefined): string[] | null {
  if (!brut) return null;
  const v = brut.split(',').map((s) => s.trim()).filter(Boolean);
  return v.length > 0 ? v : null;
}

interface Ligne {
  cle: string; nom: string; exposee: number; n_sites: number; n_indicatifs: number;
  carreaux: number; pop_totale: number | null; surface_km2: number | null;
  part_pct: number | null; densite: number | null;
}
interface Agregat {
  calculable: boolean; error?: string;
  dimension: string; cible: string; rayon_m: number; rayon_deduit: boolean;
  rayon_force?: boolean;
  total_exposee: number; total_sites: number; total_indicatifs: number;
  n_unites: number; tronquee: boolean; carreaux_non_attribues?: number;
  lignes: Ligne[]; calcule_le: string;
}

const LIBELLE_DIMENSION: Record<string, string> = {
  region: 'Région', departement: 'Département', code_postal: 'Code postal',
  commune: 'Commune', arrondissement: 'Arrondissement',
};

export async function GET(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const parsed = ParamsSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Paramètres invalides.' }, { status: 400 });
  }
  const p = parsed.data;

  const quota = await limiteur(profile.id);
  if (!quota.ok) return rateLimitResponse(quota.retrySec);

  const supabase = createAdminClient();
  const dimension = p.dimension ?? 'departement';

  const { data, error } = await supabase.rpc('population_exposee_agregee', {
    p_dimension: dimension,
    p_cible: p.cible ?? 'ind',
    p_gravites: nullableArg(liste(p.gravites)),
    p_natures: nullableArg(liste(p.natures)),
    p_modes: nullableArg(liste(p.modes)),
    p_rayon_m: nullableArg(p.rayon_m ?? null),
    // On exporte TOUT, jamais la liste tronquée de l'écran : un tableur sert
    // justement à regarder au-delà des 100 premières lignes.
    p_limite: 7000,
    p_perim_niveau: nullableArg(p.perim_codes ? (p.perim_niveau ?? 'departement') : null),
    p_perim_codes: nullableArg(liste(p.perim_codes)),
    p_forcer_rayon: p.forcer_rayon === '1',
  });

  if (error) {
    console.error('[risques/exposition/export]', error.message);
    return NextResponse.json({ error: 'Export indisponible.' }, { status: 500 });
  }
  const a = rpcJson<Agregat>(data);
  if (!a) return NextResponse.json({ error: 'Export indisponible.' }, { status: 500 });
  if (!a.calculable) {
    return NextResponse.json(
      { error: 'Ces filtres ne sont pas calculables — affinez-les avant d’exporter.' },
      { status: 400 },
    );
  }

  const libCible = p.libelle_cible ?? a.cible;
  const libPerim = p.libelle_perim ?? 'France entière';
  const libDim = LIBELLE_DIMENSION[dimension] ?? dimension;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'MAGELIAN';
  wb.created = new Date();

  // ── Onglet 1 : les données ──────────────────────────────────────────────
  const ws = wb.addWorksheet('Population exposée');
  ws.columns = [
    { header: 'Code', key: 'cle', width: 10 },
    { header: libDim, key: 'nom', width: 34 },
    { header: libCible, key: 'exposee', width: 16 },
    { header: 'Part (%)', key: 'part', width: 11 },
    { header: 'Densité (hab/km²)', key: 'densite', width: 18 },
    { header: 'Sites implantés', key: 'sites', width: 15 },
    { header: 'dont rayon calculé', key: 'indicatifs', width: 18 },
    { header: 'Carreaux', key: 'carreaux', width: 11 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  for (const l of a.lignes) {
    ws.addRow({
      cle: l.cle,
      nom: l.nom,
      exposee: Math.round(l.exposee),
      // `null` et non 0 : au code postal, aucun référentiel de population n'est
      // fiable. Écrire 0 ferait lire « personne », alors qu'on ne sait pas.
      part: l.part_pct ?? null,
      densite: l.densite ?? null,
      sites: l.n_sites,
      indicatifs: l.n_indicatifs,
      carreaux: l.carreaux,
    });
  }
  ws.getColumn('exposee').numFmt = '# ##0';
  ws.getColumn('part').numFmt = '0.00';
  ws.getColumn('densite').numFmt = '# ##0.0';
  ws.getColumn('carreaux').numFmt = '# ##0';

  // ── Onglet 2 : ce que les chiffres veulent dire ─────────────────────────
  const meta = wb.addWorksheet('Méthode et limites');
  meta.columns = [{ width: 32 }, { width: 104 }];
  const ligne = (a1: string, a2: string, gras = false) => {
    const r = meta.addRow([a1, a2]);
    if (gras) r.font = { bold: true };
    r.getCell(2).alignment = { wrapText: true, vertical: 'top' };
    return r;
  };

  ligne('Population à risque industriel', '', true);
  ligne('Exporté le', new Date().toLocaleString('fr-FR'));
  ligne('Calculé le', new Date(a.calcule_le).toLocaleString('fr-FR'));
  ligne('Cible', libCible);
  ligne('Territoire', libPerim);
  ligne('Maille', libDim);
  ligne('Total exposé', String(Math.round(a.total_exposee)));
  ligne('Sites retenus', String(a.total_sites));
  ligne('dont rayon calculé', `${a.total_indicatifs} (${Math.round((a.total_indicatifs / Math.max(a.total_sites, 1)) * 100)} %)`);
  ligne('Rayon', a.rayon_force
    ? `${a.rayon_m} m, IMPOSÉ à tous les sites (périmètres PPRT ignorés)`
    : `${a.rayon_m} m pour les sites sans PPRT${a.rayon_deduit ? ', déduit des périmètres réels' : ''}`);
  meta.addRow([]);

  ligne('Comment le chiffre est obtenu', '', true);
  ligne('Zone retenue', a.rayon_force
    ? 'Un cercle du rayon choisi autour de CHAQUE site. Aucun chiffre ne provient d’une zone publiée par l’État.'
    : 'Le périmètre PPRT publié par l’État quand le site en a un (rattachement à 500 m), sinon un cercle du rayon indiqué.');
  ligne('Population', 'Carreaux INSEE de 200 m (Filosofi), répartis au prorata de surface : un carreau dont 30 % tombe dans la zone contribue 30 % de ses habitants. Hypothèse d’une population uniforme dans le carreau — fausse au détail, raisonnable en agrégat.');
  ligne('Double comptage', 'Les zones qui se recouvrent sont UNIES avant comptage : un habitant proche de deux sites n’est compté qu’une fois. Sans cette union, l’écart mesuré atteint +62 % sur un département dense.');

  meta.addRow([]);
  ligne('Ce que ces chiffres ne disent PAS', '', true);
  ligne('La colonne « Sites »', 'Elle ne s’additionne PAS avec la population. Elle compte les sites IMPLANTÉS dans l’unité ; une commune peut être très exposée sans en porter aucun, quand c’est la zone d’un site voisin qui déborde chez elle.');
  ligne('« dont rayon calculé »', 'Ces sites n’ont AUCUN périmètre publié par l’État : leur zone est un cercle que nous avons choisi. Le chiffre est indicatif, pas réglementaire.');
  ligne('Outre-mer', 'CALCULABLE pour la Martinique et La Réunion : l’INSEE publie leur carroyage 200 m dans le même fichier que la métropole, et il est en base depuis le 18/09/2026 (26 022 carreaux, 1 190 910 habitants). Leurs 14 sites Seveso et 26 périmètres PPRT sont donc comptés. NON CALCULABLE pour la Guadeloupe, la Guyane et Mayotte, que l’INSEE ne carroye pas : leurs 603 sites, dont 31 Seveso — les 27 de Guyane compris — n’ont aucune population exposée calculable et n’entrent pas dans le total. Un site y apparaît sans chiffre : c’est une donnée absente à la source, pas une exposition nulle.');
  ligne('Part et densité au code postal', 'Absentes à cette maille, et c’est délibéré : le seul référentiel de population par code postal disponible surcompte de 10,5 % la population française, et est vide sur Paris et les DROM. Une colonne vide vaut mieux qu’un pourcentage faux.');
  ligne('Paris, Lyon, Marseille', 'À la maille Commune, leurs arrondissements sont REGROUPÉS sous la commune mère. À la maille Arrondissement, ils sont détaillés. Ce sont les trois seules communes françaises concernées.');
  if ((a.carreaux_non_attribues ?? 0) > 0) {
    ligne('Carreaux non rattachés', `${a.carreaux_non_attribues} carreaux n’ont pas pu être rattachés à une unité et sont EXCLUS du total.`);
  }

  meta.addRow([]);
  ligne('Sources', '', true);
  ligne('Sites à risque', 'Géorisques (ministère de la Transition écologique), API installations classées.');
  ligne('Périmètres PPRT', 'Géoplateforme IGN, servitudes d’utilité publique PM3 — 664 périmètres.');
  ligne('Population', 'INSEE Filosofi, carroyage 200 m, millésime 2021.');
  ligne('Dénominateurs', 'INSEE IRIS agrégés — 67 760 552 habitants, soit 100,0 % du chiffre national.');

  const buffer = await wb.xlsx.writeBuffer();
  const horodatage = new Date().toISOString().slice(0, 10);
  const nom = `population-risque_${dimension}_${horodatage}.xlsx`;

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${nom}"`,
      'Cache-Control': 'no-store',
    },
  });
}
