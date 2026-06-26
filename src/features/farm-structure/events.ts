export const FARM_STRUCTURE_EVENTS = {
  siteCreated: "farm_structure.site_created",
  siteUpdated: "farm_structure.site_updated",
  zoneCreated: "farm_structure.zone_created",
  houseCreated: "farm_structure.house_created",
  houseAreaCreated: "farm_structure.house_area_created",
  storageLocationCreated: "farm_structure.storage_location_created",
  productionProfileChanged: "farm_structure.production_profile_changed",
  targetProfileChanged: "farm_structure.target_profile_changed",
  targetProfileVersionCreated: "farm_structure.target_profile_version_created",
  targetProfileVersionApproved: "farm_structure.target_profile_version_approved",
  codeSetChanged: "farm_structure.code_set_changed",
  codeValueChanged: "farm_structure.code_value_changed",
  identifierGenerated: "farm_structure.identifier_generated",
} as const;

export type FarmStructureEvent =
  (typeof FARM_STRUCTURE_EVENTS)[keyof typeof FARM_STRUCTURE_EVENTS];
