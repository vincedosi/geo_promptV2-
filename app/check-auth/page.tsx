"use client";
import { useSession } from "@/lib/auth-client";
import Link from "next/link";

export default function CheckAuthPage() {
  const { session, isLoading } = useSession();
  if (isLoading) return <div className="p-8">Vérification...</div>;
  return (
    <div className="p-8 max-w-md mx-auto mt-20">
      <h1 className="text-xl font-bold mb-4">Auth Status</h1>
      {session ? (
        <div className="bg-green-50 border border-green-200 p-4 rounded">
          <p className="font-medium text-green-800">Connecté</p>
          <p className="text-sm text-gray-600 mt-1">{session.user.email}</p>
          <Link href="/dashboard" className="text-blue-600 underline text-sm mt-2 inline-block">→ Dashboard</Link>
        </div>
      ) : (
        <div className="bg-red-50 border border-red-200 p-4 rounded">
          <p className="font-medium text-red-800">Non connecté</p>
          <Link href="/login" className="text-blue-600 underline text-sm mt-2 inline-block">→ Connexion</Link>
        </div>
      )}
    </div>
  );
}
