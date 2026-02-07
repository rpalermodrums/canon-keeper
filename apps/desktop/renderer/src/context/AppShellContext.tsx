import { createContext, useContext, type JSX, type ReactNode } from "react";
import type { AppSection } from "../state/useCanonkeeperApp";

type AppShellContextValue = {
  activeSection: AppSection;
  setActiveSection: (section: AppSection) => void;
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
};

type AppShellProviderProps = {
  children: ReactNode;
  value: AppShellContextValue;
};

const noop = () => {};

const AppShellContext = createContext<AppShellContextValue>({
  activeSection: "dashboard",
  setActiveSection: noop,
  commandPaletteOpen: false,
  setCommandPaletteOpen: noop,
  sidebarCollapsed: false,
  setSidebarCollapsed: noop
});

export function AppShellProvider({ children, value }: AppShellProviderProps): JSX.Element {
  return <AppShellContext.Provider value={value}>{children}</AppShellContext.Provider>;
}

export function useAppShell(): AppShellContextValue {
  return useContext(AppShellContext);
}
