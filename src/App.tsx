import type { JSX } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import Login from "./pages/Login";
import EmployeeEntry from "./pages/EmployeeEntry";
import AdminDashboard from "./pages/AdminDashboard";

function Protected({ role, children }: { role: "employee" | "admin"; children: JSX.Element }) {
  const { loading, session, employee } = useAuth();
  if (loading) return <div className="p-10 text-center">Loading…</div>;
  if (!session) return <Navigate to="/login" replace />;
  if (!employee) return <div className="p-10 text-center">No employee profile linked to this account.</div>;
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
