import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { Logo } from "../components/Logo";

export default function Login() {
  const { signIn, session, employee } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // If already signed in, route to the right home
  useEffect(() => {
    if (session && employee) {
      nav(employee.role === "admin" ? "/admin" : "/employee", { replace: true });
    }
  }, [session, employee, nav]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const { error } = await signIn(username.trim(), password);
    setBusy(false);
    if (error) return setErr(error);
    // AuthProvider will fetch the employee row; the effect above then routes.
  };

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Top nav */}
      <header className="border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Logo size="sm" />
          </div>
          <div className="text-xs text-gray-500">Work Measurement Portal</div>
        </div>
      </header>

      {/* Center card */}
      <main className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-md">
          {/* Logo mark above card */}
          <div className="flex justify-center mb-8">
            <Logo size="lg" />
          </div>

          {/* Card */}
          <div className="bg-white border border-gray-200 rounded-2xl p-8 shadow-sm">
            <h1 className="font-serif text-3xl text-brand-ink mb-1">Sign in</h1>
            <p className="text-sm text-gray-500 mb-8">
              Use the credentials given to you by your admin.
            </p>

            <form onSubmit={submit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Username <span className="text-brand-blueDark">*</span>
                </label>
                <input
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoFocus
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. admin or your username"
                  className="w-full border border-gray-300 rounded-xl px-4 py-3 focus:outline-none focus:ring-4 focus:ring-brand-blue/25 focus:border-brand-blue transition"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Password <span className="text-brand-blueDark">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showPw ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full border border-gray-300 rounded-xl px-4 py-3 pr-11 focus:outline-none focus:ring-4 focus:ring-brand-blue/25 focus:border-brand-blue transition"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 text-sm px-2 py-1"
                    aria-label={showPw ? "Hide password" : "Show password"}
                    tabIndex={-1}
                  >
                    {showPw ? "hide" : "show"}
                  </button>
                </div>
              </div>

              {err && (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {err === "Invalid login credentials"
                    ? "Username or password is incorrect."
                    : err}
                </div>
              )}

              <button
                disabled={busy}
                className="w-full bg-brand-blue hover:bg-brand-blueDark disabled:opacity-50 text-brand-ink font-semibold rounded-xl py-3.5 tracking-wide transition"
              >
                {busy ? "Signing in…" : "SIGN IN"}
              </button>
            </form>
          </div>

          <p className="text-center text-xs text-gray-500 mt-6">
            Trouble signing in? Contact your Sunstar admin.
          </p>
        </div>
      </main>

      <footer className="py-6 text-center text-xs text-gray-400">
        © {new Date().getFullYear()} SUNSTAR · Dubai
      </footer>
    </div>
  );
}
