import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { ErrorBoundary } from "./components/ErrorBoundary";

const root = createRoot(document.getElementById("root")!);

// A misdeployed build (missing env) used to throw inside the supabase module
// and leave a silent white screen. Check BEFORE importing the app so the
// problem is readable on screen. App is imported dynamically for the same
// reason: a static import would evaluate the supabase module first.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  root.render(
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui", padding: 24 }}>
      <div style={{ maxWidth: 480, textAlign: "center" }}>
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>Configuration error</h1>
        <p style={{ color: "#555" }}>
          This deployment is missing <code>VITE_SUPABASE_URL</code> /{" "}
          <code>VITE_SUPABASE_ANON_KEY</code>. Set them in the hosting
          environment and redeploy.
        </p>
      </div>
    </div>,
  );
} else {
  const { default: App } = await import("./App");
  root.render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
}
