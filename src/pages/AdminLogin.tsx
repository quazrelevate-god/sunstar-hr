import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

export default function AdminLogin() {
  const { signIn } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin123");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const { error } = await signIn(username.trim(), password);
    setBusy(false);
    if (error) return setErr(error);
    nav("/admin", { replace: true });
  };

  return (
    <div className="min-h-screen bg-brand-ink flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl p-8">
        <Link to="/" className="text-sm text-gray-500 hover:underline">← Back</Link>
        <div className="flex items-center gap-3 mt-4 mb-6">
          <div className="w-12 h-12 bg-brand-ink rounded-xl flex items-center justify-center text-xl font-bold text-brand-yellow">A</div>
          <div>
            <div className="text-2xl font-bold text-brand-ink">Admin Sign In</div>
            <div className="text-sm text-gray-500">Sunstar Analytics Dashboard</div>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Username</label>
            <input
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full border rounded-xl px-4 py-3 focus:outline-none focus:ring-4 focus:ring-brand-yellow/30 focus:border-brand-yellow"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Password</label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border rounded-xl px-4 py-3 focus:outline-none focus:ring-4 focus:ring-brand-yellow/30 focus:border-brand-yellow"
              required
            />
          </div>
          {err && <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg p-3">{err}</div>}
          <button
            disabled={busy}
            className="w-full bg-brand-ink hover:bg-black disabled:opacity-50 text-brand-yellow font-bold rounded-xl py-4 text-lg shadow"
          >
            {busy ? "Signing in…" : "Sign In"}
          </button>
        </form>

        <div className="mt-6 text-xs text-gray-500 bg-gray-50 rounded-lg p-3">
          <b>Demo:</b> admin / admin123
        </div>
      </div>
    </div>
  );
}
