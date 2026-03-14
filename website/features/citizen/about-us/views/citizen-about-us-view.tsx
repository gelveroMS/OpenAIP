"use client";

import Image from "next/image";
import Link from "next/link";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import {
  BarChart3,
  Building2,
  CircleDollarSign,
  Clock3,
  FileText,
  Layers,
  ScrollText,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import CitizenPageHero from "@/features/citizen/components/citizen-page-hero";

const VIEWPORT_ONCE = { once: true, amount: 0.2 } as const;

const featureCards = [
  {
    title: "Interactive Dashboards",
    description: "See priorities at a glance.",
    icon: BarChart3,
    tint: "#0047AB0D",
    border: "#0047AB26",
  },
  {
    title: "Sector Breakdowns",
    description: "Understand allocations by sector and location.",
    icon: Layers,
    tint: "#2E7D320D",
    border: "#2E7D3226",
  },
  {
    title: "Funding Allocations",
    description: "Track where funds are planned.",
    icon: CircleDollarSign,
    tint: "#0047AB0D",
    border: "#0047AB26",
  },
  {
    title: "Project Timelines",
    description: "View implementation windows and outputs.",
    icon: Clock3,
    tint: "#2E7D320D",
    border: "#2E7D3226",
  },
];

const legalBasis = [
  {
    label: "Law",
    title: "Republic Act No. 7160 (Local Government Code of 1991)",
    items: [
      "Mandates planning-linked budgeting and development investment.",
      "Sec. 305: budgets operationalize approved development plans.",
      "Sec. 287: 20% of NTA for development projects.",
      "Sec. 17(b): devolved basic services responsibility.",
    ],
    armClass: "bg-[#0047ab]/35",
    pillClass: "border-[#0047ab]/35 text-[#0047ab]",
  },
  {
    label: "Memorandum",
    title: "Local Budget Memorandum (LBM No. 92, FY 2026)",
    items: [
      "Requires total resource AIP preparation.",
      "Prescribes official AIP templates and compliance rules.",
      "Mandates statutory allocations and climate tagging.",
    ],
    armClass: "bg-[#00384b]/35",
    pillClass: "border-[#00384b]/35 text-[#00384b]",
  },
  {
    label: "Allocations",
    title: "Other statutory allocations reflected in AIPs include",
    chips: [
      "20% Development Fund",
      "5% DRRM Fund",
      "5% GAD Budget",
      "10% SK Fund",
      "PWDs",
      "Children",
      "Public Health",
      "Senior Citizens",
    ],
    armClass: "bg-[#2e7d32]/35",
    pillClass: "border-[#2e7d32]/35 text-[#2e7d32]",
  },
];

const citizenQuestions = [
  {
    title: "What projects will be implemented this year?",
    image: "/citizen-dashboard/health.jpg",
    icon: ScrollText,
  },
  {
    title: "How much is allocated to each sector?",
    image: "/citizen-dashboard/farm.jpg",
    icon: Clock3,
  },
  {
    title: "Which office is responsible?",
    image: "/citizen-dashboard/people.jpg",
    icon: Building2,
  },
  {
    title: "What outputs are expected? How are mandatory funds being used?",
    image: "/citizen-dashboard/kids.jpg",
    icon: BarChart3,
  },
];

const ctaTiles = [
  {
    id: "dashboard",
    title: "View Interactive Dashboard",
    subtitle: "Explore budget data visually",
    icon: BarChart3,
  },
  {
    id: "budget_allocation",
    title: "Compare Budget Allocations",
    subtitle: "Analyze spending across sectors",
    icon: CircleDollarSign,
  },
  {
    id: "aips",
    title: "Browse AIP Documents",
    subtitle: "Monitor project implementation",
    icon: FileText,
  },
  {
    id: "projects",
    title: "Explore Local Projects",
    subtitle: "Browse planned projects and updates",
    icon: Building2,
  },
];

type CitizenAboutUsViewProps = {
  referenceDocs: Array<{
    id: string;
    title: string;
    source: string;
    href: string | null;
  }>;
  quickLinksById: Record<string, string>;
};

export default function CitizenAboutUsView({
  referenceDocs,
  quickLinksById,
}: CitizenAboutUsViewProps) {
  const shouldReduceMotion = useReducedMotion();

  const sectionReveal: Variants = {
    hidden: { opacity: 0, y: shouldReduceMotion ? 0 : 16 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: shouldReduceMotion ? 0.2 : 0.45,
        ease: [0.22, 1, 0.36, 1],
      },
    },
  };

  const cardReveal: Variants = {
    hidden: { opacity: 0, y: shouldReduceMotion ? 0 : 12 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: shouldReduceMotion ? 0.2 : 0.35,
        ease: [0.22, 1, 0.36, 1],
      },
    },
  };

  const legalCardReveal: Variants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { duration: shouldReduceMotion ? 0.2 : 0.3, ease: "easeOut" },
    },
  };

  const staggerContainer: Variants = {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: shouldReduceMotion ? 0.04 : 0.1,
        delayChildren: shouldReduceMotion ? 0 : 0.05,
      },
    },
  };

  return (
    <section className="min-h-dvh w-full bg-gradient-to-b from-[#d3dbe0] to-white">
      <div className="mx-auto max-w-6xl space-y-10 px-4 sm:px-6 sm:py-2 lg:px-8">
        <motion.div variants={sectionReveal} initial="hidden" whileInView="visible" viewport={VIEWPORT_ONCE}>
          <CitizenPageHero
            title="ABOUT US"
            subtitle="Explore how your city or barangay plans to use public funds for programs, projects, and community development throughout the year."
            imageSrc="/citizen-dashboard/hero2.webp"
          />
        </motion.div>

        <motion.section
          className="rounded-2xl border border-slate-200 bg-[#F3F5F7] p-4 shadow-sm sm:p-8"
          variants={sectionReveal}
          initial="hidden"
          whileInView="visible"
          viewport={VIEWPORT_ONCE}
        >
          <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2 lg:gap-10">
            <div className="space-y-3 sm:space-y-4">
              <Badge className="bg-[#0247A1] text-white">Transparency Platform</Badge>
              <h2 className="text-xl font-semibold text-[#022437] sm:text-3xl">What is OpenAIP?</h2>
              <p className="text-base font-bold text-[#0247A1] sm:text-lg">Turning AIP PDFs into citizen-readable open data.</p>
              <p className="text-xs leading-6 text-slate-600 sm:text-sm">
                OPENAIP transforms Local Government Unit (LGU) Annual Investment Plans from static PDF documents into structured, searchable, and visual open data.
              </p>
              <p className="text-xs leading-6 text-slate-600 sm:text-sm">
                By converting complex budget information into accessible formats, we make local government planning transparent and understandable to all citizens.
              </p>
              <p className="text-xs leading-6 text-slate-600 sm:text-sm">
                The platform provides real-time insights into how public funds are allocated across sectors, programs, and projects-empowering communities to actively participate in local governance.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <span className="rounded-full border border-slate-200 bg-white/70 px-3 py-1 text-xs text-[#00384b]">
                  Official AIP Documents
                </span>
                <span className="rounded-full border border-slate-200 bg-white/70 px-3 py-1 text-xs text-[#00384b]">
                  Standardized Templates
                </span>
                <span className="rounded-full border border-slate-200 bg-white/70 px-3 py-1 text-xs text-[#00384b]">
                  Citizen-Friendly Visuals
                </span>
              </div>
            </div>

            <motion.div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4" variants={staggerContainer}>
              {featureCards.map((card) => {
                const Icon = card.icon;
                return (
                  <motion.div key={card.title} variants={cardReveal}>
                    <Card
                      className="rounded-2xl shadow-sm"
                      style={{ backgroundColor: card.tint, borderColor: card.border }}
                    >
                      <CardContent className="flex min-h-[132px] flex-col space-y-2 p-3.5 sm:min-h-[178px] sm:space-y-3 sm:p-4">
                        <div className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-[#0247A1] sm:h-9 sm:w-9">
                          <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                        </div>
                        <h3 className="text-base font-semibold text-[#022437] sm:text-lg">{card.title}</h3>
                        <p className="text-[11px] leading-5 text-slate-600 sm:text-xs">{card.description}</p>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </motion.div>
          </div>
        </motion.section>

        <motion.section
          className="space-y-6"
          variants={sectionReveal}
          initial="hidden"
          whileInView="visible"
          viewport={VIEWPORT_ONCE}
        >
          <div className="space-y-2">
            <Badge className="bg-[#EFF6FF] text-[#1D4ED8]">Legal and Policy Basis</Badge>
            <h2 className="text-2xl font-semibold text-[#022437] sm:text-3xl">Legal and Policy Basis of the AIP</h2>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-4">
              <div className="grid grid-cols-[28px_minmax(0,1fr)] gap-4">
                <div className="relative">
                  <div className="absolute bottom-2 left-1/2 top-2 w-[3px] -translate-x-1/2 rounded-full bg-gradient-to-b from-[#0047ab] via-[#0047ab]/60 to-[#2e7d32]/40" />
                </div>

                <motion.div className="space-y-4" variants={staggerContainer}>
                  {legalBasis.map((section) => (
                    <motion.div key={section.title} className="relative" variants={legalCardReveal}>
                      <div className="absolute -left-9 top-6 flex items-center">
                        <span className={`h-[2px] w-3 ${section.armClass}`} />
                        <span className={`-ml-px rounded-sm border bg-white px-2 py-0.5 text-[10px] font-semibold ${section.pillClass}`}>
                          {section.label}
                        </span>
                      </div>

                      <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                        <CardContent className="space-y-4 px-5 py-3 sm:px-6 sm:py-4">
                          <h3 className="text-lg font-semibold text-[#022437]">{section.title}</h3>
                          {section.items ? (
                            <ul className="list-disc space-y-2 pl-4 text-xs leading-5 text-slate-600">
                              {section.items.map((item) => (
                                <li key={item}>{item}</li>
                              ))}
                            </ul>
                          ) : null}
                          {section.chips ? (
                            <div className="flex flex-wrap gap-2">
                              {section.chips.map((chip) => (
                                <span key={chip} className="rounded-sm border border-[#BFDBFE] bg-[#E6F0FF] px-2 py-1 text-[11px] text-[#1E3A8A]">
                                  {chip}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </CardContent>
                      </Card>
                    </motion.div>
                  ))}
                </motion.div>
              </div>

              <motion.div variants={sectionReveal} className="rounded-xl border-l-4 border-[#0047ab] bg-gradient-to-r from-[#0047ab]/5 to-transparent px-5 py-4 shadow-sm sm:px-6 sm:py-5">
                <p className="text-sm font-semibold italic leading-relaxed text-[#022437] sm:text-base">
                  &ldquo;The AIP serves as the legal bridge between planning and public expenditure.&rdquo;
                </p>
              </motion.div>
            </div>

            <motion.div variants={sectionReveal}>
              <Card className="h-fit rounded-2xl border border-slate-200 bg-white shadow-sm">
                <CardContent className="space-y-4 px-5 py-3">
                  <Badge className="rounded-full bg-[#166534] text-[11px] text-white">Verified Sources</Badge>
                  <h3 className="text-base font-semibold text-[#022437]">Reference Documents</h3>
                  <motion.div className="space-y-3" variants={staggerContainer}>
                    {referenceDocs.map((doc) => (
                      <motion.div key={doc.id} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5" variants={cardReveal}>
                        <div className="flex items-start gap-3">
                          <div className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-[#F8FAFC] text-[#1D4ED8]">
                            <FileText className="h-4 w-4" />
                          </div>
                          <div className="space-y-1">
                            <p className="text-xs font-semibold text-[#022437]">{doc.title}</p>
                            <p className="text-[11px] text-slate-500">{doc.source}</p>
                            {doc.href ? (
                              <Button asChild variant="outline" size="sm" className="h-7 px-3 text-[11px]">
                                <Link href={doc.href} target="_blank" rel="noopener noreferrer">
                                  View PDF
                                </Link>
                              </Button>
                            ) : (
                              <Button variant="outline" size="sm" className="h-7 px-3 text-[11px]" disabled>
                                View PDF
                              </Button>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </motion.div>
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </motion.section>

        <motion.section
          className="space-y-6"
          variants={sectionReveal}
          initial="hidden"
          whileInView="visible"
          viewport={VIEWPORT_ONCE}
        >
          <div className="space-y-2 text-center">
            <h2 className="text-2xl font-semibold text-[#022437] sm:text-3xl">Why the AIP Matters to Citizens</h2>
            <p className="text-sm text-slate-600">The AIP answers essential accountability questions:</p>
          </div>

          <motion.div className="grid grid-cols-1 gap-6 sm:grid-cols-2" variants={staggerContainer}>
            {citizenQuestions.map((question) => {
              return (
                <motion.div
                  key={question.title}
                  tabIndex={0}
                  variants={cardReveal}
                  className="group relative aspect-[16/10] overflow-hidden rounded-2xl bg-slate-900 shadow-[0_10px_20px_-12px_rgba(0,0,0,0.25)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#05C7F2] focus-visible:ring-offset-2"
                >
                  <Image src={question.image} alt={question.title} fill className="object-cover object-center" />

                  <div className="absolute inset-0 bg-[#0B4EA5]/20 transition-colors duration-200 group-hover:bg-[#0B4EA5]/15" />
                  <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(11,78,165,0.14)_0%,rgba(11,78,165,0.28)_42%,rgba(2,36,55,0.82)_100%)]" />

                  <div className="relative flex h-full flex-col items-center justify-center px-6 text-center">
                    <p className="max-w-[92%] line-clamp-3 text-xl font-semibold leading-tight text-white sm:text-2xl">
                      {question.title}
                    </p>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>

          <motion.div variants={sectionReveal} className="mx-auto max-w-3xl rounded-xl border border-[#CBD5E1] bg-gradient-to-b from-[#dce7f8] to-[#0047AB0D] p-8 text-center text-md text-slate-600 shadow-sm">
            Since all public expenditures must be supported by appropriations anchored in the AIP, understanding this
            document means understanding how public money is planned and spent.
            <div className="mt-2 font-semibold text-[#0247A1]">
              OPENAIP ensures that transparency is not only procedural, but practical and understandable.
            </div>
          </motion.div>
        </motion.section>

        <motion.section
          className="rounded-2xl bg-gradient-to-b from-[#0047ab] to-[#00384b] p-6 text-white shadow-xl sm:p-10"
          variants={sectionReveal}
          initial="hidden"
          whileInView="visible"
          viewport={VIEWPORT_ONCE}
        >
          <div className="space-y-4 text-center">
            <h2 className="text-2xl font-semibold">Ready to Explore Your LGU&apos;s AIP?</h2>
            <p className="text-sm text-white/85">
              Discover how your local government plans to invest in your community
            </p>
            <Button asChild className="mt-3 mb-3 rounded-full bg-white text-[#0B4EA5] hover:bg-slate-100">
              <Link href="/aips">Explore Your LGU&apos;s AIP</Link>
            </Button>
          </div>

          <motion.div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2" variants={staggerContainer}>
            {ctaTiles.map((tile) => {
              const Icon = tile.icon;
              const tileHref = quickLinksById[tile.id] ?? "/";
              return (
                <motion.div
                  key={tile.title}
                  variants={cardReveal}
                >
                  <Link
                    href={tileHref}
                    className="flex items-center gap-3 rounded-xl border border-white/20 bg-white/10 px-4 py-3 transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#00384b]"
                  >
                    <div className="grid h-9 w-9 place-items-center rounded-lg bg-white/15">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold">{tile.title}</p>
                      <p className="text-[11px] text-white/75">{tile.subtitle}</p>
                    </div>
                  </Link>
                </motion.div>
              );
            })}
          </motion.div>

          <div className="mt-6 border-t border-white/20 pt-3 text-center text-[11px] text-white/70">
            Based on official AIP documents and prescribed templates.
          </div>
        </motion.section>
      </div>
    </section>
  );
}
