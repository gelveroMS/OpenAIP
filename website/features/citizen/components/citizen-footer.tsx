"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

type FooterLink = { label: string; href: string };

const QUICK_LINKS: FooterLink[] = [
  { label: "Dashboard", href: "/" },
  { label: "AIPs", href: "/aips" },
  { label: "Budget Allocation", href: "/budget-allocation" },
  { label: "Health Projects", href: "/projects/health" },
  { label: "Infrastructure Projects", href: "/projects/infrastructure" },
];

type CitizenFooterProps = {
  forceVisible?: boolean;
};

export default function CitizenFooter({ forceVisible = false }: CitizenFooterProps) {
  const pathname = usePathname();

  if (!forceVisible && pathname === "/") {
    return null;
  }

  return (
    <footer className="w-full bg-[#001925] text-white">
      <div className="mx-auto w-full max-w-6xl px-6 py-8 md:px-12 lg:px-16">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-3 md:gap-x-16 lg:gap-x-20">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Image
                src="/brand/logo3.svg"
                alt="OpenAIP logo"
                width={40}
                height={40}
                className="h-10 w-10"
              />
              <h3 className="text-sm font-semibold text-white md:text-sm">OpenAIP</h3>
            </div>
            <p className="max-w-[34ch] text-sm leading-relaxed text-white/70 md:text-sm">
              Promoting transparent and accountable local governance through accessible Annual
              Investment Program information.
            </p>
          </div>

          <nav aria-label="Quick links" className="space-y-3">
            <h3 className="text-sm font-semibold text-white md:text-sm">Quick Links</h3>
            <ul className="space-y-2 text-sm text-white/70 md:text-sm">
              {QUICK_LINKS.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="transition-colors hover:text-white">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-white md:text-sm">Developed by</h3>
            <div className="space-y-2 text-sm text-white/70 md:text-sm">
              <p>BS Computer Engineering Students</p>
              <p>University of Cabuyao - Pamantasan ng Cabuyao</p>
              <p>City of Cabuyao, Laguna, Philippines 4025</p>
              <p>
                Email:{" "}
                <a
                  href="mailto:computerengineers2026@gmail.com"
                  className="transition-colors hover:text-white"
                >
                  computerengineers2026@gmail.com
                </a>
              </p>
            </div>
          </div>
        </div>

        <div className="mt-8 border-t border-white/10 pt-0 text-center">
          <p className="text-sm text-[#E5E7EB]/30 md:text-sm">
            2026 OpenAIP. Developed for academic purposes at the University of Cabuyao
          </p>
          <p className="mt-1 text-sm text-[#E5E7EB]/30 md:text-sm">
            Empowering citizens through transparency and participation.
          </p>
        </div>
      </div>
    </footer>
  );
}
