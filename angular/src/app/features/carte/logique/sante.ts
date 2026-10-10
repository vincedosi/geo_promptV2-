/**
 * Santé environnementale — libellés et règles de la couche nationale, copie Angular (lot 4, P6) :
 *  - `ATMO_LEVEL_LABELS`, `POLLEN_LEVEL_LABELS` : `lib/civic-health/levels.ts:14-31`, verbatim ;
 *  - `METRIQUES_SANTE` : `METRIC_LABELS` de `app/map/_components/CivicHealthMapLayer.tsx:48-64`, verbatim ;
 *  - `libelleNiveau` : `civicLevelLabel`, `CivicHealthMapLayer.tsx:42-45` ;
 *  - `ageEnJours`, `AGE_MAX_JOURS` : `app/map/_components/filter-panel/CivicHealthSection.tsx:34-48`.
 * Verrouillée par tests/unit/angular/carte-couches-paritaire.test.ts (gel P5 étendu à /map).
 */
/** Les deux jeux de la santé environnementale (`CivicHealthMapLayer.tsx:38`). */
export type JeuSante = 'pollen' | 'atmo';
/** Les deux échelles de zones (`CivicHealthMapLayer.tsx:39`). */
export type EchelleSante = 'departement' | 'cp';

export const ATMO_LEVEL_LABELS: Record<1 | 2 | 3 | 4 | 5 | 6, string> = {
  1: 'bon',
  2: 'moyen',
  3: 'dégradé',
  4: 'mauvais',
  5: 'très mauvais',
  6: 'extrêmement mauvais',
};

export const POLLEN_LEVEL_LABELS: Record<0 | 1 | 2 | 3 | 4 | 5 | 6, string> = {
  0: 'indisponible',
  1: 'très faible',
  2: 'faible',
  3: 'modéré',
  4: 'élevé',
  5: 'très élevé',
  6: 'extrêmement élevé',
};

/** Sous-métriques de la popup et du sélecteur, par jeu : `[clé, libellé]`. */
export const METRIQUES_SANTE: Record<JeuSante, Array<[string, string]>> = {
  pollen: [
    ['ambroisie', 'Ambroisie'],
    ['armoise', 'Armoise'],
    ['aulne', 'Aulne'],
    ['bouleau', 'Bouleau'],
    ['graminees', 'Graminées'],
    ['olivier', 'Olivier'],
  ],
  atmo: [
    ['no2', 'Dioxyde d’azote (NO₂)'],
    ['o3', 'Ozone (O₃)'],
    ['pm10', 'Particules PM10'],
    ['pm25', 'Particules fines PM2.5'],
    ['so2', 'Dioxyde de soufre (SO₂)'],
  ],
};

/** Libellé d'un niveau selon le jeu (0 = indisponible côté pollen). */
export function libelleNiveau(jeu: JeuSante, niveau: number): string {
  if (jeu === 'pollen') return POLLEN_LEVEL_LABELS[niveau as keyof typeof POLLEN_LEVEL_LABELS] ?? '—';
  return niveau >= 1 && niveau <= 6 ? ATMO_LEVEL_LABELS[niveau as keyof typeof ATMO_LEVEL_LABELS] : 'indisponible';
}

/**
 * Au-delà de ce nombre de jours, la donnée est signalée comme périmée : les tables quotidiennes sont purgées à J-2,
 * trois jours laissent la marge d'un fuseau ou d'un cron en retard ; au-delà, l'ingestion ne tourne plus.
 */
export const AGE_MAX_JOURS = 3;

/** Âge de la donnée en jours, ou `null` si la date est absente ou illisible (jamais « périmée depuis toujours »). */
export function ageEnJours(dateIso: string | null | undefined, maintenant = Date.now()): number | null {
  if (!dateIso) return null;
  const t = Date.parse(dateIso);
  if (Number.isNaN(t)) return null;
  return Math.floor((maintenant - t) / 86_400_000);
}
