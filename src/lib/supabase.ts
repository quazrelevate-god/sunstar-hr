import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export type EntryState = "AWAITING_ACTUAL" | "AWAITING_PRICE" | "FINALIZED";

export type WorkEntry = {
  id?: string;
  state: EntryState;
  employee_id?: string | null;
  employee_name?: string | null;
  created_by_id?: string | null;
  actual_by_id?: string | null;
  priced_by_id?: string | null;

  // Identifiers (set at morning entry)
  cluster: string;
  phase: string;
  villa: string;
  bedroom_type: string;
  description: string;
  floor_type: string;
  start_date: string | null;
  end_date: string | null;
  status: string;
  client: string;

  // Target hours (morning; only admin can change later)
  target_hours: number | null;

  // Actual hours (end-of-day)
  hours: number | null;

  // Point counts (end-of-day)
  power_point: number;
  gi_box_nos: number;
  data_point: number;
  telephone_point: number;
  lighting_point: number;
  fcu_point: number;
  db_conduit: number;

  // Price (admin)
  total_price: number | null;

  per_hour_ratio?: number | null;
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
