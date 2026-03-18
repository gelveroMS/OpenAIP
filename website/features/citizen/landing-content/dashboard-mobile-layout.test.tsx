import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProjectHighlightVM, SectorDistributionVM } from "@/lib/domain/landing-content";
import FullScreenSection from "./components/layout/full-screen-section";
import FundsDistributionMotion from "./views/sections/funds-distribution-motion.client";
import HealthProjectsSection from "./views/sections/health-projects-section";
import InfrastructureProjectsSection from "./views/sections/infrastructure-projects-section";
import HeroMotion from "./views/sections/hero-motion.client";
import ManifestoMotion from "./views/sections/manifesto-motion.client";
import LguBudgetOverviewMotion from "./views/sections/lgu-budget-overview-motion.client";

vi.mock("framer-motion", async () => {
  const React = await import("react");
  type MotionProps = { children?: React.ReactNode } & Record<string, unknown>;
  const filterMotionProps = (props: MotionProps) =>
    Object.fromEntries(
      Object.entries(props).filter(([key]) =>
        ![
          "initial",
          "animate",
          "variants",
          "transition",
          "whileHover",
          "whileTap",
          "whileInView",
          "viewport",
          "onViewportEnter",
          "onViewportLeave",
        ].includes(key)
      )
    );
  const motionFactory = (tag: string) => {
    const MotionTag = ({ children, ...props }: MotionProps) =>
      React.createElement(tag, filterMotionProps(props), children);
    MotionTag.displayName = `Motion(${tag})`;
    return MotionTag;
  };

  return {
    motion: new Proxy(
      {},
      {
        get: (_, tag) => motionFactory(tag as string),
      }
    ),
    useInView: () => true,
    useReducedMotion: () => false,
  };
});

vi.mock("./components/map/lgu-map-panel", () => ({
  default: ({ heightClass }: { heightClass: string }) => (
    <div data-testid="mock-lgu-map-panel" className={heightClass}>
      map
    </div>
  ),
}));

function buildDistributionVm(): SectorDistributionVM {
  return {
    total: 5_509_600_000,
    unitLabel: "PHP",
    sectors: [
      { key: "general", label: "General Services", percent: 45, amount: 2_479_320_000 },
      { key: "social", label: "Social Services", percent: 30, amount: 1_652_880_000 },
      { key: "economic", label: "Economic Services", percent: 15, amount: 826_440_000 },
      { key: "other", label: "Other Services", percent: 10, amount: 550_960_000 },
    ],
  };
}

function buildProjectsVm(): ProjectHighlightVM {
  return {
    heading: "Health Projects",
    description: "Strengthening healthcare access through local programs.",
    primaryKpiLabel: "Total Healthcare Budget",
    primaryKpiValue: 60_000_000,
    secondaryKpiLabel: "Total Projects",
    secondaryKpiValue: 3,
    projects: [
      {
        id: "health-1",
        title: "Unspecified project",
        subtitle: "All necessary drugs and medicines provided.",
        imageSrc: "/citizen-dashboard/health-bg.webp",
        tagLabel: "Health",
        budget: 10_000_000,
      },
      {
        id: "health-2",
        title: "Barangay clinic equipment",
        subtitle: "Equipment and supplies refresh.",
        imageSrc: "/citizen-dashboard/health-bg.webp",
        tagLabel: "Health",
        budget: 8_000_000,
      },
    ],
  };
}

describe("Citizen dashboard mobile layout", () => {
  it("uses content-fit section classes on mobile while preserving md+ full-height classes", () => {
    const { container } = render(
      <FullScreenSection id="sample">
        <div>content</div>
      </FullScreenSection>
    );

    const section = container.querySelector("section");
    expect(section).not.toBeNull();
    expect(section?.className).toContain("min-h-0");
    expect(section?.className).toContain("md:min-h-screen");
    expect(section?.className).toContain("overflow-x-hidden");
  });

  it("renders funds distribution in mobile-safe containers with compact donut hooks", () => {
    render(<FundsDistributionMotion vm={buildDistributionVm()} />);

    const root = screen.getByTestId("funds-distribution-root");
    const shell = screen.getByTestId("funds-distribution-donut-shell");
    expect(root.className).toContain("min-w-0");
    expect(shell.className).toContain("min-h-[320px]");

    const donutWrappers = Array.from(shell.querySelectorAll("div"));
    const mobileDonutWrapper = donutWrappers.find(
      (node) => node.className.includes("max-w-[240px]") && node.className.includes("md:hidden")
    );
    const desktopDonutWrapper = donutWrappers.find(
      (node) => node.className.includes("max-w-[340px]") && node.className.includes("md:block")
    );
    expect(mobileDonutWrapper).not.toBeNull();
    expect(desktopDonutWrapper).not.toBeNull();
  });

  it("keeps mobile showcase as single-card-focused stage for health and infrastructure", () => {
    render(
      <>
        <HealthProjectsSection vm={buildProjectsVm()} />
        <InfrastructureProjectsSection vm={buildProjectsVm()} />
      </>
    );

    const healthNext = screen.getByTestId("health-carousel-next");
    const healthActive = screen.getByTestId("health-carousel-active");
    expect(healthNext.className).toContain("hidden");
    expect(healthNext.className).toContain("md:block");
    expect(healthActive.className).toContain("w-[calc(100vw-3rem)]");

    const infraNext = screen.getByTestId("infrastructure-carousel-next");
    const infraActive = screen.getByTestId("infrastructure-carousel-active");
    expect(infraNext.className).toContain("hidden");
    expect(infraNext.className).toContain("md:block");
    expect(infraActive.className).toContain("w-[calc(100vw-3rem)]");
  });

  it("applies wrap-safe classes to key dashboard mobile headings", () => {
    render(
      <>
        <HeroMotion title="Know Where\nEvery Peso Goes." subtitle="Subtitle" cta={<button type="button">CTA</button>} />
        <ManifestoMotion
          eyebrow="PUBLIC. CLEAR. ACCOUNTABLE."
          lines={["Every allocation.", "Every project.", "Every peso."]}
          emphasis="Fully Transparent."
          supportingLine="Because public funds deserve public clarity."
        />
        <LguBudgetOverviewMotion
          vm={{
            lguName: "City of Cabuyao City - Annual Investment Plan 2026",
            scopeLabel: "City",
            fiscalYearLabel: "FY 2026",
            totalBudget: 5_509_600_000,
            budgetDeltaLabel: "-65.5% vs FY 2022",
            projectCount: 11,
            projectDeltaLabel: "-1182 vs FY 2022",
            aipStatus: "Published",
            citizenCount: 3,
            map: {
              center: { lat: 14.2456, lng: 121.136 },
              zoom: 12,
              selectedFiscalYear: 2026,
              markers: [],
            },
          }}
          mapPanelHeightClass="h-[300px]"
        />
      </>
    );

    const heroHeading = screen.getByText(
      (_, element) =>
        element?.tagName.toLowerCase() === "h1" &&
        element.textContent?.includes("Know Where\\nEvery Peso Goes.") === true
    );
    const manifestoHeading = screen.getByText("Every allocation.");
    const lguName = screen.getByText("City of Cabuyao City - Annual Investment Plan 2026");
    expect(heroHeading.className).toContain("break-words");
    expect(manifestoHeading.className).toContain("break-words");
    expect(lguName.className).toContain("break-words");
  });
});
