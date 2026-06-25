// Vitest setup: ensure server-only modules can be loaded in unit
// tests by stubbing the import. The `server-only` package throws at
// runtime in a Node environment unless we shim it.
import { vi } from "vitest";

vi.mock("server-only", () => ({}));
