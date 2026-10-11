/**
 * Les styles communs aux étapes de l'assistant — les objets `style={{…}}` que `ClusteringWizard.tsx` répétait à chaque
 * bouton, case et intertitre. Une feuille ici, ajoutée aux `styles` de chaque composant (styles encapsulés).
 *
 * Écarts assumés, listés au rapport de T20 : bords 0,5 px (DESIGN_SYSTEM § 7.8, React : 1 px) ; `#f59e0b` → `--warning`,
 * `#f87171` → `--danger` ; les fonds `rgba(…, 0.08)` et bords `…44` deviennent des `color-mix` du MÊME jeton (React
 * mélangeait des `var()` et des hexadécimaux recopiés) ; le curseur blanc des interrupteurs (`#fff`) → `--text-primary`,
 * lisible sur le teal comme sur la bordure dans les deux thèmes.
 *
 * La teinte d'un élément passe par `--teinte` (une thématique de variables : `var(--nature-*)`).
 */
export const STYLES_ASSISTANT = `
  .mono { font-family: var(--font-mono); }
  .inter { font-family: var(--font-sans); }
  .intertitre {
    font-family: var(--font-sans); font-size: 10px; letter-spacing: 0.5px; color: var(--text-secondary);
    padding-left: 8px; border-left: 2px solid color-mix(in srgb, var(--brand-teal) 25%, transparent);
  }
  .choix {
    display: flex; align-items: center; justify-content: space-between; border-radius: 2px; cursor: pointer;
    background: var(--bg-level-2); border: 0.5px solid var(--border-default);
    transition: background-color 200ms var(--ease-out), border-color 200ms var(--ease-out), color 200ms var(--ease-out);
  }
  .choix.actif { background: color-mix(in srgb, var(--brand-teal) 10%, transparent); border-color: var(--brand-teal); }
  .case { flex-shrink: 0; border-radius: 1px; border: 0.5px solid var(--text-secondary); background: transparent; }
  .actif > div > .case, .case.actif { border-color: var(--brand-teal); background: var(--brand-teal); }
  .pastille-bouton {
    border-radius: 2px; cursor: pointer; background: transparent; border: 0.5px solid var(--border-default); color: var(--text-secondary);
    transition: background-color 200ms var(--ease-out), border-color 200ms var(--ease-out), color 200ms var(--ease-out);
  }
  .pastille-bouton.actif { background: color-mix(in srgb, var(--brand-teal) 10%, transparent); border-color: var(--brand-teal); color: var(--brand-teal); }
  .interrupteur { position: relative; flex-shrink: 0; border-radius: 2px; cursor: pointer; border: 0; padding: 0; background: var(--border-default);
    transition: background-color 180ms var(--ease-out); }
  .interrupteur > span { position: absolute; border-radius: 1px; background: var(--text-primary); transition: left 220ms cubic-bezier(0.32, 0.72, 0, 1); }
  .encart { border-radius: 2px; font-size: 10px; line-height: 1.5; }
  .encart.alerte { background: color-mix(in srgb, var(--warning) 8%, transparent); border: 0.5px solid color-mix(in srgb, var(--warning) 27%, transparent); color: var(--warning); }
  .encart.erreur { background: color-mix(in srgb, var(--danger) 7%, transparent); border: 0.5px solid color-mix(in srgb, var(--danger) 27%, transparent); color: var(--danger); }
  .encart.succes { background: color-mix(in srgb, var(--success) 8%, transparent); border: 0.5px solid color-mix(in srgb, var(--success) 27%, transparent); color: var(--success); }
  .tuile { background: var(--bg-level-2); border: 0.5px solid var(--border-default); border-radius: 2px; }
  @media (prefers-reduced-motion: reduce) { * { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; } }
`;
