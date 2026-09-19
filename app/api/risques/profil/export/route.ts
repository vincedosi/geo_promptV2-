/**
 * @file app/api/risques/profil/export/route.ts
 *
 * GET — le classeur du profil de rayons : ses anneaux, ses bandes, ses
 * territoires, et la diffusion d'une campagne s'il y en a une.
 *
 * ── POURQUOI LE PROFIL A SON PROPRE ONGLET ───────────────────────────────
 *
 * Un tableur QUITTE l'application. Deux exports du même territoire, pris avec
 * deux profils différents, sont indiscernables une fois sur un disque — et rien
 * dans les chiffres ne dit lequel valait quoi. L'onglet « Profil » porte donc
 * les anneaux de chaque niveau ET le code du profil, qui suffit à retrouver
 * exactement la vue dont le classeur est issu.
 *
 * ── POURQUOI IL APPELLE LES MÊMES RPC QUE L'ÉCRAN ────────────────────────
 *
 * Un export qui recalculerait autrement finirait par diverger, et c'est le
 * tableur qu'on croirait. Même règle que `/api/risques/exposition/export`, qui
 * la porte déjà.
 *
 * ── L'ONGLET « MÉTHODE ET LIMITES » VOYAGE AVEC LE FICHIER ───────────────
 *
 * Tout ce que l'interface explique disparaît à l'export. Le premier lecteur qui
 * additionne les impressions des classes ET le hors-zone obtiendrait le total
 * deux fois ; celui qui lit la colonne « impressions » comme une mesure
 * croirait la campagne achetée au carreau. Les deux se corrigent par une phrase,
 * à condition qu'elle parte avec le fichier.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { checkCampaignAccess } from '@/lib/campaigns/access';
import { rpcJson, nullableArg, toJson } from '@/lib/supabase/rpc-json';
import { createRateLimiter, rateLimitResponse } from '@/lib/api/rate-limit';
import { profilDepuisCode, codeProfil } from '@/lib/risques/code-profil';
import {
  anneauxDuNiveau, LIBELLE_NIVEAU, NIVEAUX, libelleRayon, type Niveau,
} from '@/lib/risques/profil';
import { LIMITES, SOURCES, METHODE_CALCUL } from '@/lib/risques/methode';

export const dynamic = 'force-dynamic';

/**
 * 6 par minute, plus serré que les 30 de `/profil/bandes` : l'export déclenche
 * le MÊME calcul plus la fabrication du classeur. Même écart que celui déjà
 * retenu entre `/exposition/agregats` et `/exposition/export`.
 */
const limiteur = createRateLimiter({
  max: 6,
  window: '60 s',
  prefix: 'geo:rl:risque-profil-export',
});

const ParamsSchema = z.object({
  profil: z.string().min(3).max(128),
  cible: z.string().regex(/^[a-z0-9_]{1,40}$/).optional(),
  maille: z.enum(['departement', 'commune']).optional(),
  parent: z.string().regex(/^(2A|2B|\d{2,3})$/).optional(),
  campagne: z.string().uuid().optional(),
  libelle_cible: z.string().max(120).optional(),
});

interface Unite { unite: string; total: number; classes: Record<string, number> }
interface Bandes {
  calculable: boolean;
  total: number;
  hors_zone: number;
  n_unites: number;
  n_carreaux: number;
  par_classe: Record<string, number>;
  unites: Unite[];
}
interface ClasseDiffusion {
  classe: string; population: number; impressions: number;
  depense: number; indice: number | null;
}
interface Diffusion {
  calculable: boolean;
  est_demo: boolean;
  impressions_totales: number;
  impressions_en_zone: number;
  population_touchee: number;
  classes: ClasseDiffusion[];
}

/** Le libellé lisible d'une classe, reconstruit depuis le profil. */
function libelleClasse(classe: string, anneauxPar: Record<Niveau, number[]>): string {
  if (classe === 'hors') return 'Hors des anneaux';
  const [niveau, bande] = classe.split(':') as [Niveau, string];
  const court = LIBELLE_NIVEAU[niveau] ?? niveau;
  if (bande === 'pprt') return `${court} — périmètre PPRT`;
  const anneaux = anneauxPar[niveau] ?? [];
  const i = Number(bande) - 1;
  const debut = i === 0 ? '0' : libelleRayon(anneaux[i - 1]);
  const fin = anneaux[i] !== undefined ? libelleRayon(anneaux[i]) : '?';
  return `${court} — ${debut} à ${fin}`;
}

export async function GET(request: NextRequest) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();

  const parsed = ParamsSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Paramètres invalides.', detail: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const p = parsed.data;

  const profil = profilDepuisCode(p.profil);
  if (!profil) {
    return NextResponse.json(
      { error: 'Profil de rayons illisible ou hors bornes.' },
      { status: 400 },
    );
  }
  const code = codeProfil(profil);

  const quota = await limiteur(profile.id);
  if (!quota.ok) return rateLimitResponse(quota.retrySec);

  const supabase = createAdminClient();
  const maille = p.maille ?? 'departement';
  const libCible = p.libelle_cible ?? 'Population';

  const anneauxPar = Object.fromEntries(
    NIVEAUX.map((n) => [n, anneauxDuNiveau(profil, n)]),
  ) as Record<Niveau, number[]>;

  /*
   * ⚠ Les deux appels sont SÉQUENTIELS et non groupés. Le budget du projet est
   * de trois requêtes Supabase simultanées (CLAUDE.md), et on y tiendrait —
   * mais chacune de ces deux-là agrège 883 451 carreaux. Les lancer ensemble
   * doublerait la pointe de charge sans gagner de temps perçu : c'est un
   * export, il se télécharge.
   */
  const bandesRes = await supabase.rpc('population_par_classe', {
    p_profil: toJson(profil),
    p_cible: p.cible ?? 'ind',
    p_maille: maille,
    p_parent: nullableArg(p.parent ?? null),
    // Le classeur exporte TOUT, jamais la liste tronquée affichée à l'écran :
    // un tableur sert justement à regarder au-delà. Même règle que
    // `/api/risques/exposition/export`.
    p_limite: 40000,
  });
  if (bandesRes.error) {
    console.error('[risques/profil/export] bandes :', bandesRes.error.message);
    return NextResponse.json({ error: 'Export indisponible.' }, { status: 500 });
  }
  const bandes = rpcJson<Bandes>(bandesRes.data);
  if (!bandes?.calculable) {
    return NextResponse.json({ error: 'Export impossible sur ce profil.' }, { status: 400 });
  }

  let diffusion: Diffusion | null = null;
  if (p.campagne) {
    const acces = await checkCampaignAccess(supabase, profile, p.campagne);
    if (acces === 'not_found') {
      return NextResponse.json({ error: 'Campagne introuvable.' }, { status: 404 });
    }
    if (acces !== 'ok') {
      return NextResponse.json({ error: 'Accès refusé à cette campagne.' }, { status: 403 });
    }
    const dRes = await supabase.rpc('diffusion_par_classe', {
      p_campagne: p.campagne,
      p_profil: toJson(profil),
      p_cible: p.cible ?? 'ind',
      p_maille: maille,
      p_parent: nullableArg(p.parent ?? null),
      p_limite: 200,
    });
    // Une campagne sans données ne fait PAS échouer l'export : les trois autres
    // onglets restent utiles, et l'absence du quatrième est explicite.
    if (!dRes.error) diffusion = rpcJson<Diffusion>(dRes.data);
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'MAGELIAN';
  wb.created = new Date();

  // ── Onglet 1 : le profil ────────────────────────────────────────────────
  const wsProfil = wb.addWorksheet('Profil');
  wsProfil.columns = [{ width: 30 }, { width: 60 }];
  const ligneP = (a: string, b: string, gras = false) => {
    const r = wsProfil.addRow([a, b]);
    if (gras) r.font = { bold: true };
    r.getCell(2).alignment = { wrapText: true, vertical: 'top' };
  };
  ligneP('Profil de rayons', '', true);
  for (const niveau of NIVEAUX) {
    const anneaux = anneauxPar[niveau];
    ligneP(
      LIBELLE_NIVEAU[niveau],
      anneaux.length === 0 ? 'aucun anneau — non calculé' : anneaux.map(libelleRayon).join(' · '),
    );
  }
  ligneP('Niveaux liés', profil.lie ? 'oui' : 'non');
  ligneP('Périmètres PPRT', profil.inclurePPRT ? 'classe à part' : 'fondus dans les bandes');
  wsProfil.addRow([]);
  // Le code EST la vue : le coller dans l'URL du module restitue exactement ce
  // classeur. C'est ce qui distingue deux exports du même territoire.
  ligneP('Code du profil', code, true);
  ligneP('Territoire', p.parent ? `département ${p.parent}` : 'France entière');
  ligneP('Cible comptée', libCible);
  ligneP('Édité le', new Date().toLocaleString('fr-FR'));

  // ── Onglet 2 : les bandes ───────────────────────────────────────────────
  const wsBandes = wb.addWorksheet('Bandes');
  wsBandes.columns = [
    { header: 'Classe', key: 'classe', width: 42 },
    { header: libCible, key: 'pop', width: 16 },
    { header: 'Cumulée', key: 'cumul', width: 16 },
  ];
  wsBandes.getRow(1).font = { bold: true };
  wsBandes.views = [{ state: 'frozen', ySplit: 1 }];

  for (const niveau of NIVEAUX) {
    const anneaux = anneauxPar[niveau];
    if (anneaux.length === 0) continue;
    let cumul = 0;
    const cles = [
      ...(profil.inclurePPRT ? [`${niveau}:pprt`] : []),
      ...anneaux.map((_, i) => `${niveau}:${i + 1}`),
    ];
    for (const cle of cles) {
      const pop = bandes.par_classe[cle] ?? 0;
      cumul += pop;
      wsBandes.addRow({ classe: libelleClasse(cle, anneauxPar), pop, cumul });
    }
  }
  wsBandes.addRow([]);
  const rTotal = wsBandes.addRow({ classe: 'Total, tous niveaux', pop: bandes.total });
  rTotal.font = { bold: true };
  wsBandes.addRow({ classe: 'Hors des anneaux', pop: bandes.hors_zone });
  wsBandes.getColumn('pop').numFmt = '# ##0';
  wsBandes.getColumn('cumul').numFmt = '# ##0';

  // ── Onglet 3 : les territoires ──────────────────────────────────────────
  const classesVues = Array.from(
    new Set(bandes.unites.flatMap((u) => Object.keys(u.classes))),
  ).sort();
  const wsTerr = wb.addWorksheet('Territoires');
  wsTerr.columns = [
    { header: maille === 'commune' ? 'Commune' : 'Département', key: 'unite', width: 16 },
    { header: 'Total', key: 'total', width: 14 },
    ...classesVues.map((c) => ({ header: libelleClasse(c, anneauxPar), key: c, width: 28 })),
  ];
  wsTerr.getRow(1).font = { bold: true };
  wsTerr.views = [{ state: 'frozen', ySplit: 1 }];
  for (const u of bandes.unites) {
    wsTerr.addRow({
      unite: u.unite,
      total: u.total,
      ...Object.fromEntries(classesVues.map((c) => [c, u.classes[c] ?? 0])),
    });
  }
  for (const col of ['total', ...classesVues]) wsTerr.getColumn(col).numFmt = '# ##0';

  // ── Onglet 4 : la diffusion ─────────────────────────────────────────────
  const wsDiff = wb.addWorksheet('Diffusion');
  wsDiff.columns = [
    { header: 'Classe', key: 'classe', width: 42 },
    { header: libCible, key: 'pop', width: 16 },
    { header: 'Impressions', key: 'imp', width: 16 },
    { header: 'Dépense (EUR)', key: 'eur', width: 15 },
    { header: 'Indice de pression', key: 'indice', width: 18 },
  ];
  wsDiff.getRow(1).font = { bold: true };
  if (!diffusion?.calculable) {
    wsDiff.addRow({
      classe: p.campagne
        ? 'Cette campagne n’a aucune impression au code postal.'
        : 'Aucune campagne sélectionnée : rien à confronter.',
    });
  } else {
    for (const c of diffusion.classes) {
      wsDiff.addRow({
        classe: libelleClasse(c.classe, anneauxPar),
        pop: c.population,
        imp: c.impressions,
        eur: c.depense,
        // `null` et non 0 : un indice incalculable n'est pas un indice nul.
        indice: c.indice,
      });
    }
    wsDiff.getColumn('pop').numFmt = '# ##0';
    wsDiff.getColumn('imp').numFmt = '# ##0';
    wsDiff.getColumn('eur').numFmt = '# ##0.00';
    wsDiff.getColumn('indice').numFmt = '0';
  }

  // ── Onglet 5 : ce que les chiffres veulent dire ─────────────────────────
  const meta = wb.addWorksheet('Méthode et limites');
  meta.columns = [{ width: 32 }, { width: 104 }];
  const ligneM = (a: string, b: string, gras = false) => {
    const r = meta.addRow([a, b]);
    if (gras) r.font = { bold: true };
    r.getCell(2).alignment = { wrapText: true, vertical: 'top' };
  };

  ligneM('Comment le chiffre est obtenu', '', true);
  ligneM(
    'Une classe par carreau',
    'Chaque carreau INSEE de 200 m reçoit UNE seule classe : le seuil haut l’emporte sur '
    + 'le seuil bas, et le périmètre PPRT sur la bande calculée. C’est ce qui rend toutes '
    + 'les sommes additives. Avant cette règle, l’écran annonçait 537 919 habitants de plus '
    + 'qu’il n’y en a — non parce qu’un nombre était faux, mais parce que deux nombres '
    + 'exacts ne devaient pas être additionnés.',
  );
  ligneM('Population', METHODE_CALCUL.population);
  ligneM(
    'Le total n’est pas la population légale',
    'Tous les chiffres de ce classeur viennent du CARROYAGE Filosofi, qui totalise '
    + '63 783 569 habitants et non les 67 760 552 de la population légale : le carroyage '
    + 'porte les ménages fiscaux. Comparer ces totaux ferait conclure à tort à une lacune.',
  );
  ligneM('Double comptage', METHODE_CALCUL.doubleComptage);
  if (diffusion?.calculable) {
    ligneM(
      'Impressions',
      'VENTILÉES et non mesurées : une campagne s’achète au code postal, le risque se '
      + 'mesure au carreau. La ventilation suppose la pression uniforme à l’intérieur d’un '
      + 'code postal, et son dénominateur est la population TOTALE du code postal — jamais '
      + 'sa seule part exposée.',
    );
    ligneM(
      'Indice de pression',
      'Part des impressions rapportée à la part de population, ×100. 100 = la classe reçoit '
      + 'exactement son poids démographique. Vide quand la classe n’a aucune population : '
      + 'un indice incalculable n’est pas un indice nul.',
    );
    if (diffusion.est_demo) {
      ligneM(
        'DONNÉES DE DÉMONSTRATION',
        'Cette campagne est un jeu de démonstration (is_demo). Ses impressions sont '
        + 'fabriquées et ne mesurent aucune diffusion réelle.',
        true,
      );
    }
  }

  meta.addRow([]);
  ligneM('Ce que les chiffres ne disent pas', '', true);
  ligneM(
    'Hors des anneaux',
    'Habitants de carreaux PROCHES d’un site que le profil ne retient pas — un rayon réglé '
    + 'trop court, par exemple. Ce n’est PAS la population non exposée de France : le calcul '
    + 'ne porte que sur le voisinage des sites.',
  );
  for (const n of LIMITES) ligneM(n.titre, n.texte);

  meta.addRow([]);
  ligneM('Sources', '', true);
  for (const n of SOURCES) ligneM(n.titre, n.texte);

  const buffer = await wb.xlsx.writeBuffer();
  const horodatage = new Date().toISOString().slice(0, 10);
  const nom = `profil-risque_${maille}_${horodatage}.xlsx`;

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${nom}"`,
      'Cache-Control': 'no-store',
    },
  });
}
