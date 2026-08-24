"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export type ListRow = {
  id: string;
  label: string;
  secondary: string;
  /** Rendered as a small chip on the right, e.g. "needs setup". */
  badge?: { text: string; tone: "warning" | "muted" };
  archived?: boolean;
};

export function RecordList({
  rows,
  selectedId,
  emptyMessage,
  addLabel,
  canEdit,
  onSelect,
  onAdd,
}: {
  rows: ListRow[];
  selectedId: string | null;
  emptyMessage: string;
  addLabel: string;
  canEdit: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
}) {
  const t = useTranslations("logistics.setup");
  return (
    <div className="flex h-full flex-col">
      <ul className="flex-1 divide-y overflow-y-auto">
        {rows.length === 0 ? (
          <li className="p-6 text-center text-sm text-muted-foreground">{emptyMessage}</li>
        ) : (
          rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => onSelect(row.id)}
                aria-current={row.id === selectedId ? "true" : undefined}
                className={cn(
                  "flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left",
                  row.id === selectedId ? "bg-muted" : "hover:bg-muted/50",
                  row.archived && "opacity-60",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{row.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {row.secondary}
                  </span>
                </span>
                {row.archived ? (
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {t("archived")}
                  </span>
                ) : null}
                {row.badge ? (
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                      row.badge.tone === "warning"
                        ? "bg-amber-500/15 text-amber-700 dark:text-amber-500"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {row.badge.text}
                  </span>
                ) : null}
              </button>
            </li>
          ))
        )}
      </ul>
      {canEdit ? (
        <div className="border-t p-2">
          <button
            type="button"
            onClick={onAdd}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md text-sm text-muted-foreground hover:bg-muted"
          >
            <Plus className="h-4 w-4" />
            {addLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
}
