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
      <div className="mx-auto w-full max-w-6xl px-6 py-10 md:px-12 md:py-12 lg:px-16">
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
              <h3 className="text-base font-semibold text-white">OpenAIP</h3>
            </div>
            <p className="max-w-[34ch] text-sm leading-relaxed text-white/70">
              Promoting transparent and accountable local governance through accessible Annual
              Investment Program information.
            </p>
          </div>

          <nav aria-label="Quick links" className="space-y-3">
            <h3 className="text-base font-semibold text-white">Quick Links</h3>
            <ul className="space-y-2 text-sm text-white/70">
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
            <h3 className="text-base font-semibold text-white">Contact Information</h3>
            <div className="space-y-2 text-sm text-white/70">
              <p>City Hall, Cabuyao City</p>
              <p>Laguna, Philippines 4025</p>
              <p>
                Email:{" "}
                <a href="mailto:info@cabuyao.gov.ph" className="transition-colors hover:text-white">
                  info@cabuyao.gov.ph
                </a>
              </p>
              <p>Tel: (049) 123-4567</p>
            </div>
          </div>
        </div>

        <div className="mt-10 border-t border-white/10 pt-6 text-center">
          <p className="text-xs text-white/60">
            © 2025 City Government of Cabuyao. All rights reserved.
          </p>
          <p className="mt-2 text-xs text-white/50">
            Empowering citizens through transparency and participation.
          </p>
        </div>
      </div>
    </footer>
  );
}
