// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "./ToastContext";

function ToastWrapper({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ToastContext", () => {
  it("adds a toast to the list", () => {
    const { result } = renderHook(() => useToast(), {
      wrapper: ToastWrapper
    });

    act(() => {
      result.current.pushToast({ message: "Saved successfully", tone: "success" });
    });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0]?.message).toBe("Saved successfully");
  });

  it("auto-dismisses a toast after timeout", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useToast(), {
      wrapper: ToastWrapper
    });

    act(() => {
      result.current.pushToast({ message: "Auto dismiss me", tone: "info" });
    });
    expect(result.current.toasts).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(result.current.toasts).toHaveLength(0);
  });

  it("dismisses a specific toast manually", () => {
    const { result } = renderHook(() => useToast(), {
      wrapper: ToastWrapper
    });

    act(() => {
      result.current.pushToast({ message: "Remove me", tone: "error" });
    });

    const toastId = result.current.toasts[0]?.id;
    if (!toastId) {
      throw new Error("Expected a toast id to exist");
    }

    act(() => {
      result.current.dismissToast(toastId);
    });

    expect(result.current.toasts).toHaveLength(0);
  });
});
