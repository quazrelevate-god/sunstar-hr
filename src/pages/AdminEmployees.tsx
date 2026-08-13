import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { Toast } from "../components/Toast";
import type { ToastKind } from "../components/Toast";

type Emp = {
  id: string;
  full_name: string;
  employee_code: string;
  role: "employee" | "admin";
  active: boolean;
  auth_user_id: string | null;
  created_at: string;
};

const FN = "sunstar-manage-employee";

async function call(action: string, payload: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke(FN, {
    body: { action, ...payload },
  });
  if (error) {
    // FunctionsHttpError hides body — try to read it
    let msg = error.message;
    try {
      const ctx = (error as any).context;
      if (ctx && typeof ctx.text === "function") {
        const txt = await ctx.text();
        try { msg = JSON.parse(txt).error ?? txt; } catch { msg = txt; }
      }
    } catch {}
    throw new Error(msg);
  }
  if ((data as any)?.error) throw new Error((data as any).error);
  return data;
}

export default function AdminEmployees() {
  const { employee: me } = useAuth();
  const [rows, setRows] = useState<Emp[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; kind: ToastKind } | null>(null);

  // Create form
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [fUsername, setFUsername] = useState("");
  const [fPassword, setFPassword] = useState("");
  const [fFullName, setFFullName] = useState("");
  const [fCode, setFCode] = useState("");
  const [fRole, setFRole] = useState<"employee" | "admin">("employee");

  // Delete confirm
  const [confirmDel, setConfirmDel] = useState<Emp | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Reset password
  const [resetFor, setResetFor] = useState<Emp | null>(null);
  const [newPw, setNewPw] = useState("");
  const [resetting, setResetting] = useState(false);

  async function load() {
    setLoading(true); setErr(null);
    try {
      const r = await call("list");
      setRows((r as any).employees ?? []);
    } catch (e: any) {
      setErr(e.message);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  function flash(msg: string, kind: ToastKind = "info") {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3200);
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true); setErr(null);
    try {
      await call("create", {
        username: fUsername, password: fPassword,
        full_name: fFullName, employee_code: fCode, role: fRole,
      });
      flash(`Created ${fFullName} (@${fUsername})`, "success");
      setFUsername(""); setFPassword(""); setFFullName(""); setFCode(""); setFRole("employee");
      setShowForm(false);
      load();
    } catch (e: any) { setErr(e.message); }
    finally { setCreating(false); }
  }

  async function doDelete() {
    if (!confirmDel) return;
    setDeleting(true); setErr(null);
    try {
      await call("delete", { employee_id: confirmDel.id });
      flash(`Deleted ${confirmDel.full_name}`, "success");
      setConfirmDel(null);
      load();
    } catch (e: any) { setErr(e.message); }
    finally { setDeleting(false); }
  }

  async function doReset() {
    if (!resetFor) return;
    setResetting(true); setErr(null);
    try {
      await call("reset_password", { employee_id: resetFor.id, password: newPw });
      flash(`Password reset for ${resetFor.full_name}`, "success");
      setResetFor(null); setNewPw("");
    } catch (e: any) { setErr(e.message); }
    finally { setResetting(false); }
  }

  return (
    <div className="space-y-4">
      {toast && <Toast msg={toast.msg} kind={toast.kind} />}

      <div className="bg-white rounded-2xl p-5 shadow-sm flex items-center justify-between">
        <div>
          <div className="font-bold text-lg">Employees</div>
          <div className="text-sm text-gray-500">
            Create logins for your workers. They sign in at the tablet with their username & password.
          </div>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="bg-brand-yellow hover:bg-brand-yellowDark text-brand-ink font-semibold px-4 py-2 rounded-lg"
        >
          {showForm ? "Cancel" : "+ New employee"}
        </button>
      </div>

      {err && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 text-sm">{err}</div>}

      {showForm && (
        <form onSubmit={submitCreate} className="bg-white rounded-2xl p-5 shadow-sm grid md:grid-cols-3 gap-3">
          <Field label="Username *">
            <input required minLength={3} value={fUsername}
              onChange={(e) => setFUsername(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ""))}
              placeholder="e.g. ravi.k"
              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-yellow" />
            {fUsername && <div className="text-[11px] text-gray-500 mt-1">
              Login: <b>{fUsername}</b> · Password shared separately
            </div>}
          </Field>
          <Field label="Password *">
            <input required type="text" minLength={6} value={fPassword}
              onChange={(e) => setFPassword(e.target.value)}
              placeholder="min 6 chars"
              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-yellow" />
          </Field>
          <Field label="Role">
            <select value={fRole} onChange={(e) => setFRole(e.target.value as any)}
              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-yellow">
              <option value="employee">Employee</option>
              <option value="admin">Admin</option>
            </select>
          </Field>
          <Field label="Full name *">
            <input required value={fFullName}
              onChange={(e) => setFFullName(e.target.value)}
              placeholder="e.g. Ravi Kumar"
              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-yellow" />
          </Field>
          <Field label="Employee code *">
            <input required value={fCode}
              onChange={(e) => setFCode(e.target.value.toUpperCase())}
              placeholder="e.g. EMP-002"
              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-yellow" />
          </Field>
          <div className="flex items-end">
            <button disabled={creating}
              className="w-full bg-brand-ink text-brand-yellow disabled:opacity-50 font-bold px-4 py-2 rounded-lg">
              {creating ? "Creating…" : "Create login"}
            </button>
          </div>
        </form>
      )}

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Full Name</th>
                <th className="px-4 py-3 text-left">Code</th>
                <th className="px-4 py-3 text-left">Role</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Created</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="p-6 text-center text-gray-500">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="p-6 text-center text-gray-500">No employees yet.</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="border-t hover:bg-brand-yellowSoft/50">
                  <td className="px-4 py-3 font-medium">{r.full_name}
                    {r.id === me?.id && <span className="ml-2 text-xs bg-gray-100 rounded px-2 py-0.5">you</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{r.employee_code}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                      r.role === "admin" ? "bg-brand-ink text-brand-yellow" : "bg-brand-yellow text-brand-ink"
                    }`}>{r.role}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      r.active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"
                    }`}>{r.active ? "active" : "inactive"}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{new Date(r.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <button onClick={() => setResetFor(r)}
                      className="text-brand-yellowDark hover:underline text-sm">Reset password</button>
                    <button onClick={() => setConfirmDel(r)}
                      disabled={r.id === me?.id}
                      className="text-red-600 hover:underline text-sm disabled:opacity-30 disabled:no-underline">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Delete confirm */}
      {confirmDel && (
        <Modal onClose={() => setConfirmDel(null)}>
          <div className="text-lg font-bold mb-2">Delete {confirmDel.full_name}?</div>
          <div className="text-sm text-gray-600 mb-4">
            Their login is removed permanently. Their submitted work entries stay in the records but no longer link to a user.
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmDel(null)}
              className="px-4 py-2 rounded-lg border">Cancel</button>
            <button onClick={doDelete} disabled={deleting}
              className="px-4 py-2 rounded-lg bg-red-600 text-white disabled:opacity-50">
              {deleting ? "Deleting…" : "Delete"}
            </button>
          </div>
        </Modal>
      )}

      {/* Reset password */}
      {resetFor && (
        <Modal onClose={() => { setResetFor(null); setNewPw(""); }}>
          <div className="text-lg font-bold mb-2">Reset password — {resetFor.full_name}</div>
          <div className="text-sm text-gray-600 mb-4">
            Enter a new password. Share it with the employee.
          </div>
          <input autoFocus type="text" value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            placeholder="new password (min 6 chars)"
            className="w-full border rounded-lg px-3 py-2 mb-4 focus:outline-none focus:ring-2 focus:ring-brand-yellow" />
          <div className="flex justify-end gap-2">
            <button onClick={() => { setResetFor(null); setNewPw(""); }}
              className="px-4 py-2 rounded-lg border">Cancel</button>
            <button onClick={doReset} disabled={resetting || newPw.length < 6}
              className="px-4 py-2 rounded-lg bg-brand-ink text-brand-yellow font-bold disabled:opacity-50">
              {resetting ? "Saving…" : "Reset password"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-semibold text-gray-500 mb-1">{label}</div>
      {children}
    </label>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
         onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl p-6 max-w-md w-full"
           onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
