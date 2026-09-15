import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App.tsx";
import "./index.css";
import { installOAuthTrace } from "./lib/oauth-trace";

// Install BEFORE React mounts so the wrappers catch the very first
// Supabase client init and any callback fetches / storage writes.
installOAuthTrace();

createRoot(document.getElementById("root")!).render(
  <HelmetProvider>
    <App />
  </HelmetProvider>
);
