import type { SyncOperationResult } from "./types";

export type TemplateCandidate = {
  id: string;
  version?: string;
  status: string;
  productionTypes: string[];
  riskClasses: string[];
};

export type CompletionQuestion = {
  key: string;
  required: boolean;
  critical: boolean;
};

export type CompletionResponse = {
  questionKey: string;
  status: "ok" | "abnormal" | "skipped" | "corrected";
  exceptionReason?: string | null;
};

export function matchTemplateForRound(input: {
  productionType: string;
  houseRiskClass: string;
  templates: TemplateCandidate[];
}): TemplateCandidate | null {
  return (
    input.templates.find(
      (template) =>
        template.status === "approved" &&
        includesOrWildcard(template.productionTypes, input.productionType) &&
        includesOrWildcard(template.riskClasses, input.houseRiskClass),
    ) ??
    input.templates.find(
      (template) =>
        template.status === "approved" &&
        includesOrWildcard(template.productionTypes, input.productionType),
    ) ??
    null
  );
}

export function validateInspectionCompletion(input: {
  questions: CompletionQuestion[];
  responses: CompletionResponse[];
}): { ok: boolean; missingRequired: string[]; missingCriticalReasons: string[] } {
  const responsesByKey = new Map(input.responses.map((response) => [response.questionKey, response]));
  const missingRequired: string[] = [];
  const missingCriticalReasons: string[] = [];

  for (const question of input.questions) {
    const response = responsesByKey.get(question.key);
    if (question.required && !response) missingRequired.push(question.key);
    if (question.critical && (!response || (response.status === "skipped" && !response.exceptionReason?.trim()))) {
      missingCriticalReasons.push(question.key);
    }
  }

  return {
    ok: missingRequired.length === 0 && missingCriticalReasons.length === 0,
    missingRequired,
    missingCriticalReasons,
  };
}

export function calculatePeriodCompleteness(input: {
  requiredRounds: number;
  completedRounds: number;
  unresolvedCriticalFindings: number;
  authorizedExceptions: number;
}): {
  status: "passed" | "failed";
  missingRounds: number;
  unresolvedCriticalFindings: number;
  score: number;
} {
  const missingRounds = Math.max(0, input.requiredRounds - input.completedRounds - input.authorizedExceptions);
  const score = input.requiredRounds === 0 ? 100 : Math.round((input.completedRounds / input.requiredRounds) * 100);
  return {
    status: missingRounds === 0 && input.unresolvedCriticalFindings === 0 ? "passed" : "failed",
    missingRounds,
    unresolvedCriticalFindings: input.unresolvedCriticalFindings,
    score,
  };
}

export function getSyncOperationOutcome(input: {
  existingOperationId: string | null;
  locked: boolean;
  conflict: boolean;
}): SyncOperationResult {
  if (input.existingOperationId) return "duplicate";
  if (input.locked) return "rejected";
  if (input.conflict) return "conflict";
  return "accepted";
}

export function flattenTemplateQuestions(definition: unknown): CompletionQuestion[] {
  const record = isRecord(definition) ? definition : {};
  const sections = Array.isArray(record.sections) ? record.sections : [];
  return sections.flatMap((section) => {
    if (!isRecord(section) || !Array.isArray(section.questions)) return [];
    return section.questions
      .filter(isRecord)
      .map((question) => ({
        key: String(question.key ?? ""),
        required: Boolean(question.required),
        critical: Boolean(question.critical),
      }))
      .filter((question) => question.key.length > 0);
  });
}

function includesOrWildcard(values: string[], value: string): boolean {
  return values.length === 0 || values.includes("*") || values.includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
