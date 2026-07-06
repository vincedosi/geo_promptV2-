/**
 * /demo/pilote — absorbé par le cockpit campagne (app/campaigns/[id]).
 * Redirige vers la campagne de démo dans le cockpit.
 */
import { redirect } from 'next/navigation';

export default function Page() {
  redirect('/campaigns/dede0000-0000-4000-8000-000000000001');
}
