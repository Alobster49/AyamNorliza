import { describe, expect, it } from "vitest";
import {
  overviewLayoutClasses,
  overviewTrendSeries,
} from "../../components/overview-presentation";

describe("overview presentation", () => {
  it("uses overflow-safe root and KPI grid classes", () => {
    expect(overviewLayoutClasses.root).toContain("min-w-0");
    expect(overviewLayoutClasses.root).toContain("overflow-x-hidden");
    expect(overviewLayoutClasses.kpiGrid).toContain("2xl:grid-cols-6");
    expect(classTokens(overviewLayoutClasses.kpiGrid)).not.toContain("xl:grid-cols-6");
  });

  it("keeps the command strip bounded on desktop", () => {
    expect(overviewLayoutClasses.commandStrip).toContain("min-w-0");
    expect(overviewLayoutClasses.commandStrip).toContain("2xl:grid-cols");
    expect(classTokens(overviewLayoutClasses.commandStrip)).not.toContain("xl:grid-cols");
  });

  it("gives each trend series a visible dark-mode tone", () => {
    const environment = overviewTrendSeries.find((series) => series.key === "environment");

    expect(environment?.barClassName).toContain("bg-sky");
    expect(environment?.legendClassName).toContain("bg-sky");
    expect(new Set(overviewTrendSeries.map((series) => series.barClassName)).size).toBe(3);
  });
});

function classTokens(className: string): string[] {
  return className.split(/\s+/).filter(Boolean);
}
