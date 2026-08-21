/**
 * Pure gesture/spring math for the mobile swipe deck, after Apple's
 * "Designing Fluid Interfaces" (WWDC 2018). No DOM — the rAF loop lives in
 * the component; these functions are unit tested.
 */

export type SpringState = { position: number; velocity: number };

/**
 * Progressive resistance past a boundary: the further past, the less the
 * element follows. `dimension` is the axis size (e.g. card width).
 */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/**
 * Where a flick would coast to under scroll-style exponential decay.
 * Velocity in px/s; returns the projected travel distance in px.
 */
export function projectMomentum(velocityPxPerS: number, decelerationRate = 0.998): number {
  return ((velocityPxPerS / 1000) * decelerationRate) / (1 - decelerationRate);
}

/**
 * One step of a spring parameterized the way Apple's designers think:
 * damping ratio (1.0 = no overshoot, <1 = bouncy) and response (seconds to
 * approach the target — not a fixed duration).
 *
 * Uses the closed-form damped-oscillator solution rather than Euler
 * integration: exact for any dt, so a 60fps rAF loop keeps the analytic
 * bounce instead of numerically damping it away.
 */
export function springStep(
  state: SpringState,
  target: number,
  dampingRatio: number,
  responseSeconds: number,
  dtSeconds: number,
): SpringState {
  const omega = (2 * Math.PI) / responseSeconds;
  const zeta = dampingRatio;
  const x0 = state.position - target;
  const v0 = state.velocity;
  const decay = Math.exp(-zeta * omega * dtSeconds);

  let x: number;
  let v: number;
  if (Math.abs(zeta - 1) < 1e-6) {
    // Critically damped
    const c = v0 + omega * x0;
    x = decay * (x0 + c * dtSeconds);
    v = decay * (v0 - omega * c * dtSeconds);
  } else if (zeta < 1) {
    // Underdamped
    const omegaD = omega * Math.sqrt(1 - zeta * zeta);
    const cos = Math.cos(omegaD * dtSeconds);
    const sin = Math.sin(omegaD * dtSeconds);
    const b = (v0 + zeta * omega * x0) / omegaD;
    x = decay * (x0 * cos + b * sin);
    v = decay * ((b * omegaD - zeta * omega * x0) * cos - (x0 * omegaD + zeta * omega * b) * sin);
  } else {
    // Overdamped
    const omegaD = omega * Math.sqrt(zeta * zeta - 1);
    const cosh = Math.cosh(omegaD * dtSeconds);
    const sinh = Math.sinh(omegaD * dtSeconds);
    const b = (v0 + zeta * omega * x0) / omegaD;
    x = decay * (x0 * cosh + b * sinh);
    v = decay * ((b * omegaD - zeta * omega * x0) * cosh + (x0 * omegaD - zeta * omega * b) * sinh);
  }
  return { position: target + x, velocity: v };
}

export function isSettled(
  state: SpringState,
  target: number,
  positionEpsilon = 0.5,
  velocityEpsilon = 5,
): boolean {
  return (
    Math.abs(state.position - target) < positionEpsilon &&
    Math.abs(state.velocity) < velocityEpsilon
  );
}
