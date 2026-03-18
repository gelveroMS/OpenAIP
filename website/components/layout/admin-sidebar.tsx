"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Shield } from "lucide-react";
import { cn } from "@/lib/ui/utils";
import { ADMIN_NAV } from "@/constants/lgu-nav";

type Props = {
  mode?: "desktop" | "mobile";
  className?: string;
  onNavigate?: () => void;
};

function isActive(pathname: string, href: string) {
  if (pathname === href) return true;
  if (href === "/admin") return false;
  if (href !== "/" && pathname.startsWith(href + "/")) return true;
  return false;
}

function toAdminSidebarTestId(label: string): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `admin-sidebar-${slug}`;
}

export default function AdminSidebar({ mode = "desktop", className, onNavigate }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const isMobile = mode === "mobile";

  return (
    <aside
      data-testid="admin-sidebar"
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
            className="h-16 w-16 object-contain"
          />
          <div className="text-2xl font-semibold leading-none">OpenAIP</div>
        </div>

        <div className="mt-5 flex items-center gap-3 rounded-3xl border border-white/10 bg-[#0A5A6C33] px-3 py-3 shadow-[0_10px_24px_rgba(0,0,0,0.2)] backdrop-blur-sm">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
            <Shield className="h-7 w-7 text-white/90" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold leading-tight text-white">Admin Console</div>
            <div className="mt-1 truncate text-sm text-white/65">System Administration</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-6 pt-3">
        <ul className="space-y-1.5">
          {ADMIN_NAV.map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item.href);
            const params = new URLSearchParams();
            if (item.href === "/admin/usage-controls") {
              if (from) params.set("from", from);
              if (to) params.set("to", to);
            }
            const href = params.size > 0 ? `${item.href}?${params.toString()}` : item.href;
            const rowClassName = cn(
              "w-full flex h-10 items-center gap-3 rounded-xl px-3 text-sm transition-colors",
              "hover:bg-white/10",
              active && "bg-[#2E6F7A] hover:bg-[#2E6F7A]"
            );

            return (
              <li key={item.href}>
                <Link
                  href={href}
                  onClick={onNavigate}
                  data-testid={toAdminSidebarTestId(item.label)}
                  className={rowClassName}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="font-medium leading-5">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
