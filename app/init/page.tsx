"use client";
import { useState } from "react";

export default function InitPage() {
  const [result, setResult] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const handleInit = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/init-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "admin@genesis.local", password: "changeme123" }),
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
      <button onClick={handleInit} disabled={loading} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
        {loading ? "..." : "Créer Admin"}
      </button>
      {result && <pre className="mt-4 p-3 bg-gray-100 rounded text-xs overflow-auto">{result}</pre>}
    </div>
  );
}
