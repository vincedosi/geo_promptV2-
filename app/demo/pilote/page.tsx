/**
 * /demo/pilote — ouvre l'overlay MAGELIAN sur la campagne de démo (onglet Suivi).
 */
import { redirect } from 'next/navigation';

export default function Page() {
  redirect('/map?campaign=dede0000-0000-4000-8000-000000000001&tab=suivi');
}
