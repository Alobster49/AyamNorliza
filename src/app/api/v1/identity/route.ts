/**
 * REST API placeholder. The plan explicitly says no /v1/identity routes
 * are required for Phase 1. We keep the directory and a stub route so
 * future endpoints (e.g. `GET /v1/identity/me`) have an obvious home.
 */

import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({ status: "not_implemented" }, { status: 501 });
}
