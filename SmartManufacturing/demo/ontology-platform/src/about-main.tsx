import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@xyflow/react/dist/style.css";
import "./styles/app.css";
import { createRoot } from "react-dom/client";
import { PlatformProvider } from "./hooks/usePlatformState";
import { AboutPage } from "./pages/AboutPage";

createRoot(document.getElementById("root")!).render(
  <PlatformProvider>
    <AboutPage />
  </PlatformProvider>,
);
