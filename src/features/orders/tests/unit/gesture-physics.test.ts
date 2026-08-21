import { describe, expect, it } from "vitest";
import {
  isSettled,
  projectMomentum,
  rubberband,
  springStep,
  type SpringState,
} from "../../lib/gesture-physics";

describe("rubberband", () => {
  it("returns 0 for 0 overshoot", () => {
    expect(rubberband(0, 320)).toBe(0);
  });

  it("is monotonic but sub-linear (diminishing returns)", () => {
    const a = rubberband(50, 320);
    const b = rubberband(100, 320);
    const c = rubberband(150, 320);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(b - a).toBeGreaterThan(c - b); // gains shrink
    expect(b).toBeLessThan(100); // always less than raw input
  });

  it("is symmetric for negative overshoot", () => {
    expect(rubberband(-120, 320)).toBeCloseTo(-rubberband(120, 320));
  });
});

describe("projectMomentum", () => {
  it("returns 0 for 0 velocity", () => {
    expect(projectMomentum(0)).toBe(0);
  });

  it("sign follows velocity and magnitude scales linearly", () => {
    expect(projectMomentum(500)).toBeGreaterThan(0);
    expect(projectMomentum(-500)).toBeLessThan(0);
    expect(projectMomentum(1000)).toBeCloseTo(2 * projectMomentum(500));
  });

  it("matches the exponential-decay form for the default rate", () => {
    // v/1000 * d/(1-d) with d = 0.998 → v * 0.499
    expect(projectMomentum(1000)).toBeCloseTo(499, 0);
  });
});

function settle(
  start: SpringState,
  target: number,
  dampingRatio: number,
  responseSeconds: number,
  maxSteps = 600,
): { states: SpringState[]; settledAt: number | null } {
  const dt = 1 / 60;
  const states: SpringState[] = [start];
  let s = start;
  for (let i = 0; i < maxSteps; i++) {
    s = springStep(s, target, dampingRatio, responseSeconds, dt);
    states.push(s);
    if (isSettled(s, target)) return { states, settledAt: i };
  }
  return { states, settledAt: null };
}

describe("springStep / isSettled", () => {
  it("converges to the target", () => {
    const { states, settledAt } = settle({ position: 300, velocity: 0 }, 0, 1.0, 0.35);
    expect(settledAt).not.toBeNull();
    expect(states[states.length - 1]!.position).toBeCloseTo(0, 0);
  });

  it("critically damped (1.0) never overshoots", () => {
    const { states } = settle({ position: 300, velocity: 0 }, 0, 1.0, 0.35);
    for (const s of states) expect(s.position).toBeGreaterThan(-1); // 1px tolerance on 300px travel
  });

  it("damping 0.8 overshoots at least once before settling", () => {
    const { states } = settle({ position: 300, velocity: 0 }, 0, 0.8, 0.35);
    expect(Math.min(...states.map((s) => s.position))).toBeLessThan(-1);
  });

  it("carries initial velocity (a throw moves it away first)", () => {
    const s0: SpringState = { position: 0, velocity: 2000 };
    const s1 = springStep(s0, 0, 1.0, 0.35, 1 / 60);
    expect(s1.position).toBeGreaterThan(0);
  });

  it("isSettled only near target with low velocity", () => {
    expect(isSettled({ position: 0.1, velocity: 1 }, 0)).toBe(true);
    expect(isSettled({ position: 50, velocity: 0 }, 0)).toBe(false);
    expect(isSettled({ position: 0, velocity: 500 }, 0)).toBe(false);
  });
});
