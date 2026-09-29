import type { JSX } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import Login from "./pages/Login";
import EmployeeEntry from "./pages/EmployeeEntry";
import AdminDashboard from "./pages/AdminDashboard";

function Protected({ role, children }: { role: "employee" | "admin"; children: JSX.Element }) {
  const { loading, session, employee, signOut } = useAuth();
  if (loading) return <div className="p-10 text-center">Loading…</div>;
  if (!session) return <Navigate to="/login" replace />;
  if (!employee) {
    return (
      <div className="p-10 text-center space-y-4">
        <div>No employee profile linked to this account.</div>
        <div className="text-sm text-gray-500">Please contact your Sunstar admin.</div>
        <button
          onClick={signOut}
          className="bg-brand-ink hover:bg-black text-white px-5 py-2.5 rounded-lg text-sm font-medium"
        >
          Sign out
        </button>
      </div>
    );
  }
  if (role === "admin" && employee.role !== "admin") return <Navigate to="/employee" replace />;
  if (role === "employee" && employee.role === "admin") return <Navigate to="/admin" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<Login />} />
          {/* legacy paths → redirect to unified /login */}
          <Route path="/employee/login" element={<Navigate to="/login" replace />} />
          <Route path="/admin/login" element={<Navigate to="/login" replace />} />
          <Route
            path="/employee"
            element={
              <Protected role="employee">
                <EmployeeEntry />
              </Protected>
            }
          />
          <Route
            path="/admin"
            element={
              <Protected role="admin">
                <AdminDashboard />
              </Protected>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
