// Routes: / (my demos), /new (set up a presentation), /r/CODE (the recording room), /r/CODE/edit (edit slides and transcript).
import { Fragment, lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter/opsz.css";
import "./base.css";
import { usePath } from "./route";
import { Tooltip } from "./Tooltip";

const pages = {
  home: () => import("./home/Home"),
  setup: () => import("./setup/Setup"),
  studio: () => import("./studio/Studio"),
};
const Home = lazy(() => pages.home().then((m) => ({ default: m.Home })));
const Setup = lazy(() => pages.setup().then((m) => ({ default: m.Setup })));
const Studio = lazy(() => pages.studio().then((m) => ({ default: m.Studio })));

// Every page's code is small; having it on hand makes the first switch as quick as the rest.
addEventListener("load", () => setTimeout(() => Object.values(pages).forEach((load) => void load().catch(() => undefined)), 1000), { once: true });

function page(path: string) {
  const room = path.match(/^\/r\/([A-Za-z0-9]{6})(\/edit)?$/);
  if (room) {
    const code = room[1].toUpperCase();
    return room[2] ? <Setup code={code} /> : <Studio code={code} />;
  }
  if (path === "/new") return <Setup />;
  return <Home />;
}

function Route() {
  const path = usePath().replace(/\/+$/, "") || "/";
  return <Fragment key={path}>{page(path)}</Fragment>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <Route />
    </Suspense>
    <Tooltip />
  </StrictMode>,
);
