"use client";
import { useState } from "react";

export default function InitPage() {
  const [result, setResult] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleInit = async () => {
    if (!email.trim() || !password.trim()) {
      setResult("Email et mot de passe requis.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/admin/init-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json();
      setResult(JSON.stringify(data, null, 2));
    } catch (e) {
      setResult(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8 max-w-md mx-auto mt-20">
      <h1 className="text-xl font-bold mb-4">Initialisation Admin</h1>
      <div className="space-y-3 mb-4">
        <input
          type="email"
          placeholder="Email admin"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-3 py-2 border rounded"
        />
        <input
          type="password"
          placeholder="Mot de passe"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-3 py-2 border rounded"
        />
      </div>
      <button onClick={handleInit} disabled={loading || !email || !password} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
        {loading ? "..." : "Créer Admin"}
      </button>
      {result && <pre className="mt-4 p-3 bg-gray-100 rounded text-xs overflow-auto">{result}</pre>}
    </div>
  );
}
