/**
 * Logique PURE des journaux « terminal » de la bataille V2 et de son remplissage — portage de
 * `use-isochrone-battle.ts:144-200,310-314` et des couleurs de ligne de `BattleV2Tool.tsx:254-261` (lot 4, T17). Le
 * journal de la V1 (ticker, progression, teintes) est parti avec elle (retrait de la V1, 27/10).
 *
 * Les journaux sont mis à jour EN PLACE : la ligne de progression ORS et celle du comptage d'anneaux sont remplacées
 * plutôt qu'empilées, sinon un calcul long noie l'écran sous des centaines de lignes (`use-isochrone-battle.ts:10-12`).
 *
 * Défauts React corrigés au remplissage V2 : la ligne « N POIs trouvés » sortait préfixée deux fois (« > > … ») et la
 * ligne d'anneaux doublait son losange (« > ◆ ◆ +N … ») — le message reçu porte déjà son préfixe.
 */

/** La teinte d'une ligne de journal : un jeton de texte (`--success`, `--danger`, `--warning`, `--text-*`). */
export type TeinteLigne = 'success' | 'danger' | 'warning' | 'secondary' | 'tertiary';

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

/** Couleur d'une ligne du journal V2 (`BattleV2Tool.tsx:254-261`). */
export function teinteLigneV2(ligne: string): TeinteLigne {
  if (ligne.startsWith('> ✓')) return 'success';
  if (ligne.startsWith('> ✕')) return 'danger';
  if (ligne.startsWith('> !')) return 'warning';
  if (ligne.startsWith('> ◆')) return 'secondary';
  if (ligne.startsWith('> ORS')) return 'warning';
  return 'tertiary';
}
