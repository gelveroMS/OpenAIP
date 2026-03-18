'use client'

import { Button } from '@/components/ui/button'
import type { AuthParameters } from '@/types'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { getRolePath, getRoleEmailPlaceholder } from "@/lib/ui/auth-helpers";

export function LoginForm({role, baseURL}:AuthParameters) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const router = useRouter()

  const rolePath = getRolePath(baseURL, role);
  const isStaffRole = role === "admin" || role === "city" || role === "barangay"
  const isLguRole = role === "city" || role === "barangay"
  const roleBadgeLabel =
    role === 'city' ? 'City Official' : role === 'barangay' ? 'Barangay Official' : 'Admin'
  const staffHeroTitle = isLguRole
    ? "Promoting transparency in Annual Investment Plans."
    : "Turn AIP documents into actionable planning data.";
  const staffHeroDescription = isLguRole
    ? "OpenAIP transforms Annual Investment Plans into structured, searchable records that support transparency and make local planning information easier for the public to access and understand."
    : "OpenAIP converts Annual Investment Plans into structured, searchable records so officials can publish, review, and monitor budgets and projects with clarity and accountability.";

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    try {
      const endpoint = isStaffRole ? "/auth/staff-sign-in" : "/auth/sign-in";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email,
          password,
          ...(isStaffRole ? { role } : {}),
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: { message?: string } }
        | null;

      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error?.message ?? "An error occurred");
      }

      const targetPath = `/${isStaffRole ? role : ""}`;
      // Refresh the App Router tree after auth so RSC/cached payloads re-read fresh auth cookies.
      router.replace(targetPath);
      router.refresh();

    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'An error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  if (isStaffRole) {
    return (
      <div className="relative min-h-screen min-h-[100dvh] overflow-hidden bg-[#022034]">
        <Image
          src="/login/building.png"
          alt=""
          fill
          priority
          className="object-cover object-center"
        />
        <div className="absolute inset-0 bg-[#022437]/50" aria-hidden />
        <div className="absolute inset-0 bg-gradient-to-r from-[#022437]/30 via-[#022437]/5 to-transparent" aria-hidden />
        <div className="absolute inset-0 bg-gradient-to-t from-black/22 via-black/12 to-transparent" aria-hidden />
        <div
          className="absolute inset-0 [background:radial-gradient(ellipse_at_center,rgba(0,0,0,0)_0%,rgba(0,0,0,0.14)_70%,rgba(0,0,0,0.26)_100%)]"
          aria-hidden
        />
        <div className="relative z-10 grid min-h-screen min-h-[100dvh] lg:grid-cols-5">
          <main className="order-1 flex items-center justify-center md:items-start md:justify-start lg:order-2 lg:col-span-2 lg:min-h-screen lg:items-stretch">
            <div className="w-full px-3 py-4 sm:px-5 sm:py-5 md:px-5 md:pb-5 md:pt-5 lg:p-9">
              <Card className="relative mx-auto w-full max-w-[420px] gap-0 rounded-2xl border-slate-200 bg-white shadow-xl lg:h-full lg:max-w-none">
              <CardHeader className="items-center space-y-3 px-5 pt-5 text-center sm:space-y-4 sm:px-8 sm:pt-7 lg:px-12 lg:pt-11">
                <div className="absolute left-5 top-5 sm:left-8 sm:top-7 lg:left-9 lg:top-9">
                  <Image
                    src="/brand/logo3.svg"
                    alt="OpenAIP logo"
                    width={64}
                    height={64}
                    className="h-10 w-10 sm:h-12 sm:w-12 lg:h-14 lg:w-14"
                  />
                </div>
                <div className="space-y-1.5 pt-6 sm:space-y-2 sm:pt-7 lg:pt-9">
                  <CardTitle className="text-[2.15rem] font-bold leading-tight text-slate-900 sm:text-4xl lg:text-5xl">
                    Welcome back!
                  </CardTitle>
                  <CardDescription className="text-sm leading-relaxed text-slate-500">
                    Sign in to continue to OpenAIP.
                  </CardDescription>
                </div>
                <span className="mx-auto mt-2 inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-[#3B7A9D] sm:mt-3">
                  {roleBadgeLabel}
                </span>
              </CardHeader>
              <CardContent className="px-5 pb-5 pt-2 sm:px-8 sm:pb-7 sm:pt-3 lg:px-12 lg:pb-11">
                <form onSubmit={handleLogin} className="space-y-3.5 sm:space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-sm font-medium text-slate-700">
                      Email
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      autoComplete="email"
                      data-testid="auth-login-email"
                      placeholder={getRoleEmailPlaceholder(role)}
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="h-11 border-slate-300 bg-white text-base text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-primary/40 sm:h-12"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password" className="text-sm font-medium text-slate-700">
                      Password
                    </Label>
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        data-testid="auth-login-password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="h-11 border-slate-300 bg-white pr-16 text-base text-slate-900 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-primary/40 sm:h-12"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((prev) => !prev)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        className="absolute inset-y-0 right-2 my-auto h-8 rounded-md px-2 text-sm font-medium text-slate-600 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      >
                        {showPassword ? "Hide" : "Show"}
                      </button>
                    </div>
                  </div>
                  {error && (
                    <p
                      role="alert"
                      data-testid="auth-login-error"
                      className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                    >
                      {error}
                    </p>
                  )}
                  <Button
                    type="submit"
                    data-testid="auth-login-submit"
                    className="h-11 w-full bg-[#022437] text-base font-medium text-white hover:bg-[#022437]/90 focus-visible:ring-2 focus-visible:ring-[#022437]/40 sm:h-12"
                    disabled={isLoading}
                  >
                    {isLoading ? 'Logging in...' : 'Sign in'}
                  </Button>
                  <div>
                    <Link
                      href={`${rolePath}/forgot-password`}
                      className="inline-flex rounded-sm text-sm font-medium text-slate-700 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      Forgot password?
                    </Link>
                  </div>
                </form>
                <p className="mt-3 text-center text-sm leading-relaxed text-slate-500 sm:mt-4">
                  For account access or resets, contact your LGU administrator.
                </p>
              </CardContent>
            </Card>
            </div>
          </main>

          <aside className="order-2 relative hidden min-h-[220px] overflow-hidden md:block lg:order-1 lg:col-span-3 lg:min-h-screen">
            <Image
              src="/login/faded-logo.png"
              alt=""
              aria-hidden
              width={660}
              height={660}
              className="pointer-events-none absolute left-1/2 top-1/2 hidden h-auto w-[560px] -translate-x-1/2 -translate-y-1/2 opacity-20 lg:block"
            />

            <div className="relative z-10 flex h-full flex-col justify-end p-6 text-white sm:p-8 lg:justify-between lg:p-14">
              <div className="flex items-center">
                <span className="text-2xl font-semibold leading-none tracking-tight sm:text-3xl">OpenAIP</span>
              </div>
              <div className="max-w-xl space-y-3 pb-0 sm:space-y-4 lg:max-w-2xl lg:space-y-6 lg:pb-10">
                <h1 className="max-w-[18ch] text-[2.2rem] font-bold leading-[1.1] tracking-tight sm:max-w-[20ch] sm:text-[2.6rem] lg:max-w-none lg:text-5xl">
                  {staffHeroTitle}
                </h1>
                <p className="max-w-[34ch] line-clamp-3 text-sm leading-relaxed text-slate-100/90 sm:max-w-[46ch] sm:line-clamp-none sm:text-base lg:text-lg">
                  {staffHeroDescription}
                </p>
              </div>
            </div>
          </aside>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Login</CardTitle>
          <CardDescription>Enter your email below to login to your account</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin}>
            <div className="flex flex-col gap-6">
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  data-testid="auth-login-email"
                  placeholder={getRoleEmailPlaceholder(role)}
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center">
                  <Label htmlFor="password">Password</Label>
                  <Link
                    href={`${rolePath}/forgot-password`}
                    className="ml-auto inline-block text-sm underline-offset-4 hover:underline"
                  >
                    Forgot your password?
                  </Link>
                </div>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  data-testid="auth-login-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {error && (
                <p data-testid="auth-login-error" className="text-sm text-red-500">
                  {error}
                </p>
              )}
              <Button type="submit" data-testid="auth-login-submit" className="w-full" disabled={isLoading}>
                {isLoading ? 'Logging in...' : 'Login'}
              </Button>
            </div>
            <div className="mt-4 text-center text-sm">
              Don&apos;t have an account?{' '}
              <Link href={`${rolePath}/sign-up`} className="underline underline-offset-4">
                Sign up
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
