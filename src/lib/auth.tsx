import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { supabase } from "./supabase";
import type { Employee } from "./supabase";

type AuthCtx = {
  loading: boolean;
  session: any | null;
  employee: Employee | null;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({} as any);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<any | null>(null);
  const [employee, setEmployee] = useState<Employee | null>(null);
  // Monotonic token: a slow/stale profile fetch (e.g. fired by an hourly
  // TOKEN_REFRESHED while offline, or for a user who signed out meanwhile)
  // must never overwrite the state set by a newer request.
  const loadSeq = useRef(0);

  async function loadEmployee(userId: string) {
    const seq = ++loadSeq.current;
    const { data, error } = await supabase
      .from("sunstar_employees")
      .select("*")
      .eq("auth_user_id", userId)
      .maybeSingle();
    if (seq !== loadSeq.current) return; // a newer auth event superseded this fetch
    // Network hiccup: keep whatever profile we already have instead of booting
    // the signed-in user to the "no profile" screen mid-shift.
    if (error) return;
    const emp = data as Employee | null;
    // Paranoia: never pair user A's profile with user B's session.
    if (emp && emp.auth_user_id !== userId) return;
    setEmployee(emp ?? null);
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session?.user?.id) await loadEmployee(data.session.user.id);
      setLoading(false);
    });
    // Supabase warns against awaiting other Supabase calls inside this callback
    // (it can deadlock the auth client), so the profile lookup runs just after it.
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s?.user?.id) {
        const uid = s.user.id;
        setTimeout(() => { loadEmployee(uid); }, 0);
      } else {
        loadSeq.current++; // invalidate any in-flight profile fetch
        setEmployee(null);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn = async (username: string, password: string) => {
    const u = username.trim().toLowerCase();
    const email = u.includes("@") ? u : `${u}@sunstar.local`;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <Ctx.Provider value={{ loading, session, employee, signIn, signOut }}>
      {children}
    </Ctx.Provider>
  );
}
