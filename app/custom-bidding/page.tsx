/**
 * /custom-bidding — absorbé par l'overlay MAGELIAN.
 * La gestion vit dans l'overlay MAGELIAN de /map.
 */
import { redirect } from 'next/navigation';

export default function Page() {
  redirect('/map');
}
