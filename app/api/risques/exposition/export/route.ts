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
import { liste } from '@/lib/api/parametres-requete';
import { DIMENSIONS, LIBELLE_DIMENSION, modesValides } from '@/lib/risques/dimensions';
import { METHODE_CALCUL, LIMITES, SOURCES } from '@/lib/risques/methode';

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
    // Validés, comme dans `/agregats` : un mode inconnu rendait ici un
    // classeur VIDE sans message, là où l'écran répondait « les deux modes ».
    p_modes: nullableArg(modesValides(liste(p.modes))),
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
  wb.creator = 'dentsu.explore';
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

  // Le texte vient de `lib/risques/methode.ts`, partagé avec l'écran : il y
  // était rédigé DEUX fois, et différemment. Corriger une phrase imposait de
  // toucher une route API (R-23).
  ligne('Comment le chiffre est obtenu', '', true);
  ligne('Zone retenue', METHODE_CALCUL.zone(Boolean(a.rayon_force)));
  ligne('Population', METHODE_CALCUL.population);
  ligne('Double comptage', METHODE_CALCUL.doubleComptage);

  meta.addRow([]);
  ligne('Ce que ces chiffres ne disent PAS', '', true);
  for (const n of LIMITES) ligne(n.titre, n.texte);
  if ((a.carreaux_non_attribues ?? 0) > 0) {
    ligne('Carreaux non rattachés', `${a.carreaux_non_attribues} carreaux n’ont pas pu être rattachés à une unité et sont EXCLUS du total.`);
  }

  meta.addRow([]);
  ligne('Sources', '', true);
  for (const n of SOURCES) ligne(n.titre, n.texte);

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
