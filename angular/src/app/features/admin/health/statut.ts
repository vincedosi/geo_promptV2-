/**
 * Couleurs de statut du Health check — `statusColor` / `statusBg` et suffixes d'opacité hex de
 * `app/admin/health/page.tsx:14-33,70-80` (`44` = 26,67 %, `22` = 13,33 %, `66` = 40 %).
 *
 * Substitutions C9 (aucun hex ni rgba littéral) : `#f87171` → `--danger`, `#fbbf24` → `--warning`,
 * fonds `rgba(…, 0.12)` / `rgba(…, 0.1)` → `color-mix` du jeton à la même opacité. En thème
 * sombre l'écart est nul pour OK (`--success` = #3dffa0) et léger pour WARN/ERROR ; en thème
 * clair les jetons s'assombrissent, là où React garde ses couleurs sombres.
 *
 * Un élément porte `class="statut"` et `data-etat` ; il expose alors `--c-statut` (trait, barre),
 * `--c-statut-texte` (TEXTE : la propriété lisible du cadre, DESIGN_SYSTEM § 3, T21),
 * `--fond-statut`, `--bord-statut` (26,67 %), `--bord-statut-fort` (40 %) et `--badge-statut`.
 */
export const STYLES_STATUT = `
  .statut[data-etat='OK'] {
    --c-statut: var(--success);
    --c-statut-texte: var(--success-texte, var(--success));
    --fond-statut: color-mix(in srgb, var(--success) 12%, transparent);
    --bord-statut: color-mix(in srgb, var(--success) 26.67%, transparent);
    --bord-statut-fort: color-mix(in srgb, var(--success) 40%, transparent);
    --badge-statut: color-mix(in srgb, var(--success) 13.33%, transparent);
  }
  .statut[data-etat='WARN'] {
    --c-statut: var(--warning);
    --c-statut-texte: var(--warning-texte, var(--warning));
    --fond-statut: color-mix(in srgb, var(--warning) 10%, transparent);
    --bord-statut: color-mix(in srgb, var(--warning) 26.67%, transparent);
    --bord-statut-fort: color-mix(in srgb, var(--warning) 40%, transparent);
    --badge-statut: color-mix(in srgb, var(--warning) 13.33%, transparent);
  }
  .statut[data-etat='ERROR'] {
    --c-statut: var(--danger);
    --c-statut-texte: var(--danger-texte, var(--danger));
    --fond-statut: color-mix(in srgb, var(--danger) 10%, transparent);
    --bord-statut: color-mix(in srgb, var(--danger) 26.67%, transparent);
    --bord-statut-fort: color-mix(in srgb, var(--danger) 40%, transparent);
    --badge-statut: color-mix(in srgb, var(--danger) 13.33%, transparent);
  }
`;
