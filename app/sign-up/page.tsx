"use client";
import Link from "next/link";

/** Sign-up redirects to login (both modes available there). */
export default function SignUpPage() {
  return (
    <div className="p-8 max-w-md mx-auto mt-20 text-center">
      <h1 className="text-xl font-bold mb-4">Inscription</h1>
      <p className="text-gray-600 mb-4">L&apos;inscription se fait depuis la page de connexion.</p>
      <Link href="/login" className="text-blue-600 underline">→ Aller à la connexion</Link>
    </div>
  );
}
