'use client';

import { ENTREES_NAVIGATION } from '@/lib/navigation/config';
import { COLORS, FONTS } from './_shared/styles';

/** 'ctrl+k' -> 'Ctrl + K', 'alt+1' -> 'Alt + 1'. */
function formaterRaccourci(raccourci: string): string {
  return raccourci
    .split('+')
    .map(partie => partie.charAt(0).toUpperCase() + partie.slice(1))
    .join(' + ');
}

/**
 * Panneau « Aide » : liste des raccourcis clavier du rail, DERIVES de
 * `ENTREES_NAVIGATION` — jamais une liste recopiée à la main (sinon un
 * raccourci ajouté à la Tâche 1 ne serait jamais documenté ici).
 */
export function HelpOverlay() {
  const entreesAvecRaccourci = ENTREES_NAVIGATION.filter(e => e.raccourci);

  return (
    <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 4, fontFamily: FONTS.inter }}>
      <h4 style={{
        fontSize: 11, fontWeight: 500, color: COLORS.textDim,
        letterSpacing: '0.04em', marginTop: 0, marginBottom: 8,
      }}>
        Raccourcis clavier
      </h4>
      {entreesAvecRaccourci.map(entree => (
        <div
          key={entree.id}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '8px 6px', borderBottom: `0.5px solid ${COLORS.border}`,
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: COLORS.text, fontSize: 12 }}>
            <entree.icone size={14} strokeWidth={1.5} />
            {entree.label}
          </span>
          <span style={{
            fontFamily: FONTS.mono, fontSize: 11, color: COLORS.textDim,
            background: COLORS.bgLevel2, border: `0.5px solid ${COLORS.borderDefault}`,
            borderRadius: 4, padding: '2px 8px',
          }}>
            {formaterRaccourci(entree.raccourci as string)}
          </span>
        </div>
      ))}
    </div>
  );
}
