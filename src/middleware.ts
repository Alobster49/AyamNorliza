/**
 * Re-export the `proxy.ts` middleware so Next.js picks it up.
 *
 * `proxy.ts` is the spec name from the foundation; Next.js looks for a
 * `middleware.ts` file at the project root, so this thin shim keeps the
 * spec naming while wiring the actual middleware.
 */

export { proxy as middleware } from "../proxy";
