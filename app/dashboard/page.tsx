"use client";

import { useSession, useSignOut } from "@/lib/auth-client";
import Link from "next/link";

export default function DashboardPage() {
  const { session, isLoading } = useSession();
  const { signOut } = useSignOut();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg text-gray-600">Loading...</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Link href="/login" className="text-blue-600 underline">
          Redirect to login
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">GENESIS</h1>
              <p className="text-sm text-gray-500">Dashboard</p>
            </div>

            <div className="flex items-center gap-4">
              <div>
                <p className="text-sm text-gray-700 font-medium">
                  {session.user.name || session.user.email}
                </p>
                <p className="text-xs text-gray-500">{session.user.email}</p>
              </div>
              <button
                onClick={() => signOut()}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* User Info Card */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              User Profile
            </h2>
            <div className="space-y-2 text-sm">
              <p>
                <span className="text-gray-600">Email:</span>{" "}
                <span className="font-medium">{session.user.email}</span>
              </p>
              <p>
                <span className="text-gray-600">Name:</span>{" "}
                <span className="font-medium">
                  {session.user.name || "Not set"}
                </span>
              </p>
              <p>
                <span className="text-gray-600">Role:</span>{" "}
                <span className="font-medium">
                  {session.user.role || "user"}
                </span>
              </p>
              <p>
                <span className="text-gray-600">Verified:</span>{" "}
                <span className="font-medium">
                  {session.user.emailVerified ? "Yes" : "No"}
                </span>
              </p>
            </div>
          </div>

          {/* Organization Card */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Organization
            </h2>
            <div className="space-y-2 text-sm">
              {session.user.organizationId ? (
                <>
                  <p>
                    <span className="text-gray-600">Org ID:</span>{" "}
                    <span className="font-mono text-xs">
                      {session.user.organizationId}
                    </span>
                  </p>
                  <button className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">
                    View Organization
                  </button>
                </>
              ) : (
                <p className="text-gray-500">
                  <button className="text-blue-600 underline">
                    Create an organization
                  </button>
                </p>
              )}
            </div>
          </div>

          {/* Session Info Card */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Session
            </h2>
            <div className="space-y-2 text-xs text-gray-600">
              <p>
                <span className="text-gray-700 font-medium">Session ID:</span>
                <br />
                <span className="font-mono truncate">{session.id}</span>
              </p>
              <p>
                <span className="text-gray-700 font-medium">Expires:</span>
                <br />
                <span>
                  {new Date(session.expiresAt).toLocaleString()}
                </span>
              </p>
            </div>
          </div>
        </div>

        {/* Quick Links */}
        <div className="mt-12 p-6 bg-blue-50 border border-blue-200 rounded-lg">
          <h2 className="text-lg font-semibold text-blue-900 mb-4">
            Documentation
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <a
              href="/settings"
              className="text-blue-600 hover:underline text-sm"
            >
              → Settings
            </a>
            <a
              href="https://www.better-auth.com"
              target="_blank"
              className="text-blue-600 hover:underline text-sm"
            >
              → Better Auth Docs
            </a>
            <a
              href="/api/auth"
              className="text-blue-600 hover:underline text-sm"
            >
              → Auth API
            </a>
            <a
              href="/"
              className="text-blue-600 hover:underline text-sm"
            >
              → Home
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
