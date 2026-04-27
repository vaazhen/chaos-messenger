import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useI18n } from "../hooks/useI18n";

// Mock api module
vi.mock("../api", () => ({
  api: {
    getTranslations: vi.fn().mockResolvedValue({ no_chats: "No chats EN" }),
    setLang: vi.fn().mockResolvedValue(null),
  },
}));

describe("useI18n", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to ru when no saved lang", () => {
    const { result } = renderHook(() => useI18n());
    expect(result.current.lang).toBe("ru");
    expect(result.current.t.no_chats).toBeTruthy();
  });

  it("switchLang updates lang and translations", async () => {
    const { result } = renderHook(() => useI18n());
    await act(async () => {
      await result.current.switchLang("en");
    });
    expect(result.current.lang).toBe("en");
    expect(localStorage.getItem("cm_lang")).toBe("en");
  });
});
