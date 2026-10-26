import { formaterNombre } from '../../../../core/format/nombre';
import type { Prevol } from '../../data/activation.api';
import type { ExtractionJeu, ResumeExtraction } from '../../data/jeux.api';
import { NOM_PLATEFORME, nombreUnites, texteAvertissement } from '../jeu/ecran';
import { type Maille, PLATEFORMES, type Plateforme, type PlateformeGeo } from '../jeu/plateformes';
import { CANAL_DE_PLATEFORME, resumeDuCanal } from '../plan/plateformes-canaux';
import { texteMotif } from './motifs';

/**
 * ⑦ Activation — une CARTE par plateforme cochée en ⑥ (lot 7, T3, A-4, A-5, A-13), logique PURE.
 *
 * - Ordre : celui du registre `plateformes_geo.ordre` (la plus petite ligne de la plateforme), puis l'ordre de ⑥ pour
 *   un canal hors registre.
 * - Nature : la conversion en unités RETENUES du résumé figé (« 63 CP — conversion de la zone (95 % d’utile) »,
 *   « 1 polygone exact », « 53 cercles de 5 km », « 1 département »). La poussée et le fichier comptent les CP BRUTS
 *   de `lireCpPlateforme` (ruling du lot 6) : la carte dit l'extraction, pas le fichier.
 * - Mode : DV360 au CP pousse par l'API (`reel`), en simulé (`simule`, démo sans connexion) ou pas du tout (`fichier`,
 *   `indisponible`) ; ses fichiers restent offerts en repli. Tout le reste est en `fichier`.
 * - Motifs : ce qui empêche d'envoyer quoi que ce soit — pour DV360 au CP, ceux du pré-vol. Une extraction sans CP
 *   DV360 (Meta et TikTok seuls) n'est pas une erreur : la carte DV360 dit « rien à pousser » (Review Focus 1).
 * - Jeu RISQUE (extraction sans résumé) : tout le plan est au CP ; DV360 et TTD le reçoivent, TikTok ne l'achète pas
 *   en France, Meta l'achète « à vérifier » mais le serveur ne sert son fichier qu'à DV360 et TTD (route `fichier`).
 * - Avertissements : réglementaires (Meta, TikTok), ceux figés dans l'extraction, et le dépassement de `max_unites`
 *   d'après le registre COURANT (il a pu changer depuis l'extraction). Écrits, jamais une case à cocher (Q-2).
 */

export const FORMATS_FICHIER = ['cp', 'sdf', 'cercles', 'polygone', 'territoires'] as const;
export type FormatFichier = (typeof FORMATS_FICHIER)[number];

/**
 * Les formats qu'offre une plateforme à une maille — COPIE de `formatsDe` (`lib/zones/fichiers-plateformes.ts`),
 * verrouillée par `tests/unit/angular/activation-paritaire.test.ts` (ruling 2 du lot 7).
 */
export function formatsDe(plateforme: Plateforme, maille: Maille): FormatFichier[] {
  switch (maille) {
    case 'cp': return plateforme === 'dv360' ? ['cp', 'sdf'] : ['cp'];
    case 'cercle': return ['cercles'];
    case 'polygone': return ['polygone'];
    case 'commune':
    case 'departement': return ['territoires'];
    default: return [];
  }
}

export type ModeCarte = 'api' | 'simule' | 'fichier';

export interface CarteActivation {
  canal: string;
  plateforme: Plateforme | null;
  libelle: string;
  maille: Maille | null;
  /** La conversion, en unités retenues ; vide quand rien n'est à envoyer. */
  nature: string;
  mode: ModeCarte;
  unites: number;
  formats: FormatFichier[];
  /** Ce qui empêche d'envoyer (pousser ou télécharger), au vouvoiement ; vide : la carte est prête. */
  motifs: string[];
  avertissements: string[];
  /** La règle (plateforme, maille) du registre est marquée `a_verifier` : l'écran le dit à côté des fichiers (T5). */
  aVerifier: boolean;
}

export const MESSAGE_HORS_EXTRACTION = 'Aucune unité dans l’extraction pour cette plateforme : rien à envoyer.';
export const MESSAGE_META_RISQUE =
  'Les codes postaux d’un jeu risque sont « à vérifier » chez Meta : aucun fichier n’est servi, seuls DV360 et The Trade Desk le reçoivent.';
export const AVERTISSEMENT_SENSIBLE_META = 'Catégorie sensible (emploi, logement, crédit) : pas de code postal, rayon ≥ 15 km.';

export const messageRisqueNonAchete = (nom: string) =>
  `Un jeu risque ne porte que des codes postaux : ${nom} ne les achète pas en France.`;
export const messageSansJeu = (nom: string) => `Ce plan ne vient pas d’un jeu de zones : rien à envoyer à ${nom}.`;
export const avertissementPolitique = (nom: string) => `Publicité politique interdite chez ${nom} dans l’Union européenne.`;

const PLATEFORME_DE_CANAL = new Map<string, Plateforme>(PLATEFORMES.map((p) => [CANAL_DE_PLATEFORME[p], p]));

/** Le mode affiché de DV360 au CP d'après le pré-vol ; sans pré-vol lu, aucun mode de poussée n'est promis. */
function modeDv360(prevol: Prevol | null): ModeCarte {
  if (prevol?.mode_dv360 === 'reel') return 'api';
  return prevol?.mode_dv360 === 'simule' ? 'simule' : 'fichier';
}

/** « 95 % », « 81,5 % » : le taux d'utile tel que l'extraction le porte. */
function pourcent(taux: number | null | undefined): string | null {
  return taux == null ? null : `${formaterNombre(Number(taux))} %`;
}

/** La conversion dite en unités retenues (A-5). */
function nature(maille: Maille, n: number, r: { exacte?: boolean; rayon_m?: number | null; taux_utile?: number | null }): string {
  const base = maille === 'cp' ? `${formaterNombre(n)} CP` : nombreUnites(n, maille);
  if (r.exacte) return `${base} exact${maille === 'commune' ? 'e' : ''}${n > 1 ? 's' : ''}`;
  if (maille === 'cercle' && r.rayon_m) return `${base} de ${formaterNombre(r.rayon_m / 1000)} km`;
  const utile = pourcent(r.taux_utile);
  if (maille === 'cp' && utile) return `${base} — conversion de la zone (${utile} d’utile)`;
  return base;
}

/** Les avertissements réglementaires d'une plateforme (A-13, § 8). */
function reglementaires(p: Plateforme | null, nom: string): string[] {
  if (p === 'meta') return [avertissementPolitique(nom), AVERTISSEMENT_SENSIBLE_META];
  return p === 'tiktok' ? [avertissementPolitique(nom)] : [];
}

/** Les limites dépassées : celles figées dans l'extraction, puis `max_unites` du registre courant si elle ne l'était pas. */
function limites(r: ResumeExtraction | undefined, ligne: PlateformeGeo | undefined, maille: Maille, unites: number): string[] {
  const figes = r?.avertissements ?? [];
  const textes = figes.map((a) => texteAvertissement(a, maille));
  const max = ligne?.limites.max_unites;
  if (max !== undefined && unites > max && !figes.some((a) => a.code === 'max_unites')) {
    textes.push(texteAvertissement({ code: 'max_unites', limite: max, valeur: unites }, maille));
  }
  return textes;
}

export interface EntreeCartes {
  /** Les canaux cochés en ⑥ (DSP puis réseaux), dans leur ordre. */
  canaux: string[];
  extraction: ExtractionJeu | null;
  typeJeu: 'zone' | 'risque' | null;
  prevol: Prevol | null;
  registre: PlateformeGeo[];
}

/** Une carte par canal coché, dans l'ordre du registre. */
export function cartesActivation(e: EntreeCartes): CarteActivation[] {
  const ordre = new Map<string, number>();
  for (const l of e.registre) ordre.set(l.plateforme, Math.min(ordre.get(l.plateforme) ?? Infinity, l.ordre));
  const rang = (c: string) => ordre.get(PLATEFORME_DE_CANAL.get(c) ?? '') ?? Infinity;
  const canaux = e.canaux.map((c, i) => ({ c, i })).sort((a, b) => rang(a.c) - rang(b.c) || a.i - b.i).map((x) => x.c);
  return canaux.map((c) => carte(c, e));
}

function carte(canal: string, e: EntreeCartes): CarteActivation {
  const plateforme = PLATEFORME_DE_CANAL.get(canal) ?? null;
  const libelle = plateforme ? NOM_PLATEFORME[plateforme] : canal;
  const vide: CarteActivation = {
    canal, plateforme, libelle, maille: null, nature: '', mode: 'fichier', unites: 0, formats: [], motifs: [], aVerifier: false,
    avertissements: reglementaires(plateforme, libelle),
  };
  const motifsPrevol = (e.prevol?.motifs ?? []).map(texteMotif);

  // Un plan d'avant le lot 7 (une zone, pas une extraction) : seul DV360 reçoit ses CP, par la poussée.
  if (!e.extraction) {
    // Pré-vol pas encore lu, ou extraction du plan pas encore relue : rien n'est dit plutôt qu'un faux « rien à envoyer ».
    if (!e.prevol || e.prevol.extraction) return vide;
    if (plateforme !== 'dv360') return { ...vide, motifs: [messageSansJeu(libelle)] };
    const n = e.prevol?.n_cp_dv360 ?? 0;
    return { ...vide, maille: 'cp', nature: `${formaterNombre(n)} CP`, unites: n, mode: modeDv360(e.prevol), motifs: motifsPrevol };
  }
  if (!plateforme) return { ...vide, motifs: [MESSAGE_HORS_EXTRACTION] };

  const risque = e.typeJeu === 'risque' || e.extraction.plateformes === null;
  if (risque && plateforme === 'tiktok') return { ...vide, motifs: [messageRisqueNonAchete(libelle)] };

  const resume = resumeDuCanal(e.extraction, canal);
  const brut = e.extraction.plateformes?.find((r) => r.plateforme === plateforme);
  if (!resume || resume.nUnites === 0) {
    // DV360 hors extraction : le motif du pré-vol (« Cette extraction n’achète pas DV360 au code postal : rien à pousser. »).
    const pourDv360 = plateforme === 'dv360'
      ? (e.prevol?.motifs ?? []).filter((m) => m.code === 'aucun_cp_dv360').map(texteMotif) : [];
    return { ...vide, motifs: pourDv360.length ? pourDv360 : [MESSAGE_HORS_EXTRACTION] };
  }

  const { maille, nUnites } = resume;
  const ligne = e.registre.find((l) => l.plateforme === plateforme && l.maille === maille);
  const base: CarteActivation = {
    ...vide,
    maille,
    unites: nUnites,
    nature: nature(maille, nUnites, risque ? { taux_utile: e.extraction.taux_utile } : (brut ?? {})),
    formats: formatsDe(plateforme, maille),
    aVerifier: ligne?.a_verifier ?? false,
    avertissements: [...vide.avertissements, ...limites(brut, ligne, maille, nUnites)],
  };
  if (risque && plateforme === 'meta') return { ...base, formats: [], motifs: [MESSAGE_META_RISQUE] };
  if (plateforme === 'dv360' && maille === 'cp') return { ...base, mode: modeDv360(e.prevol), motifs: motifsPrevol };
  return base.formats.length ? base : { ...base, motifs: [MESSAGE_HORS_EXTRACTION] };
}
