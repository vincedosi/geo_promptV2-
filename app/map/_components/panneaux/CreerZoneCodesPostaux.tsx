'use client';

/**
 * @file CreerZoneCodesPostaux — créer une zone depuis une liste de codes
 * postaux (Tâche 16, 2026-09-13).
 *
 * Deux gestes pour la même chose : coller une liste, ou déposer un fichier.
 * C'est ainsi qu'elle arrive en vrai — dans un mail, un tableur, un CSV client.
 *
 * **L'aperçu est calculé AVANT l'appel, côté client**, par le même parseur que
 * la route (`lib/custom-geo/parse-cp.ts`). L'utilisateur voit donc combien de
 * codes sont reconnus et combien sont rejetés pendant qu'il tape, sans aucune
 * requête — et il corrige avant de créer, pas après.
 *
 * La route distingue ensuite une SECONDE famille de perte, que le client ne
 * peut pas connaître : les codes bien formés mais absents du référentiel
 * (Cedex, code périmé, CP étranger). Les deux sont affichées séparément,
 * parce qu'elles ne se corrigent pas de la même façon.
 */
import { useMemo, useRef, useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';
import { useSession } from '@/lib/auth-client';
import { parserCodesPostaux } from '@/lib/custom-geo/parse-cp';
import { formaterNombre } from '@/lib/format/nombre';

const fInter = "'Inter', system-ui, sans-serif";
const fMono = "'JetBrains Mono', monospace";

/** Même plafond que la route — annoncé ici pour éviter un aller-retour perdu. */
const MAX_CP = 2000;

export interface CreerZoneCodesPostauxProps {
  /** Recharge « Mes zones » après création. */
  onCree?: () => void;
}

export function CreerZoneCodesPostaux({ onCree }: CreerZoneCodesPostauxProps) {
  const { session } = useSession();
  const orgId = session?.user?.organizationId ?? '';

  const [ouvert, setOuvert] = useState(false);
  const [saisie, setSaisie] = useState('');
  const [nom, setNom] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const inputFichier = useRef<HTMLInputElement | null>(null);

  // Aperçu local, sans requête : même parseur que la route.
  const apercu = useMemo(() => parserCodesPostaux(saisie), [saisie]);

  const lireFichier = async (fichier: File) => {
    setErreur(null);
    try {
      setSaisie(await fichier.text());
      if (!nom) setNom(`Codes postaux — ${fichier.name.replace(/\.[^.]+$/, '')}`);
    } catch {
      setErreur('Fichier illisible.');
    }
  };

  const creer = async () => {
    if (enCours || !apercu.codes.length || !orgId) return;
    setEnCours(true);
    setErreur(null);
    setMessage(null);
    try {
      const geoRes = await adminFetch('/api/custom-geo/source/codes-postaux', {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ saisie }),
      });
      const geo = await geoRes.json();
      if (!geoRes.ok) throw new Error(geo.error ?? `Erreur ${geoRes.status}`);

      const saveRes = await adminFetch('/api/custom-geo/save', {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: (nom || `Liste de ${geo.n_codes} codes postaux`).slice(0, 200),
          source_type: 'codes_postaux',
          source_metadata: {
            n_codes_postaux: geo.n_codes,
            n_inconnus: geo.n_inconnus,
            n_rejetes: geo.n_rejetes,
          },
          geometry: geo.geometry,
          org_id: orgId,
        }),
      });
      if (!saveRes.ok) throw new Error('Sauvegarde de la zone échouée.');
      const sauve = await saveRes.json();

      // Les pertes sont dites APRÈS création aussi : c'est le moment où le
      // chiffre compte, parce que c'est celui qu'on reportera au client.
      const pertes: string[] = [];
      if (geo.n_inconnus) pertes.push(`${formaterNombre(geo.n_inconnus)} inconnu${geo.n_inconnus > 1 ? 's' : ''} du référentiel`);
      if (geo.n_rejetes) pertes.push(`${formaterNombre(geo.n_rejetes)} rejeté${geo.n_rejetes > 1 ? 's' : ''}`);
      setMessage(
        `Zone créée : ${formaterNombre(sauve.count_cp ?? geo.n_codes)} codes postaux`
        + (pertes.length ? ` · ${pertes.join(', ')}` : ''),
      );
      setSaisie('');
      setNom('');
      onCree?.();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setEnCours(false);
    }
  };

  const tropDeCodes = apercu.codes.length > MAX_CP;
  const inactif = enCours || !apercu.codes.length || tropDeCodes || !orgId;

  return (
    <div style={{ marginTop: 8 }}>
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        style={{
          width: '100%', background: 'transparent', border: '0.5px solid var(--border-default)',
          color: 'var(--text-secondary)', borderRadius: 6, padding: '8px 16px',
          fontFamily: fInter, fontSize: 12, cursor: 'pointer', textAlign: 'left',
        }}
      >
        Importer une liste de codes postaux {ouvert ? '▲' : '▼'}
      </button>

      {ouvert && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
            placeholder={'Collez vos codes postaux\n75001, 75002 ; 69001…'}
            rows={4}
            style={{
              width: '100%', background: 'var(--bg-level-2)', border: '0.5px solid var(--border-subtle)',
              borderRadius: 6, padding: '8px 10px', fontFamily: fMono, fontSize: 11,
              color: 'var(--text-primary)', resize: 'vertical',
            }}
          />

          <div style={{ display: 'flex', gap: 6 }}>
            <input
              ref={inputFichier}
              type="file"
              accept=".txt,.csv,text/plain,text/csv"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void lireFichier(f); }}
              style={{ display: 'none' }}
            />
            <button
              type="button"
              onClick={() => inputFichier.current?.click()}
              style={{
                flex: 1, background: 'transparent', border: '0.5px solid var(--border-default)',
                color: 'var(--text-secondary)', borderRadius: 6, padding: '6px 10px',
                fontFamily: fInter, fontSize: 11, cursor: 'pointer',
              }}
            >Déposer un fichier</button>
          </div>

          {/* L'aperçu se met à jour À LA FRAPPE, sans requête. */}
          {(apercu.codes.length > 0 || apercu.nRejetes > 0) && (
            <div style={{ fontFamily: fMono, fontSize: 10, color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
              <span style={{ color: tropDeCodes ? 'var(--danger)' : 'var(--brand-teal)' }}>
                {formaterNombre(apercu.codes.length)} code{apercu.codes.length > 1 ? 's' : ''} reconnu{apercu.codes.length > 1 ? 's' : ''}
              </span>
              {apercu.nRejetes > 0 && (
                <>
                  {' · '}
                  <span style={{ color: 'var(--warning)' }}>
                    {formaterNombre(apercu.nRejetes)} rejeté{apercu.nRejetes > 1 ? 's' : ''}
                  </span>
                  <br />
                  <span style={{ color: 'var(--text-tertiary)' }}>
                    {apercu.rejetes.slice(0, 8).join(', ')}
                    {apercu.nRejetes > 8 && '…'}
                  </span>
                </>
              )}
              {tropDeCodes && (
                <>
                  <br />
                  <span style={{ color: 'var(--danger)' }}>
                    Maximum {formaterNombre(MAX_CP)} par import.
                  </span>
                </>
              )}
            </div>
          )}

          <input
            type="text"
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            placeholder="Nom de la zone"
            style={{
              width: '100%', background: 'var(--bg-level-2)', border: '0.5px solid var(--border-subtle)',
              borderRadius: 6, padding: '7px 10px', fontFamily: fInter, fontSize: 12,
              color: 'var(--text-primary)',
            }}
          />

          <button
            type="button"
            onClick={creer}
            disabled={inactif}
            style={{
              width: '100%', background: 'transparent', border: '0.5px solid var(--brand-teal)',
              color: 'var(--brand-teal)', borderRadius: 6, padding: '8px 16px',
              fontFamily: fInter, fontSize: 12, fontWeight: 500,
              cursor: inactif ? 'not-allowed' : 'pointer', opacity: inactif ? 0.4 : 1,
            }}
          >
            {enCours ? 'Création…' : 'Créer la zone'}
          </button>

          {erreur && (
            <div style={{
              padding: '7px 9px', borderRadius: 4, background: 'rgba(255,87,87,0.08)',
              border: '0.5px solid rgba(255,87,87,0.25)', color: 'var(--danger)',
              fontFamily: fInter, fontSize: 11, lineHeight: 1.5,
            }}>{erreur}</div>
          )}
          {message && (
            <div style={{
              padding: '7px 9px', borderRadius: 4, background: 'rgba(61,255,160,0.08)',
              border: '0.5px solid rgba(61,255,160,0.2)', color: 'var(--success)',
              fontFamily: fInter, fontSize: 11, lineHeight: 1.5,
            }}>{message}</div>
          )}
        </div>
      )}
    </div>
  );
}
