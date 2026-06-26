import { describe, expect, it } from "vitest";
import {
  calculatePeriodCompleteness,
  getSyncOperationOutcome,
  matchTemplateForRound,
  validateInspectionCompletion,
} from "@/features/daily-operations/domain";

describe("matchTemplateForRound", () => {
  it("prefers approved templates matching production type and risk", () => {
    const match = matchTemplateForRound({
      productionType: "layer",
      houseRiskClass: "high",
      templates: [
        { id: "draft", status: "draft", productionTypes: ["layer"], riskClasses: ["high"] },
        { id: "low", status: "approved", productionTypes: ["layer"], riskClasses: ["low"] },
        { id: "high", status: "approved", productionTypes: ["layer"], riskClasses: ["high"] },
      ],
    });

    expect(match?.id).toBe("high");
  });
});

describe("validateInspectionCompletion", () => {
  it("requires critical responses or an exception reason", () => {
    expect(
      validateInspectionCompletion({
        questions: [
          { key: "bird_behavior", required: true, critical: true },
          { key: "temperature", required: true, critical: false },
        ],
        responses: [{ questionKey: "temperature", status: "ok" }],
      }),
    ).toEqual({
      ok: false,
      missingRequired: ["bird_behavior"],
      missingCriticalReasons: ["bird_behavior"],
    });

    expect(
      validateInspectionCompletion({
        questions: [{ key: "bird_behavior", required: true, critical: true }],
        responses: [{ questionKey: "bird_behavior", status: "skipped", exceptionReason: "Vet instructed no entry." }],
      }).ok,
    ).toBe(true);
  });
});

describe("calculatePeriodCompleteness", () => {
  it("fails daily close when required rounds are incomplete without exception", () => {
    expect(
      calculatePeriodCompleteness({
        requiredRounds: 3,
        completedRounds: 2,
        unresolvedCriticalFindings: 1,
        authorizedExceptions: 0,
      }),
    ).toEqual({
      status: "failed",
      missingRounds: 1,
      unresolvedCriticalFindings: 1,
      score: 67,
    });
  });
});

describe("getSyncOperationOutcome", () => {
  it("maps duplicate client operation ids to duplicate instead of accepted", () => {
    expect(getSyncOperationOutcome({ existingOperationId: "op-1", locked: false, conflict: false })).toBe("duplicate");
    expect(getSyncOperationOutcome({ existingOperationId: null, locked: true, conflict: false })).toBe("rejected");
    expect(getSyncOperationOutcome({ existingOperationId: null, locked: false, conflict: true })).toBe("conflict");
    expect(getSyncOperationOutcome({ existingOperationId: null, locked: false, conflict: false })).toBe("accepted");
  });
});
