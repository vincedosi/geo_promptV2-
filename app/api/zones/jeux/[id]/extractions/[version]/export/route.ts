/**
 * @file app/api/zones/jeux/[id]/extractions/[version]/export/route.ts
 *
 * Le classeur d'une EXTRACTION — ce qui est parti au custom bidding, tel qu'il
 * est parti.
 *
 * ── POURQUOI CE N'EST PAS `/api/zones/jeux/[id]/export` ──────────────────
 *
 * Celui-là recalcule à chaque téléchargement, donc il suit le jeu : déplacer
 * le seuil de couverture change le fichier, sous le même nom. Celui-ci relit
 * `zone_set_extraction_cp`, figé au moment de l'extraction, et ne recalcule
 * RIEN. C'est la seule façon de répondre, trois semaines plus tard, à « qu'est
 * -ce qu'on avait envoyé, exactement ? ».
 *
 * ⚠ Corollaire à ne pas perdre de vue : si le jeu a été re-réglé depuis, ce
 * classeur et celui du jeu diffèrent — et c'est voulu. L'onglet de méthode le
 * dit, sans quoi la différence passerait pour un défaut.
 *
 * ── LES DEUX ONGLETS QU'ON NE POUSSE PAS ENSEMBLE ────────────────────────
 *
 * « Codes postaux » et « Sites et rayons » sont deux EXPRESSIONS de la même
 * intention, pas deux plans : le premier sert les DSP qui ciblent au code
 * postal, le second ceux qui ciblent par proximité. Les pousser tous les deux
 * ferait diffuser deux fois sur le même territoire. Même avertissement que le
 * classeur du jeu, et pour la même raison.
 */
import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { lireTout } from '@/lib/supabase/lire-tout';
import { createRateLimiter, rateLimitResponse } from '@/lib/api/rate-limit';
import { normaliserJeu } from '@/lib/zones/jeu';
import { libelleClasse, anneauxParNiveau } from '@/lib/risques/libelle-classe';
import {
  normaliserProfil, anneauxDuNiveau, LIBELLE_NIVEAU, libelleRayon, NIVEAUX, type Niveau,
} from '@/lib/risques/profil';

export const dynamic = 'force-dynamic';

/**
 * 6 par minute, comme les autres exports du module : celui-ci relit toutes les
 * lignes figées, relit les sites et fabrique un classeur.
 */
const limiteur = createRateLimiter({
  max: 6, window: '60 s', prefix: 'geo:rl:zone-set-extraction-export',
});

/** Au-delà, `lireTout` LÈVE plutôt que de rendre un classeur amputé. */
const PLAFOND_CP = 8000;
const PLAFOND_SITES = 5000;

interface LigneExtraite {
  code_postal: string;
  code_canonique: string;
  classe: string;
  cluster_rang: number | null;
  zone_nom: string | null;
  pop_en_zone: number | null;
  pop_totale: number | null;
  part_en_zone: number | null;
  retenu: boolean;
  multiplicateur: number;
}

/** Un nom de fichier sans accent ni espace, sûr en en-tête HTTP. */
function slug(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'extraction';
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; version: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  if (!profile.organization_id) {
    return NextResponse.json({ error: 'Aucune organisation active.' }, { status: 403 });
  }

  const { id, version } = await params;
  const numero = Number.parseInt(version, 10);
  if (!Number.isFinite(numero) || numero < 1) {
    return NextResponse.json(
      { error: 'Numéro de version invalide.' },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();

  const { data: jeuRow, error: erreurJeu } = await supabase
    .from('zone_sets')
    .select('*')
    .eq('id', id)
    .eq('org_id', profile.organization_id)
    .maybeSingle();

  if (erreurJeu) {
    console.error('[extraction/export] lecture jeu :', erreurJeu.message);
    return NextResponse.json({ error: 'Jeu de zones illisible.' }, { status: 500 });
  }
  if (!jeuRow) {
    return NextResponse.json({ error: 'Ce jeu de zones est introuvable.' }, { status: 404 });
  }

  const { data: extraction, error: erreurExtraction } = await supabase
    .from('zone_set_extractions')
    .select('id, version, origine, commentaire, seuil_couverture_cp, mode_plan, n_cp, n_retenus, taux_utile, part_plan_en_zone, population_exposee, created_at')
    .eq('zone_set_id', id)
    .eq('version', numero)
    .maybeSingle();

  if (erreurExtraction) {
    console.error('[extraction/export] lecture :', erreurExtraction.message);
    return NextResponse.json({ error: 'Extraction illisible.' }, { status: 500 });
  }
  if (!extraction) {
    return NextResponse.json(
      { error: `Ce jeu de zones n’a pas de version ${numero}.` },
      { status: 404 },
    );
  }

  const quota = await limiteur(profile.id);
  if (!quota.ok) return rateLimitResponse(quota.retrySec);

  let lignes: LigneExtraite[];
  try {
    ({ lignes } = await lireTout<LigneExtraite>(
      (de, a) => supabase
        .from('zone_set_extraction_cp')
        .select('code_postal, code_canonique, classe, cluster_rang, zone_nom, pop_en_zone, pop_totale, part_en_zone, retenu, multiplicateur')
        .eq('extraction_id', extraction.id)
        .order('code_postal')
        .range(de, a),
      PLAFOND_CP,
    ));
  } catch (e) {
    console.error('[extraction/export] lignes :', (e as Error).message);
    return NextResponse.json({ error: 'Lignes de l’extraction illisibles.' }, { status: 500 });
  }

  const jeu = normaliserJeu({
    profil: jeuRow.profil,
    cible: jeuRow.cible,
    gravites: jeuRow.gravites,
    natures: jeuRow.natures,
    modes: jeuRow.modes,
    territoire: jeuRow.territoire,
    mode_plan: jeuRow.mode_plan,
    seuil_couverture_cp: Number(jeuRow.seuil_couverture_cp),
    poids: jeuRow.poids,
  });
  const profil = normaliserProfil(jeuRow.profil);
  const anneauxPar = anneauxParNiveau(profil);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'dentsu.explore';
  wb.created = new Date();

  // ── Onglet 1 : l'extraction ────────────────────────────────────────────
  const ws1 = wb.addWorksheet('Extraction');
  ws1.columns = [{ width: 32 }, { width: 66 }];
  const ligne1 = (a: string, b: string, gras = false) => {
    const r = ws1.addRow([a, b]);
    if (gras) r.font = { bold: true };
    r.getCell(2).alignment = { wrapText: true, vertical: 'top' };
  };

  ligne1('Extraction', '', true);
  ligne1('Jeu de zones', jeuRow.nom);
  // ⚠ La version de l'EXTRACTION et celle du JEU sont deux numéros distincts.
  // Les confondre ferait chercher « v2 » dans la mauvaise histoire.
  ligne1('Version de l’extraction', `v${extraction.version}`);
  ligne1('Version du jeu de zones', `v${jeuRow.version}`);
  ligne1(
    'Origine',
    extraction.origine === 'recalage'
      ? 'Recalage — corrige une diffusion déjà mesurée'
      : 'Initiale',
  );
  if (extraction.commentaire) ligne1('Commentaire', extraction.commentaire);
  ligne1('Extraite le', extraction.created_at ?? '—');
  ws1.addRow([]);

  ligne1('Réglages figés', '', true);
  ligne1(
    'Mode de plan',
    extraction.mode_plan === 'exclusif'
      ? 'Exclusif — zéro impression hors des codes postaux retenus'
      : 'Pondéré — toute la France reçoit du budget, les zones davantage',
  );
  ligne1(
    'Seuil de couverture',
    `${Number(extraction.seuil_couverture_cp)} % de la population du code postal`,
  );
  ws1.addRow([]);

  ligne1('Profil de rayons', '', true);
  for (const niveau of NIVEAUX) {
    const anneaux = anneauxDuNiveau(profil, niveau);
    ligne1(
      LIBELLE_NIVEAU[niveau],
      anneaux.length === 0 ? 'aucun anneau — non calculé' : anneaux.map(libelleRayon).join(' · '),
    );
  }
  ligne1('Périmètres PPRT', profil.inclurePPRT ? 'inclus' : 'exclus');
  ws1.addRow([]);

  ligne1('Ce que porte cette extraction', '', true);
  ligne1('Codes postaux touchés', String(extraction.n_cp));
  ligne1('Codes postaux retenus', String(extraction.n_retenus));
  ligne1('Lignes envoyées au DSP', String(lignes.length));
  ligne1(
    'Taux d’utile',
    extraction.taux_utile == null ? '—' : `${Number(extraction.taux_utile).toFixed(1)} %`,
  );
  ligne1(
    'Part du plan en zone',
    extraction.part_plan_en_zone == null
      ? '—'
      : `${Number(extraction.part_plan_en_zone).toFixed(1)} %`,
  );
  ligne1('Population exposée visée', String(Math.round(Number(extraction.population_exposee))));

  // ── Onglet 2 : les codes postaux ───────────────────────────────────────
  const ws2 = wb.addWorksheet('Codes postaux');
  ws2.columns = [
    { header: 'Code postal', key: 'cp', width: 13 },
    { header: 'Zone', key: 'zone', width: 30 },
    { header: 'Classe', key: 'classe', width: 40 },
    { header: 'Population exposée', key: 'expo', width: 20 },
    { header: 'Population du code postal', key: 'tot', width: 24 },
    { header: 'Taux d’exposition (%)', key: 'taux', width: 21 },
    { header: 'Retenu', key: 'retenu', width: 10 },
    { header: 'Multiplicateur d’enchère', key: 'mult', width: 24 },
    { header: 'Population comptée sous', key: 'canon', width: 24 },
  ];
  ws2.getRow(1).font = { bold: true };

  for (const l of lignes) {
    const partage = l.code_postal !== l.code_canonique;
    ws2.addRow({
      cp: l.code_postal,
      zone: l.zone_nom ?? (l.cluster_rang == null ? '—' : `Zone ${l.cluster_rang}`),
      classe: libelleClasse(l.classe, anneauxPar),
      // ⚠ Cellule VIDE et non 0 sur un code postal dont la population est
      // comptée ailleurs : un 0 se lirait « ce code postal n'expose personne ».
      expo: l.pop_en_zone == null ? null : Math.round(Number(l.pop_en_zone)),
      tot: l.pop_totale == null ? null : Math.round(Number(l.pop_totale)),
      taux: l.part_en_zone == null ? null : Number(l.part_en_zone),
      // « oui / non » et non TRUE/FALSE : le classeur se lit en français, et un
      // booléen Excel se trie mal entre deux langues.
      retenu: l.retenu ? 'oui' : 'non',
      mult: Number(l.multiplicateur),
      canon: partage ? l.code_canonique : '',
    });
  }
  for (const col of ['expo', 'tot']) ws2.getColumn(col).numFmt = '# ##0';
  ws2.getColumn('taux').numFmt = '0.0';
  ws2.getColumn('mult').numFmt = '0.000';

  // ── Onglet 3 : par zone ────────────────────────────────────────────────
  //
  // Le brief de la Phase 5 note le score PAR ZONE : ce récapitulatif est ce
  // qu'on y comparera. Le calculer à la lecture du classeur obligerait chacun
  // à refaire le même tableau croisé, et chacun le ferait un peu autrement.
  const ws3 = wb.addWorksheet('Zones');
  ws3.columns = [
    { header: 'Zone', key: 'zone', width: 30 },
    { header: 'Codes postaux', key: 'cp', width: 15 },
    { header: 'dont retenus', key: 'ret', width: 14 },
    { header: 'Population exposée', key: 'expo', width: 20 },
    { header: 'Population achetée', key: 'achat', width: 20 },
    { header: 'Taux d’utile (%)', key: 'utile', width: 17 },
    { header: 'Part du plan (%)', key: 'part', width: 17 },
  ];
  ws3.getRow(1).font = { bold: true };

  const totalMult = lignes.reduce((t, l) => t + Number(l.multiplicateur), 0);
  const parZone = new Map<string, {
    cp: number; ret: number; expo: number; achat: number; mult: number;
  }>();
  for (const l of lignes) {
    const cle = l.zone_nom ?? (l.cluster_rang == null ? 'Hors bassin' : `Zone ${l.cluster_rang}`);
    const z = parZone.get(cle) ?? { cp: 0, ret: 0, expo: 0, achat: 0, mult: 0 };
    z.cp += 1;
    z.mult += Number(l.multiplicateur);
    if (l.retenu) {
      z.ret += 1;
      // ⚠ Seuls les codes postaux qui portent leur population entrent dans ces
      // deux sommes : un membre indiscernable la voit comptée sous son
      // canonique, l'additionner ici la compterait deux fois.
      z.expo += Number(l.pop_en_zone ?? 0);
      z.achat += Number(l.pop_totale ?? 0);
    }
    parZone.set(cle, z);
  }
  for (const [zone, z] of [...parZone.entries()].sort((a, b) => b[1].expo - a[1].expo)) {
    ws3.addRow({
      zone,
      cp: z.cp,
      ret: z.ret,
      expo: Math.round(z.expo),
      achat: Math.round(z.achat),
      // `null` et non 0 : aucune population achetée n'est pas « 0 % d'utile »,
      // c'est l'absence de ratio.
      utile: z.achat > 0 ? (z.expo / z.achat) * 100 : null,
      part: totalMult > 0 ? (z.mult / totalMult) * 100 : null,
    });
  }
  for (const col of ['expo', 'achat']) ws3.getColumn(col).numFmt = '# ##0';
  for (const col of ['utile', 'part']) ws3.getColumn(col).numFmt = '0.0';

  // ── Onglet 4 : sites et rayons (ciblage par proximité) ─────────────────
  const ws4 = wb.addWorksheet('Sites et rayons');
  ws4.columns = [
    { header: 'Site', key: 'nom', width: 44 },
    { header: 'Gravité', key: 'gravite', width: 16 },
    { header: 'Commune', key: 'commune', width: 26 },
    { header: 'Longitude', key: 'lon', width: 13 },
    { header: 'Latitude', key: 'lat', width: 13 },
    { header: 'Rayon (m)', key: 'rayon', width: 12 },
  ];
  ws4.getRow(1).font = { bold: true };

  /*
   * Le rayon exporté est le PLUS GRAND anneau du niveau du site : l'étendue
   * réelle de la zone que le jeu dessine autour de lui. Prendre le plus petit
   * donnerait un ciblage bien plus étroit que le plan par code postal, et les
   * deux expressions cesseraient de décrire la même intention.
   */
  const rayonMax: Record<Niveau, number | null> = {
    haut: anneauxPar.haut.at(-1) ?? null,
    bas: anneauxPar.bas.at(-1) ?? null,
    autres: anneauxPar.autres.at(-1) ?? null,
  };
  const NIVEAU_DE_GRAVITE: Record<string, Niveau> = {
    seveso_haut: 'haut',
    seveso_bas: 'bas',
  };

  // ⚠ Les colonnes s'appellent `lat` et `lng` — PAS `latitude`/`longitude`.
  // Une faute de nom ne lèverait pas côté SQL : PostgREST répondrait une erreur
  // que `lireTout` transforme en onglet vide, donc en « aucun site ».
  let sites: Array<{
    nom: string | null; sous_categorie: string | null; ville: string | null;
    lng: number | null; lat: number | null;
  }> = [];
  try {
    ({ lignes: sites } = await lireTout(
      (de, a) => supabase
        .from('poi_france')
        .select('nom, sous_categorie, ville, lng, lat')
        .eq('categorie', 'risque_industriel')
        .in('sous_categorie', jeu.gravites)
        .order('nom')
        .range(de, a),
      PLAFOND_SITES,
    ));
  } catch (e) {
    // L'échec n'interrompt PAS l'export : les trois premiers onglets portent le
    // plan, qui est l'essentiel. L'onglet le DIT plutôt que de rester vide —
    // une feuille vide se lirait « aucun site », ce qui serait faux.
    console.error('[extraction/export] sites :', (e as Error).message);
    ws4.addRow({ nom: 'Liste des sites indisponible — le plan par code postal reste complet.' });
  }

  for (const s of sites) {
    if (s.lng == null || s.lat == null) continue;
    const niveau = NIVEAU_DE_GRAVITE[s.sous_categorie ?? ''] ?? 'autres';
    const rayon = rayonMax[niveau];
    // Un site dont le niveau n'a AUCUN anneau n'est pas dans le jeu : l'exporter
    // avec un rayon vide inviterait à le cibler quand même.
    if (rayon === null) continue;
    ws4.addRow({
      nom: s.nom ?? '(sans nom)',
      gravite: s.sous_categorie ?? '—',
      commune: s.ville ?? '—',
      lon: s.lng,
      lat: s.lat,
      rayon,
    });
  }
  for (const col of ['lon', 'lat']) ws4.getColumn(col).numFmt = '0.000000';
  ws4.getColumn('rayon').numFmt = '# ##0';

  // ── Onglet 5 : méthode et limites ──────────────────────────────────────
  const ws5 = wb.addWorksheet('Méthode et limites');
  ws5.columns = [{ width: 34 }, { width: 104 }];
  const ligne5 = (a: string, b: string, gras = false) => {
    const r = ws5.addRow([a, b]);
    if (gras) r.font = { bold: true };
    r.getCell(2).alignment = { wrapText: true, vertical: 'top' };
  };

  ligne5('Ce que ce classeur est', '', true);
  ligne5(
    'Un constat figé',
    `Ces multiplicateurs sont ceux de l’extraction v${extraction.version}, enregistrée le `
    + `${extraction.created_at}. Ils ne changent plus. Si le jeu de zones a été re-réglé `
    + 'depuis, le classeur du jeu montrera d’autres chiffres : ce n’est pas une erreur, '
    + 'c’est la raison d’être de cette version.',
    true,
  );
  ligne5(
    'Les deux onglets à ne pas pousser ensemble',
    '« Codes postaux » et « Sites et rayons » sont DEUX EXPRESSIONS DE LA MÊME intention, '
    + 'pas deux plans. Le premier sert les DSP qui ciblent au code postal, le second ceux '
    + 'qui ciblent par proximité. Les pousser tous les deux ferait diffuser deux fois sur '
    + 'le même territoire.',
  );
  ws5.addRow([]);

  ligne5('Ce que les chiffres ne disent pas', '', true);
  ligne5(
    'Les cellules de population vides',
    'Certains codes postaux partagent un contour identique dans le référentiel — les '
    + 'quatre codes de Nantes, par exemple. On ne peut donc pas savoir dans lequel habite '
    + 'un exposé : la population du groupe est comptée en entier sous UN code, indiqué '
    + 'dans la colonne « Population comptée sous ». Les autres ont une cellule vide, et '
    + 'non un zéro qui se lirait « ce code postal n’expose personne ». Sommer la colonne '
    + 'reste donc juste.',
  );
  ligne5(
    'Le multiplicateur d’un groupe',
    'Il est DIVISÉ par le nombre de codes du groupe. Le DSP normalise sur la somme des '
    + 'multiplicateurs : émettre quatre lignes à pleine valeur donnerait à cette ville '
    + 'quatre fois sa part, et le suivi la déclarerait en sous-pression permanente.',
  );
  ligne5(
    'Le taux d’utile',
    'Population visée (en zone) rapportée à la population achetée (celle des codes postaux '
    + 'retenus en entier). Le DSP achète au code postal, le risque se mesure au carreau de '
    + '200 m : un cercle d’un kilomètre est bien plus petit qu’un code postal. La '
    + 'différence est payée sans être visée.',
  );
  ligne5(
    'La colonne « sites » des zones',
    'Une zone est un BASSIN : les sites dont les périmètres se touchent. Un code postal à '
    + 'cheval sur deux bassins est rattaché au plus exposant — il n’apparaît donc qu’une '
    + 'fois, et les colonnes de l’onglet « Zones » s’additionnent.',
  );
  ligne5(
    'La population',
    'Carroyage Filosofi de l’INSEE, qui porte les ménages fiscaux et non la population '
    + 'légale. Comparer son total aux 67 760 552 habitants de la France ferait conclure à '
    + 'tort à une lacune.',
  );
  ligne5(
    'Les multiplicateurs à zéro',
    'Un zéro est une décision, pas une donnée manquante : le code postal n’atteint pas le '
    + `seuil de couverture (${Number(extraction.seuil_couverture_cp)} %), ou le mode est exclusif.`,
  );

  const buf = await wb.xlsx.writeBuffer();
  const nom = `magelian_extraction_${slug(jeuRow.nom)}_v${extraction.version}.xlsx`;
  return new Response(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${nom}"`,
      'Cache-Control': 'no-store',
    },
  });
}
