/**
 * Les styles partagés du panneau de clusters — `lbl` et `btn(actif, couleur)` de `ClusterPanel.tsx:344-356`, que React
 * recopiait dans chacun de ses sous-composants (`CompareDurationsView`, `CompareView`). Une feuille ici, ajoutée aux
 * `styles` de chaque composant du panneau (styles encapsulés : chaque composant la reçoit).
 *
 * La teinte d'un bouton passe par la propriété `--teinte` posée sur l'élément (`[style.--teinte]`) : un jeton
 * (`var(--warning)`) ou la couleur d'un cluster (hexadécimal de donnée). React mélangeait `rgba(${hexRgb(couleur)},…)`
 * — qui rendait un fond NOIR pour une couleur `var(--…)`, illisible pour `hexRgb` — et des hexadécimaux en dur.
 *
 * Écarts assumés, listés au rapport : bords 0,5 px (DESIGN_SYSTEM § 7.8, React : 1 px) ; `#f59e0b` → `--warning`,
 * `#f87171` / `#ef4444` → `--danger`, `#3dffa0` / `#22c55e` → `--success`, la bordure violette `#261a35` de la
 * comparaison → `--border-default`.
 */
export const STYLES_CLUSTERS = `
  .mono { font-family: var(--font-mono); }
  .inter { font-family: var(--font-sans); }
  .etiquette {
    font-family: var(--font-sans); font-size: 9px; letter-spacing: 0.04em; color: var(--text-secondary);
    margin-bottom: 6px; padding-left: 8px; border-left: 2px solid color-mix(in srgb, var(--brand-teal) 25%, transparent);
  }
  .bouton {
    --teinte: var(--brand-teal);
    font-family: var(--font-sans); font-size: 9px; letter-spacing: 0.02em; padding: 5px 10px;
    background: none; border: 0.5px solid var(--border-default); color: var(--text-secondary); border-radius: 2px; cursor: pointer;
    transition: background-color 200ms var(--ease-out), border-color 200ms var(--ease-out), color 200ms var(--ease-out), opacity 200ms var(--ease-out);
  }
  .bouton.actif { background: color-mix(in srgb, var(--teinte) 12%, transparent); border-color: var(--teinte); color: var(--teinte); }
  .bouton.teinte { border-color: var(--teinte); color: var(--teinte); }
  .bouton:disabled { cursor: not-allowed; opacity: 0.45; }
  .tuile { background: var(--bg-level-2); border: 0.5px solid var(--border-default); border-radius: 2px; }
  .pastille { display: inline-block; flex-shrink: 0; border-radius: 1px; }
  .compte { padding: 1px 5px; border-radius: 1px; background: color-mix(in srgb, var(--teinte) 13%, transparent); color: var(--teinte); }
  .barre { height: 2px; background: var(--border-default); border-radius: 1px; position: relative; }
  @media (prefers-reduced-motion: reduce) { * { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; } }
`;
