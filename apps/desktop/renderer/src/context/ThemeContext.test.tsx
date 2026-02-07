// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider, useTheme } from "./ThemeContext";

function ThemeWrapper({ children }: { children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

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

function installMatchMedia(matches: boolean): void {
  const matchMediaMock = vi.fn().mockImplementation((query: string): MediaQueryList => ({
    matches,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false
  }));
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: matchMediaMock
  });
}

beforeEach(() => {
  installLocalStorageMock();
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("ThemeContext", () => {
  it("adds the dark class when dark mode is selected", () => {
    installMatchMedia(false);
    const { result } = renderHook(() => useTheme(), {
      wrapper: ThemeWrapper
    });

    act(() => {
      result.current.setTheme("dark");
    });

    expect(result.current.theme).toBe("dark");
    expect(result.current.resolvedTheme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("removes the dark class when switching back to light mode", () => {
    installMatchMedia(false);
    const { result } = renderHook(() => useTheme(), {
      wrapper: ThemeWrapper
    });

    act(() => {
      result.current.setTheme("dark");
      result.current.setTheme("light");
    });

    expect(result.current.theme).toBe("light");
    expect(result.current.resolvedTheme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("hydrates initial theme from localStorage", () => {
    localStorage.setItem("canonkeeper.theme", "dark");
    installMatchMedia(false);

    const { result } = renderHook(() => useTheme(), {
      wrapper: ThemeWrapper
    });

    expect(result.current.theme).toBe("dark");
    expect(result.current.resolvedTheme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
