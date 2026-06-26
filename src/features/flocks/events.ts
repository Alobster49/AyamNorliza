export const FLOCK_EVENTS = {
  planCreated: "flock.plan_created",
  planApproved: "flock.plan_approved",
  houseReady: "flock.house_ready",
  placed: "flock.placed",
  stageChanged: "flock.stage_changed",
  restricted: "flock.restricted",
  moved: "flock.moved",
  harvestStarted: "flock.harvest_started",
  depopulated: "flock.depopulated",
  closed: "flock.closed",
} as const;

export type FlockEvent = (typeof FLOCK_EVENTS)[keyof typeof FLOCK_EVENTS];
