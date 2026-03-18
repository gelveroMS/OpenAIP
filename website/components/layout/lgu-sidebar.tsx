"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Building2, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/ui/utils";
import type { LguVariant } from "@/types/navigation";
import { BARANGAY_NAV, CITY_NAV } from "@/constants/lgu-nav";

type Props = {
  variant: LguVariant;
  scopeDisplayName?: string;
  mode?: "desktop" | "mobile";
  className?: string;
  onNavigate?: () => void;
};

function isActive(pathname: string, href: string) {
  if (pathname === href) return true;
  if (href === "/barangay" || href === "/city") return false;
  if (href !== "/" && pathname.startsWith(href + "/")) return true;
  return false;
}

function isParentActive(pathname: string, href: string, hasChildren: boolean) {
  if (hasChildren) return pathname === href;
  return isActive(pathname, href);
}

function formatHeaderLabel(variant: LguVariant, scopeDisplayName?: string): string {
  const fallback = variant === "barangay" ? "Barangay Management" : "City Management";
  const trimmedName = typeof scopeDisplayName === "string" ? scopeDisplayName.trim() : "";
  if (!trimmedName) return fallback;

  if (variant === "barangay") {
    if (/^(barangay|brgy\.?)/i.test(trimmedName)) return trimmedName;
    return `Barangay ${trimmedName}`;
  }

  if (/city/i.test(trimmedName)) return trimmedName;
  return `${trimmedName} City`;
}

function formatHeaderSubtext(variant: LguVariant, scopeDisplayName?: string): string {
  const trimmedName = typeof scopeDisplayName === "string" ? scopeDisplayName.trim() : "";

  if (variant === "barangay") {
    return "Cabuyao, Laguna";
  }

  if (trimmedName) {
    return "Laguna, Philippines";
  }

  return "Local Government";
}

function toSidebarTestId(variant: LguVariant, label: string): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${variant}-sidebar-${slug}`;
}

export default function LguSidebar({
  variant,
  scopeDisplayName,
  mode = "desktop",
  className,
  onNavigate,
}: Props) {
  const pathname = usePathname();
  const nav = variant === "barangay" ? BARANGAY_NAV : CITY_NAV;

  const [openDropdowns, setOpenDropdowns] = useState<string[]>([]);
  const headerLabel = formatHeaderLabel(variant, scopeDisplayName);
  const headerSubtext = formatHeaderSubtext(variant, scopeDisplayName);
  const isMobile = mode === "mobile";

  const toggleDropdown = (href: string) => {
    setOpenDropdowns((prev) =>
      prev.includes(href) ? prev.filter((item) => item !== href) : [...prev, href]
    );
  };

  useEffect(() => {
    const activeParents = nav
      .filter((item) => item.children?.some((child) => isActive(pathname, child.href)))
      .map((item) => item.href);

    if (activeParents.length === 0) return;
    setOpenDropdowns((prev) => Array.from(new Set([...prev, ...activeParents])));
  }, [nav, pathname]);

  return (
    <aside
      data-testid={`${variant}-sidebar`}
      className={cn(
        "bg-[#022437] text-white flex h-full flex-col",
        isMobile ? "w-full max-w-[17rem] overflow-y-auto" : "sticky top-0 h-dvh w-72 overflow-hidden",
        className
      )}
    >
      <div className="px-6 pb-3 pt-6">
        <div className="flex flex-col items-center gap-3">
          <Image
            src="/brand/logo3.svg"
            alt="OpenAIP Logo"
            width={100}
            height={100}
            className="h-16 w-16"
          />
          <div className="text-2xl font-semibold leading-none">OpenAIP</div>
        </div>

        <div className="mt-5 flex items-center gap-3 rounded-3xl border border-white/10 bg-[#0A5A6C33] px-3 py-3 shadow-[0_10px_24px_rgba(0,0,0,0.2)] backdrop-blur-sm">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
            <Building2 className="h-7 w-7 text-white/90" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold leading-tight text-white">{headerLabel}</div>
            <div className="mt-1 truncate text-sm text-white/65">{headerSubtext}</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-6 pt-3">
        <ul className="space-y-1.5">
          {nav.map((item) => {
            const Icon = item.icon;
            const hasChildren = Boolean(item.children && item.children.length > 0);
            const active = isParentActive(pathname, item.href, hasChildren);
            const isOpen = openDropdowns.includes(item.href);
            const baseRowClass = cn(
              "w-full flex h-10 items-center gap-3 rounded-xl px-3 text-sm transition-colors",
              "hover:bg-white/10",
              active && "bg-[#2E6F7A] hover:bg-[#2E6F7A]"
            );

            return (
              <li key={item.href}>
                {hasChildren ? (
                  <div>
                    <button
                      type="button"
                      data-testid={toSidebarTestId(variant, item.label)}
                      onClick={() => toggleDropdown(item.href)}
                      className={baseRowClass}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="flex-1 text-left font-medium">{item.label}</span>
                      {isOpen ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </button>

                    {isOpen && (
                      <ul className="ml-4 mt-1 space-y-1">
                        {item.children?.map((child) => {
                          const childActive = isActive(pathname, child.href);
                          const ChildIcon = child.icon;

                          return (
                            <li key={child.href}>
                              <Link
                                href={child.href}
                                onClick={onNavigate}
                                data-testid={toSidebarTestId(variant, child.label)}
                                className={cn(
                                  "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors",
                                  "hover:bg-white/10",
                                  childActive && "bg-[#2E6F7A] hover:bg-[#2E6F7A]"
                                )}
                              >
                                <ChildIcon className="h-3.5 w-3.5 shrink-0" />
                                <span className="font-medium">{child.label}</span>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                ) : (
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    data-testid={toSidebarTestId(variant, item.label)}
                    className={baseRowClass}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="font-medium">{item.label}</span>
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
