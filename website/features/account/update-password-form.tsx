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
import { PasswordPolicyChecklist } from '@/components/auth/password-policy-checklist'
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
import { fetchPasswordPolicy } from '@/lib/security/password-policy-client'
import {
  getPasswordPolicyRuleStatus,
  validatePasswordWithPolicy,
  type PasswordPolicyLike,
} from '@/lib/security/password-policy'
import type { EmailOtpType } from '@supabase/supabase-js'

const MISSING_SESSION_MESSAGE =
  "Your reset session is missing or expired. Reopen the latest invite/reset link from your email."

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

function readTokenHashFromQuery() {
  if (typeof window === "undefined") return null
  const params = new URLSearchParams(window.location.search)
  const tokenHash = params.get("token_hash")
  const type = params.get("type") as EmailOtpType | null
  if (!tokenHash || !type) return null
  return { tokenHash, type }
}

function scrubSensitiveAuthParams() {
  if (typeof window === "undefined") return
  const searchParams = new URLSearchParams(window.location.search)
  const hadCode = searchParams.has("code")
  const hadType = searchParams.has("type")
  const hadTokenHash = searchParams.has("token_hash")
  if (hadCode) searchParams.delete("code")
  if (hadType) searchParams.delete("type")
  if (hadTokenHash) searchParams.delete("token_hash")
  if (!hadCode && !hadType && !hadTokenHash) return
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
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [passwordPolicy, setPasswordPolicy] = useState<PasswordPolicyLike | null>(null)
  const router = useRouter()
  const supabase = useMemo(() => supabaseBrowser(), [])

  const policyRules = useMemo(
    () => (passwordPolicy ? getPasswordPolicyRuleStatus(password, passwordPolicy) : []),
    [password, passwordPolicy]
  )
  const policyErrors = useMemo(
    () => (passwordPolicy ? validatePasswordWithPolicy(password, passwordPolicy) : []),
    [password, passwordPolicy]
  )
  const passwordsMatch = password === confirmPassword
  const canSubmit =
    !isLoading &&
    password.length > 0 &&
    confirmPassword.length > 0 &&
    passwordsMatch &&
    policyErrors.length === 0

  const ensureInviteSession = useCallback(async () => {
    const hasSession = async () => {
      const { data } = await supabase.auth.getSession()
      return Boolean(data.session)
    }

    const code = readCodeFromQuery()
    if (code) {
      // Some flows already establish a session before reaching this page.
      // In that case, skip code exchange to avoid noisy PKCE errors.
      if (await hasSession()) {
        scrubSensitiveAuthParams()
        return
      }

      const { error } = await supabase.auth.exchangeCodeForSession(code)
      if (error) {
        if (await hasSession()) {
          scrubSensitiveAuthParams()
          return
        }
        throw new Error(MISSING_SESSION_MESSAGE)
      }
      scrubSensitiveAuthParams()
      return
    }

    const tokenHash = readTokenHashFromQuery()
    if (tokenHash) {
      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash.tokenHash,
        type: tokenHash.type,
      })
      if (error) {
        if (await hasSession()) {
          scrubSensitiveAuthParams()
          return
        }
        throw new Error(MISSING_SESSION_MESSAGE)
      }
      scrubSensitiveAuthParams()
      return
    }

    const tokens = readTokensFromHash()
    if (tokens) {
      const { error } = await supabase.auth.setSession({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
      })
      if (error) {
        if (await hasSession()) return
        throw new Error(MISSING_SESSION_MESSAGE)
      }

      // Drop sensitive tokens from the URL once session cookies are set.
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`)
      return
    }

    const { data } = await supabase.auth.getSession()
    if (data.session) return
  }, [supabase])

  useEffect(() => {
    void ensureInviteSession().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : MISSING_SESSION_MESSAGE)
    })
  }, [ensureInviteSession])

  useEffect(() => {
    let active = true;
    const loadPolicy = async () => {
      const policy = await fetchPasswordPolicy()
      if (!active || !policy) return
      setPasswordPolicy(policy)
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
        throw new Error(MISSING_SESSION_MESSAGE)
      }

      if (!passwordsMatch) {
        throw new Error("Passwords do not match.")
      }

      const errors = passwordPolicy ? validatePasswordWithPolicy(password, passwordPolicy) : []
      if (errors.length > 0) {
        throw new Error(errors[0])
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
      if (!response.ok || payload?.ok !== true) {
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
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="New password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pr-16"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    disabled={isLoading}
                    className="absolute inset-y-0 right-2 my-auto h-8 rounded-md px-2 text-sm font-medium text-slate-600 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </div>
              {passwordPolicy ? (
                <PasswordPolicyChecklist rules={policyRules} className="space-y-1" />
              ) : null}
              <div className="grid gap-2">
                <Label htmlFor="confirm-password">Confirm new password</Label>
                <div className="relative">
                  <Input
                    id="confirm-password"
                    type={showConfirmPassword ? "text" : "password"}
                    placeholder="Confirm new password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="pr-16"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((prev) => !prev)}
                    aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                    disabled={isLoading}
                    className="absolute inset-y-0 right-2 my-auto h-8 rounded-md px-2 text-sm font-medium text-slate-600 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {showConfirmPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </div>
              {confirmPassword.length > 0 && !passwordsMatch ? (
                <p className="text-sm text-red-500">Passwords do not match.</p>
              ) : null}
              {error && <p className="text-sm text-red-500">{error}</p>}
              <Button type="submit" className="w-full" disabled={!canSubmit}>
                {isLoading ? 'Saving...' : 'Save new password'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
