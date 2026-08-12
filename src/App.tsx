import type { JSX } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import LoginChooser from "./pages/LoginChooser";
import EmployeeLogin from "./pages/EmployeeLogin";
import AdminLogin from "./pages/AdminLogin";
import EmployeeEntry from "./pages/EmployeeEntry";
import AdminDashboard from "./pages/AdminDashboard";

function Protected({ role, children }: { role: "employee" | "admin"; children: JSX.Element }) {
  const { loading, session, employee } = useAuth();
  if (loading) return <div className="p-10 text-center">Loading…</div>;
  if (!session) return <Navigate to={role === "admin" ? "/admin/login" : "/employee/login"} replace />;
  if (!employee) return <div className="p-10 text-center">No employee profile linked to this account.</div>;
  if (role === "admin" && employee.role !== "admin") return <Navigate to="/employee" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LoginChooser />} />
          <Route path="/employee/login" element={<EmployeeLogin />} />
          <Route path="/admin/login" element={<AdminLogin />} />
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
