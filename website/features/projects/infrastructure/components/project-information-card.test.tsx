import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ImgHTMLAttributes } from "react";
import { describe, expect, it, vi } from "vitest";
import type { InfrastructureProject } from "@/features/projects/types";
import InfrastructureProjectInformationCard from "./project-information-card";

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

function buildProject(
  overrides: Partial<InfrastructureProject> = {}
): InfrastructureProject {
  return {
    id: "PROJ-I-TEST-DETAIL",
    kind: "infrastructure",
    year: 2026,
    title: "Infrastructure Project Detail Test",
    lguLabel: "Brgy. Test",
    status: "proposed",
    imageUrl: "/mock/infra/infra1.jpg",
    description: "Project detail description",
    startDate: "2026-01-01",
    targetCompletionDate: "2026-10-01",
    implementingOffice: "Barangay Engineering Office",
    fundingSource: "General Fund",
    contractorName: "Build Co",
    contractCost: 1200000,
    updates: [],
    ...overrides,
  };
}

describe("Infrastructure ProjectInformationCard image fallback", () => {
  it("uses logo fallback when image is missing and fallback is enabled", () => {
    render(
      <InfrastructureProjectInformationCard
        aipYear={2026}
        project={buildProject({ imageUrl: undefined })}
        scope="citizen"
        useLogoFallback
      />
    );

    const image = screen.getByRole("img", { name: "Infrastructure Project Detail Test" });
    expect(image.getAttribute("src")).toContain("/brand/logo3.svg");
  });

  it("uses logo fallback when image is default placeholder and fallback is enabled", () => {
    render(
      <InfrastructureProjectInformationCard
        aipYear={2026}
        project={buildProject({ imageUrl: "/default/default-no-image.jpg" })}
        scope="citizen"
        useLogoFallback
      />
    );

    const image = screen.getByRole("img", { name: "Infrastructure Project Detail Test" });
    expect(image.getAttribute("src")).toContain("/brand/logo3.svg");
  });

  it("switches to logo on image load error when fallback is enabled", async () => {
    render(
      <InfrastructureProjectInformationCard
        aipYear={2026}
        project={buildProject({ imageUrl: "/broken/custom-image.jpg" })}
        scope="citizen"
        useLogoFallback
      />
    );

    const image = screen.getByRole("img", { name: "Infrastructure Project Detail Test" });
    expect(image.getAttribute("src")).toContain("/broken/custom-image.jpg");

    fireEvent.error(image);

    await waitFor(() => {
      expect(image.getAttribute("src")).toContain("/brand/logo3.svg");
    });
  });
});

describe("Infrastructure ProjectInformationCard date rendering", () => {
  it("renders full date range when both dates are valid", () => {
    render(
      <InfrastructureProjectInformationCard
        aipYear={2026}
        project={buildProject()}
        scope="citizen"
      />
    );

    expect(screen.getByText("January 1, 2026 - October 1, 2026")).toBeInTheDocument();
  });

  it("renders one-sided label when only start date is valid", () => {
    render(
      <InfrastructureProjectInformationCard
        aipYear={2026}
        project={buildProject({
          targetCompletionDate: "unknown date",
        })}
        scope="citizen"
      />
    );

    expect(screen.getByText("Starts January 1, 2026")).toBeInTheDocument();
  });

  it("renders one-sided label when only end date is valid", () => {
    render(
      <InfrastructureProjectInformationCard
        aipYear={2026}
        project={buildProject({
          startDate: "unknown date",
        })}
        scope="citizen"
      />
    );

    expect(screen.getByText("Ends October 1, 2026")).toBeInTheDocument();
  });

  it("renders N/A when both dates are invalid", () => {
    render(
      <InfrastructureProjectInformationCard
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
