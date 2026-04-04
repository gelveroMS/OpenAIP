import { NextResponse } from "next/server";
import { getActorContext } from "@/lib/domain/get-actor-context";
import { supabaseAdmin } from "@/lib/supabase/admin";

type ProfileRow = {
  id: string;
  role: "citizen" | "barangay_official" | "city_official" | "municipal_official" | "admin" | null;
  full_name: string | null;
  barangay_id: string | null;
  city_id: string | null;
  municipality_id: string | null;
};

type NameRow = {
  id: string;
  name: string;
};

type BarangayParentRow = {
  id: string;
  city_id: string | null;
  municipality_id: string | null;
};

type AccessContext =
  | { kind: "admin" }
  | { kind: "city"; cityId: string; barangayIds: Set<string> }
  | { kind: "municipality"; municipalityId: string; barangayIds: Set<string> }
  | { kind: "barangay"; barangayId: string; parentCityId: string | null; parentMunicipalityId: string | null };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function parseIds(url: URL): string[] {
  const raw = url.searchParams.get("ids")?.trim();
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0 && isUuid(value))
    )
  ).slice(0, 200);
}

function mergeProfiles(chunks: ProfileRow[][]): ProfileRow[] {
  const profileById = new Map<string, ProfileRow>();
  for (const chunk of chunks) {
    for (const profile of chunk) {
      profileById.set(profile.id, profile);
    }
  }
  return Array.from(profileById.values());
}

function canAccessProfile(profile: ProfileRow, access: AccessContext): boolean {
  if (access.kind === "admin") return true;

  if (access.kind === "city") {
    if (profile.city_id && profile.city_id === access.cityId) return true;
    return !!profile.barangay_id && access.barangayIds.has(profile.barangay_id);
  }

  if (access.kind === "municipality") {
    if (profile.municipality_id && profile.municipality_id === access.municipalityId) return true;
    return !!profile.barangay_id && access.barangayIds.has(profile.barangay_id);
  }

  if (profile.barangay_id && profile.barangay_id === access.barangayId) {
    return true;
  }
  if (
    access.parentCityId &&
    profile.role === "city_official" &&
    profile.city_id === access.parentCityId
  ) {
    return true;
  }
  if (
    access.parentMunicipalityId &&
    profile.role === "municipal_official" &&
    profile.municipality_id === access.parentMunicipalityId
  ) {
    return true;
  }
  return false;
}

export async function GET(request: Request) {
  try {
    const actor = await getActorContext();
    if (!actor) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    if (
      actor.role !== "barangay_official" &&
      actor.role !== "city_official" &&
      actor.role !== "municipal_official" &&
      actor.role !== "admin"
    ) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const url = new URL(request.url);
    const ids = parseIds(url);
    if (ids.length === 0) {
      return NextResponse.json({ items: [] }, { status: 200 });
    }

    const admin = supabaseAdmin();
    let access: AccessContext;
    let candidateProfiles: ProfileRow[] = [];

    if (actor.role === "admin") {
      access = { kind: "admin" };
      const { data, error } = await admin
        .from("profiles")
        .select("id,role,full_name,barangay_id,city_id,municipality_id")
        .in("id", ids);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      candidateProfiles = (data ?? []) as ProfileRow[];
    } else if (actor.role === "city_official") {
      if (actor.scope.kind !== "city" || !actor.scope.id) {
        return NextResponse.json({ error: "Forbidden." }, { status: 403 });
      }

      const cityId = actor.scope.id;
      const { data: barangayRows, error: barangaysError } = await admin
        .from("barangays")
        .select("id")
        .eq("city_id", cityId);
      if (barangaysError) {
        return NextResponse.json({ error: barangaysError.message }, { status: 500 });
      }

      const barangayIds = ((barangayRows ?? []) as Array<{ id: string }>)
        .map((row) => row.id)
        .filter((value) => typeof value === "string" && value.length > 0);
      const barangayIdSet = new Set(barangayIds);

      const directQuery = await admin
        .from("profiles")
        .select("id,role,full_name,barangay_id,city_id,municipality_id")
        .in("id", ids)
        .eq("city_id", cityId);
      if (directQuery.error) {
        return NextResponse.json({ error: directQuery.error.message }, { status: 500 });
      }

      const viaBarangayQuery =
        barangayIds.length > 0
          ? await admin
              .from("profiles")
              .select("id,role,full_name,barangay_id,city_id,municipality_id")
              .in("id", ids)
              .in("barangay_id", barangayIds)
          : { data: [], error: null };
      if (viaBarangayQuery.error) {
        return NextResponse.json({ error: viaBarangayQuery.error.message }, { status: 500 });
      }

      access = { kind: "city", cityId, barangayIds: barangayIdSet };
      candidateProfiles = mergeProfiles([
        (directQuery.data ?? []) as ProfileRow[],
        (viaBarangayQuery.data ?? []) as ProfileRow[],
      ]);
    } else if (actor.role === "municipal_official") {
      if (actor.scope.kind !== "municipality" || !actor.scope.id) {
        return NextResponse.json({ error: "Forbidden." }, { status: 403 });
      }

      const municipalityId = actor.scope.id;
      const { data: barangayRows, error: barangaysError } = await admin
        .from("barangays")
        .select("id")
        .eq("municipality_id", municipalityId);
      if (barangaysError) {
        return NextResponse.json({ error: barangaysError.message }, { status: 500 });
      }

      const barangayIds = ((barangayRows ?? []) as Array<{ id: string }>)
        .map((row) => row.id)
        .filter((value) => typeof value === "string" && value.length > 0);
      const barangayIdSet = new Set(barangayIds);

      const directQuery = await admin
        .from("profiles")
        .select("id,role,full_name,barangay_id,city_id,municipality_id")
        .in("id", ids)
        .eq("municipality_id", municipalityId);
      if (directQuery.error) {
        return NextResponse.json({ error: directQuery.error.message }, { status: 500 });
      }

      const viaBarangayQuery =
        barangayIds.length > 0
          ? await admin
              .from("profiles")
              .select("id,role,full_name,barangay_id,city_id,municipality_id")
              .in("id", ids)
              .in("barangay_id", barangayIds)
          : { data: [], error: null };
      if (viaBarangayQuery.error) {
        return NextResponse.json({ error: viaBarangayQuery.error.message }, { status: 500 });
      }

      access = { kind: "municipality", municipalityId, barangayIds: barangayIdSet };
      candidateProfiles = mergeProfiles([
        (directQuery.data ?? []) as ProfileRow[],
        (viaBarangayQuery.data ?? []) as ProfileRow[],
      ]);
    } else {
      if (actor.scope.kind !== "barangay" || !actor.scope.id) {
        return NextResponse.json({ error: "Forbidden." }, { status: 403 });
      }

      const barangayId = actor.scope.id;
      const { data: parentData, error: parentError } = await admin
        .from("barangays")
        .select("id,city_id,municipality_id")
        .eq("id", barangayId)
        .maybeSingle();
      if (parentError) {
        return NextResponse.json({ error: parentError.message }, { status: 500 });
      }
      const parent = (parentData ?? null) as BarangayParentRow | null;

      const sameBarangayQuery = await admin
        .from("profiles")
        .select("id,role,full_name,barangay_id,city_id,municipality_id")
        .in("id", ids)
        .eq("barangay_id", barangayId);
      if (sameBarangayQuery.error) {
        return NextResponse.json({ error: sameBarangayQuery.error.message }, { status: 500 });
      }

      const parentCityOfficialsQuery =
        parent?.city_id
          ? await admin
              .from("profiles")
              .select("id,role,full_name,barangay_id,city_id,municipality_id")
              .in("id", ids)
              .eq("role", "city_official")
              .eq("city_id", parent.city_id)
          : { data: [], error: null };
      if (parentCityOfficialsQuery.error) {
        return NextResponse.json({ error: parentCityOfficialsQuery.error.message }, { status: 500 });
      }

      const parentMunicipalOfficialsQuery =
        parent?.municipality_id
          ? await admin
              .from("profiles")
              .select("id,role,full_name,barangay_id,city_id,municipality_id")
              .in("id", ids)
              .eq("role", "municipal_official")
              .eq("municipality_id", parent.municipality_id)
          : { data: [], error: null };
      if (parentMunicipalOfficialsQuery.error) {
        return NextResponse.json(
          { error: parentMunicipalOfficialsQuery.error.message },
          { status: 500 }
        );
      }

      access = {
        kind: "barangay",
        barangayId,
        parentCityId: parent?.city_id ?? null,
        parentMunicipalityId: parent?.municipality_id ?? null,
      };
      candidateProfiles = mergeProfiles([
        (sameBarangayQuery.data ?? []) as ProfileRow[],
        (parentCityOfficialsQuery.data ?? []) as ProfileRow[],
        (parentMunicipalOfficialsQuery.data ?? []) as ProfileRow[],
      ]);
    }

    const profiles = candidateProfiles.filter((profile) => canAccessProfile(profile, access));

    const barangayIds = Array.from(
      new Set(
        profiles
          .map((profile) => profile.barangay_id)
          .filter((value): value is string => typeof value === "string" && value.length > 0)
      )
    );
    const cityIds = Array.from(
      new Set(
        profiles
          .map((profile) => profile.city_id)
          .filter((value): value is string => typeof value === "string" && value.length > 0)
      )
    );
    const municipalityIds = Array.from(
      new Set(
        profiles
          .map((profile) => profile.municipality_id)
          .filter((value): value is string => typeof value === "string" && value.length > 0)
      )
    );

    const [barangayResult, cityResult, municipalityResult] = await Promise.all([
      barangayIds.length
        ? admin.from("barangays").select("id,name").in("id", barangayIds)
        : Promise.resolve({ data: [], error: null }),
      cityIds.length
        ? admin.from("cities").select("id,name").in("id", cityIds)
        : Promise.resolve({ data: [], error: null }),
      municipalityIds.length
        ? admin.from("municipalities").select("id,name").in("id", municipalityIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (barangayResult.error) {
      return NextResponse.json({ error: barangayResult.error.message }, { status: 500 });
    }
    if (cityResult.error) {
      return NextResponse.json({ error: cityResult.error.message }, { status: 500 });
    }
    if (municipalityResult.error) {
      return NextResponse.json({ error: municipalityResult.error.message }, { status: 500 });
    }

    const barangayNameById = new Map(
      ((barangayResult.data ?? []) as NameRow[]).map((row) => [row.id, row.name])
    );
    const cityNameById = new Map(
      ((cityResult.data ?? []) as NameRow[]).map((row) => [row.id, row.name])
    );
    const municipalityNameById = new Map(
      ((municipalityResult.data ?? []) as NameRow[]).map((row) => [row.id, row.name])
    );

    return NextResponse.json(
      {
        items: profiles.map((profile) => ({
          id: profile.id,
          role: profile.role,
          full_name: profile.full_name,
          barangay_name: profile.barangay_id
            ? barangayNameById.get(profile.barangay_id) ?? null
            : null,
          city_name: profile.city_id ? cityNameById.get(profile.city_id) ?? null : null,
          municipality_name: profile.municipality_id
            ? municipalityNameById.get(profile.municipality_id) ?? null
            : null,
        })),
      },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to load profile metadata.",
      },
      { status: 500 }
    );
  }
}
