/**
 * Drift guard for the email copy that exists twice.
 *
 * `supabase/functions/_shared/messages.ts` is a hand-maintained copy of the
 * `email.*` namespace in `src/messages/{locale}.json`, made because the Deno
 * runtime has no build step and cannot import the app's next-intl catalogs.
 * Its own header names the app copy as canonical. Nothing enforced that, so
 * editing a template in the catalog left the Edge Functions sending the old
 * wording indefinitely, with no signal.
 *
 * This compares the templates the two sides genuinely share. It is not a
 * strict equality check on the whole set: each side legitimately holds
 * templates the other does not send (the app sends passwordReset, the
 * functions send accessReviewDue and the invite-resend variants), and
 * failing on that would only teach people to delete the test.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import en from "@/messages/en.json";

type Template = { subject: string; bodyHtml: string };

const EDGE_MESSAGES = path.resolve(
  __dirname,
  "../../../supabase/functions/_shared/messages.ts",
);

/**
 * Pulls the `en` catalog out of the Deno module by evaluating just its object
 * literal. Importing the module directly would drag Deno globals into the
 * Node test run, which is the same reason `cron-auth.ts` keeps its pure half
 * separate.
 */
function edgeTemplates(): Record<string, Template> {
  const source = readFileSync(EDGE_MESSAGES, "utf8");
  const start = source.indexOf("const en: IdentityMessages = {");
  expect(start, "the edge copy should declare `const en: IdentityMessages`").toBeGreaterThan(-1);

  const objectStart = source.indexOf("{", start);
  let depth = 0;
  let end = objectStart;
  for (let i = objectStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }

  // The literal is plain data: string properties, no expressions.
  return Function(`"use strict"; return (${source.slice(objectStart, end)});`)() as Record<
    string,
    Template
  >;
}

const appTemplates = (en as { email?: Record<string, Template> }).email ?? {};

describe("edge email templates", () => {
  it("has an app-side catalog to compare against", () => {
    expect(Object.keys(appTemplates).length).toBeGreaterThan(0);
  });

  it("shares at least one template with the app, or the guard is vacuous", () => {
    const shared = Object.keys(edgeTemplates()).filter((k) => k in appTemplates);
    expect(shared.length).toBeGreaterThan(0);
  });

  it("keeps every shared template identical to the canonical catalog", () => {
    const edge = edgeTemplates();
    const drifted: string[] = [];

    for (const [key, appTemplate] of Object.entries(appTemplates)) {
      const edgeTemplate = edge[key];
      if (!edgeTemplate) continue; // legitimately not sent from the edge
      if (
        edgeTemplate.subject !== appTemplate.subject ||
        edgeTemplate.bodyHtml !== appTemplate.bodyHtml
      ) {
        drifted.push(key);
      }
    }

    expect(
      drifted,
      `These templates differ between src/messages/en.json and supabase/functions/_shared/messages.ts. ` +
        `The catalog is canonical — copy the change across, or the Edge Functions keep sending the old wording.`,
    ).toEqual([]);
  });
});
