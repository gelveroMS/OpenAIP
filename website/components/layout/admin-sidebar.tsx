"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
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
    <aside className="
                      h-screen
                      w-16 md:w-60 lg:w-64
                      shrink-0
                      sticky top-0
                      overflow-y-auto
                      bg-sidebar
                      text-sidebar-foreground
                      flex flex-col
                    ">
      <div className="px-4 pt-4 pb-3">
        <div className="flex flex-col items-center gap-1">
          <Image
            src="/brand/logo3.svg"
            alt="OpenAIP Logo"
            width={100}
            height={100}
            className="h-20 w-20 object-contain"
          />
          <div className="text-3xl font-semibold leading-none">OpenAIP</div>
        </div>

          <div className="mt-6 h-21 rounded-[9px] border-2 border-[#1B6272] bg-[#114B59] shadow-[0_4px_4px_rgba(0,0,0,0.25)] flex items-center justify-center px-4 text-2xl font-light text-center">
          Admin
        </div>
      </div>

      <nav className="flex-1 px-4 py-3">
        <ul className="space-y-1">
          {ADMIN_NAV.map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item.href);
            const params = new URLSearchParams();
            if (item.href === "/admin/usage-controls") {
              if (from) params.set("from", from);
              if (to) params.set("to", to);
            }
            const href = params.size > 0 ? `${item.href}?${params.toString()}` : item.href;

            return (
              <li key={item.href}>
                <Link
                  href={href}
                  className={cn(
                    "flex h-11 items-center gap-3 rounded-[10px] px-4 text-[12px] transition-colors text-sidebar-foreground/80",
                    "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    active && "bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent"
                  )}
                >
                  <Icon className="h-4 w-4" />
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
