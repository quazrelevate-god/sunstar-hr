import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export type EntryState = "AWAITING_ACTUAL" | "AWAITING_PRICE" | "FINALIZED";

/** column key of sunstar_work_entries that a saved filter can target */
export type FilterCol =
  | "cluster" | "phase" | "villa" | "bedroom_type" | "floor_type"
  | "description" | "client" | "status"
  | "start_date" | "end_date"
  | "hours" | "target_hours" | "total_price" | "per_hour_ratio";

export type Condition =
  | { col: FilterCol; op: "equals" | "neq";                value: string | number }
  | { col: FilterCol; op: "in" | "nin";                    values: (string | number)[] }
  | { col: FilterCol; op: "contains";                      value: string }
  | { col: FilterCol; op: "between";                       from: string | number; to: string | number }
  | { col: FilterCol; op: "gt" | "gte" | "lt" | "lte";     value: number | string };

export type SavedFilter = {
  id?: string;
  name: string;
  conditions: Condition[];
  created_by_id?: string | null;
  created_at?: string;
  updated_at?: string;
};

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
