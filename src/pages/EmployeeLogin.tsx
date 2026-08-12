import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

export default function EmployeeLogin() {
  const { signIn } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("employee@sunstar.test");
  const [password, setPassword] = useState("employee123");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const { error } = await signIn(email.trim(), password);
    setBusy(false);
    if (error) return setErr(error);
    nav("/employee", { replace: true });
  };

  return (
    <div className="min-h-screen bg-brand-yellowSoft flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-lg p-8 tap-lg">
        <Link to="/" className="text-sm text-gray-500 hover:underline">← Back</Link>
        <div className="flex items-center gap-3 mt-4 mb-6">
          <div className="w-12 h-12 bg-brand-yellow rounded-xl flex items-center justify-center text-xl font-bold">S</div>
          <div>
            <div className="text-2xl font-bold text-brand-ink">Employee Sign In</div>
            <div className="text-sm text-gray-500">Sunstar Work Portal</div>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border rounded-xl focus:outline-none focus:ring-4 focus:ring-brand-yellow/30 focus:border-brand-yellow"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border rounded-xl focus:outline-none focus:ring-4 focus:ring-brand-yellow/30 focus:border-brand-yellow"
              required
            />
          </div>
          {err && <div className="text-red-600 text-sm">{err}</div>}
          <button
            disabled={busy}
            className="w-full bg-brand-yellow hover:bg-brand-yellowDark disabled:opacity-50 text-brand-ink font-bold rounded-xl py-4 text-lg shadow"
          >
            {busy ? "Signing in…" : "Sign In"}
          </button>
        </form>

        <div className="mt-6 text-xs text-gray-500 bg-gray-50 rounded-lg p-3">
          <b>Demo:</b> employee@sunstar.test / employee123
        </div>
      </div>
    </div>
  );
}
