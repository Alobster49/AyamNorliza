import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Flock } from "../types";
import { untypedDb } from "@/features/farm-structure/server/db";

export async function listFlocks(organizationId: string): Promise<Flock[]> {
  const db = untypedDb(await createSupabaseServerClient());
  const { data, error } = await db
    .from("flocks")
    .select(
      "id, organization_id, site_id, house_id, production_profile_id, target_profile_version_id, code, name, production_type, source_name, breed_strain, sex, hatch_date, planned_arrival_date, expected_end_date, planned_quantity, current_live_birds, status, created_at, updated_at",
    )
    .eq("organization_id", organizationId)
    .order("planned_arrival_date", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToFlock);
}

export async function listFlocksForHouse(organizationId: string, houseId: string): Promise<Flock[]> {
  const db = untypedDb(await createSupabaseServerClient());
  const { data, error } = await db
    .from("flocks")
    .select(
      "id, organization_id, site_id, house_id, production_profile_id, target_profile_version_id, code, name, production_type, source_name, breed_strain, sex, hatch_date, planned_arrival_date, expected_end_date, planned_quantity, current_live_birds, status, created_at, updated_at",
    )
    .eq("organization_id", organizationId)
    .eq("house_id", houseId)
    .order("planned_arrival_date", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToFlock);
}

export async function getFlock(flockId: string): Promise<Flock | null> {
  const db = untypedDb(await createSupabaseServerClient());
  const { data, error } = await db
    .from("flocks")
    .select(
      "id, organization_id, site_id, house_id, production_profile_id, target_profile_version_id, code, name, production_type, source_name, breed_strain, sex, hatch_date, planned_arrival_date, expected_end_date, planned_quantity, current_live_birds, status, created_at, updated_at",
    )
    .eq("id", flockId)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToFlock(data) : null;
}

export function rowToFlock(row: any): Flock {
  return {
    id: row.id,
    organizationId: row.organization_id,
    siteId: row.site_id,
    houseId: row.house_id,
    productionProfileId: row.production_profile_id,
    targetProfileVersionId: row.target_profile_version_id,
    code: row.code,
    name: row.name,
    productionType: row.production_type,
    sourceName: row.source_name,
    breedStrain: row.breed_strain,
    sex: row.sex,
    hatchDate: row.hatch_date,
    plannedArrivalDate: row.planned_arrival_date,
    expectedEndDate: row.expected_end_date,
    plannedQuantity: row.planned_quantity,
    currentLiveBirds: row.current_live_birds,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
