"use client";

import { Suspense, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { CitizenAuthModalHost } from "@/features/citizen/auth";
import CitizenFooter from "@/features/citizen/components/citizen-footer";
import FloatingChatButton from "@/features/citizen/components/floating-chat-button";
import CitizenTopNav from "@/features/citizen/components/citizen-top-nav";
import { cn } from "@/ui/utils";

const CitizenLayout = ({ children }: { children: ReactNode }) => {
  const pathname = usePathname();
  const normalizedPathname = pathname.replace(/\/+$/, "") || "/";
  const isLandingDashboard = normalizedPathname === "/";

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-[#D3DBE0] to-[#FFFFFF]">
      <Suspense fallback={null}>
        <CitizenTopNav />
      </Suspense>
      <main
        className={cn(
          "mx-auto w-full flex-1 min-h-0",
          isLandingDashboard
            ? "m-0 max-w-none p-0"
            : "flex flex-col max-w-screen-2xl px-4 py-6 md:px-8 md:py-8"
        )}
      >
        {children}
      </main>
      <Suspense fallback={null}>
        <CitizenAuthModalHost />
      </Suspense>
      <CitizenFooter />
      <FloatingChatButton />
    </div>
  );
};

export default CitizenLayout;
