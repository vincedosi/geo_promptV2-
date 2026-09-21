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
import { formaterNombre, formaterDecimal } from '@/lib/format/nombre';
import { Kpi } from '@/components/risques/Kpi';
import { partsDeNature } from '@/lib/risques/palette-natures';
import type { CompteSites } from '@/components/risques/use-sites-compte';

interface Props {
  compte: CompteSites | null;
  chargement: boolean;
  /** Le territoire regardé, pour dire à quoi le total se rapporte. */
  libelleTerritoire: string;
}

export function PanneauSites({ compte, chargement, libelleTerritoire }: Props) {
  /*
   * L'ordre, le regroupement de la queue et les teintes vivent dans
   * `lib/risques/palette-natures.ts` — la même source que les courbes du
   * panneau ②, pour qu'une nature garde sa couleur d'un panneau à l'autre.
   */
  const parts = partsDeNature(compte?.par_nature ?? {});
  const totalNatures = parts.reduce((t, p) => t + p.n, 0);

  /*
   * ⚠ L'écart entre la somme des natures et le compte de sites retenus.
   *
   * Il doit valoir ZÉRO : chaque site compte sous sa nature dominante, donc
   * une et une seule fois. Mesuré le 2026-09-21 : 1 259 = 1 259. On ne le
   * suppose pas pour autant — si la RPC changeait de règle, une barre
   * silencieusement plus courte que son total serait indétectable à l'œil.
   */
  const ecart = compte ? compte.retenus - totalNatures : 0;

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

      {parts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)' }}>
            De quoi ces sites menacent
          </span>

          {/*
            ── LA BARRE EMPILÉE ──────────────────────────────────────────
            Une seule barre, segmentée par nature. Elle remplace une barre par
            nature, proportionnelle à la plus grande : celle-ci montrait
            l'ordre des natures, jamais leur POIDS RELATIF dans le parc. On lit
            désormais « la toxicité aiguë, c'est 40 % du parc » d'un coup
            d'œil.

            ⚠ Les largeurs se calculent sur les EFFECTIFS et non sur les parts
            arrondies : sept arrondis à une décimale ne totalisent pas 100, et
            la barre finirait par un trou ou un débordement de quelques
            dixièmes.
          */}
          <div
            role="img"
            aria-label={`Répartition des ${formaterNombre(totalNatures)} sites par nature de risque`}
            style={{
              display: 'flex', width: '100%', height: 10,
              borderRadius: 3, overflow: 'hidden',
              background: 'var(--border-subtle)',
            }}
          >
            {parts.map((p) => (
              <span
                key={p.libelle}
                title={`${p.libelle} — ${formaterNombre(p.n)} sites (${formaterDecimal(p.pct)} %)`}
                style={{
                  width: `${(p.n / totalNatures) * 100}%`,
                  background: p.teinte,
                  /* Un filet entre segments : deux teintes voisines de
                     luminosité proche se lisent sinon comme une seule. */
                  borderRight: '0.5px solid var(--bg-level-1)',
                }}
              />
            ))}
          </div>

          {/* La légende EST la liste des effectifs : deux blocs séparés
              obligeraient à faire l'aller-retour couleur → nom → chiffre. */}
          {parts.map((p) => (
            <div key={p.libelle} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                aria-hidden
                style={{
                  width: 9, height: 9, borderRadius: 2, flexShrink: 0,
                  background: p.teinte,
                }}
              />
              <span
                style={{
                  fontFamily: fInter, fontSize: 11.5,
                  color: p.regroupee ? 'var(--text-tertiary)' : 'var(--text-secondary)',
                  flex: 1, minWidth: 0,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
                title={p.libelle}
              >
                {p.libelle}
              </span>
              <span
                style={{
                  fontFamily: fMono, fontSize: 10.5, color: 'var(--text-tertiary)',
                  minWidth: 38, textAlign: 'right',
                }}
              >
                {formaterDecimal(p.pct)} %
              </span>
              <span
                style={{
                  fontFamily: fMono, fontSize: 11, color: 'var(--text-primary)',
                  minWidth: 46, textAlign: 'right',
                }}
              >
                {formaterNombre(p.n)}
              </span>
            </div>
          ))}

          {/*
            L'écart doit valoir zéro : chaque site compte sous sa nature
            dominante, donc une seule fois. S'il ne vaut pas zéro, le dire —
            une barre plus courte que son total ne se voit pas à l'œil.
          */}
          {ecart !== 0 && (
            <p style={{ ...styleNote, color: 'var(--warning)' }}>
              ⚠ {formaterNombre(Math.abs(ecart))} site{Math.abs(ecart) > 1 ? 's' : ''}
              {ecart > 0 ? ' ne sont rattachés à aucune nature' : ' sont comptés deux fois'} :
              la barre ne couvre pas exactement le total retenu.
            </p>
          )}

          <p style={styleNote}>
            ⚠ Un site porte souvent plusieurs natures de risque ; celle comptée
            ici est sa nature <strong>dominante</strong>, déduite du rang de sa
            rubrique ICPE. Les segments s’additionnent donc bien au total des
            sites retenus, mais ils ne disent pas tout de chaque site.
            {parts.some((p) => p.regroupee) && (
              <> Les natures les moins nombreuses sont regroupées : au-delà de
              huit teintes, deux natures se ressembleraient.</>
            )}
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
