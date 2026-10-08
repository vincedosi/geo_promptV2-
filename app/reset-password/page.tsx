'use client';

/**
 * /reset-password — definition du mot de passe.
 *
 * Point d'atterrissage des liens generes par l'admin (`generateLink`, type
 * `recovery`) : creation d'un compte dans /admin/users, ou reinitialisation
 * depuis la page d'une organisation.
 *
 * Le lien porte une session temporaire — en fragment (`#access_token=…`) ou en
 * code PKCE (`?code=…`) selon le flux. Elle est consommee EXPLICITEMENT ici, et
 * jamais lue depuis la session ambiante : voir le commentaire du `useEffect`,
 * qui documente le piege d'identite verifie en test.
 *
 * Sans jeton dans l'URL, la page repond « lien invalide » meme si l'utilisateur
 * a une session valide — ce formulaire n'est pas un ecran de changement de mot
 * de passe accessible par navigation.
 *
 * Sans systeme d'email, c'est le SEUL chemin par lequel un compte cree devient
 * utilisable : `admin.createUser()` n'envoie rien et ne pose pas de mot de
 * passe. Voir ARCHITECTURE.md § « Creation de compte ».
 */

import { useState, useEffect } from 'react';
import { Eye, EyeOff, AlertCircle, CheckCircle2 } from 'lucide-react';
import { getSupabaseBrowser } from '@/lib/auth-client';
import { LogoDentsu } from '@/components/ui/LogoDentsu';

const fInter = "'Inter', system-ui, sans-serif";

type Etat = 'verification' | 'pret' | 'lien_invalide' | 'termine';

export default function ResetPasswordPage() {
  const [etat, setEtat]         = useState<Etat>('verification');
  const [email, setEmail]       = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [voir, setVoir]         = useState(false);
  const [erreur, setErreur]     = useState('');
  const [envoi, setEnvoi]       = useState(false);

  // Le jeton du lien est consomme EXPLICITEMENT, jamais par session ambiante.
  //
  // Piege verifie en test : un admin deja connecte qui ouvre le lien voyait sa
  // PROPRE session (getSession lit le cookie en premier, et le fragment restait
  // intact dans l'URL). Il aurait change son propre mot de passe en croyant
  // agir sur le compte cible. On force donc `setSession` avec les jetons de
  // l'URL, ce qui fait autorite sur toute session preexistante.
  useEffect(() => {
    const supabase = getSupabaseBrowser();
    let vivant = true;

    (async () => {
      const frag = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const access_token  = frag.get('access_token');
      const refresh_token = frag.get('refresh_token');

      if (access_token && refresh_token) {
        const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
        if (!vivant) return;
        // Le fragment porte une session : on le retire de la barre d'adresse.
        window.history.replaceState(null, '', window.location.pathname);
        if (error || !data.session?.user) { setEtat('lien_invalide'); return; }
        setEmail(data.session.user.email ?? null);
        setEtat('pret');
        return;
      }

      // Flux PKCE : le lien porte `?code=` que le SDK echange lui-meme.
      const code = new URLSearchParams(window.location.search).get('code');
      if (code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        if (!vivant) return;
        window.history.replaceState(null, '', window.location.pathname);
        if (error || !data.session?.user) { setEtat('lien_invalide'); return; }
        setEmail(data.session.user.email ?? null);
        setEtat('pret');
        return;
      }

      // Ni fragment ni code : page ouverte sans lien. Une session existante ne
      // suffit PAS a autoriser un changement de mot de passe ici — sinon
      // n'importe quel utilisateur connecte tomberait sur ce formulaire par
      // simple navigation.
      if (vivant) setEtat('lien_invalide');
    })();

    return () => { vivant = false; };
  }, []);

  const soumettre = async (e: React.FormEvent) => {
    e.preventDefault();
    setErreur('');

    if (password.length < 8) { setErreur('Le mot de passe doit faire au moins 8 caractères.'); return; }
    if (password !== confirm) { setErreur('Les deux mots de passe ne correspondent pas.'); return; }

    setEnvoi(true);
    const { error } = await getSupabaseBrowser().auth.updateUser({ password });
    setEnvoi(false);

    if (error) { setErreur(error.message); return; }
    setEtat('termine');
    setTimeout(() => { window.location.href = '/map'; }, 1800);
  };

  const champ: React.CSSProperties = {
    width: '100%', background: 'var(--bg-level-2)',
    border: '0.5px solid var(--border-subtle)', borderRadius: 6,
    padding: '9px 36px 9px 12px', fontSize: 13, fontFamily: fInter,
    color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box',
    transition: 'border-color 0.15s',
  };
  const label: React.CSSProperties = {
    display: 'block', fontSize: 12, color: 'var(--text-tertiary)',
    fontWeight: 400, marginBottom: 6,
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-primary)', padding: 24,
    }}>
      <div style={{ width: '100%', maxWidth: 380 }}>

        <div style={{ marginBottom: 32 }}>
          <LogoDentsu largeur={240} />
        </div>

        {etat === 'verification' && (
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)', fontFamily: fInter }}>
            Vérification du lien…
          </div>
        )}

        {etat === 'lien_invalide' && (
          <>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4 }}>
                Lien expiré ou déjà utilisé
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-tertiary)', fontWeight: 400, lineHeight: 1.6 }}>
                Ces liens sont à usage unique et ont une durée de vie courte.
                Demandez-en un nouveau à votre administrateur.
              </div>
            </div>
            <a
              href="/login"
              style={{
                display: 'inline-block', fontSize: 12, fontFamily: fInter,
                color: 'var(--brand-teal)', textDecoration: 'none',
              }}
            >
              Retour à la connexion
            </a>
          </>
        )}

        {etat === 'termine' && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 8,
            background: 'rgba(61,255,160,0.10)',
            border: '0.5px solid rgba(61,255,160,0.2)',
            borderRadius: 6, padding: '10px 12px',
          }}>
            <CheckCircle2 size={14} style={{ color: 'var(--success)', flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 12, color: 'var(--success)', fontFamily: fInter, lineHeight: 1.5 }}>
              Mot de passe enregistré. Redirection…
            </span>
          </div>
        )}

        {etat === 'pret' && (
          <>
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4 }}>
                Définissez votre mot de passe
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-tertiary)', fontWeight: 400 }}>
                {email ?? 'Votre compte'}
              </div>
            </div>

            <form onSubmit={soumettre} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={label}>Mot de passe</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={voir ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={8}
                    autoFocus
                    style={champ}
                    onFocus={e => { e.currentTarget.style.borderColor = 'rgba(78,205,196,0.5)'; }}
                    onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
                  />
                  <button
                    type="button"
                    onClick={() => setVoir(v => !v)}
                    tabIndex={-1}
                    aria-label={voir ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                    style={{
                      position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                      color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center',
                    }}
                  >
                    {voir ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 6, fontFamily: fInter }}>
                  8 caractères minimum
                </div>
              </div>

              <div>
                <label style={label}>Confirmation</label>
                <input
                  type={voir ? 'text' : 'password'}
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="••••••••"
                  required
                  style={champ}
                  onFocus={e => { e.currentTarget.style.borderColor = 'rgba(78,205,196,0.5)'; }}
                  onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
                />
              </div>

              {erreur && (
                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8,
                  background: 'rgba(255,87,87,0.10)',
                  border: '0.5px solid rgba(255,87,87,0.2)',
                  borderRadius: 6, padding: '10px 12px',
                }}>
                  <AlertCircle size={14} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 1 }} />
                  <span style={{ fontSize: 12, color: 'var(--danger)', fontFamily: fInter, lineHeight: 1.5 }}>
                    {erreur}
                  </span>
                </div>
              )}

              <button
                type="submit"
                disabled={envoi}
                style={{
                  width: '100%', padding: '10px 0',
                  background: envoi ? 'var(--border-default)' : 'var(--text-primary)',
                  color: envoi ? 'var(--text-tertiary)' : 'var(--bg-primary)',
                  border: 'none', borderRadius: 6,
                  fontSize: 13, fontWeight: 500, fontFamily: fInter,
                  cursor: envoi ? 'not-allowed' : 'pointer',
                  transition: 'background 0.15s, color 0.15s',
                }}
              >
                {envoi ? 'Enregistrement…' : 'Enregistrer et se connecter'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
