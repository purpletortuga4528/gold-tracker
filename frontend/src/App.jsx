import { NavLink, Route, Routes } from "react-router-dom";
import { PriceProvider } from "./lib/usePrice.jsx";
import { AppearanceProvider } from "./lib/useTheme.jsx";
import { AppearanceControls } from "./components/AppearanceControls.jsx";
import { FreshnessBanner } from "./components/FreshnessBanner.jsx";
import { Dashboard } from "./pages/Dashboard.jsx";
import { Countries } from "./pages/Countries.jsx";
import { CountryDetail } from "./pages/CountryDetail.jsx";
import { Compare } from "./pages/Compare.jsx";

const NAV = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/countries", label: "Countries" },
  { to: "/compare", label: "Compare" },
];

export default function App() {
  return (
    <AppearanceProvider>
      <PriceProvider>
        <div className="min-h-screen">
          {/* Hidden until focused, which is the whole point: the first Tab on
              any page offers a way past the navigation rather than making
              somebody walk it again on every route change. */}
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-on-accent"
          >
            Skip to content
          </a>

          <header className="border-b border-line bg-surface">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4">
              <div className="flex items-baseline gap-3">
                <span className="text-xl font-semibold tracking-tight">
                  Gold Tracker
                </span>
                <span className="text-sm text-ink-muted">reserves and price</span>
              </div>
              <div className="flex items-center gap-3">
                <nav className="flex gap-1">
                  {NAV.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) =>
                        `rounded-md px-3 py-1.5 text-sm font-medium transition ${
                          isActive
                            ? "bg-accent-soft text-accent-strong"
                            : "text-ink-muted hover:bg-ink/5"
                        }`
                      }
                    >
                      {item.label}
                    </NavLink>
                  ))}
                </nav>
                <AppearanceControls />
              </div>
            </div>
          </header>

          <main id="main" className="mx-auto max-w-6xl space-y-6 px-4 py-6">
            <FreshnessBanner />
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/countries" element={<Countries />} />
              <Route path="/countries/:code" element={<CountryDetail />} />
              <Route path="/compare" element={<Compare />} />
              <Route
                path="*"
                element={
                  <p className="py-16 text-center text-ink-muted">
                    Page not found.
                  </p>
                }
              />
            </Routes>
          </main>

          <footer className="mx-auto max-w-6xl px-4 pb-10 text-xs text-ink-subtle">
            {/* The price source is not named here. This said "Price from the
                LBMA daily auction unless configured otherwise", which was a
                claim about a feed that is now shut, printed on every page: with
                the demo provider it told the reader invented numbers came from
                a London auction. Only the response knows what is serving, so
                the price panel names it and this does not guess. */}
            Reserves from the IMF. The price panel names whichever provider
            served the figures beside it. Neither is investment advice, and
            neither is a complete picture of the world's official gold.
          </footer>
        </div>
      </PriceProvider>
    </AppearanceProvider>
  );
}
