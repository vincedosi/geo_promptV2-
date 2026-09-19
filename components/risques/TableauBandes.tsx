'use client';

/**
 * Le tableau des bandes : population dans chaque bande, et cumulée.
 *
 * ── CE QU'IL PERMET ENFIN ─────────────────────────────────────────────────
 *
 * D'additionner. Les deux nombres affichés jusqu'ici — population près d'un
 * seuil haut, population près d'un seuil bas — étaient exacts séparément et ne
 * devaient pas être sommés : 317 367 carreaux sur 883 451 sont à portée des
 * deux. Mesuré le 2026-09-19, l'écran annonçait ainsi **537 919 habitants de
 * plus qu'il n'y en a**, soit 3,8 %.
 *
 * Chaque carreau portant désormais UNE classe, le cumul est une simple somme
 * des bandes au-dessus. C'est pour cela que la colonne « cumulée » peut
 * exister : elle n'existait pas avant, faute de sens.
 */
import React from 'react';
import { formaterNombre } from '@/lib/format/nombre';
import { fInter, fMono } from '@/lib/design/polices';
import {
  anneauxDuNiveau, LIBELLE_NIVEAU, NIVEAUX, libelleRayon,
  type Niveau, type ProfilRayons,
} from '@/lib/risques/profil';

interface Props {
  profil: ProfilRayons;
  parClasse: Record<string, number>;
  horsZone: number;
  total: number;
  libelleCible: string;
}

/** Une ligne du tableau : son libellé, sa population, et son cumul. */
interface Ligne {
  cle: string;
  libelle: string;
  /** L'étendue de la bande, en clair. Vide pour un périmètre publié. */
  etendue: string;
  pop: number;
  cumul: number;
  /** Une servitude de l'État, par opposition à un rayon que nous avons choisi. */
  publie: boolean;
}

/**
 * Construit les lignes d'un niveau, dans l'ordre du cœur vers l'extérieur.
 *
 * Le cumul se calcule ICI, par addition des bandes précédentes — jamais servi
 * par le serveur. Deux raisons : la somme est exacte par construction (l'arrondi
 * a eu lieu au grain le plus fin, côté base), et un cumul transporté pourrait
 * dériver de ses composantes sans qu'on le voie.
 */
function lignesDuNiveau(
  profil: ProfilRayons,
  niveau: Niveau,
  parClasse: Record<string, number>,
): Ligne[] {
  const anneaux = anneauxDuNiveau(profil, niveau);
  if (anneaux.length === 0) return [];

  const lignes: Ligne[] = [];
  let cumul = 0;

  if (profil.inclurePPRT) {
    const pop = parClasse[`${niveau}:pprt`] ?? 0;
    cumul += pop;
    lignes.push({
      cle: `${niveau}:pprt`,
      libelle: 'Périmètre PPRT',
      etendue: 'servitude publiée',
      pop, cumul, publie: true,
    });
  }

  anneaux.forEach((r, i) => {
    const pop = parClasse[`${niveau}:${i + 1}`] ?? 0;
    cumul += pop;
    const debut = i === 0 ? '0' : libelleRayon(anneaux[i - 1]);
    lignes.push({
      cle: `${niveau}:${i + 1}`,
      libelle: `Bande ${i + 1}`,
      etendue: `${debut} à ${libelleRayon(r)}`,
      pop, cumul, publie: false,
    });
  });

  return lignes;
}

export function TableauBandes({ profil, parClasse, horsZone, total, libelleCible }: Props) {
  const niveaux = NIVEAUX
    .map((n) => ({ niveau: n, lignes: lignesDuNiveau(profil, n, parClasse) }))
    .filter(({ lignes }) => lignes.length > 0);

  if (niveaux.length === 0) {
    return (
      <p style={{ fontFamily: fInter, fontSize: 12, color: 'var(--warning)' }}>
        Aucun anneau n’est réglé : aucune population n’est classée. Ajoutez un anneau
        à un niveau pour voir apparaître des bandes.
      </p>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {niveaux.map(({ niveau, lignes }) => {
        const totalNiveau = lignes[lignes.length - 1].cumul;
        return (
          <div key={niveau}>
            <div
              style={{
                display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6,
              }}
            >
              <span style={{ fontFamily: fInter, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
                {LIBELLE_NIVEAU[niveau]}
              </span>
              <span style={{ fontFamily: fMono, fontSize: 11, color: 'var(--text-tertiary)' }}>
                {formaterNombre(totalNiveau)}
              </span>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <Th>Bande</Th>
                  <Th>Étendue</Th>
                  <Th align="right">{libelleCible}</Th>
                  <Th align="right">Cumulée</Th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((l) => (
                  <tr key={l.cle}>
                    <Td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        {/*
                          Le tiret indique une zone CALCULÉE, le trait plein une
                          servitude publiée par l'État. Même convention que sur
                          la carte (`lib/carte/nature-zone.ts`) : le même signe
                          doit vouloir dire la même chose partout.
                        */}
                        <span
                          aria-hidden
                          style={{
                            width: 12, height: 0,
                            borderTop: l.publie
                              ? '2px solid var(--text-secondary)'
                              : '2px dashed var(--text-tertiary)',
                          }}
                        />
                        {l.libelle}
                      </span>
                    </Td>
                    <Td muted>{l.etendue}</Td>
                    <Td align="right" mono>{formaterNombre(l.pop)}</Td>
                    <Td align="right" mono muted>{formaterNombre(l.cumul)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      <div
        style={{
          borderTop: '0.5px solid var(--border-subtle)', paddingTop: 10,
          display: 'flex', flexDirection: 'column', gap: 4,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ fontFamily: fInter, fontSize: 12, color: 'var(--text-primary)' }}>
            Total, tous niveaux
          </span>
          <span style={{ fontFamily: fMono, fontSize: 12, color: 'var(--text-primary)' }}>
            {formaterNombre(total)}
          </span>
        </div>
        <p style={{ fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)', margin: 0, lineHeight: 1.5 }}>
          Chaque carreau ne compte qu’une fois : le seuil haut l’emporte sur le seuil bas.
          La somme des bandes égale donc ce total, exactement.
        </p>
        {horsZone > 0 && (
          <p style={{ fontFamily: fInter, fontSize: 11, color: 'var(--text-tertiary)', margin: '4px 0 0', lineHeight: 1.5 }}>
            <span style={{ fontFamily: fMono }}>{formaterNombre(horsZone)}</span> habitants vivent
            à moins de 10 km d’un site sans être retenus par ces anneaux. Élargir un rayon les
            fera entrer. Ce n’est pas la population non exposée de France : le calcul ne porte
            que sur le voisinage des sites.
          </p>
        )}
      </div>
    </div>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      style={{
        textAlign: align, padding: '4px 8px 6px',
        borderBottom: '0.5px solid var(--border-subtle)',
        fontFamily: fInter, fontSize: 11, fontWeight: 400, color: 'var(--text-tertiary)',
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children, align = 'left', mono = false, muted = false,
}: {
  children: React.ReactNode; align?: 'left' | 'right'; mono?: boolean; muted?: boolean;
}) {
  return (
    <td
      style={{
        textAlign: align, padding: '5px 8px',
        borderBottom: '0.5px solid var(--border-subtle)',
        fontFamily: mono ? fMono : fInter, fontSize: 12,
        color: muted ? 'var(--text-tertiary)' : 'var(--text-secondary)',
      }}
    >
      {children}
    </td>
  );
}
