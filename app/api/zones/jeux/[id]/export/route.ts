/**
 * @file app/api/zones/jeux/[id]/export/route.ts
 *
 * Export Excel d'un jeu de zones.
 *
 * ── POURQUOI CE CLASSEUR N'EST PAS CELUI DU PROFIL ───────────────────────
 *
 * `/api/risques/profil/export` exporte une ANALYSE : combien d'habitants
 * chaque anneau expose, par territoire. Celui-ci exporte un OBJET DE
 * TRAVAIL : les codes postaux qu'on va acheter, leur classe, leur poids
 * d'enchère, et ce qu'on paie pour rien.
 *
 * Les deux se ressemblent et ne servent pas au même moment : on lit le
 * premier pour comprendre, on ouvre le second pour vérifier ce qui part au
 * DSP.
 *
 * ── L'ONGLET « SITES ET RAYONS » ─────────────────────────────────────────
 *
 * Certains DSP ne ciblent pas par code postal mais par PROXIMITÉ : un point
 * et un rayon. Le plan par code postal leur est inutilisable, et le taux
 * d'utile mesuré ici — 75,9 % sur le profil par défaut — est exactement ce
 * qu'ils permettent d'éviter.
 *
 * ⚠ Ce sont donc deux expressions de la MÊME intention, pas deux plans. Le
 * classeur le dit, sans quoi on pourrait pousser les deux et diffuser deux
 * fois sur le même territoire.
 *
 * ── UN TABLEUR QUITTE L'APPLICATION ──────────────────────────────────────
 *
 * Il est transféré, renommé, recollé dans une présentation, relu dans six
 * mois par quelqu'un qui n'a jamais vu l'écran. Tout ce que l'interface
 * explique disparaît à l'export : d'où l'onglet « Méthode et limites », qui
 * voyage avec les chiffres.
 */
import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { lireTout } from '@/lib/supabase/lire-tout';
import { createRateLimiter, rateLimitResponse } from '@/lib/api/rate-limit';
import { normaliserJeu, poidsDeClasse } from '@/lib/zones/jeu';
import { genererPlanCp, type CpZone } from '@/lib/zones/plan';
import { lireGroupesCp } from '@/lib/zones/groupes';
import { libelleClasse, anneauxParNiveau } from '@/lib/risques/libelle-classe';
import { normaliserProfil, anneauxDuNiveau, LIBELLE_NIVEAU, libelleRayon, NIVEAUX, type Niveau } from '@/lib/risques/profil';

export const dynamic = 'force-dynamic';

/**
 * 6 par minute. Plus serré que la lecture du jeu : l'export lit TOUS les codes
 * postaux, relit les sites, et fabrique un classeur. Compteur PARTAGÉ en base
 * (`consommer_quota`, sql/135) — une `Map` locale ne limiterait rien sur
 * plusieurs instances.
 */
const limiteur = createRateLimiter({ max: 6, window: '60 s', prefix: 'geo:rl:zone-set-export' });

/** Au-delà, la lecture échoue plutôt que de rendre un début. */
const PLAFOND_CP = 8000;
/** Au-delà, l'onglet des sites est tronqué et le dit. */
const PLAFOND_SITES = 5000;

interface LigneCp {
  code_postal: string;
  classe: string;
  pop_en_zone: number | null;
  pop_totale: number | null;
  part_en_zone: number | null;
  retenu: boolean;
}

/** Un nom de fichier sans accent ni espace, sûr en en-tête HTTP. */
function slug(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'jeu-de-zones';
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requireAuth(request);
  if (!profile) return authUnauthorized();
  if (!profile.organization_id) {
    return NextResponse.json({ error: 'Aucune organisation active.' }, { status: 403 });
  }

  const { id } = await params;
  const supabase = createAdminClient();

  const { data: jeuRow, error: erreurJeu } = await supabase
    .from('zone_sets')
    .select('*')
    .eq('id', id)
    .eq('org_id', profile.organization_id)
    .maybeSingle();

  if (erreurJeu) {
    console.error('[zones/export] lecture :', erreurJeu.message);
    return NextResponse.json({ error: 'Jeu de zones illisible.' }, { status: 500 });
  }
  if (!jeuRow) {
    return NextResponse.json({ error: 'Ce jeu de zones est introuvable.' }, { status: 404 });
  }
  if (!jeuRow.construit_le) {
    return NextResponse.json(
      { error: 'Ce jeu de zones n’a pas été construit : il n’y a rien à exporter.' },
      { status: 409 },
    );
  }

  const quota = await limiteur(profile.id);
  if (!quota.ok) return rateLimitResponse(quota.retrySec);

  let lignes: LigneCp[];
  try {
    ({ lignes } = await lireTout<LigneCp>(
      (de, a) => supabase
        .from('zone_set_cp')
        .select('code_postal, classe, pop_en_zone, pop_totale, part_en_zone, retenu')
        .eq('zone_set_id', id)
        .order('code_postal')
        .range(de, a),
      PLAFOND_CP,
    ));
  } catch (e) {
    // ⚠ `lireTout` LÈVE plutôt que de rendre un début : un classeur amputé de
    // moitié ne se voit pas, et c'est lui qu'on croirait.
    console.error('[zones/export] codes postaux :', (e as Error).message);
    return NextResponse.json({ error: 'Codes postaux du jeu illisibles.' }, { status: 500 });
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

  const cps: CpZone[] = lignes.map((l) => ({
    code_postal: l.code_postal,
    classe: l.classe,
    pop_en_zone: Number(l.pop_en_zone ?? 0),
    pop_totale: Number(l.pop_totale ?? 0),
    retenu: l.retenu,
  }));

  /*
   * Le plan est RECALCULÉ par `genererPlanCp`, la fonction PURE qui produit
   * aussi celui qu'on pousse au DSP. Recopier la formule ici donnerait deux
   * implémentations qui divergent au premier correctif — et c'est le tableur
   * qu'on croirait.
   */
  // Les codes postaux que le référentiel ne distingue pas : le plan les
  // achète TOUS, sans quoi on cible un quart d'une ville (lib/zones/groupes.ts).
  const groupes = await lireGroupesCp(supabase);
  const plan = genererPlanCp(cps, jeu, groupes);
  const multiplicateurParCp = new Map(plan.lignes.map((l) => [l.code_postal, l.multiplicateur]));

  const profil = normaliserProfil(jeuRow.profil);
  const anneauxPar = anneauxParNiveau(profil);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'MAGELIAN';
  wb.created = new Date();

  // ── Onglet 1 : le jeu ──────────────────────────────────────────────────
  const ws1 = wb.addWorksheet('Jeu de zones');
  ws1.columns = [{ width: 32 }, { width: 62 }];
  const ligne1 = (a: string, b: string, gras = false) => {
    const r = ws1.addRow([a, b]);
    if (gras) r.font = { bold: true };
    r.getCell(2).alignment = { wrapText: true, vertical: 'top' };
  };
  ligne1('Jeu de zones', '', true);
  ligne1('Nom', jeuRow.nom);
  ligne1('Version', String(jeuRow.version));
  if (jeuRow.description) ligne1('Description', jeuRow.description);
  ligne1('Construit le', jeuRow.construit_le ?? '—');
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
  ligne1('Plan', '', true);
  ligne1(
    'Mode',
    jeu.mode_plan === 'exclusif'
      ? 'Exclusif — zéro impression hors des codes postaux retenus'
      : 'Pondéré — toute la France reçoit du budget, les zones davantage',
  );
  ligne1('Seuil de couverture', `${jeu.seuil_couverture_cp} % de la population du code postal`);
  ligne1('Codes postaux touchés', String(cps.length));
  ligne1('Codes postaux retenus', String(plan.n_retenus));
  ligne1(
    'Taux d’utile',
    plan.taux_utile === null ? '—' : `${plan.taux_utile.toFixed(1)} %`,
  );
  ligne1(
    'Part du plan en zone',
    plan.part_plan_en_zone === null ? '—' : `${plan.part_plan_en_zone.toFixed(1)} %`,
  );

  // ── Onglet 2 : les classes ─────────────────────────────────────────────
  const ws2 = wb.addWorksheet('Classes');
  ws2.columns = [
    { header: 'Classe', key: 'classe', width: 40 },
    { header: 'Population en zone', key: 'zone', width: 20 },
    { header: 'Codes postaux touchés', key: 'cp', width: 20 },
    { header: 'Codes postaux retenus', key: 'ret', width: 21 },
    { header: 'Population achetée', key: 'achat', width: 20 },
    { header: 'Poids d’enchère', key: 'poids', width: 16 },
  ];
  ws2.getRow(1).font = { bold: true };

  const parClasse = new Map<string, { zone: number; cp: number; ret: number; achat: number }>();
  for (const l of lignes) {
    const c = parClasse.get(l.classe) ?? { zone: 0, cp: 0, ret: 0, achat: 0 };
    c.zone += Number(l.pop_en_zone ?? 0);
    c.cp += 1;
    if (l.retenu) { c.ret += 1; c.achat += Number(l.pop_totale ?? 0); }
    parClasse.set(l.classe, c);
  }
  for (const [classe, c] of [...parClasse.entries()].sort((a, b) => b[1].zone - a[1].zone)) {
    ws2.addRow({
      classe: libelleClasse(classe, anneauxPar),
      zone: Math.round(c.zone),
      cp: c.cp,
      ret: c.ret,
      achat: Math.round(c.achat),
      poids: poidsDeClasse(jeu, classe),
    });
  }
  for (const col of ['zone', 'cp', 'ret', 'achat']) ws2.getColumn(col).numFmt = '# ##0';
  ws2.getColumn('poids').numFmt = '0.00';

  // ── Onglet 3 : les codes postaux ───────────────────────────────────────
  const ws3 = wb.addWorksheet('Codes postaux');
  ws3.columns = [
    { header: 'Code postal', key: 'cp', width: 13 },
    { header: 'Classe', key: 'classe', width: 40 },
    { header: 'Population en zone', key: 'zone', width: 20 },
    { header: 'Population du code postal', key: 'tot', width: 24 },
    { header: 'Part en zone (%)', key: 'part', width: 17 },
    { header: 'Retenu', key: 'retenu', width: 10 },
    { header: 'Multiplicateur d’enchère', key: 'mult', width: 24 },
  ];
  ws3.getRow(1).font = { bold: true };
  for (const l of lignes) {
    ws3.addRow({
      cp: l.code_postal,
      classe: libelleClasse(l.classe, anneauxPar),
      zone: Math.round(Number(l.pop_en_zone ?? 0)),
      tot: Math.round(Number(l.pop_totale ?? 0)),
      part: Number(l.part_en_zone ?? 0),
      // « oui / non » et non TRUE/FALSE : le classeur se lit en français, et
      // un booléen Excel se trie mal entre deux langues.
      retenu: l.retenu ? 'oui' : 'non',
      // 0 explicite et non vide : un code postal écarté reçoit zéro, ce qui
      // est une information. Une cellule vide se lirait « non renseigné ».
      mult: multiplicateurParCp.get(l.code_postal) ?? 0,
    });
  }
  for (const col of ['zone', 'tot']) ws3.getColumn(col).numFmt = '# ##0';
  ws3.getColumn('part').numFmt = '0.0';
  ws3.getColumn('mult').numFmt = '0.000';

  // ── Onglet 4 : sites et rayons ─────────────────────────────────────────
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
   * Le rayon exporté est le PLUS GRAND anneau du niveau du site : c'est
   * l'étendue réelle de la zone que le jeu dessine autour de lui. Prendre le
   * plus petit donnerait un ciblage bien plus étroit que le plan par code
   * postal, et les deux expressions cesseraient de décrire la même intention.
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
  // Une faute de nom ici ne lèverait pas côté SQL : PostgREST répondrait une
  // erreur que `lireTout` transforme en onglet vide, donc en « aucun site ».
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
    /*
     * L'échec n'interrompt PAS l'export : les trois premiers onglets portent
     * le plan, qui est l'essentiel. L'onglet le dit plutôt que de rester
     * vide — une feuille vide se lirait « aucun site », ce qui serait faux.
     */
    console.error('[zones/export] sites :', (e as Error).message);
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

  ligne5('Ce que ce classeur contient', '', true);
  ligne5(
    'Les deux onglets à ne pas pousser ensemble',
    '« Codes postaux » et « Sites et rayons » sont DEUX EXPRESSIONS DE LA MÊME '
    + 'intention, pas deux plans. Le premier sert les DSP qui ciblent au code postal, '
    + 'le second ceux qui ciblent par proximité. Les pousser tous les deux ferait '
    + 'diffuser deux fois sur le même territoire.',
    true,
  );
  ligne5(
    'Une classe par carreau',
    'Chaque carreau INSEE de 200 m reçoit UNE seule classe : le seuil haut l’emporte '
    + 'sur le seuil bas, et le périmètre PPRT sur la bande calculée. C’est ce qui rend '
    + 'toutes les sommes additives.',
  );
  ligne5(
    'La classe d’un code postal',
    'Celle qui y porte le plus de population. Un code postal chevauche souvent '
    + 'plusieurs bandes ; en retenir une est ce qui fait tenir « un code postal, un '
    + 'poids » — la seule forme que le DSP sache acheter.',
  );
  ws5.addRow([]);
  ligne5('Ce que les chiffres ne disent pas', '', true);
  ligne5(
    'Le taux d’utile',
    'Population visée (en zone) rapportée à la population achetée (celle des codes '
    + 'postaux retenus en entier). Le DSP achète au code postal, le risque se mesure '
    + 'au carreau de 200 m : un cercle d’un kilomètre est bien plus petit qu’un code '
    + 'postal. La différence est payée sans être visée.',
  );
  ligne5(
    'Le seuil de couverture',
    `Réglé à ${jeu.seuil_couverture_cp} %. Le baisser élargit le plan et dilue ; le `
    + 'monter concentre mais vide les campagnes, où un site isolé ne couvre jamais une '
    + 'telle part de son code postal. Ce réglage décide de ce qu’on paie.',
  );
  ligne5(
    'Le rayon exporté',
    'Le PLUS GRAND anneau du niveau du site — l’étendue réelle de la zone que le jeu '
    + 'dessine autour de lui. Les anneaux intermédiaires portent des poids différents, '
    + 'que le ciblage par proximité ne sait pas exprimer : il est donc plus grossier '
    + 'que le plan par code postal.',
  );
  ligne5(
    'La population',
    'Carroyage Filosofi de l’INSEE, qui totalise 63 783 569 habitants et non les '
    + '67 760 552 de la population légale : il porte les ménages fiscaux. Comparer ces '
    + 'deux totaux ferait conclure à tort à une lacune.',
  );
  ligne5(
    'Les codes postaux à zéro',
    'Un multiplicateur de 0 est une décision, pas une donnée manquante : le code '
    + 'postal n’atteint pas le seuil de couverture, ou le mode est exclusif.',
  );

  const buf = await wb.xlsx.writeBuffer();
  const nom = `magelian_jeu_de_zones_${slug(jeuRow.nom)}_v${jeuRow.version}.xlsx`;
  return new Response(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${nom}"`,
      'Cache-Control': 'no-store',
    },
  });
}
