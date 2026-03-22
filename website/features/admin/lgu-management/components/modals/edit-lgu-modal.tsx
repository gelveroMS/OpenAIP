"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  BarangayParentType,
  LguRecord,
  LguStatus,
  UpdateLguInput,
} from "@/lib/repos/lgu/repo";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lgu: LguRecord | null;
  lgus: LguRecord[];
  onSave: (id: string, patch: UpdateLguInput, nextStatus: LguStatus) => Promise<void>;
  submitError: string | null;
};

function psgcLength(type: LguRecord["type"]) {
  if (type === "region") return 2;
  if (type === "province") return 4;
  if (type === "city") return 6;
  if (type === "municipality") return 6;
  return 9;
}

function typeLabel(type: LguRecord["type"]) {
  if (type === "region") return "Region";
  if (type === "province") return "Province";
  if (type === "city") return "City";
  if (type === "municipality") return "Municipality";
  return "Barangay";
}

function isNcrRegion(region: LguRecord | null) {
  if (!region) return false;
  return (
    region.code === "13" ||
    region.name.toLowerCase().includes("national capital region")
  );
}

export default function EditLguModal({
  open,
  onOpenChange,
  lgu,
  lgus,
  onSave,
  submitError,
}: Props) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<LguStatus>("active");
  const [regionId, setRegionId] = useState("");
  const [provinceId, setProvinceId] = useState("");
  const [parentType, setParentType] = useState<BarangayParentType | "">("");
  const [parentId, setParentId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const regions = useMemo(
    () =>
      lgus
        .filter((row) => row.type === "region")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [lgus]
  );
  const provinces = useMemo(
    () =>
      lgus
        .filter((row) => row.type === "province")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [lgus]
  );
  const cities = useMemo(
    () =>
      lgus
        .filter((row) => row.type === "city")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [lgus]
  );
  const municipalities = useMemo(
    () =>
      lgus
        .filter((row) => row.type === "municipality")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [lgus]
  );

  useEffect(() => {
    if (!lgu) return;
    setName(lgu.name);
    setCode(lgu.code);
    setStatus(lgu.status);
    setRegionId(lgu.regionId ?? "");
    setProvinceId(lgu.provinceId ?? "");
    setParentType(
      lgu.parentType === "city" || lgu.parentType === "municipality"
        ? lgu.parentType
        : ""
    );
    setParentId(lgu.parentId ?? "");
    setErrors({});
    setSubmitting(false);
  }, [lgu, open]);

  const selectedRegion = useMemo(
    () => regions.find((row) => row.id === regionId) ?? null,
    [regions, regionId]
  );
  const ncrSelected = isNcrRegion(selectedRegion);

  const filteredProvinces = useMemo(() => {
    if (!regionId) return provinces;
    return provinces.filter((row) => row.regionId === regionId);
  }, [provinces, regionId]);

  const filteredCityParents = useMemo(() => {
    return cities.filter((row) => {
      if (regionId && row.regionId !== regionId) return false;
      if (provinceId && row.provinceId !== provinceId) return false;
      return true;
    });
  }, [cities, regionId, provinceId]);

  const filteredMunicipalityParents = useMemo(() => {
    return municipalities.filter((row) => {
      if (regionId && row.regionId !== regionId) return false;
      if (provinceId && row.provinceId !== provinceId) return false;
      return true;
    });
  }, [municipalities, regionId, provinceId]);

  const parentOptions = useMemo(() => {
    if (parentType === "city") return filteredCityParents;
    if (parentType === "municipality") return filteredMunicipalityParents;
    return [];
  }, [filteredCityParents, filteredMunicipalityParents, parentType]);

  async function handleSave() {
    if (!lgu) return;

    const nextErrors: Record<string, string> = {};
    if (!name.trim()) nextErrors.name = "LGU Name is required.";
    if (!code.trim()) nextErrors.code = "PSGC code is required.";

    const expectedLength = psgcLength(lgu.type);
    if (!/^[0-9]+$/.test(code.trim())) {
      nextErrors.code = "PSGC code must contain digits only.";
    } else if (code.trim().length !== expectedLength) {
      nextErrors.code = `PSGC code for ${lgu.type} must be ${expectedLength} digits.`;
    }

    if (lgu.type === "province" && !regionId) {
      nextErrors.regionId = "Region is required for provinces.";
    }

    if (lgu.type === "city") {
      if (!regionId) nextErrors.regionId = "Region is required for cities.";
      if (!ncrSelected && !provinceId) {
        nextErrors.provinceId = "Province is required for cities outside NCR.";
      }
    }

    if (lgu.type === "municipality") {
      if (!regionId) nextErrors.regionId = "Region is required for municipalities.";
      if (!provinceId) nextErrors.provinceId = "Province is required for municipalities.";
    }

    if (lgu.type === "barangay") {
      if (!parentType) nextErrors.parentType = "Select City or Municipality.";
      if (!parentId) nextErrors.parentId = "Parent LGU is required for barangays.";
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const patch: UpdateLguInput = {
      name: name.trim(),
      code: code.trim(),
    };

    if (lgu.type === "province") {
      patch.regionId = regionId;
    } else if (lgu.type === "city") {
      patch.regionId = regionId;
      patch.provinceId = ncrSelected ? null : provinceId;
      patch.isIndependent = ncrSelected;
    } else if (lgu.type === "municipality") {
      patch.provinceId = provinceId;
    } else if (lgu.type === "barangay") {
      patch.parentType = parentType as BarangayParentType;
      patch.parentId = parentId;
    }

    setSubmitting(true);
    try {
      await onSave(lgu.id, patch, status);
      onOpenChange(false);
    } catch {
      // Parent view handles mutation errors and passes them via submitError.
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit LGU</DialogTitle>
        </DialogHeader>

        {!lgu ? (
          <div className="text-sm text-slate-500">No LGU selected.</div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>LGU Type</Label>
              <Input className="h-11 bg-slate-100" value={typeLabel(lgu.type)} disabled />
              <div className="text-xs text-slate-500">Type is fixed for existing records.</div>
            </div>

            <div className="space-y-2">
              <Label>
                LGU Name <span className="text-rose-600">*</span>
              </Label>
              <Input className="h-11" value={name} onChange={(e) => setName(e.target.value)} />
              {errors.name ? <div className="text-xs text-rose-600">{errors.name}</div> : null}
            </div>

            <div className="space-y-2">
              <Label>
                PSGC Code <span className="text-rose-600">*</span>
              </Label>
              <Input className="h-11" value={code} onChange={(e) => setCode(e.target.value)} />
              {errors.code ? <div className="text-xs text-rose-600">{errors.code}</div> : null}
            </div>

            {(lgu.type === "province" || lgu.type === "city" || lgu.type === "municipality" || lgu.type === "barangay") && (
              <div className="space-y-2">
                <Label>
                  {lgu.type === "barangay" ? "Filter by Region (optional)" : "Region"}
                  {lgu.type !== "barangay" ? <span className="text-rose-600"> *</span> : null}
                </Label>
                <Select
                  value={lgu.type === "barangay" ? (regionId || "all") : regionId}
                  onValueChange={(value) => {
                    const nextRegion = value === "all" ? "" : value;
                    setRegionId(nextRegion);
                    setProvinceId("");
                    if (lgu.type === "barangay") setParentId("");
                  }}
                >
                  <SelectTrigger className="h-11 w-full">
                    <SelectValue
                      placeholder={
                        lgu.type === "barangay" ? "All regions" : "Select region"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {lgu.type === "barangay" ? (
                      <SelectItem value="all">All regions</SelectItem>
                    ) : null}
                    {regions.map((row) => (
                      <SelectItem key={row.id} value={row.id}>
                        {row.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.regionId ? (
                  <div className="text-xs text-rose-600">{errors.regionId}</div>
                ) : null}
              </div>
            )}

            {(lgu.type === "city" || lgu.type === "municipality" || lgu.type === "barangay") && (
              <div className="space-y-2">
                <Label>
                  {lgu.type === "barangay" ? "Filter by Province (optional)" : "Province"}
                  {lgu.type === "municipality" || (lgu.type === "city" && !ncrSelected) ? (
                    <span className="text-rose-600"> *</span>
                  ) : null}
                </Label>
                <Select
                  value={lgu.type === "barangay" ? (provinceId || "all") : provinceId}
                  onValueChange={(value) => {
                    const nextProvince = value === "all" ? "" : value;
                    setProvinceId(nextProvince);
                    if (lgu.type === "barangay") setParentId("");
                  }}
                  disabled={lgu.type === "city" && ncrSelected}
                >
                  <SelectTrigger className="h-11 w-full">
                    <SelectValue
                      placeholder={
                        lgu.type === "barangay"
                          ? "All provinces"
                          : ncrSelected
                          ? "N/A for NCR cities"
                          : "Select province"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {lgu.type === "barangay" ? (
                      <SelectItem value="all">All provinces</SelectItem>
                    ) : null}
                    {filteredProvinces.map((row) => (
                      <SelectItem key={row.id} value={row.id}>
                        {row.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {ncrSelected && lgu.type === "city" ? (
                  <div className="text-xs text-slate-500">
                    Province is automatically set to N/A for NCR cities.
                  </div>
                ) : null}
                {errors.provinceId ? (
                  <div className="text-xs text-rose-600">{errors.provinceId}</div>
                ) : null}
              </div>
            )}

            {lgu.type === "barangay" ? (
              <>
                <div className="space-y-2">
                  <Label>
                    Parent Type <span className="text-rose-600">*</span>
                  </Label>
                  <Select
                    value={parentType}
                    onValueChange={(value) => {
                      setParentType(value as BarangayParentType);
                      setParentId("");
                    }}
                  >
                    <SelectTrigger className="h-11 w-full">
                      <SelectValue placeholder="Select parent type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="city">City</SelectItem>
                      <SelectItem value="municipality">Municipality</SelectItem>
                    </SelectContent>
                  </Select>
                  {errors.parentType ? (
                    <div className="text-xs text-rose-600">{errors.parentType}</div>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label>
                    Parent LGU <span className="text-rose-600">*</span>
                  </Label>
                  <Select value={parentId} onValueChange={setParentId}>
                    <SelectTrigger className="h-11 w-full">
                      <SelectValue placeholder="Select parent city/municipality" />
                    </SelectTrigger>
                    <SelectContent>
                      {parentOptions.map((row) => (
                        <SelectItem key={row.id} value={row.id}>
                          {row.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.parentId ? (
                    <div className="text-xs text-rose-600">{errors.parentId}</div>
                  ) : null}
                </div>
              </>
            ) : null}

            <div className="space-y-2">
              <Label>
                Status <span className="text-rose-600">*</span>
              </Label>
              <div className="flex items-center gap-8 pt-1">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="lgu-status"
                    value="active"
                    checked={status === "active"}
                    onChange={() => setStatus("active")}
                    className="h-4 w-4 accent-teal-700"
                  />
                  Active
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="lgu-status"
                    value="deactivated"
                    checked={status === "deactivated"}
                    onChange={() => setStatus("deactivated")}
                    className="h-4 w-4 accent-teal-700"
                  />
                  Deactivated
                </label>
              </div>
            </div>

            {submitError ? (
              <div
                className="pt-2 text-sm text-rose-600"
                data-testid="admin-edit-lgu-error"
              >
                {submitError}
              </div>
            ) : null}

            <div className="flex items-center gap-3">
              <Button
                className="flex-1 bg-teal-700 hover:bg-teal-800"
                onClick={handleSave}
                disabled={submitting}
              >
                Save LGU
              </Button>
              <Button
                className="flex-1"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
