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
  | "description" | "client" | "status" | "apartment_number"
  | "start_date" | "end_date"
  | "hours" | "target_hours" | "total_price" | "per_hour_ratio" | "total_manpower";

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

  // Morning ops (added round 5)
  apartment_number?: string | null;
  total_manpower?: number | null;
  check_in_time?: string | null;     // "HH:MM"
  check_out_time?: string | null;
  break_start_time?: string | null;
  break_end_time?: string | null;

  // Target hours (morning; only admin can change later)
  target_hours: number | null;

  // Actual hours (end-of-day)
  hours: number | null;

  // Point counts (end-of-day) — power_point label is "Power Socket"
  power_point: number;
  gi_box_nos: number;
  data_point: number;
  telephone_point: number;
  lighting_point: number;
  fcu_point: number;
  db_conduit: number;

  // Round 5: detailed second-phase point counts
  gi_conduiting?: number;
  gi_circular_box?: number;
  gi_offset?: number;
  final_fix_switch?: number;
  final_fix_socket?: number;
  type_no_1_light?: number;
  type_no_2_light?: number;
  type_no_3_light?: number;
  type_no_4_light?: number;
  type_no_5_light?: number;
  type_no_6_light?: number;
  led_strip_light_meter?: number;

  // Price (admin)
  total_price: number | null;

  per_hour_ratio?: number | null;
  created_at?: string;
};

/** Labels for point-count fields — used by both forms and export */
export const POINT_FIELDS: { key: keyof WorkEntry; label: string; decimal?: boolean }[] = [
  { key: "power_point",           label: "Power Socket" },
  { key: "gi_box_nos",            label: "GI Box" },
  { key: "data_point",            label: "Data" },
  { key: "telephone_point",       label: "Telephone" },
  { key: "lighting_point",        label: "Lighting" },
  { key: "fcu_point",             label: "FCU" },
  { key: "db_conduit",            label: "DB Conduit" },
  { key: "gi_conduiting",         label: "GI Conduiting" },
  { key: "gi_circular_box",       label: "GI-Circular Box" },
  { key: "gi_offset",             label: "GI-Offset" },
  { key: "final_fix_switch",      label: "Final Fix Switch" },
  { key: "final_fix_socket",      label: "Final Fix Socket" },
  { key: "type_no_1_light",       label: "Type 1 Light" },
  { key: "type_no_2_light",       label: "Type 2 Light" },
  { key: "type_no_3_light",       label: "Type 3 Light" },
  { key: "type_no_4_light",       label: "Type 4 Light" },
  { key: "type_no_5_light",       label: "Type 5 Light" },
  { key: "type_no_6_light",       label: "Type 6 Light" },
  { key: "led_strip_light_meter", label: "LED Strip (m)", decimal: true },
];

export type Employee = {
  id: string;
  auth_user_id: string | null;
  full_name: string;
  employee_code: string;
  role: "employee" | "admin";
  active: boolean;
};
