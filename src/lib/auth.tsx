import { createContext, useContext, useEffect, useState } from "react";
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

  async function loadEmployee(userId: string) {
    const { data } = await supabase
      .from("sunstar_employees")
      .select("*")
      .eq("auth_user_id", userId)
      .maybeSingle();
    setEmployee((data as Employee) ?? null);
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
        setEmployee(null);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn = async (username: string, password: string) => {
    const email = username.includes("@") ? username : `${username.toLowerCase().trim()}@sunstar.local`;
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
