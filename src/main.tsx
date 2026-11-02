// Routes: / (my demos), /new (set up a presentation), /r/CODE (the recording room), /r/CODE/edit (edit slides and transcript).
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter/opsz.css";
import "./base.css";
import { Tooltip } from "./Tooltip";

const Home = lazy(() => import("./home/Home").then((m) => ({ default: m.Home })));
const Setup = lazy(() => import("./setup/Setup").then((m) => ({ default: m.Setup })));
const Studio = lazy(() => import("./studio/Studio").then((m) => ({ default: m.Studio })));

function Route() {
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const room = path.match(/^\/r\/([A-Za-z0-9]{6})(\/edit)?$/);
  if (room) {
    const code = room[1].toUpperCase();
    return room[2] ? <Setup code={code} /> : <Studio code={code} />;
  }
  if (path === "/new") return <Setup />;
  return <Home />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <Route />
    </Suspense>
    <Tooltip />
  </StrictMode>,
);
