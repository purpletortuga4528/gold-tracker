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
          <header className="border-b border-line bg-surface">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4">
              <div className="flex items-baseline gap-3">
                <span className="text-xl font-semibold tracking-tight">
                  Gold Tracker
                </span>
                <span className="text-sm text-ink/50">reserves and price</span>
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
                            : "text-ink/70 hover:bg-ink/5"
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

          <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
            <FreshnessBanner />
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/countries" element={<Countries />} />
              <Route path="/countries/:code" element={<CountryDetail />} />
              <Route path="/compare" element={<Compare />} />
              <Route
                path="*"
                element={
                  <p className="py-16 text-center text-ink/50">
                    Page not found.
                  </p>
                }
              />
            </Routes>
          </main>

          <footer className="mx-auto max-w-6xl px-4 pb-10 text-xs text-ink/40">
            Reserves from the IMF. Price from the LBMA daily auction unless
            configured otherwise. Neither is investment advice, and neither is a
            complete picture of the world's official gold.
          </footer>
        </div>
      </PriceProvider>
    </AppearanceProvider>
  );
}
