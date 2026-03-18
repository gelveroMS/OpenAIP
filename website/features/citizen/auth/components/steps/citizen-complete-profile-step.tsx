"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import CitizenAuthHeader from "@/features/citizen/auth/components/citizen-auth-header";

type SelectOption = {
  value: string;
  label: string;
};

type CitizenCompleteProfileStepProps = {
  titleId: string;
  descriptionId: string;
  firstName: string;
  lastName: string;
  provinceId: string;
  cityOrMunicipalityId: string;
  barangayId: string;
  provinceOptions: SelectOption[];
  cityOrMunicipalityOptions: SelectOption[];
  barangayOptions: SelectOption[];
  isGeoLoading: boolean;
  geoLoadError: string | null;
  errorMessage: string | null;
  isLoading: boolean;
  onFirstNameChange: (value: string) => void;
  onLastNameChange: (value: string) => void;
  onProvinceChange: (value: string) => void;
  onCityOrMunicipalityChange: (value: string) => void;
  onBarangayChange: (value: string) => void;
  onSubmit: () => void;
};

export default function CitizenCompleteProfileStep({
  titleId,
  descriptionId,
  firstName,
  lastName,
  provinceId,
  cityOrMunicipalityId,
  barangayId,
  provinceOptions,
  cityOrMunicipalityOptions,
  barangayOptions,
  isGeoLoading,
  geoLoadError,
  errorMessage,
  isLoading,
  onFirstNameChange,
  onLastNameChange,
  onProvinceChange,
  onCityOrMunicipalityChange,
  onBarangayChange,
  onSubmit,
}: CitizenCompleteProfileStepProps) {
  const isCityDisabled =
    isLoading || isGeoLoading || !provinceId || cityOrMunicipalityOptions.length === 0;
  const isBarangayDisabled =
    isLoading || isGeoLoading || !cityOrMunicipalityId || barangayOptions.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-white px-5 py-6 sm:px-6 sm:py-7 md:p-10">
      <div className="m-auto w-full max-w-[420px] space-y-6 md:max-w-md md:space-y-7">
        <CitizenAuthHeader
          titleId={titleId}
          descriptionId={descriptionId}
          title="Complete Your Profile"
          description="All fields are required before you can continue."
        />

        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
          className="space-y-4 md:space-y-5"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="citizen-first-name" className="text-sm font-medium text-slate-800">
                First Name
              </Label>
              <Input
                id="citizen-first-name"
                type="text"
                autoComplete="given-name"
                required
                autoFocus
                value={firstName}
                onChange={(event) => onFirstNameChange(event.target.value)}
                placeholder="Juan"
                disabled={isLoading}
                className="h-12 rounded-xl border-slate-300 bg-white text-base text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-[#0EA5C6]/40"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="citizen-last-name" className="text-sm font-medium text-slate-800">
                Last Name
              </Label>
              <Input
                id="citizen-last-name"
                type="text"
                autoComplete="family-name"
                required
                value={lastName}
                onChange={(event) => onLastNameChange(event.target.value)}
                placeholder="Dela Cruz"
                disabled={isLoading}
                className="h-12 rounded-xl border-slate-300 bg-white text-base text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-[#0EA5C6]/40"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="citizen-province" className="text-sm font-medium text-slate-800">
              Province
            </Label>
            <Select
              value={provinceId || undefined}
              onValueChange={onProvinceChange}
              disabled={isLoading}
            >
              <SelectTrigger
                id="citizen-province"
                className="h-12 w-full rounded-xl border-slate-300 bg-white px-3 text-base text-slate-900 focus-visible:ring-2 focus-visible:ring-[#0EA5C6]/40"
              >
                <SelectValue placeholder={isGeoLoading ? "Loading provinces..." : "Select province"} />
              </SelectTrigger>
              <SelectContent>
                {provinceOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="citizen-city-or-municipality" className="text-sm font-medium text-slate-800">
                City
              </Label>
              <Select
                value={cityOrMunicipalityId || undefined}
                onValueChange={onCityOrMunicipalityChange}
                disabled={isCityDisabled}
              >
                <SelectTrigger
                  id="citizen-city-or-municipality"
                  className="h-12 w-full rounded-xl border-slate-300 bg-white px-3 text-base text-slate-900 focus-visible:ring-2 focus-visible:ring-[#0EA5C6]/40"
                >
                  <SelectValue
                    placeholder={
                      isGeoLoading
                        ? "Loading cities..."
                        : provinceId
                          ? "Select city"
                          : "Select province first"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {cityOrMunicipalityOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="citizen-barangay" className="text-sm font-medium text-slate-800">
                Barangay
              </Label>
              <Select
                value={barangayId || undefined}
                onValueChange={onBarangayChange}
                disabled={isBarangayDisabled}
              >
                <SelectTrigger
                  id="citizen-barangay"
                  className="h-12 w-full rounded-xl border-slate-300 bg-white px-3 text-base text-slate-900 focus-visible:ring-2 focus-visible:ring-[#0EA5C6]/40"
                >
                  <SelectValue
                    placeholder={
                      isGeoLoading
                        ? "Loading barangays..."
                        : cityOrMunicipalityId
                          ? "Select barangay"
                          : "Select city first"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {barangayOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {geoLoadError ? (
            <p
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {geoLoadError}
            </p>
          ) : null}

          {errorMessage ? (
            <p
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {errorMessage}
            </p>
          ) : null}

          <Button
            type="submit"
            className="h-12 w-full rounded-xl bg-[#022E45] text-base font-semibold text-white hover:bg-[#01304A] focus-visible:ring-2 focus-visible:ring-[#0EA5C6]/40"
            disabled={isLoading}
          >
            {isLoading ? "Saving profile..." : "Save and continue"}
          </Button>
        </form>
      </div>
    </div>
  );
}
