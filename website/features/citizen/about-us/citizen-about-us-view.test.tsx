import { render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";
import CitizenAboutUsView from "@/features/citizen/about-us/views/citizen-about-us-view";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => (
    <div
      role="img"
      aria-label={String(props.alt ?? "")}
      data-src={String(props.src ?? "")}
    />
  ),
}));

vi.mock("framer-motion", () => {
  const createMotionComponent = () =>
    function MotionComponent({
      children,
      ...props
    }: PropsWithChildren<
      Record<string, unknown> & {
        whileInView?: unknown;
        viewport?: unknown;
        variants?: unknown;
        initial?: unknown;
        animate?: unknown;
        exit?: unknown;
        transition?: unknown;
      }
    >) {
      const nextProps = { ...props };
      delete nextProps.whileInView;
      delete nextProps.viewport;
      delete nextProps.variants;
      delete nextProps.initial;
      delete nextProps.animate;
      delete nextProps.exit;
      delete nextProps.transition;

      return <div {...nextProps}>{children}</div>;
    };

  return {
    motion: new Proxy(
      {},
      {
        get: () => createMotionComponent(),
      }
    ),
    useReducedMotion: () => true,
  };
});

describe("CitizenAboutUsView", () => {
  it("renders CTA tile links with backend quick-link targets", () => {
    render(
      <CitizenAboutUsView
        quickLinksById={{
          dashboard: "/",
          budget_allocation: "/budget-allocation",
          aips: "/aips",
          projects: "/projects",
        }}
        referenceDocs={[
          {
            id: "dbm_primer_cover",
            title: "DBM Primer Cover",
            source: "Source: DBM",
            href: "/api/citizen/about-us/reference/dbm_primer_cover",
          },
          {
            id: "ra_7160",
            title: "RA 7160",
            source: "Source: Official Code",
            href: "/api/citizen/about-us/reference/ra_7160",
          },
          {
            id: "lbm_92_fy_2026",
            title: "LBM No. 92, FY 2026",
            source: "Source: DBM",
            href: "/api/citizen/about-us/reference/lbm_92_fy_2026",
          },
        ]}
      />
    );

    expect(screen.getByRole("link", { name: /View Interactive Dashboard/i })).toHaveAttribute(
      "href",
      "/"
    );
    expect(screen.getByRole("link", { name: /Compare Budget Allocations/i })).toHaveAttribute(
      "href",
      "/budget-allocation"
    );
    expect(screen.getByRole("link", { name: /Browse AIP Documents/i })).toHaveAttribute(
      "href",
      "/aips"
    );
    expect(screen.getByRole("link", { name: /Explore Local Projects/i })).toHaveAttribute(
      "href",
      "/projects"
    );
  });

  it("renders View PDF links and disables button when href is unavailable", () => {
    render(
      <CitizenAboutUsView
        quickLinksById={{
          dashboard: "/",
          budget_allocation: "/budget-allocation",
          aips: "/aips",
          projects: "/projects",
        }}
        referenceDocs={[
          {
            id: "dbm_primer_cover",
            title: "DBM Primer Cover",
            source: "Source: DBM",
            href: "/api/citizen/about-us/reference/dbm_primer_cover",
          },
          {
            id: "ra_7160",
            title: "RA 7160",
            source: "Source: Official Code",
            href: null,
          },
          {
            id: "lbm_92_fy_2026",
            title: "LBM No. 92, FY 2026",
            source: "Source: DBM",
            href: "/api/citizen/about-us/reference/lbm_92_fy_2026",
          },
        ]}
      />
    );

    const pdfLinks = screen.getAllByRole("link", { name: "View PDF" });
    expect(pdfLinks.map((link) => link.getAttribute("href"))).toContain(
      "/api/citizen/about-us/reference/dbm_primer_cover"
    );
    expect(pdfLinks.map((link) => link.getAttribute("href"))).toContain(
      "/api/citizen/about-us/reference/lbm_92_fy_2026"
    );

    expect(screen.getByRole("button", { name: "View PDF" })).toBeDisabled();
  });
});
