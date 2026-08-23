import { describe, expect, it } from "vitest";
import {
  EXPLAINER_FLAG_KEY,
  hasSeenExplainer,
  markExplainerSeen,
} from "@/features/buyer/lib/explainer-flag";

function memoryStorage(initial: Record<string, string> = {}) {
  const store = { ...initial };
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    dump: () => store,
  };
}

describe("explainer flag", () => {
  it("unseen by default", () => {
    expect(hasSeenExplainer(memoryStorage())).toBe(false);
  });
  it("seen after marking", () => {
    const s = memoryStorage();
    markExplainerSeen(s);
    expect(s.dump()[EXPLAINER_FLAG_KEY]).toBe("1");
    expect(hasSeenExplainer(s)).toBe(true);
  });
});
