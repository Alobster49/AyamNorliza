// Vitest setup: ensure server-only modules can be loaded in unit
// tests by stubbing the import. The `server-only` package throws at
// runtime in a Node environment unless we shim it.
import { vi } from "vitest";

vi.mock("server-only", () => ({}));

// `revalidatePath`/`revalidateTag` require a Next.js request-scoped
// workAsyncStorage store; outside of a real request (i.e. in unit tests)
// they throw "Invariant: static generation store missing". Server Actions
// call these as a side effect after a successful mutation, so stub them
// out for unit tests the same way `server-only` is stubbed above.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));
