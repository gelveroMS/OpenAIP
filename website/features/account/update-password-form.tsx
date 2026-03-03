/**
 * Update Password Form Component
 * 
 * Provides a secure form for users to reset/update their password.
 * Uses Supabase authentication to update the user's password and
 * redirects to the appropriate dashboard based on user role.
 * 
 * @module feature/account/update-password-form
 */

'use client'

import { supabaseBrowser } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AuthParameters } from '@/types'
import { validatePasswordWithPolicy } from "@/lib/security/password-policy";

function readTokensFromHash() {
  if (typeof window === "undefined" || !window.location.hash) return null
  const params = new URLSearchParams(window.location.hash.slice(1))
  const accessToken = params.get("access_token")
  const refreshToken = params.get("refresh_token")
  if (!accessToken || !refreshToken) return null
  return { accessToken, refreshToken }
}

function readCodeFromQuery() {
  if (typeof window === "undefined") return null
  return new URLSearchParams(window.location.search).get("code")
}

function scrubSensitiveAuthParams() {
  if (typeof window === "undefined") return
  const searchParams = new URLSearchParams(window.location.search)
  const hadCode = searchParams.has("code")
  const hadType = searchParams.has("type")
  if (hadCode) searchParams.delete("code")
  if (hadType) searchParams.delete("type")
  if (!hadCode && !hadType) return
  const nextSearch = searchParams.toString()
  const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`
  window.history.replaceState(null, "", nextUrl)
}

/**
 * UpdatePasswordForm Component
 * 
 * Allows authenticated users to change their password.
 * Features:
 * - Secure password input
 * - Real-time error handling
 * - Loading state management
 * - Role-based redirect after successful update
 * 
 * @param role - User's role (citizen, barangay, city) for redirect routing
 */
export function UpdatePasswordForm({role}:AuthParameters) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [passwordPolicy, setPasswordPolicy] = useState<{
    minLength: number;
    requireUppercase: boolean;
    requireLowercase: boolean;
    requireNumbers: boolean;
    requireSpecialCharacters: boolean;
  } | null>(null)
  const router = useRouter()
  const supabase = useMemo(() => supabaseBrowser(), [])

  const ensureInviteSession = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    if (data.session) return

    const code = readCodeFromQuery()
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code)
      if (error) throw error
      scrubSensitiveAuthParams()
      return
    }

    const tokens = readTokensFromHash()
    if (!tokens) return

    const { error } = await supabase.auth.setSession({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    })
    if (error) throw error

    // Drop sensitive tokens from the URL once session cookies are set.
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`)
  }, [supabase])

  useEffect(() => {
    void ensureInviteSession().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to initialize auth session.")
    })
  }, [ensureInviteSession])

  useEffect(() => {
    let active = true;
    const loadPolicy = async () => {
      try {
        const response = await fetch("/api/system/security-policy", {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as
          | {
              securitySettings?: {
                passwordPolicy?: {
                  minLength: number;
                  requireUppercase: boolean;
                  requireLowercase: boolean;
                  requireNumbers: boolean;
                  requireSpecialCharacters: boolean;
                };
              };
            }
          | null;

        if (!active) return;
        if (!response.ok || !payload?.securitySettings?.passwordPolicy) return;
        setPasswordPolicy(payload.securitySettings.passwordPolicy);
      } catch {
        // Ignore policy fetch errors; server route remains authoritative.
      }
    };
    void loadPolicy();
    return () => {
      active = false;
    };
  }, []);

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    try {
      await ensureInviteSession()
      const { data: sessionData } = await supabase.auth.getSession()
      if (!sessionData.session) {
        throw new Error("Auth session missing. Reopen the invite/reset link from your email.")
      }

      if (passwordPolicy) {
        const errors = validatePasswordWithPolicy(password, passwordPolicy);
        if (errors.length > 0) {
          throw new Error(errors[0]);
        }
      }

      const response = await fetch("/auth/update-password", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ password }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: { message?: string } }
        | null;
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error?.message ?? "Unable to update password.");
      }
      // Update this route to redirect to an authenticated route. The user already has an active session.
      router.push(role === 'citizen' ? '/' : `/${role}`);
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'An error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className='flex flex-col gap-6'>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Set Your Password</CardTitle>
          <CardDescription>Please enter your new password below.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleForgotPassword}>
            <div className="flex flex-col gap-6">
              <div className="grid gap-2">
                <Label htmlFor="password">New password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="New password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? 'Saving...' : 'Save new password'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
