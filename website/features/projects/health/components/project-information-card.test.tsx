import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ImgHTMLAttributes } from "react";
import { describe, expect, it, vi } from "vitest";
import type { HealthProject } from "@/features/projects/types";
import ProjectInformationCard from "./project-information-card";

vi.mock("next/image", () => ({
  default: (props: ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean }) => {
    const { fill, ...imgProps } = props;
    void fill;
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img alt={imgProps.alt ?? ""} {...imgProps} />
    );
  },
}));

function buildProject(overrides: Partial<HealthProject> = {}): HealthProject {
  return {
    id: "PROJ-H-TEST-DETAIL",
    kind: "health",
    year: 2026,
    title: "Health Project Detail Test",
    lguLabel: "Brgy. Test",
    status: "ongoing",
    imageUrl: "/mock/health/health1.jpg",
    month: "January",
    startDate: "2026-01-01",
    targetCompletionDate: "2026-10-01",
    description: "Project detail description",
    totalTargetParticipants: 250,
    targetParticipants: "Residents",
    implementingOffice: "Barangay Health Office",
    budgetAllocated: 250000,
    updates: [],
    ...overrides,
  };
}

describe("Health ProjectInformationCard image fallback", () => {
  it("uses logo fallback when image is missing and fallback is enabled", () => {
    render(
      <ProjectInformationCard
        aipYear={2026}
        project={buildProject({ imageUrl: undefined })}
        scope="citizen"
        useLogoFallback
      />
    );

    const image = screen.getByRole("img", { name: "Health Project Detail Test" });
    expect(image.getAttribute("src")).toContain("/brand/logo3.svg");
  });

  it("uses logo fallback when image is default placeholder and fallback is enabled", () => {
    render(
      <ProjectInformationCard
        aipYear={2026}
        project={buildProject({ imageUrl: "/default/default-no-image.jpg" })}
        scope="citizen"
        useLogoFallback
      />
    );

    const image = screen.getByRole("img", { name: "Health Project Detail Test" });
    expect(image.getAttribute("src")).toContain("/brand/logo3.svg");
  });

  it("switches to logo on image load error when fallback is enabled", async () => {
    render(
      <ProjectInformationCard
        aipYear={2026}
        project={buildProject({ imageUrl: "/broken/custom-image.jpg" })}
        scope="citizen"
        useLogoFallback
      />
    );

    const image = screen.getByRole("img", { name: "Health Project Detail Test" });
    expect(image.getAttribute("src")).toContain("/broken/custom-image.jpg");

    fireEvent.error(image);

    await waitFor(() => {
      expect(image.getAttribute("src")).toContain("/brand/logo3.svg");
    });
  });
});

describe("Health ProjectInformationCard date rendering", () => {
  it("renders full date range when both dates are valid", () => {
    render(
      <ProjectInformationCard
        aipYear={2026}
        project={buildProject()}
        scope="citizen"
      />
    );

    expect(screen.getByText("January 1, 2026 - October 1, 2026")).toBeInTheDocument();
  });

  it("renders one-sided label when only start date is valid", () => {
    render(
      <ProjectInformationCard
        aipYear={2026}
        project={buildProject({ targetCompletionDate: "Unknown date" })}
        scope="citizen"
      />
    );

    expect(screen.getByText("Starts January 1, 2026")).toBeInTheDocument();
  });

  it("renders one-sided label when only end date is valid", () => {
    render(
      <ProjectInformationCard
        aipYear={2026}
        project={buildProject({ startDate: "Unknown date" })}
        scope="citizen"
      />
    );

    expect(screen.getByText("Ends October 1, 2026")).toBeInTheDocument();
  });

  it("renders N/A when both dates are invalid", () => {
    render(
      <ProjectInformationCard
        aipYear={2026}
        project={buildProject({
          startDate: "Unknown",
          targetCompletionDate: "invalid date",
        })}
        scope="citizen"
      />
    );

    expect(screen.getByText("N/A")).toBeInTheDocument();
  });
});
