"use client";

import { useState } from "react";
import { completeTask } from "@/features/orders/server/order-actions";
import type { TaskWithOrder } from "@/features/orders/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

type LineDraft = { weightKg: string; pieces: string };

type TasksClientProps = {
  organizationSlug: string;
  initialTasks: TaskWithOrder[];
};

export function TasksClient({ organizationSlug, initialTasks }: TasksClientProps) {
  const { toast } = useToast();
  const [tasks, setTasks] = useState(initialTasks);
  const [drafts, setDrafts] = useState<Record<string, Record<string, LineDraft>>>(() =>
    Object.fromEntries(
      initialTasks.map((task) => [
        task.id,
        Object.fromEntries(
          task.order.items
            .filter((item) => !item.is_cancelled)
            .map((item) => [item.id, { weightKg: "", pieces: "" }]),
        ),
      ]),
    ),
  );
  const [submitting, setSubmitting] = useState<string | null>(null);

  function updateDraft(taskId: string, itemId: string, field: keyof LineDraft, value: string) {
    setDrafts((prev) => {
      const taskDrafts = prev[taskId] ?? {};
      const itemDraft = taskDrafts[itemId] ?? { weightKg: "", pieces: "" };
      const updatedDraft: LineDraft = { ...itemDraft, [field]: value } as LineDraft;
      return {
        ...prev,
        [taskId]: {
          ...taskDrafts,
          [itemId]: updatedDraft,
        },
      };
    });
  }

  async function handleDone(task: TaskWithOrder) {
    const nonCancelled = task.order.items.filter((item) => !item.is_cancelled);
    const draft = drafts[task.id] ?? {};
    const weights: { itemId: string; weightKg: number; pieces?: number }[] = [];

    for (const item of nonCancelled) {
      const line = draft[item.id] ?? { weightKg: "", pieces: "" };
      const weightKg = Number(line.weightKg);
      if (!Number.isFinite(weightKg) || weightKg <= 0) {
        toast({
          title: "Error",
          description: `Enter a valid weight for ${item.product?.name ?? "an item"}.`,
          variant: "destructive",
        });
        return;
      }
      const entry: { itemId: string; weightKg: number; pieces?: number } = { itemId: item.id, weightKg };
      if (line.pieces.trim() !== "") {
        const pieces = Number(line.pieces);
        if (!Number.isFinite(pieces) || pieces <= 0 || !Number.isInteger(pieces)) {
          toast({
            title: "Error",
            description: `Enter a whole number of pieces for ${item.product?.name ?? "an item"}.`,
            variant: "destructive",
          });
          return;
        }
        entry.pieces = pieces;
      }
      weights.push(entry);
    }

    setSubmitting(task.id);
    const result = await completeTask({
      organizationSlug,
      taskId: task.id,
      weights,
    });
    setSubmitting(null);

    if (!result.ok) {
      toast({ title: "Error", description: result.message, variant: "destructive" });
      return;
    }

    setTasks((prev) => prev.filter((t) => t.id !== task.id));
    toast({ title: "Task marked done" });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Today&apos;s tasks</h1>
        <p className="text-muted-foreground">Allocate and weigh orders for today&apos;s runs</p>
      </div>

      {tasks.length === 0 ? (
        <p className="text-muted-foreground">No tasks pending. Nice work.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {tasks.map((task) => (
            <div key={task.id} className="space-y-4 rounded-lg border p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-mono text-sm text-muted-foreground">Order {task.order.id.slice(0, 8)}</div>
                  <div className="font-semibold">{task.order.customer?.name ?? "Unknown customer"}</div>
                </div>
                <Badge variant="secondary">{task.order.truck?.code ?? "-"}</Badge>
              </div>

              <div className="space-y-3">
                {task.order.items
                  .filter((item) => !item.is_cancelled)
                  .map((item) => (
                    <div key={item.id} className="space-y-2 rounded-md bg-muted/50 p-3">
                      <div className="text-sm font-medium">{item.product?.name ?? "Unknown product"}</div>
                      <div className="text-xs text-muted-foreground">
                        {item.mode === "kg" ? `${item.quantity} kg ordered` : `${item.quantity} pcs ordered`} · size{" "}
                        {item.size_min_kg}–{item.size_max_kg} kg
                      </div>
                      <div className="flex gap-2">
                        <div className="flex-1 space-y-1">
                          <Label className="text-xs">Weight (kg)</Label>
                          <Input
                            type="number"
                            step="0.001"
                            min="0"
                            value={drafts[task.id]?.[item.id]?.weightKg ?? ""}
                            onChange={(e) => updateDraft(task.id, item.id, "weightKg", e.target.value)}
                          />
                        </div>
                        <div className="flex-1 space-y-1">
                          <Label className="text-xs">Pieces</Label>
                          <Input
                            type="number"
                            step="1"
                            min="0"
                            value={drafts[task.id]?.[item.id]?.pieces ?? ""}
                            onChange={(e) => updateDraft(task.id, item.id, "pieces", e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
              </div>

              <Button className="w-full" disabled={submitting === task.id} onClick={() => handleDone(task)}>
                {submitting === task.id ? "Saving…" : "Done"}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
