import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export type WorkEntry = {
  id?: string;
  employee_id?: string | null;
  employee_name?: string | null;
  cluster: string;
  phase: string;
  villa: string;
  bedroom_type: string;
  description: string;
  floor_type: string;
  start_date: string | null;
  end_date: string | null;
  status: string;
  hours: number;
  total_price: number;
  cost: number;
  per_hour_ratio?: number;
  power_point: number;
  gi_box_nos: number;
  data_point: number;
  telephone_point: number;
  lighting_point: number;
  fcu_point: number;
  db_conduit: number;
  client: string;
  created_at?: string;
};

export type Employee = {
  id: string;
  auth_user_id: string | null;
  full_name: string;
  employee_code: string;
  role: "employee" | "admin";
  active: boolean;
};
