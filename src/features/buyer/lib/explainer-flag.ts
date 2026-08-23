export const EXPLAINER_FLAG_KEY = "buyer_pricing_explained_v1";

export function hasSeenExplainer(storage: Pick<Storage, "getItem">): boolean {
  return storage.getItem(EXPLAINER_FLAG_KEY) === "1";
}

export function markExplainerSeen(storage: Pick<Storage, "setItem">): void {
  storage.setItem(EXPLAINER_FLAG_KEY, "1");
}
