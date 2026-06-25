import { describe, it, expect } from "vitest";
import { consume } from "@/lib/rate-limit";

describe("rate-limit bucket", () => {
  it("allows up to N then denies", () => {
    const key = "test:" + Math.random();
    const limit = 3;
    const window = 1000;
    expect(consume(key, limit, window).allowed).toBe(true);
    expect(consume(key, limit, window).allowed).toBe(true);
    expect(consume(key, limit, window).allowed).toBe(true);
    expect(consume(key, limit, window).allowed).toBe(false);
  });
});
