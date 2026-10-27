# Sunstar HR — Testing Guide

> **For the tester:** please read this document before writing bug tickets. Many things that *look* like bugs are actually intentional product behavior — the specific spec Sunstar asked for. This guide walks you through every intended behavior so you can focus on real defects.

---

## 1. What this application is

Sunstar HR is a **work-measurement portal** built for Sunstar, a Dubai-based manpower/HR company that supplies workers for villa electrical/conduit jobs.

The app replaces a paper/Excel workflow with two live interfaces:

- **Employee portal** (tablet-friendly) — daily on-site entries, morning + afternoon
- **Admin portal** (desktop) — sets prices, sees analytics, manages users

The end goal is to answer, per job and per client:
> "What are we earning per hour?" — measured as **AED per hour** (total amount ÷ actual hours), per client and overall.

**Live URL:** https://web-production-f23d9.up.railway.app

---

## 2. The two login roles

There are only **two roles**: `admin` and `employee`. No separate "manager" — every employee can create morning entries and complete afternoon entries, but each employee's Queue shows **only their own entries** (changed 2026-10-27; it used to be a shared site-wide queue). Admins see everything.

| Login | Password | Role | Landing page |
|---|---|---|---|
| `admin` | *(set by the owner — never written down here)* | Admin | Queue tab (empty until entries exist) |
| `sam` | *set by admin — Reset from Employees tab* | Employee | Queue tab (empty until entries exist) |

Employee display name for `sam`: **109-EHTESAMUL HAQUE** (code `109`).

The system is intentionally seeded blank for the client — no work entries, no saved filter views, and only these two logins. The client's admin will add their own employees.

---

## 3. The 3-state entry lifecycle (READ THIS FIRST)

Every work entry moves through **three states** in order. This is the core of the workflow — everything else is UI around it.

```
   AWAITING_ACTUAL  ─►  AWAITING_PRICE  ─►  FINALIZED
   (morning entry)      (end-of-day)         (admin sets price)
```

| State | What it means | Who fills what | Where it shows |
|---|---|---|---|
| 🟡 **AWAITING_ACTUAL** | Job created in the morning, no actual hours yet. | Employee entered: cluster, phase, villa, apartment, bedroom, floor, description, client, status, start date, total manpower, shift times (defaults 07:00–18:00, break 13:00–14:00). | Employee **Queue** tab · Admin **Queue** tab |
| 🟠 **AWAITING_PRICE** | Employee finished the job. Actual hours + all point counts + check-out + break times are in. End date auto-stamped by the DB. Now waiting on admin. | Employee updated: actual hours, all 19 point counts, check-out/break times. | Admin **Queue** tab (Set Price button appears here) |
| 🟢 **FINALIZED** | Admin has entered total price. Row enters analytics/charts and the "Finalized Entries" tab. | Admin filled: total price. Also allowed: full edit of any field. | Admin **Finalized Entries** tab (with company ratios, charts, filters, XLSX/CSV export) |

**Testers: never file a bug that says "the row disappeared from the queue after I filled actuals" — that is correct.** The row moved to the next state.

---

## 4. Employee portal — what each screen does

Two tabs: **Queue** (default landing) and **+ New Entry**.

### 4.1 Queue tab
- Shows only `AWAITING_ACTUAL` rows (not `AWAITING_PRICE`).
- Empty state: "All caught up · Nothing pending. You can head home 🏠"
  → **This is the intended UX signal** for the employee: an empty queue means they can go home.
- Each row expands to reveal an **actuals form** with:
  - Actual Hours *
  - Check-out / Break start / Break end (times)
  - 19 point counts (Power Socket, GI Box, Data, Telephone, Lighting, FCU, DB Conduit, GI Conduiting, GI-Circular Box, GI-Offset, Final Fix Switch, Final Fix Socket, Type 1–6 Light, LED Strip (m))
- Submit → row moves to `AWAITING_PRICE`, drops out of the employee queue.
- **Delete is allowed only on your own `AWAITING_ACTUAL` rows** (enforced by database rules). Submitted (`AWAITING_PRICE`) and finalized rows can only be changed or deleted by an admin.

### 4.2 + New Entry tab
The **morning entry** form. Required fields marked with `*`:
- Villa *, Description *, Client *, Total Manpower *, Check-in *
- Optional: Cluster, Phase, Apartment (no `*` per spec), Bedroom, Floor, Status, Start Date, Check-out, Break start, Break end
- Bedroom & Floor are **free-text inputs with autocomplete** — not dropdowns. As you type, past values appear. Type anything new — it's accepted and becomes a suggestion for others.
- Same for Cluster / Phase / Villa / Description / Client / Apartment — history-based autocomplete via `<datalist>`.
- Check-in defaults to **the current time** when the form opens.

### 4.3 Things that look like bugs but aren't
| Observation | Explanation |
|---|---|
| "Bedroom is not a dropdown, it lets me type anything." | Correct — spec was changed from dropdown to editable autocomplete. |
| "I can't edit my own submitted morning entry." | Correct — after submit, only an admin can change the entry (enforced by database rules, not just the UI). Before submit, the employee can still edit or delete it from the Queue. |
| "There's no 'Cost' field anymore." | Correct — cost was removed entirely (spec). Only price exists, entered by admin. |
| "I don't see the price of any entry I fill." | Correct — pricing is admin-only. |
| "The queue is empty even though I know there's work." | The other employee may have already picked it up and moved it forward. Realtime keeps sessions in sync. |
| "I typed a new client name and it saved fine." | Correct — free-text; new value becomes a suggestion next time. |

---

## 5. Admin portal — what each screen does

Three tabs: **Queue** · **Finalized Entries** · **Employees**.

### 5.1 Queue tab (landing page)
- Shows every non-finalized entry: 🟡 Awaiting actual + 🟠 Awaiting price.
- **Filter chips** at top: All / Awaiting actual / Awaiting price.
- **Search** by villa, cluster, phase, client, employee.
- Per-row actions:
  - **Set price →** — only visible on `AWAITING_PRICE` rows. Opens a modal with three billing shapes: **Total price** (single amount), **Quantity × price** (auto-computed total), and — when the villa/description contains "supply" — **Hours + AED/hr** (manpower mode, hours become the billable number). A live AED/hr preview updates as you type. Finalize → row moves to `FINALIZED`. If anything about the entry changed while the modal was open, the save is refused with a clear message instead of overwriting. |
  - **Edit** — opens the **Full Edit modal** (see 5.4).
  - **Delete** — confirmation modal, cannot be undone.
- Empty state: "🎉 Queue is empty · All entries have been finalized."

### 5.2 Finalized Entries tab
A three-column split-screen designed for desktop analysis:

1. **Left sidebar — Views**
   - "All entries" (default, cannot be deleted).
   - Saved filter views, listed alphabetically. Hover → rename ✎ / delete ×.
   - "+ New view" at the bottom.

2. **Metrics & insights**
   - Entries · Total Hours · Revenue · Avg AED/hr strip across the top.
   - **Company AED/hr panel** (inside the collapsible "insights" column) — one
     row per client: AED/hr pill (HIGH / AVG / LOW vs the fleet average),
     client name, rate bar relative to the best-earning client, hours,
     revenue and entry count. Default sort: lowest AED/hr first.
   - **Client metrics chart** with segmented toggle (Total price · Actual hours · AED/hr) and a "Compare clients" popover.
   - The whole insights column is hidden by default — "📊 Show insights" above the Views list toggles it.

3. **Right column — Toolbar + Table** (scrolls independently)
   - **+ Add condition** (dark) opens the filter builder.
   - **Save as view** (yellow) — appears when a filter is applied but unsaved.
   - **Edit filter** (yellow) — appears when a saved view is active; opens confirmation modal to unlock editing.
   - **Save changes** (green) — commits edits back to the saved view.
   - **Export XLSX** (green outline) — actual `.xlsx`, sheet named after active view.
   - **CSV** (grey outline).
   - Active filter chips (removable × when unlocked).
   - Table: 23 columns, paginated 50 rows/page, prev/next.
   - AED/hr cell is **color-coded**: green (actual<target, profit) · amber (=target, on plan) · red (actual>target, loss) · grey (missing data).

### 5.3 Filter builder — supported operators
Different columns show different operators (intentional):

| Column type | Operators |
|---|---|
| Text (Cluster, Phase, Villa, Apartment, Bedroom, Floor, Description, Client, Status) | equals, does not equal, is one of, is not one of, contains |
| Date (Start date, End date) | on, not on, before, on or before, after, on or after, between |
| Number (Actual/Target hours, Total price, AED/hr, Total manpower) | equals, does not equal, is one of, is not one of, `>`, `≥`, `<`, `≤`, between |

For text columns, the "value" field is a **dropdown of values seen in past entries** (auto-populated). Type a new value if it hasn't been recorded yet.

### 5.4 Full Edit modal
- Reachable only from Admin Queue → **Edit** on any non-finalized row.
- Admin can edit **every field**: identifiers, times, manpower, hours, all 19 point counts, price. Employees do not have this power (spec).
- Sectioned into: Identifiers · Times & manpower · Hours & price · Point counts.

### 5.5 Employees tab
- Lists every employee login. Admin can:
  - **+ New employee** (opens inline form). Fields: username, password (min 6), full name, employee code, role (Employee / Admin).
  - **Reset password** per row (opens modal).
  - **Delete** per row (opens modal). Cannot delete yourself.
- Behind the scenes, this calls a Supabase Edge Function that (1) verifies the caller is an admin, (2) uses the service role to create/delete `auth.users` and link a matching `sunstar_employees` row.

### 5.6 Things that look like bugs but aren't
| Observation | Explanation |
|---|---|
| "The Queue tab has no charts." | Correct — Queue is action-only. All metrics/charts live in Finalized Entries. |
| "I applied a filter but the saved view didn't update automatically." | Correct — saved views are read-only by default. Click **Edit filter**, confirm, then **Save changes**. |
| "Editing a saved view forces me to click a Confirm modal." | Correct — friction is intentional to prevent accidental changes on team-shared views. |
| "The pie chart legend shows only cluster names, no percentages." | Recharts default. Hover a slice for AED. |
| "I filtered the chart's clients using Compare — the whole table filtered too." | Correct — every widget on this tab derives from the same filtered row set. That's the sync spec. |
| "I can't edit prices or finalized entries as an employee." | Correct — enforced at the DB level (policies + triggers), not just UI. Employees also can't see finalized entries or prices at all. |
| "A client shows LOW on the AED/hr panel." | Correct — LOW means that client's earned rate (total AED ÷ actual hours) is more than 5% below the fleet average; HIGH means above. |
| "Real-time updates arrive without me refreshing." | Correct — Supabase Realtime subscriptions on every list view. Multi-user friendly. |
| "The value dropdown in the filter builder shows lowercase and uppercase versions of the same word (e.g. 'v-14' and 'V-14')." | Because they are different distinct entries in history. Text comparisons in filters *are* case-insensitive, but the dropdown lists what was actually recorded. |
| "I set target_hours on an entry — but the DB says only admin can, and I got an error." | Only enforced when the caller is not admin. Admin can always change. |
| "The XLSX export doesn't include 'Ratio' as a column." | Correct — ratio is a per-client aggregate, not a per-row field. Per-row you get Target/Actual/AED per hour and can compute yourself. |

---

## 6. Data model — quick reference

Three tables in Postgres, under the `sunstar_` prefix (isolated from other apps in the same Supabase project):

- **`sunstar_employees`** — one row per login, linked to `auth.users`.
- **`sunstar_work_entries`** — one row per villa/job. Columns: identifiers, morning ops (apartment, manpower, times), target/actual hours, total price, all 19 point counts, state, actor references (created_by, actual_by, priced_by). `per_hour_ratio` is a **generated column** that fires only when state = `FINALIZED`.
- **`sunstar_saved_filters`** — shared filter views (visible to all admins).

RLS policies enforce role-based access. Trigger `sunstar_set_end_date_on_actual` auto-stamps `end_date` when state moves to `AWAITING_PRICE`. Trigger `sunstar_guard_updates` prevents non-admins from changing `target_hours`, `total_price`, or setting `state = FINALIZED`.

---

## 7. Tech stack

- **Frontend:** React 19 + Vite + TypeScript + Tailwind CSS + Recharts + SheetJS (xlsx export)
- **Backend:** Supabase (Postgres + Auth + RLS + Realtime + Edge Functions)
- **Auth:** username-based (transparent `@sunstar.local` email domain behind the scenes)
- **Hosting:** Railway (auto-deploys on push to `main` at https://github.com/quazrelevate-god/sunstar-hr)
- **Env vars** live in Railway (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY) and mirror the local `.env`.

---

## 8. Known limitations / out of scope

- No mobile-native app — the tablet experience is a responsive PWA-style web app.
- No password self-reset for employees — admin resets from the Employees tab.
- No email/SMS notifications — everything is in-app + realtime.
- Analytics are only computed on `FINALIZED` rows (by design — pre-finalized data is not clean money data).
- No multi-tenant / multi-company support — single-org install.
- No audit trail table (who changed what and when). If required, add later.
- The `sunstar-manage-employee` edge function is admin-only (verified via JWT). Employees calling it get 403.

---

## 9. How to test — suggested happy path

1. **Sign in as `admin`** (with the owner's password). Queue should be empty.
2. Go to **Employees** → **+ New employee** → create yourself a test employee (e.g. `tester` / a password of 8+ chars / Test Person / TST-001).
3. Sign out. **Sign in as `tester`**. Land on empty Queue.
4. Go to **+ New Entry** → fill a job (Villa `T-1`, Client `TEST-CO`, Manpower `2`; shift times are pre-filled) → **Queue for actuals**.
5. Back to Queue. See the row 🟡. Click **Fill actuals →** → enter Actual Hours `8`, fill some point counts → **Submit for pricing**.
6. Queue should now be empty (your work is done for the day).
7. Sign out. Sign back in as **admin**. Go to **Queue**. See the 🟠 row. Click **Set price →** → enter `250` → **Finalize**. Live preview should show green (8 < 10 target = profit).
8. Go to **Finalized Entries**. Row should appear in table, one card in Company Ratio panel showing 0.80 ratio (green), one bar in Client metrics chart.
9. Try **+ Add condition** → Client equals TEST-CO → **Save as view** → name it "Test view". Chart + metrics + table narrow to just that row.
10. Click **Export XLSX** → download → open in Excel → confirm row is present with all 23 columns.
11. Delete the test employee and the test entry when done (both from admin UI). Verify counts return to fresh state.

---

## 10. Reporting bugs

When something looks broken, before writing a ticket, please:
1. Check the tables in section 4.3 and 5.6 — is your observation actually intended behavior?
2. Note **which role** you were logged in as.
3. Note **which state** the entry was in (`AWAITING_ACTUAL` / `AWAITING_PRICE` / `FINALIZED`).
4. Include a screenshot and the browser console errors, if any.

Real bugs — data loss, incorrect calculations, permission bypasses, layout breakage, crashes — are always welcome. The tables above just help filter out spec confusions.

---

*Last updated: 2026-09-29 · Live at https://web-production-f23d9.up.railway.app · Source at https://github.com/quazrelevate-god/sunstar-hr*
