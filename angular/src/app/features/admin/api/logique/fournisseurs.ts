/**
 * Copie de `PROVIDERS` (`app/admin/api/_lib/constants.ts`, gel P5 du 2026-10-06) ; parité :
 * `tests/unit/angular/admin-logique-paritaire.test.ts`.
 *
 * Seul écart : `logo` est un chemin RELATIF (`logos/<p>.svg`), résolu par `urlRessourceDistante`
 * contre l'adresse de l'application distante (arbitrage C15, contrat AIDA) — React écrit
 * `/logos/<p>.svg`, absolu, qui dans un hôte désignerait l'origine du SHELL. Les quatre fichiers
 * sont copiés à l'octet dans `angular/public/logos/` (même test).
 *
 * Les jetons de couleur `C` de React ne sont pas recopiés : les styles des écrans écrivent les
 * mêmes `var(--…)` directement.
 */
import type { DspProvider } from '../../logique/types/dsp';

export interface ProviderMeta {
  key: DspProvider;
  label: string;
  logo: string;
  available: boolean; // false = placeholder « bientôt disponible »
}

export const PROVIDERS: ProviderMeta[] = [
  { key: 'dv360',  label: 'DV360',          logo: 'logos/dv360.svg',  available: true },
  { key: 'meta',   label: 'Meta',           logo: 'logos/meta.svg',   available: false },
  { key: 'tiktok', label: 'TikTok',         logo: 'logos/tiktok.svg', available: true },
  { key: 'ttd',    label: 'The Trade Desk', logo: 'logos/ttd.svg',    available: false },
];

/** Le fournisseur d'une clé (toujours présent : `DspProvider` est fermé). */
export function fournisseur(cle: DspProvider): ProviderMeta {
  return PROVIDERS.find((p) => p.key === cle)!;
}
