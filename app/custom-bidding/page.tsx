/**
 * /custom-bidding — absorbé par le cockpit campagne (app/campaigns/[id]).
 * La liste des stratégies vit désormais dans le portfolio /campaigns.
 */
import { redirect } from 'next/navigation';

export default function Page() {
  redirect('/campaigns');
}
