'use client';

/**
 * ① Sites — ce que les filtres retiennent, et de quoi ces sites menacent.
 *
 * ── POURQUOI LA PREMIÈRE ÉTAPE ────────────────────────────────────────────
 *
 * Régler un rayon avant de savoir autour de QUOI revient à répondre avant
 * d'avoir la question. L'écran ouvrait pourtant sur les rayons jusqu'au
 * 2026-09-21, et le choix des régimes était une rangée de pastilles parmi
 * d'autres dans la barre.
 *
 * ── LES RÉGIMES RESTENT DANS LA BARRE, ET CE N'EST PAS UN OUBLI ───────────
 *
 * Ils y valent pour les quatre étapes — la barre est commune. Les recopier
 * ici donnerait deux commandes pour un seul réglage : celle qu'on change et
 * celle qu'on croit avoir changée. Ce panneau MONTRE ce que le filtre retient ;
 * il ne le repose pas.
 *
 * ── CE QUI MANQUE ENCORE, ET POURQUOI ─────────────────────────────────────
 *
 * Le brief demande aussi le décompte PAR NIVEAU et la part des sites couverts
 * par un périmètre PPRT publié. Ni l'un ni l'autre n'est servi aujourd'hui :
 * `compter_sites_rayon` groupe par nature, pas par gravité, et un décompte par
 * niveau coûterait un appel par niveau. C'est un ajout à `compter_sites_rayon`,
 * pas un calcul à refaire ici — et il vient avec le reste du panneau, à la
 * phase 4 du brief.
 */
import React from 'react';
import { fInter, fMono } from '@/lib/design/polices';
import { formaterNombre } from '@/lib/format/nombre';
import { Kpi } from '@/components/risques/Kpi';
import type { CompteSites } from '@/components/risques/use-sites-compte';

interface Props {
  compte: CompteSites | null;
  chargement: boolean;
  /** Le territoire regardé, pour dire à quoi le total se rapporte. */
  libelleTerritoire: string;
}

export function PanneauSites({ compte, chargement, libelleTerritoire }: Props) {
  /*
   * Triées par effectif décroissant : la nature dominante du parc est la
   * première chose à voir. L'ordre alphabétique ferait remonter « Autres
   * dangers » en tête d'une liste qui sert justement à repérer le risque
   * majoritaire.
   */
  const natures = Object.entries(compte?.par_nature ?? {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);

  const plusGrande = natures.length > 0 ? natures[0][1] : 0;

  if (chargement) {
    return <p style={styleNote}>Comptage des sites…</p>;
  }

  if (!compte) {
    return (
      <p style={{ ...styleNote, color: 'var(--warning)' }}>
        Le comptage des sites n’a pas abouti. Les autres étapes restent
        utilisables : ce panneau ne conditionne aucun calcul.
      </p>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Kpi
        valeur={`${formaterNombre(compte.retenus)} / ${formaterNombre(compte.total)}`}
        libelle="sites retenus"
        note={`sur ${libelleTerritoire} — le total porte le même territoire`}
        accent
        taille={22}
      />

      {/*
        « 421 sur 1 259 » se lit « les filtres écartent les deux tiers ». Sans
        le dénominateur, un chiffre seul ne dit pas qu'un filtre est resté coché.
      */}
      {compte.retenus === 0 && (
        <p style={{ ...styleNote, color: 'var(--warning)' }}>
          Aucun site ne passe les filtres. Tout l’écran sera vide — ce n’est pas
          une absence de population exposée, c’est une absence de site à exposer.
        </p>
      )}

      {natures.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)' }}>
            De quoi ces sites menacent
          </span>
          {natures.map(([nature, n]) => (
            <div key={nature} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  fontFamily: fInter, fontSize: 11.5, color: 'var(--text-secondary)',
                  flex: 1, minWidth: 0,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
                title={nature}
              >
                {nature}
              </span>
              {/*
                Barre proportionnelle à la PLUS GRANDE nature et non au total :
                un parc dominé à 80 % par une nature écraserait toutes les
                autres à un pixel, et on ne lirait plus leur ordre.
              */}
              <span
                aria-hidden
                style={{
                  width: 54, height: 4, borderRadius: 2,
                  background: 'var(--border-subtle)', overflow: 'hidden',
                }}
              >
                <span
                  style={{
                    display: 'block', height: '100%',
                    width: `${plusGrande > 0 ? (n / plusGrande) * 100 : 0}%`,
                    background: 'var(--brand-teal)',
                  }}
                />
              </span>
              <span
                style={{
                  fontFamily: fMono, fontSize: 11, color: 'var(--text-primary)',
                  minWidth: 46, textAlign: 'right',
                }}
              >
                {formaterNombre(n)}
              </span>
            </div>
          ))}
          <p style={styleNote}>
            ⚠ Un site porte souvent plusieurs natures de risque ; celle comptée
            ici est sa nature <strong>dominante</strong>, déduite du rang de sa
            rubrique ICPE. Les lignes s’additionnent donc bien au total des
            sites retenus, mais elles ne disent pas tout de chaque site.
          </p>
        </div>
      )}
    </div>
  );
}

const styleNote: React.CSSProperties = {
  margin: 0,
  fontFamily: fInter,
  fontSize: 11,
  lineHeight: 1.55,
  color: 'var(--text-tertiary)',
};
