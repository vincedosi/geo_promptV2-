/**
 * Le parcours de la carte — ① Périmètre › ② Données › ③ Analyse › ④ Zones › ⑤ Plan › ⑥ Activation › ⑦ Live
 * (spec `docs/superpowers/specs/2026-10-13-carte-en-parcours-design.md`, V1-V2, § 5).
 *
 * Logique PURE : le fil, l'URL, le clavier et l'aide lisent tous cette définition, jamais une copie.
 * Ce n'est pas un tunnel : rien ici ne vérifie qu'une étape est « validée » avant la suivante, et rien ne doit le faire.
 */
import type { EtapeAffichee } from '../../../ui/fil-etapes/fil-etapes.component';
import type { SegmentAriane } from '../../../ui/fil-ariane/fil-ariane.component';
import type { FiltreActif } from './filtre';
import { PARAM_ZONE_LIEN } from './zones/zone-du-lien';

/** Les sept étapes, dans l'ordre. L'ordre EST la numérotation ; ce sont aussi les valeurs de `?etape=`. */
export const ETAPES_CARTE = ['perimetre', 'donnees', 'analyse', 'zones', 'plan', 'activation', 'live'] as const;
export type EtapeCarte = (typeof ETAPES_CARTE)[number];

export const ETAPE_PAR_DEFAUT: EtapeCarte = 'perimetre';
/** Le paramètre d'URL de l'étape (spec § 5). La valeur par défaut ne s'écrit pas. */
export const PARAM_ETAPE = 'etape';

export const LIBELLE_ETAPE_CARTE: Readonly<Record<EtapeCarte, string>> = {
  perimetre: 'Périmètre', donnees: 'Données', analyse: 'Analyse', zones: 'Zones',
  plan: 'Plan', activation: 'Activation', live: 'Live',
};

/** Ce que chaque panneau attend, en une ligne (spec § 11 : « le parcours peut se lire comme un tunnel »). */
export const CONSIGNE_ETAPE: Readonly<Record<EtapeCarte, string>> = {
  perimetre: 'Choisissez où regarder : région, département, ville, code postal ou zone enregistrée. Ce périmètre borne les calculs des étapes suivantes.',
  donnees: 'Allumez ce que vous voulez voir. Rien n’est chargé tant que vous ne l’allumez pas.',
  analyse: 'Calculez : score, corrélation, isochrones, bataille, clustering. Chaque résultat s’affiche sur la carte.',
  zones: 'Fabriquez une zone : capture de ce qui est affiché, codes postaux, rayon, dessin. Vos zones enregistrées sont dans la boîte à outils, « Mes zones ».',
  plan: 'Le plan de campagne arrive dans le parcours. En attendant, il se prépare dans l’application actuelle.',
  activation: 'L’activation plateforme par plateforme arrive dans le parcours. En attendant, elle se fait dans l’application actuelle.',
  live: 'Le suivi de la campagne en vol arrive dans le parcours. En attendant, il se consulte dans l’application actuelle.',
};

/** Étapes dont le contenu n'est pas encore porté (lots 3, 6, 7 de la spec). */
export const ETAPES_BIENTOT: ReadonlySet<EtapeCarte> = new Set<EtapeCarte>(['plan', 'activation', 'live']);

/** L'onglet de l'overlay campagne React qui porte aujourd'hui l'étape (`components/magelian/deep-link.ts`, `TABS`). */
const ONGLET_REACT: Partial<Record<EtapeCarte, 'strategie' | 'activation' | 'suivi'>> = {
  plan: 'strategie', activation: 'activation', live: 'suivi',
};

/** Bornes de la poignée du panneau d'étape : celles de `RisquePage` (320-900 px, 480 par défaut). */
export const LARGEUR_PANNEAU_ETAPE = { min: 320, max: 900, defaut: 480 } as const;

export function rangEtapeCarte(e: EtapeCarte): number {
  return ETAPES_CARTE.indexOf(e) + 1;
}

/** Une valeur d'URL connue, sinon `null`. Ne lève jamais : l'URL vient de l'extérieur. */
export function lireEtape(brut: string | null | undefined): EtapeCarte | null {
  return (ETAPES_CARTE as readonly string[]).includes(brut ?? '') ? (brut as EtapeCarte) : null;
}

/**
 * L'étape d'ouverture : `?etape=` s'il est lisible ; sinon ④ si l'URL porte une zone (`?customZone=`, le lien
 * historique d'une zone enregistrée — sa redirection vers `jeu=` attend le lot 5) ; sinon ①.
 */
export function etapeInitiale(params: { get(nom: string): string | null }): EtapeCarte {
  return lireEtape(params.get(PARAM_ETAPE)) ?? (params.get(PARAM_ZONE_LIEN) ? 'zones' : ETAPE_PAR_DEFAUT);
}

/** La valeur écrite dans l'URL : vide pour l'étape par défaut. */
export function ecrireEtape(e: EtapeCarte): string {
  return e === ETAPE_PAR_DEFAUT ? '' : e;
}

type FrappeClavier = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

/**
 * Alt+1…Alt+7 → ①…⑦. Alt SEUL (ni Ctrl, ni Méta, ni Maj). Le chiffre est lu sur la touche PHYSIQUE (`code` :
 * `Digit1`, `Numpad1`) puis, à défaut, sur `key` : en AZERTY, Alt+1 rend `key` = « & » — l'ancien raccourci du rail
 * (`entreeParRaccourci`, lu sur `key`) n'y marchait pas.
 */
export function etapeParRaccourci(e: FrappeClavier): EtapeCarte | null {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  const parCode = /^(?:Digit|Numpad)([1-9])$/.exec(e.code ?? '')?.[1];
  const chiffre = parCode ?? (/^[1-9]$/.test(e.key) ? e.key : null);
  if (!chiffre) return null;
  return ETAPES_CARTE[Number(chiffre) - 1] ?? null;
}

/** Ce qui allume la pastille « renseignée » au lot 1 (arbitrage A2). Les autres étapes s'allument avec leur paramètre d'URL. */
export interface EtatRenseigne {
  readonly filtrePose: boolean;
  readonly calquesActifs: boolean;
}

export function etapesDuFil(r: EtatRenseigne): EtapeAffichee[] {
  return ETAPES_CARTE.map((e) => ({
    cle: e,
    rang: rangEtapeCarte(e),
    libelle: LIBELLE_ETAPE_CARTE[e],
    renseignee: e === 'perimetre' ? r.filtrePose : e === 'donnees' ? r.calquesActifs : false,
  }));
}

const TITRE_TYPE_FILTRE: Readonly<Record<FiltreActif['type'], string>> = {
  region: 'Région', departement: 'Département', commune: 'Commune', cp: 'Code postal', zone: 'Zone enregistrée', france: 'France entière',
};

/** « Où je regarde » : France entière, puis le filtre unique de ① (il remplace la puce de filtre du rail). */
export function segmentsDuFiltre(f: FiltreActif | null): SegmentAriane[] {
  const racine: SegmentAriane = { cle: 'france', libelle: 'France entière' };
  if (!f || f.type === 'france') return [racine];
  const titre = f.type === 'zone' ? TITRE_TYPE_FILTRE.zone : `${TITRE_TYPE_FILTRE[f.type]} ${f.code}`;
  return [racine, { cle: `${f.type}:${f.code}`, libelle: f.label, titre }];
}

/** La précision du fil d'Ariane : les pastilles Métro / +DROM de ①. */
export function precisionDuPerimetre(scope: 'metro' | 'all' | null): string | undefined {
  return scope === 'metro' ? 'métropole' : scope === 'all' ? 'métropole + DROM' : undefined;
}

/** Le lien d'une étape « bientôt » vers l'overlay React. Sans origine connue (hôte AIDA) : aucun lien, jamais une URL inventée. */
export function lienApplicationReact(base: string | undefined, e: EtapeCarte): string | null {
  const onglet = ONGLET_REACT[e];
  if (!base || !onglet) return null;
  return `${base.replace(/\/+$/, '')}/map?tab=${onglet}`;
}
