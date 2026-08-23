import { describe, expect, it } from "vitest";
import { NextResponse } from "next/server";
import { copyResponseMetadata, isRedirectResponse } from "./middleware-compose";

describe("isRedirectResponse", () => {
  it("detects a redirect by its Location header", () => {
    const redirect = NextResponse.redirect("http://localhost/en/login");
    expect(isRedirectResponse(redirect)).toBe(true);
  });

  it("treats a pass-through as not a redirect", () => {
    expect(isRedirectResponse(NextResponse.next())).toBe(false);
  });
});

describe("copyResponseMetadata", () => {
  it("carries cookies from the source onto the target", () => {
    const from = NextResponse.next();
    from.cookies.set("NEXT_LOCALE", "ms");
    const to = copyResponseMetadata(from, NextResponse.next());
    expect(to.cookies.get("NEXT_LOCALE")?.value).toBe("ms");
  });

  it("carries next-intl's Link header onto the target", () => {
    const from = NextResponse.next();
    from.headers.set("link", '<http://localhost/ms>; rel="alternate"');
    const to = copyResponseMetadata(from, NextResponse.next());
    expect(to.headers.get("link")).toBe('<http://localhost/ms>; rel="alternate"');
  });

  it("does not copy Next's internal middleware directives", () => {
    const from = NextResponse.next();
    from.headers.set("x-middleware-next", "1");
    const to = copyResponseMetadata(from, NextResponse.next());
    // The target has its own directive from its own NextResponse.next() call;
    // overwriting it with the source's would discard the request headers the
    // target is carrying.
    expect(to.headers.get("x-middleware-override-headers")).toBe(
      NextResponse.next().headers.get("x-middleware-override-headers"),
    );
  });
});
