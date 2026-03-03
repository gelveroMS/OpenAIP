"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Shield } from "lucide-react";
import { cn } from "@/lib/ui/utils";
import { ADMIN_NAV } from "@/constants/lgu-nav";

function isActive(pathname: string, href: string) {
  if (pathname === href) return true;
  if (href === "/admin") return false;
  if (href !== "/" && pathname.startsWith(href + "/")) return true;
  return false;
}

export default function AdminSidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  return (
    <aside
      className={cn(
        "shrink-0 sticky top-0 bg-[#022437] text-white flex flex-col",
        "w-16 md:w-72",
        "h-dvh overflow-hidden"
      )}
    >
      <div className="pt-4 md:pt-8 pb-2 md:pb-3 px-2 md:px-6">
        <div className="flex flex-col items-center gap-2 md:gap-3">
          <Image
            src="/brand/logo3.svg"
            alt="OpenAIP Logo"
            width={100}
            height={100}
            className="h-10 w-10 md:h-20 md:w-20 object-contain"
          />
          <div className="hidden md:block text-3xl font-semibold leading-none">OpenAIP</div>
        </div>

        <div className="hidden md:flex mt-5 items-center gap-3 rounded-3xl border border-white/10 bg-[#0A5A6C33] px-3 py-3 shadow-[0_10px_24px_rgba(0,0,0,0.2)] backdrop-blur-sm">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
            <Shield className="h-7 w-7 text-white/90" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold leading-tight text-white">
              Admin Console
            </div>
            <div className="mt-1 truncate text-sm text-white/65">System Administration</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-1 md:px-4 pb-3 md:py-5">
        <ul className="space-y-1 md:space-y-1.5">
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
              "w-full flex items-center rounded-xl transition-colors",
              "hover:bg-white/10",
              active && "bg-[#2E6F7A] hover:bg-[#2E6F7A]",
              "h-9 md:h-10",
              "px-2 md:px-3",
              "gap-0 md:gap-3",
              "text-[11px] md:text-xs"
            );

            return (
              <li key={item.href}>
                <Link href={href} className={rowClassName}>
                  <Icon className="h-4.5 w-4.5 md:h-4 md:w-4 mx-auto md:mx-0" />
                  <span className="hidden md:block font-medium leading-5">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
