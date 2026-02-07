// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppShellProvider, useAppShell } from "../context/AppShellContext";
import type { AppSection } from "../state/useCanonkeeperApp";

function installLocalStorageMock(): void {
  const store = new Map<string, string>();
  const mockStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    }
  };

  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: mockStorage
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: mockStorage
  });
}

function writeSession(activeSection: AppSection): void {
  localStorage.setItem(
    "canonkeeper.session.v1",
    JSON.stringify({
      version: 1,
      global: {
        lastProjectRoot: null,
        lastProjectId: null,
        lastProjectName: null,
        activeSection,
        sidebarCollapsed: false,
        hasSeenWelcome: false
      },
      projects: {}
    })
  );
}

function ContextSectionControls(): JSX.Element {
  const shell = useAppShell();
  return (
    <>
      <div data-testid="context-section">{shell.activeSection}</div>
      <button type="button" onClick={() => shell.setActiveSection("search")}>
        context-set-search
      </button>
      <button type="button" onClick={() => shell.setActiveSection("bible")}>
        context-set-bible
      </button>
    </>
  );
}

function SharedShellHarness({
  initialSection = "dashboard"
}: {
  initialSection?: AppSection;
}): JSX.Element {
  const [activeSection, setActiveSectionRaw] = useState<AppSection>(initialSection);
  const [setSectionCallCount, setSetSectionCallCount] = useState(0);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const setActiveSection = useCallback((section: AppSection) => {
    setSetSectionCallCount((count) => count + 1);
    setActiveSectionRaw(section);
  }, []);

  useEffect(() => {
    writeSession(activeSection);
  }, [activeSection]);

  const appShell = useMemo(
    () => ({
      activeSection,
      setActiveSection,
      commandPaletteOpen,
      setCommandPaletteOpen,
      sidebarCollapsed,
      setSidebarCollapsed
    }),
    [activeSection, commandPaletteOpen, setActiveSection, sidebarCollapsed]
  );

  return (
    <AppShellProvider value={appShell}>
      <div data-testid="hook-section">{activeSection}</div>
      <div data-testid="set-section-calls">{String(setSectionCallCount)}</div>
      <button type="button" onClick={() => setActiveSection("issues")}>
        hook-set-issues
      </button>
      <ContextSectionControls />
    </AppShellProvider>
  );
}

describe("AppShellContext", () => {
  beforeEach(() => {
    installLocalStorageMock();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("uses delegated activeSection state instead of localStorage-backed internal state", () => {
    localStorage.setItem("canonkeeper.activeSection", JSON.stringify("issues"));

    render(<SharedShellHarness initialSection="dashboard" />);

    expect(screen.getByTestId("hook-section").textContent).toBe("dashboard");
    expect(screen.getByTestId("context-section").textContent).toBe("dashboard");
  });

  it("keeps activeSection synchronized between hook and context update paths", () => {
    render(<SharedShellHarness initialSection="dashboard" />);

    fireEvent.click(screen.getByRole("button", { name: "hook-set-issues" }));
    expect(screen.getByTestId("hook-section").textContent).toBe("issues");
    expect(screen.getByTestId("context-section").textContent).toBe("issues");
    expect(screen.getByTestId("set-section-calls").textContent).toBe("1");

    fireEvent.click(screen.getByRole("button", { name: "context-set-search" }));
    expect(screen.getByTestId("hook-section").textContent).toBe("search");
    expect(screen.getByTestId("context-section").textContent).toBe("search");
    expect(screen.getByTestId("set-section-calls").textContent).toBe("2");
  });

  it("persists section state through the shared source of truth and avoids legacy key writes", () => {
    render(<SharedShellHarness initialSection="dashboard" />);

    fireEvent.click(screen.getByRole("button", { name: "context-set-bible" }));

    const raw = localStorage.getItem("canonkeeper.session.v1");
    const envelope = raw ? (JSON.parse(raw) as { global?: { activeSection?: string } }) : null;
    expect(envelope?.global?.activeSection).toBe("bible");
    expect(localStorage.getItem("canonkeeper.activeSection")).toBeNull();
  });
});
