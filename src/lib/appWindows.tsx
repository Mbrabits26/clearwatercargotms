import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

// App-level "windows" (QuickBooks match, Review assistant) live above the routes so they
// keep their work while you minimize them and switch to Dispatch or any other screen.
export type AppWindowKind = "qbMatch" | "reviewAssistant";
export type AppWindowState = "open" | "min";
type Ctx = {
  windows: Partial<Record<AppWindowKind, AppWindowState>>;
  openWindow: (k: AppWindowKind) => void;
  minimizeWindow: (k: AppWindowKind) => void;
  closeWindow: (k: AppWindowKind) => void;
};
const AppWindowsContext = createContext<Ctx | null>(null);

export function AppWindowsProvider({ children }: { children: ReactNode }) {
  const [windows, setWindows] = useState<Ctx["windows"]>({});
  const set = useCallback((k: AppWindowKind, v: AppWindowState | undefined) => setWindows((w) => {
    const next = { ...w };
    if (v) next[k] = v; else delete next[k];
    return next;
  }), []);
  const value = useMemo<Ctx>(() => ({
    windows,
    openWindow: (k) => set(k, "open"),
    minimizeWindow: (k) => set(k, "min"),
    closeWindow: (k) => set(k, undefined),
  }), [windows, set]);
  return <AppWindowsContext.Provider value={value}>{children}</AppWindowsContext.Provider>;
}

export function useAppWindows() {
  const ctx = useContext(AppWindowsContext);
  if (!ctx) throw new Error("useAppWindows must be used inside AppWindowsProvider");
  return ctx;
}
