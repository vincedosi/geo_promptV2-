/** Lecture des options du script `scripts/ooh/importer-plan.ts` (spec 2026-10-16-ooh-campagnes § 7). */

interface ArgumentsImport {
  plan: string;
  espace: string;
  campagne: string;
  vague: string | null;
  cle: string;
  annonceur: string | null;
  rapport: string;
  aBlanc: boolean;
}

const AVEC_VALEUR = ['--plan', '--espace', '--campagne', '--vague', '--cle', '--annonceur', '--rapport'] as const;
const OBLIGATOIRES = ['--plan', '--espace', '--campagne', '--cle'] as const;
const CLE = /^[a-z0-9][a-z0-9-]{2,63}$/;

/** Rend les options lues, ou `{ erreur }` en français — jamais d'exception. */
export function lireArguments(argv: readonly string[], dossierRapportParDefaut: string): ArgumentsImport | { erreur: string } {
  const valeurs = new Map<string, string>();
  let aBlanc = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--a-blanc') {
      aBlanc = true;
      continue;
    }
    if (!(AVEC_VALEUR as readonly string[]).includes(a)) return { erreur: `Option inconnue : ${a}.` };
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) return { erreur: `Valeur absente pour ${a}.` };
    valeurs.set(a, v);
    i++;
  }
  for (const o of OBLIGATOIRES) if (!valeurs.has(o)) return { erreur: `Option obligatoire absente : ${o}.` };
  const cle = valeurs.get('--cle')!;
  if (!CLE.test(cle)) return { erreur: '--cle : minuscules, chiffres et tirets, 3 à 64 caractères (ex. marine-tf4-2026).' };
  return {
    plan: valeurs.get('--plan')!,
    espace: valeurs.get('--espace')!,
    campagne: valeurs.get('--campagne')!,
    vague: valeurs.get('--vague') ?? null,
    cle,
    annonceur: valeurs.get('--annonceur') ?? null,
    rapport: valeurs.get('--rapport') ?? dossierRapportParDefaut,
    aBlanc,
  };
}
