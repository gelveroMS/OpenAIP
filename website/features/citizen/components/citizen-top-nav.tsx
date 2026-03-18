'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Menu, ChevronDown, ChevronRight, User } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useCitizenAccount } from '@/features/citizen/auth/hooks/use-citizen-account';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import CitizenAccountModal from '@/features/citizen/components/citizen-account-modal';
import {
  buildCitizenAuthHref,
  setReturnToInSessionStorage,
} from '@/features/citizen/auth/utils/auth-query';
import { CITIZEN_NAV } from '@/features/citizen/constants/nav';
import NotificationsBell from '@/features/notifications/components/notifications-bell';
import { cn } from '@/lib/ui/utils';

function isActivePath(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function getNavTriggerId(href: string) {
  const clean = href.replace(/\//g, '-').replace(/^-+|-+$/g, '');
  return `citizen-nav-trigger-${clean || 'root'}`;
}

function toNavTestId(label: string): string {
  return `citizen-nav-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;
}

export default function CitizenTopNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const mobileSheetId = 'citizen-mobile-nav-sheet';
  const [mobileProjectsOpen, setMobileProjectsOpen] = useState<boolean>(false);
  const [accountModalOpen, setAccountModalOpen] = useState<boolean>(false);
  const { isAuthenticated, profile, refresh } = useCitizenAccount();

  const sanitizedNext = (() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('auth');
    params.delete('authStep');
    params.delete('completeProfile');
    params.delete('next');
    params.delete('returnTo');
    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
  })();

  const signInHref = buildCitizenAuthHref({
    pathname,
    searchParams,
    mode: 'login',
    next: sanitizedNext,
  });

  const handleSignInClick = () => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash ?? '';
    const returnTo = `${sanitizedNext}${hash}`;
    setReturnToInSessionStorage(returnTo);
  };

  useEffect(() => {
    setMobileProjectsOpen(pathname === '/projects' || pathname.startsWith('/projects/'));
  }, [pathname]);

  const isSignedIn = isAuthenticated && Boolean(profile);

  // Styles: hover has bg, active has NO bg (teal text only)
  const NAV_BASE =
    'inline-flex items-center gap-1 rounded-md px-3 py-2 text-xs font-medium transition-colors duration-200';
  const NAV_INACTIVE = 'text-slate-700 hover:text-[#0E7490]';
  const NAV_ACTIVE = 'text-[#0E7490] font-semibold';

  const accountTrigger = profile ? (
    <>
      <div className="text-right leading-tight">
        <div className="text-sm font-semibold text-slate-900">{profile.fullName}</div>
        <div className="text-xs text-slate-500">{profile.barangay}</div>
      </div>
      <button
        type="button"
        className="grid h-10 w-10 place-items-center rounded-full bg-[#0B3440]"
        data-testid="citizen-nav-account-trigger"
        aria-label="Open account"
        aria-haspopup="dialog"
        aria-expanded={accountModalOpen}
        onClick={() => setAccountModalOpen(true)}
      >
        <User className="h-5 w-5 text-white" />
      </button>
      <NotificationsBell href="/notifications" />
    </>
  ) : null;

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-[#D3DBE0]">
      {/* FULL-WIDTH BAR; center nav items via absolute centering */}
      <div className="relative flex h-16 w-full items-center px-3 sm:px-4 md:px-15 lg:px-20">
        {/* LEFT: Logo */}
        <div className="flex items-center">
          <Link href="/" className="flex items-center gap-2" aria-label="OpenAIP home">
            <Image
              src="/brand/logo3.svg"
              alt="OpenAIP logo"
              width={50}
              height={50}
              className="h-12 w-12"
            />
            <span className="text-2xl font-semibold tracking-tight text-[#0B3440]">OpenAIP</span>
          </Link>
        </div>

        {/* CENTER: Desktop nav */}
        <nav
          className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 md:flex"
          aria-label="Primary"
        >
          {CITIZEN_NAV.map((item) => {
            const active = isActivePath(pathname, item.href);

            if (item.children?.length) {
              return (
                <DropdownMenu key={item.href}>
                  <DropdownMenuTrigger asChild id={getNavTriggerId(item.href)}>
                    <button
                      data-testid={toNavTestId(item.label)}
                      className={cn(NAV_BASE, active ? NAV_ACTIVE : NAV_INACTIVE)}
                    >
                      <span>{item.label}</span>
                      {/* Chevron inherits text color */}
                      <ChevronDown className="h-4 w-4 text-inherit" />
                    </button>
                  </DropdownMenuTrigger>

                  <DropdownMenuContent
                    align="start"
                    sideOffset={8}
                    className="w-52 rounded-lg border border-slate-300 bg-white p-1 shadow-lg"
                  >
                    {item.children.map((child) => {
                      const childActive = isActivePath(pathname, child.href);
                      return (
                        <DropdownMenuItem
                          asChild
                          key={child.href}
                          className={cn(
                            'cursor-pointer rounded-md px-3 py-2 text-xs font-medium transition-colors duration-200',
                            childActive
                              ? 'text-[#0E7490] font-semibold'
                              : 'text-slate-700 hover:bg-gray-200 hover:text-[#0E7490]'
                          )}
                        >
                          <Link href={child.href}>{child.label}</Link>
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                data-testid={toNavTestId(item.label)}
                className={cn(NAV_BASE, active ? NAV_ACTIVE : NAV_INACTIVE)}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* RIGHT: Desktop Sign In / Account */}
        <div className="ml-auto hidden md:block">
          {isSignedIn ? (
            <div className="flex items-center gap-3">{accountTrigger}</div>
          ) : (
            <Button asChild className="bg-[#0E7490] text-white hover:bg-[#0C6078]">
              <Link href={signInHref} data-testid="citizen-nav-sign-in" onClick={handleSignInClick}>
                Sign In
              </Link>
            </Button>
          )}
        </div>

        {/* RIGHT: Mobile menu button */}
        <div className="ml-auto md:hidden">
          <Sheet>
            <SheetTrigger asChild>
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700"
                aria-label="Open menu"
                aria-controls={mobileSheetId}
              >
                <Menu className="h-4 w-4" />
              </button>
            </SheetTrigger>

            <SheetContent id={mobileSheetId} side="right" className="w-[280px]">
              <SheetTitle className="sr-only">Citizen navigation</SheetTitle>

              <div className="mt-8 mb-5 border-b border-slate-200 pb-5">
                {isSignedIn ? (
                  <div className="flex items-center justify-between gap-4 px-2 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">{profile?.fullName}</p>
                      <p className="truncate text-xs text-slate-500">{profile?.barangay}</p>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#0B3440]"
                        aria-label="Open account"
                        aria-haspopup="dialog"
                        aria-expanded={accountModalOpen}
                        onClick={() => setAccountModalOpen(true)}
                      >
                        <User className="h-4 w-4 text-white" />
                      </button>
                      <NotificationsBell href="/notifications" className="h-9 w-9" />
                    </div>
                  </div>
                ) : (
                  <Button asChild className="w-full bg-[#0E7490] text-white hover:bg-[#0C6078]">
                    <Link href={signInHref} onClick={handleSignInClick}>
                      Sign In
                    </Link>
                  </Button>
                )}
              </div>

              <div className="flex flex-col gap-2">
                {CITIZEN_NAV.map((item) => {
                  const active = isActivePath(pathname, item.href);

                  if (item.children?.length) {
                    return (
                      <div key={item.href} className="rounded-md">
                        <button
                          type="button"
                          onClick={() => setMobileProjectsOpen((current) => !current)}
                          className={cn(
                            'flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors duration-200',
                            active ? 'text-[#0E7490] font-semibold' : 'text-slate-700 hover:bg-gray-200 hover:text-[#0E7490]'
                          )}
                        >
                          <span>{item.label}</span>
                          {mobileProjectsOpen ? (
                            <ChevronDown className="h-4 w-4 text-inherit" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-inherit" />
                          )}
                        </button>

                        {mobileProjectsOpen ? (
                          <div className="mt-1 ml-3 space-y-1 border-l border-slate-200 pl-3">
                            {item.children.map((child) => {
                              const childActive = isActivePath(pathname, child.href);
                              return (
                                <Link
                                  key={child.href}
                                  href={child.href}
                                  className={cn(
                                    'block rounded-md px-3 py-2 text-sm font-medium transition-colors duration-200',
                                    childActive
                                      ? 'text-[#0E7490] font-semibold'
                                      : 'text-slate-700 hover:bg-gray-200 hover:text-[#0E7490]'
                                  )}
                                >
                                  {child.label}
                                </Link>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    );
                  }

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        'rounded-md px-3 py-2 text-sm font-medium transition-colors duration-200',
                        active ? 'text-[#0E7490] font-semibold' : 'text-slate-700 hover:bg-gray-200 hover:text-[#0E7490]'
                      )}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {profile ? (
        <CitizenAccountModal
          open={accountModalOpen}
          onOpenChange={setAccountModalOpen}
          profile={profile}
          onSaved={refresh}
          onLoggedOut={refresh}
        />
      ) : null}
    </header>
  );
}
