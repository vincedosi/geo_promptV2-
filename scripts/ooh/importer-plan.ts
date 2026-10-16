#!/usr/bin/env node
/**
 * Import d'un plan OOH de régie dans une campagne d'un espace de travail (spec 2026-10-16-ooh-campagnes § 7).
 *
 * Étapes nommées, avec progression : lecture → synthèse du plan → emplacements par réseau → géolocalisation →
 * écriture → rapport. `--a-blanc` fait tout sauf l'écriture. Le fichier client est passé en argument et n'est JAMAIS
 * versionné (`PM OOH/` exclu par .git/info/exclude) ; le rapport CSV s'écrit HORS du dépôt.
 * Rejeu = même résultat : la campagne est retrouvée par (espace, --cle), ses lignes et liens remplacés, ses panneaux
 * gardent leurs id.
 * BAN en panne : `geolocaliser` lève « BAN indisponible : rien n'est écrit. » et le script s'arrête AVANT l'étape 5
 * (code de sortie 1, aucun rapport) — `tests/unit/ooh/importer-plan-cli.test.ts`.
 *
 * Usage :
 *   npx tsx scripts/ooh/importer-plan.ts --plan "<fichier.xlsx>" --espace marine \
 *     --campagne "Marine nationale — TF4 septembre 2026" --vague TF4 --cle marine-tf4-2026 [--annonceur "…"] \
 *     [--rapport <dossier>] [--a-blanc]
 *
 * ⚠ CIBLE : la base LOCALE. Dépendances externes : BAN (api-adresse.data.gouv.fr) et le référentiel SNCF des gares.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { geocodeBatchDetailed } from '@/lib/import/geocoder';
import { lirePlan, listesSansLigne, rattacher } from '@/lib/ooh/plan/adaptateurs';
import { lireArguments } from '@/lib/ooh/plan/arguments';
import { lireClasseur } from '@/lib/ooh/plan/classeur';
import { ecrirePlan, type EmplacementsDeLigne } from '@/lib/ooh/plan/ecrire';
import { telechargerReferentielGares } from '@/lib/ooh/plan/gares-sncf';
import { geolocaliser } from '@/lib/ooh/plan/geolocaliser';
import { cheminRapportAutorise, compterParReseau, csvAReprendre, ligneProgression, nomRapport } from '@/lib/ooh/plan/rapport';

// Priorité au local. `dotenv` n'écrase jamais une variable déjà posée : l'ordre de ces deux lignes EST le garde-fou.
if (existsSync('.env.development.local')) dotenv.config({ path: '.env.development.local', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

function etape(titre: string): void {
  process.stdout.write(`\n— ${titre}\n`);
}

function suivre(nom: string): (fait: number, total: number) => void {
  return (fait, total) => process.stdout.write(`\r${ligneProgression(nom, fait, total)}   `);
}

async function main(): Promise<void> {
  const args = lireArguments(process.argv.slice(2), tmpdir());
  if ('erreur' in args) {
    console.error(args.erreur);
    process.exit(2);
  }
  if (!cheminRapportAutorise(args.rapport, process.cwd())) {
    console.error(`Le rapport doit s'écrire HORS du dépôt (il nomme des emplacements du client) : ${args.rapport}`);
    process.exit(2);
  }

  etape('1/6 Lecture du classeur');
  const classeur = await lireClasseur(readFileSync(args.plan));
  console.log(`${classeur.feuilles.size} onglet(s) : ${[...classeur.feuilles.keys()].join(', ')}`);

  etape('2/6 Synthèse du plan');
  const plan = lirePlan(classeur);
  console.log(`${plan.lignes.length} ligne(s) ; formats reconnus : ${plan.adaptateurs.join(', ')}`);

  etape('3/6 Emplacements par réseau');
  const parLigne = rattacher(plan.lignes, plan.emplacements);
  for (const l of plan.lignes) {
    const r = parLigne.get(l.ordre);
    console.log(`  ${l.ordre}. ${l.regie} · ${l.reseau ?? l.territoire ?? '—'} — ${r ? `${r.emplacements.length} emplacement(s) (${r.adaptateur})` : 'liste non fournie'}`);
  }
  for (const a of listesSansLigne(parLigne, plan.emplacements)) {
    const n = plan.emplacements.filter((e) => e.adaptateur === a).length;
    console.warn(`  AVERTISSEMENT liste ${a} (${n} emplacement(s)) : aucune ligne de sa régie dans le plan, elle n'est pas importée.`);
  }

  etape('4/6 Géolocalisation');
  const aPlacer = [...parLigne.values()].flatMap((r) => r.emplacements);
  const gares = aPlacer.some((e) => e.recherche.type === 'gare') ? await telechargerReferentielGares() : [];
  if (gares.length > 0) console.log(`référentiel SNCF : ${gares.length} gares`);
  // Une liste va à la PREMIÈRE ligne de sa régie (`rattacher`) : le drapeau outre-mer se code donc par adaptateur.
  // Une liste rattachée à une ligne d'outre-mer (territoire renseigné) échappe à la règle « résultat BAN en 97x/98x non placé ».
  const adaptateursOutreMer = new Set(plan.lignes.filter((l) => l.territoire !== null).flatMap((l) => parLigne.get(l.ordre)?.adaptateur ?? []));
  const geo = await geolocaliser(aPlacer, { gares, geocoder: geocodeBatchDetailed, adaptateursOutreMer, progression: suivre('géolocalisation') });
  process.stdout.write('\n');

  const emplacements = new Map<number, EmplacementsDeLigne>();
  for (const [ordre, r] of parLigne) {
    emplacements.set(ordre, {
      adaptateur: r.adaptateur,
      places: geo.places.filter((p) => p.adaptateur === r.adaptateur),
      non_places: geo.non_places.filter((n) => n.adaptateur === r.adaptateur),
    });
  }

  etape('5/6 Écriture');
  if (args.aBlanc) {
    console.log('À blanc : rien n\'est écrit.');
  } else {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const cle = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !cle) {
      console.error('NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente : monter le stack local (scripts/local/).');
      process.exit(1);
    }
    const sb = createClient(url, cle, { auth: { persistSession: false } });
    const { data: espace, error } = await sb.from('organizations').select('id, name').eq('slug', args.espace).maybeSingle();
    if (error || !espace) {
      console.error(`Espace « ${args.espace} » introuvable${error ? ` : ${error.message}` : ''}.`);
      process.exit(1);
    }
    const bilan = await ecrirePlan(sb, {
      organizationId: espace.id as string,
      campagne: {
        nom: args.campagne,
        annonceur: args.annonceur ?? (espace.name as string),
        vague: args.vague,
        cle_import: args.cle,
        date_debut: plan.entete.date_debut,
        date_fin: plan.entete.date_fin,
        budget_total_ttc: plan.entete.budget_total_ttc,
        metadata: {
          fichier: basename(args.plan),
          titre_plan: plan.entete.titre,
          hypothese: plan.entete.hypothese,
          couts_annexes: plan.entete.couts_annexes,
          notes: plan.entete.notes,
          adaptateurs: plan.adaptateurs,
          importe_le: new Date().toISOString(),
        },
      },
      lignes: plan.lignes,
      emplacements,
    }, (nom, fait, total) => suivre(nom)(fait, total));
    process.stdout.write('\n');
    console.log(`campagne ${bilan.campagne_id} : ${bilan.lignes} ligne(s), ${bilan.panneaux_ecrits} panneau(x) écrit(s), `
      + `${bilan.liens} lien(s), ${bilan.panneaux_retires} panneau(x) retiré(s) de la liste.`);
    for (const e of bilan.erreurs) console.error(`  ERREUR ${e}`);
    if (bilan.erreurs.length > 0) process.exitCode = 1;
  }

  etape('6/6 Rapport');
  console.table(compterParReseau(geo.places, geo.non_places));
  const chemin = join(args.rapport, nomRapport(args.cle, new Date()));
  writeFileSync(chemin, csvAReprendre(geo.places, geo.non_places), 'utf8');
  console.log(`emplacements à reprendre : ${chemin}`);
}

main().catch((e: unknown) => {
  console.error(`\nÉCHEC : ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
