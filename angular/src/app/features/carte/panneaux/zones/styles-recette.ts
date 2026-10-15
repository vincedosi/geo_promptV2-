/**
 * Les styles communs aux formulaires de recette de ③ et à leur pied (lot 3, T10) — sur le modèle de
 * `panneaux/analyse/styles-analyse.ts`. Jetons seulement (DESIGN_SYSTEM § 5) : champs `--bg-level-2` bordés 0,5 px,
 * focus teal à 50 %, CTA teal (« Aperçu », « Enregistrer la zone »), bouton neutre, encarts d'erreur et de réussite
 * aux taux de `outil-creation.component.ts` (danger 8 / 25 %, success 8 / 20 %).
 */
export const STYLES_RECETTE = `
  .titre-recette { margin: 0; font-size: 12px; font-weight: 500; color: var(--text-primary); }
  .libelle { font-size: 11px; color: var(--text-tertiary); }
  .champ { background: var(--bg-level-2); border: 0.5px solid var(--border-subtle); border-radius: 6px; padding: 6px 10px;
    font-size: 12px; color: var(--text-primary); }
  .champ:focus { outline: none; border-color: var(--brand-teal-50); }
  .garde { margin: 0; font-size: 11px; line-height: 1.5; color: var(--text-tertiary); }
  .cta-teal { background: transparent; border: 0.5px solid var(--brand-teal); color: var(--brand-teal); border-radius: 6px;
    padding: 8px 16px; font-size: 12px; font-weight: 500; cursor: pointer; }
  .cta-teal:hover:not(:disabled) { background: var(--brand-teal-10); }
  .cta-teal:disabled { border-color: var(--border-default); color: var(--text-tertiary); cursor: not-allowed; opacity: 0.5; }
  .neutre { background: transparent; border: 0.5px solid var(--border-default); color: var(--text-secondary); border-radius: 6px;
    padding: 6px 12px; font-size: 12px; cursor: pointer; }
  .neutre:hover:not(:disabled) { border-color: var(--border-hover); background: var(--bg-level-2); color: var(--text-primary); }
  .neutre:disabled { cursor: not-allowed; opacity: 0.4; }
  .erreur { border-radius: 4px; padding: 7px 9px; font-size: 11px; line-height: 1.5; color: var(--danger);
    background: color-mix(in srgb, var(--danger) 8%, transparent); border: 0.5px solid color-mix(in srgb, var(--danger) 25%, transparent); }
  .succes { border-radius: 4px; padding: 7px 9px; font-size: 11px; line-height: 1.5; color: var(--success);
    background: color-mix(in srgb, var(--success) 8%, transparent); border: 0.5px solid color-mix(in srgb, var(--success) 20%, transparent); }
`;
