/**
 * Le classeur d'une simulation de campagne (étape ⑤).
 *
 * Quatre onglets demandés par le brief — Extraction, Diffusion par CP,
 * Alignement par zone, Journalier — plus « Méthode et limites », parce qu'un
 * tableur QUITTE l'application et que tout ce que l'écran explique disparaît
 * à l'export.
 *
 * ⚠ Les chiffres viennent de `construireVue` et `courbeAlignement`
 * (`lib/simulation/vue.ts`), les MÊMES fonctions que l'écran : un export qui
 * recalculerait autrement finirait par diverger, et c'est le tableur qu'on
 * croirait.
 */
import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { requireAuth, authUnauthorized } from '@/lib/api/middleware';
import { createAdminClient } from '@/lib/auth';
import { createRateLimiter, rateLimitResponse } from '@/lib/api/rate-limit';
import { chargerSimulation } from '@/lib/simulation/serveur';
import { construireVue, courbeAlignement, LIBELLE_PERIODE } from '@/lib/simulation/vue';

export const dynamic = 'force-dynamic';

const limiteur = createRateLimiter({
  max: 6, window: '60 s', prefix: 'geo:rl:zone-set-simulation-export',
});

/** Un nom de fichier sûr : ni accent, ni espace, ni caractère réservé. */
function slug(s: string | null | undefined): string {
  return (s ?? 'jeu')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 60) || 'jeu';
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
  const quota = await limiteur(profile.id);
  if (!quota.ok) return rateLimitResponse(quota.retrySec);

  const { id } = await params;
  const supabase = createAdminClient();
  const { data: jeu, error: erreurJeu } = await supabase
    .from('zone_sets').select('id, nom')
    .eq('id', id).eq('org_id', profile.organization_id).maybeSingle();
  if (erreurJeu) return NextResponse.json({ error: 'Jeu de zones illisible.' }, { status: 500 });
  if (!jeu) return NextResponse.json({ error: 'Ce jeu de zones est introuvable.' }, { status: 404 });

  let rep;
  try {
    rep = await chargerSimulation(supabase, id);
  } catch (e) {
    console.error('[zones/simulation/export] :', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Simulation illisible.' }, { status: 500 });
  }
  const sim = rep.simulation;
  if (!sim || !rep.entrees) {
    return NextResponse.json({ error: 'Aucune simulation à exporter : lancez-en une d’abord.' }, { status: 404 });
  }

  const vues = {
    v1: construireVue(rep, 'v1')!,
    v2: sim.statut === 'v2' ? construireVue(rep, 'v2') : null,
    tout: construireVue(rep, 'tout')!,
  };
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MAGELIAN';

  // ── Extraction ────────────────────────────────────────────────────────────
  const ws1 = wb.addWorksheet('Extraction');
  ws1.columns = [
    { header: 'Code postal', key: 'cp', width: 12 },
    { header: 'Code canonique', key: 'canon', width: 14 },
    { header: 'Zone', key: 'zone', width: 30 },
    { header: 'Acheté en zone', key: 'retenu', width: 14 },
    { header: 'Population exposée', key: 'pz', width: 18 },
    { header: 'Population totale', key: 'pt', width: 18 },
    { header: 'Taux d’exposition (%)', key: 'part', width: 20 },
    { header: `Multiplicateur v${sim.extraction_v1.version}`, key: 'm1', width: 16 },
    { header: sim.extraction_v2 ? `Multiplicateur v${sim.extraction_v2.version}` : 'Multiplicateur v2', key: 'm2', width: 16 },
  ];
  ws1.getRow(1).font = { bold: true };
  const nomZone = new Map((rep.zones ?? []).map((z) => [z.id, z.nom]));
  for (const e of rep.entrees) {
    ws1.addRow({
      cp: e.code_postal,
      canon: e.code_canonique,
      zone: e.cluster_id ? nomZone.get(e.cluster_id) ?? '' : '',
      retenu: e.retenu ? 'oui' : 'non',
      // Vide et non 0 sur un membre : sa population est portée par le canonique.
      pz: e.membre ? null : e.pop_en_zone,
      pt: e.membre ? null : e.pop_totale,
      part: e.part_en_zone,
      m1: e.multiplicateur,
      m2: rep.multiplicateurs_v2?.[e.code_postal] ?? null,
    });
  }
  for (const c of ['pz', 'pt']) ws1.getColumn(c).numFmt = '# ##0';
  ws1.getColumn('part').numFmt = '0.0';
  for (const c of ['m1', 'm2']) ws1.getColumn(c).numFmt = '0.000';

  // ── Diffusion par CP ──────────────────────────────────────────────────────
  const ws2 = wb.addWorksheet('Diffusion par CP');
  ws2.columns = [
    { header: 'Code postal', key: 'cp', width: 12 },
    { header: 'Zone', key: 'zone', width: 30 },
    { header: 'Acheté en zone', key: 'achete', width: 14 },
    { header: 'Impressions v1', key: 'i1', width: 16 },
    { header: 'Impressions v2', key: 'i2', width: 16 },
    { header: 'Impressions utiles', key: 'u', width: 18 },
    { header: 'Dépense (€)', key: 'd', width: 14 },
    { header: 'Indice (28 jours)', key: 'ind', width: 16 },
  ];
  ws2.getRow(1).font = { bold: true };
  const i1 = new Map(vues.v1.cps.map((c) => [c.code_postal, c.impressions]));
  const i2 = new Map((vues.v2?.cps ?? []).map((c) => [c.code_postal, c.impressions]));
  for (const c of [...vues.tout.cps].sort((a, b) => b.impressions - a.impressions)) {
    ws2.addRow({
      cp: c.code_postal,
      zone: c.cluster_id ? nomZone.get(c.cluster_id) ?? '' : '',
      achete: c.achete ? 'oui' : 'non',
      i1: i1.get(c.code_postal) ?? 0,
      i2: vues.v2 ? (i2.get(c.code_postal) ?? 0) : null,
      u: Math.round(c.utiles),
      d: c.depense,
      ind: c.indice == null ? null : Math.round(c.indice),
    });
  }
  for (const c of ['i1', 'i2', 'u']) ws2.getColumn(c).numFmt = '# ##0';
  ws2.getColumn('d').numFmt = '# ##0.00';

  // ── Alignement par zone ───────────────────────────────────────────────────
  const ws3 = wb.addWorksheet('Alignement par zone');
  ws3.columns = [
    { header: 'Zone', key: 'zone', width: 30 },
    { header: 'Sites', key: 'sites', width: 8 },
    { header: 'Population exposée', key: 'pop', width: 18 },
    { header: 'Part du plan (%)', key: 'plan', width: 16 },
    { header: 'Part diffusée v1 (%)', key: 'd1', width: 18 },
    { header: 'Indice v1', key: 'x1', width: 10 },
    { header: 'Part diffusée v2 (%)', key: 'd2', width: 18 },
    { header: 'Indice v2', key: 'x2', width: 10 },
    { header: 'Impressions utiles', key: 'u', width: 18 },
    { header: 'Taux d’utile (%)', key: 'tu', width: 15 },
    { header: 'Coût par exposé touché (€)', key: 'c', width: 24 },
  ];
  ws3.getRow(1).font = { bold: true };
  const z2 = new Map((vues.v2?.zones ?? []).map((z) => [z.id, z]));
  const z1 = new Map(vues.v1.zones.map((z) => [z.id, z]));
  for (const z of [...vues.tout.zones].sort((a, b) => b.pop_exposee - a.pop_exposee)) {
    const a = z1.get(z.id);
    const b = z2.get(z.id);
    ws3.addRow({
      zone: z.nom, sites: z.n_sites, pop: z.pop_exposee,
      plan: z.part_plan * 100,
      d1: a ? a.part_diffusee * 100 : null, x1: a?.indice == null ? null : Math.round(a.indice),
      d2: b ? b.part_diffusee * 100 : null, x2: b?.indice == null ? null : Math.round(b.indice),
      u: Math.round(z.utiles),
      tu: z.taux_utile == null ? null : z.taux_utile * 100,
      c: z.cout_expose_touche,
    });
  }
  for (const c of ['pop', 'u']) ws3.getColumn(c).numFmt = '# ##0';
  for (const c of ['plan', 'd1', 'd2', 'tu']) ws3.getColumn(c).numFmt = '0.00';
  ws3.getColumn('c').numFmt = '0.000';

  // ── Journalier ────────────────────────────────────────────────────────────
  const ws4 = wb.addWorksheet('Journalier');
  ws4.columns = [
    { header: 'Jour', key: 'j', width: 8 },
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Plan', key: 'v', width: 8 },
    { header: 'Impressions', key: 'imps', width: 14 },
    { header: 'Impressions utiles', key: 'u', width: 18 },
    { header: 'En zone', key: 'z', width: 12 },
    { header: 'Dépense (€)', key: 'd', width: 14 },
    { header: 'Alignement', key: 's', width: 12 },
  ];
  ws4.getRow(1).font = { bold: true };
  const scores = new Map(courbeAlignement(rep).map((p) => [p.jour, p]));
  for (const j of rep.agregats?.par_jour ?? []) {
    const d = new Date(`${sim.date_debut}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + j.jour - 1);
    const p = scores.get(j.jour);
    ws4.addRow({
      j: j.jour,
      date: d.toISOString().slice(0, 10),
      v: j.jour < sim.jour_recalage ? `v${sim.extraction_v1.version}` : `v${sim.extraction_v2?.version ?? 2}`,
      imps: Number(j.imps), u: Math.round(Number(j.utiles)), z: Number(j.en_zone),
      d: Number(j.spend),
      s: p?.score ?? null,
    });
  }
  for (const c of ['imps', 'u', 'z']) ws4.getColumn(c).numFmt = '# ##0';
  ws4.getColumn('d').numFmt = '# ##0.00';

  // ── Méthode et limites ────────────────────────────────────────────────────
  const ws5 = wb.addWorksheet('Méthode et limites');
  ws5.columns = [{ width: 34 }, { width: 104 }];
  const ligne = (a: string, b: string, gras = false) => {
    const r = ws5.addRow([a, b]);
    r.alignment = { wrapText: true, vertical: 'top' };
    if (gras) r.font = { bold: true };
  };
  ligne('Jeu de zones', jeu.nom ?? '', true);
  ligne('Période simulée', `${sim.jours} jours à partir du ${sim.date_debut}, recalage au jour ${sim.jour_recalage}`);
  ligne('Alignement', [
    `${LIBELLE_PERIODE.v1} : ${vues.v1.indicateurs.score ?? 'non calculable'}`,
    vues.v2 ? `${LIBELLE_PERIODE.v2} : ${vues.v2.indicateurs.score ?? 'non calculable'}` : 'Recalage non effectué',
  ].join(' · '));
  ligne('Diffusion simulée',
    'Les impressions sont générées, reproductibles à paramètres égaux (graine '
    + `${sim.params.graine}). Géométries, populations et plan sont réels : ce sont ceux du jeu `
    + 'de zones et de son extraction.');
  ligne('Plan d’une zone',
    'Sa part de la population EXPOSÉE du jeu, jamais la population totale de ses codes postaux.');
  ligne('Impressions utiles',
    'Impressions × taux d’exposition du code postal : une impression touche toute la population '
    + 'du code postal, dont une part seulement vit en zone.');
  ligne('Score d’alignement',
    'Même règle que le Suivi de campagne (tolérance 10 %, sous-pression et sur-pression pénalisées), '
    + 'calculée par zone sur les impressions utiles. « Non calculable » quand il n’y a ni diffusion '
    + 'ni plan : jamais un 100 par défaut.');
  ligne('Coût par exposé touché',
    'Dépense ÷ exposés touchés au moins une fois, estimés par une loi de Poisson : '
    + 'pop × (1 − e^(−utiles/pop)).');
  ligne('Codes postaux groupés',
    'Un membre non canonique (même géométrie que son canonique) a une population vide : '
    + 'elle est portée en entier par la ligne canonique. Sommer la colonne reste juste.');
  ligne('Paramètres',
    `Budget ${sim.params.budget} € · effet inventaire ${sim.params.intensite} · fuite `
    + `${sim.params.fuite * 100} % · bruit ${sim.params.bruit} · force du recalage `
    + `${sim.params.amortissement * 100} %`);

  const buf = await wb.xlsx.writeBuffer();
  const nom = `magelian_simulation_${slug(jeu.nom)}_v${sim.extraction_v1.version}.xlsx`;
  return new Response(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${nom}"`,
      'Cache-Control': 'no-store',
    },
  });
}
