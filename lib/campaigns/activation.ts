/**
 * @file lib/campaigns/activation.ts — la logique PURE du pré-vol de ⑦ Activation (lot 7, T1 ; écarts E1-E4).
 *
 * Partagée par `GET …/activation/prevol` (ce qui serait poussé, et pourquoi on ne peut pas encore) et
 * `POST …/activation/pousser` (qui rejoue le même pré-vol avant d'écrire quoi que ce soit) : un seul jeu de règles,
 * deux routes qui ne peuvent pas se contredire. Les lectures vivent dans `lib/campaigns/etat-activation.ts`.
 *
 * - `sourceDuPlan` : d'où viennent les CP poussés — une zone (`zone_id`, chemin d'avant le lot 7) ou une extraction
 *   (`in_zone_weights.extraction_id`, écrite par `rattacher` en ⑥ — E1).
 * - `modePoussee` : réel, simulé (campagne de démo sans connexion DV360 active — E3, A-3) ou indisponible.
 * - `motifsPrevol` : les raisons de ne pas pousser, avec un CODE (E4) ; leurs messages restent les `blocages` lus par
 *   React.
 *
 * ⚠ À ne pas confondre avec `sourceDuPlan` de `lib/campagne/source-plan.ts`, qui répond à une autre question
 * (indicateur ou jeu de zones, pour les libellés du Suivi).
 */

/** D'où viennent les CP qu'une poussée envoie. */
export type SourceActivation = { type: 'zone'; zoneId: string } | { type: 'extraction'; extractionId: string };

/** `reel` : connexion DV360 active ; `simule` : démo sans connexion ; `indisponible` : ni l'un ni l'autre. */
export type ModeDv360 = 'reel' | 'simule' | 'indisponible';

type CodeMotif =
  | 'aucune_strategie' | 'droit' | 'jamais_publiee' | 'derive'
  | 'aucune_connexion' | 'connexion_en_erreur' | 'aucun_cp_dv360';

export interface Motif { code: CodeMotif; message: string; version?: number }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Statuts d'une connexion qui ne permettent PAS de pousser : la compter ferait échouer au premier appel sortant. */
const STATUTS_INUTILISABLES = new Set(['error', 'revoked']);

/**
 * La source des CP poussés. La zone d'abord : c'est le chemin d'avant le lot 7, il reste tel quel.
 *
 * @param s - `bidding_strategies.zone_id` et `in_zone_weights`, tels que la base les rend.
 * @returns `null` si la stratégie ne porte ni zone ni extraction lisible (jamais d'exception).
 */
export function sourceDuPlan(s: { zone_id: string | null; in_zone_weights: unknown }): SourceActivation | null {
  if (s.zone_id) return { type: 'zone', zoneId: s.zone_id };
  const w = s.in_zone_weights;
  if (!w || typeof w !== 'object' || Array.isArray(w)) return null;
  const id = (w as Record<string, unknown>).extraction_id;
  return typeof id === 'string' && UUID.test(id) ? { type: 'extraction', extractionId: id } : null;
}

/**
 * Le mode de la poussée DV360 (A-3). Une connexion active l'emporte, même sur une campagne de démo : une démo
 * branchée sur un vrai compte pousse pour de vrai.
 *
 * @param connexions - Les connexions DSP de l'espace (toutes plateformes : seule DV360 compte).
 * @param isDemo - `dsp_campaigns.is_demo`.
 */
export function modePoussee(connexions: { provider: string; status: string }[], isDemo: boolean): ModeDv360 {
  if (connexions.some((c) => c.provider === 'dv360' && !STATUTS_INUTILISABLES.has(c.status))) return 'reel';
  return isDemo ? 'simule' : 'indisponible';
}

export interface EntreeMotifs {
  aStrategie: boolean;
  superAdmin: boolean;
  /** Dernière version publiée, `null` si jamais publiée. */
  versionPubliee: number | null;
  /** Zones changées depuis la publication (`zonesModifiees`). */
  nZonesModifiees: number;
  mode: ModeDv360;
  /** Une connexion DV360 existe (en erreur ou révoquée quand `mode` est `indisponible`). */
  connexionDv360: boolean;
  source: SourceActivation | null;
  nCpDv360: number;
}

/**
 * Les raisons de ne pas pousser, dans l'ordre des `blocages` d'avant le lot 7. Une liste vide = activable.
 * `aucun_cp_dv360` ne bloque que la poussée : une extraction sans CP DV360 (Meta et TikTok seuls) est légitime, ses
 * fichiers restent offerts, ce n'est jamais une erreur HTTP.
 */
export function motifsPrevol(e: EntreeMotifs): Motif[] {
  const motifs: Motif[] = [];
  if (!e.aStrategie) {
    motifs.push({ code: 'aucune_strategie', message: 'Aucune stratégie n’est définie pour cette campagne.' });
  }
  if (!e.superAdmin) {
    motifs.push({ code: 'droit', message: 'La poussée de ciblage vers un DSP est réservée aux super-administrateurs.' });
  }
  if (e.aStrategie) {
    if (e.versionPubliee === null) {
      motifs.push({
        code: 'jamais_publiee',
        message: 'La stratégie n’a jamais été publiée — publiez-la pour figer le périmètre poussé.',
      });
    } else if (e.nZonesModifiees > 0) {
      const n = e.nZonesModifiees;
      motifs.push({
        code: 'derive',
        version: e.versionPubliee,
        message: `${n} zone${n > 1 ? 's ont' : ' a'} changé depuis la publication de la v${e.versionPubliee} — republiez avant d’activer.`,
      });
    }
  }
  if (e.mode === 'indisponible') {
    motifs.push(e.connexionDv360
      ? {
        code: 'connexion_en_erreur',
        message: 'La connexion DV360 de cet espace est en erreur ou révoquée : téléchargez le fichier SDF.',
      }
      : { code: 'aucune_connexion', message: 'Aucune connexion DV360 active dans cet espace : téléchargez le fichier SDF.' });
  }
  if (e.aStrategie && e.nCpDv360 === 0) {
    motifs.push({
      code: 'aucun_cp_dv360',
      message: e.source?.type === 'extraction'
        ? 'Cette extraction n’achète pas DV360 au code postal : rien à pousser.'
        : 'Ce plan ne porte aucun code postal à pousser chez DV360.',
    });
  }
  return motifs;
}
