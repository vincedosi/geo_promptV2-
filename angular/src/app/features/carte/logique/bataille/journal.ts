/**
 * Logique PURE des journaux « terminal » des batailles — portage de `use-isochrone-battle.ts:144-200,243-290,310-314`
 * et des couleurs de ligne de `IsochronesTool.tsx:276-282` / `BattleV2Tool.tsx:254-261` (lot 4, T17).
 *
 * Les journaux sont mis à jour EN PLACE : la ligne de progression ORS et celle du comptage d'anneaux sont remplacées
 * plutôt qu'empilées, sinon un calcul long noie l'écran sous des centaines de lignes (`use-isochrone-battle.ts:10-12`).
 *
 * Défauts React corrigés au remplissage V2 : la ligne « N POIs trouvés » sortait préfixée deux fois (« > > … ») et la
 * ligne d'anneaux doublait son losange (« > ◆ ◆ +N … ») — le message reçu porte déjà son préfixe.
 */

/** La teinte d'une ligne de journal : un jeton de texte (`--success`, `--danger`, `--warning`, `--text-*`). */
export type TeinteLigne = 'success' | 'danger' | 'warning' | 'secondary' | 'tertiary';

/** Les quatre lignes de départ de la bataille V1 (`use-isochrone-battle.ts:246-251`). */
export function journalInitialV1(categorie: string, mode: string, maxMin: number, territoire: string): string[] {
  return [
    `> catégorie : ${categorie}`,
    `> mode : ${mode} | max : ${maxMin} min`,
    `> territoire : ${territoire}`,
    '> [1/3] vérification cache isochrones...',
  ];
}

/** Les étapes simulées du ticker, à la seconde près : l'appel ORS dure 30 à 120 s sans retour intermédiaire. */
const ETAPES_TICKER: Readonly<Record<number, string>> = {
  3: '> [2/3] appel ORS (peut prendre 30-120s)...',
  10: '> ! premier batch ORS en cours...',
  20: '> ! batches suivants en cours...',
  35: '> ! appels ORS — encore en cours...',
};
const FIN_ECOULE = /\d+\.\ds$/;

/** Un battement du ticker (1 s) : l'étape du moment, puis le temps écoulé — mis à jour en place sur la dernière ligne. */
export function tickJournal(journal: readonly string[], tick: number, ecoule: string): string[] {
  const lignes = [...journal];
  const etape = ETAPES_TICKER[tick];
  if (etape) lignes.push(etape);
  const derniere = lignes[lignes.length - 1] ?? '';
  if (FIN_ECOULE.test(derniere)) lignes[lignes.length - 1] = derniere.replace(FIN_ECOULE, `${ecoule}s`);
  else lignes.push(`> elapsed : ${ecoule}s`);
  return lignes;
}

/** Progression V1 : la dernière ligne « POIs traités » / « POIs trouvés » est remplacée, sinon le message s'ajoute. */
export function remplacerProgression(journal: readonly string[], msg: string): string[] {
  for (let i = journal.length - 1; i >= 0; i--) {
    if (journal[i].includes('POIs traités') || journal[i].includes('POIs trouvés')) {
      return [...journal.slice(0, i), msg, ...journal.slice(i + 1)];
    }
  }
  return [...journal, msg];
}

/** Les compteurs d'un message de progression V1 : « X/Y POIs », ou « N POIs trouvés » pour le seul total. */
export function compteursProgression(msg: string): { termines?: number; total?: number } {
  const m = msg.match(/(\d+)\/(\d+) POIs/);
  if (m) return { termines: Number(m[1]), total: Number(m[2]) };
  if (msg.includes('POIs trouvés')) {
    const t = msg.match(/(\d+) POIs/);
    if (t) return { total: Number(t[1]) };
  }
  return {};
}

/** Les trois lignes de départ du remplissage du cache V2 (`use-isochrone-battle.ts:144-148`). */
export function journalInitialRemplissage(categorie: string, mode: string, paliers: readonly number[]): string[] {
  return ['> [ORS] Calcul des isochrones manquants...', `> catégorie : ${categorie} | mode : ${mode}`, `> paliers : ${paliers.join(', ')} min`];
}

/** Les trois lignes de départ de la bataille V2 (`use-isochrone-battle.ts:310-314`). */
export function journalInitialV2(categorie: string, mode: string, paliers: readonly number[]): string[] {
  return [`> catégorie : ${categorie}`, `> mode : ${mode} | paliers : ${paliers.join(', ')} min`, '> lecture cache isochrones...'];
}

/** Ce qu'un message du remplissage change : le journal, et les compteurs qu'il porte. */
export interface LectureRemplissage {
  journal: string[];
  total?: number;
  termines?: number;
  pct?: number;
  /** Anneaux reçus par CE message (à cumuler). */
  anneaux?: number;
}

/** Remplace la dernière ligne qui commence par `prefixe`, sinon ajoute. */
function enPlace(journal: readonly string[], prefixe: string, ligne: string): string[] {
  const i = journal.map((l) => l.startsWith(prefixe)).lastIndexOf(true);
  if (i < 0) return [...journal, ligne];
  const suite = [...journal];
  suite[i] = ligne;
  return suite;
}

/** Sans le « > » de tête : le message d'un flux porte déjà le sien. */
const sansPrefixe = (msg: string) => msg.replace(/^> /, '');

/** Un message du remplissage ORS (`use-isochrone-battle.ts:161-199`) : total, progression, anneaux, ou ligne libre. */
export function lireMessageRemplissage(journal: readonly string[], msg: string): LectureRemplissage {
  const total = msg.match(/(\d+) POIs trouv/);
  if (total) return { journal: [...journal, `> ${sansPrefixe(msg)}`], total: Number(total[1]) };

  const progression = msg.match(/(\d+)\/(\d+) POIs traités.*?(\d+)%/);
  if (progression) {
    const [, termines, tot, pct] = progression.map(Number);
    return { journal: enPlace(journal, '> ORS —', `> ORS — ${termines}/${tot} POIs — ${pct}%`), termines, total: tot, pct };
  }

  const anneaux = msg.match(/\+(\d+) isochrones/);
  if (anneaux) {
    return { journal: enPlace(journal, '> ◆', `> ◆ ${sansPrefixe(msg).replace(/^◆ /, '')}`), anneaux: Number(anneaux[1]) };
  }

  return { journal: msg.trim() ? [...journal, `> ${sansPrefixe(msg)}`] : [...journal] };
}

/** Couleur d'une ligne du journal V1 (`IsochronesTool.tsx:276-282`). */
export function teinteLigneV1(ligne: string): TeinteLigne {
  if (ligne.startsWith('> ✓')) return 'success';
  if (ligne.startsWith('> ✕')) return 'danger';
  if (ligne.startsWith('> !')) return 'warning';
  if (ligne.includes('[3/3]')) return 'success';
  return 'tertiary';
}

/** Couleur d'une ligne du journal V2 (`BattleV2Tool.tsx:254-261`). */
export function teinteLigneV2(ligne: string): TeinteLigne {
  if (ligne.startsWith('> ✓')) return 'success';
  if (ligne.startsWith('> ✕')) return 'danger';
  if (ligne.startsWith('> !')) return 'warning';
  if (ligne.startsWith('> ◆')) return 'secondary';
  if (ligne.startsWith('> ORS')) return 'warning';
  return 'tertiary';
}
