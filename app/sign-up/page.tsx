import { redirect } from 'next/navigation';

/** Sign-up n'est pas disponible — l'inscription se fait depuis /login. */
export default function SignUpPage() {
  redirect('/login');
}
