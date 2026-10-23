# Sunstar HR — Work Measurement Portal

Dubai-based HR/manpower company. Employees log daily site work on a tablet; admin sees live analytics, per-hour rates, and profit.

## Two interfaces
- **Employee (tablet)** — fast repeat-entry form with live AED/hour and profit calculation. Smart defaults carry over between entries. Edit freely before submit; locked after submit.
- **Admin (desktop)** — metric cards (hours, revenue, cost, profit, avg AED/hr), Revenue-by-Client and Revenue-by-Cluster charts, filterable table, CSV export.

## Stack
- React + Vite + TypeScript + Tailwind CSS
- Supabase (Postgres + Auth + RLS)
- Recharts

## Getting started

```bash
npm install
cp .env.example .env   # then fill in your Supabase URL + anon/publishable key
npm run dev
```

Open http://localhost:5173.

### Credentials
Logins are provisioned by the admin from the **Employees** tab (username +
password, min 8 chars). Never commit real credentials to this repository.

## Database
Schema lives in the Supabase project and consists of:
- `sunstar_employees` — links `auth.users` to a role (employee | admin)
- `sunstar_work_entries` — one row per villa/floor job; `per_hour_ratio` is a generated column
- RLS: employees read/insert their own entries only; admins read/write all
- `sunstar_is_admin()` — security-definer helper used inside policies to avoid recursion
