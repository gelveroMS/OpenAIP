'use client'

import { supabaseBrowser } from '@/lib/supabase/client'
import { PasswordPolicyChecklist } from '@/components/auth/password-policy-checklist'
import { Button } from '@/components/ui/button'
import type { AuthParameters } from "@/types";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ListOfBarangays } from '@/constants'
import { getRolePath, getRoleEmailPlaceholder } from "@/lib/ui/auth-helpers";
import { verifyOfficialInviteEligibilityAction } from "@/lib/actions/signup.actions";
import { fetchPasswordPolicy } from "@/lib/security/password-policy-client";
import {
  getPasswordPolicyRuleStatus,
  validatePasswordWithPolicy,
  type PasswordPolicyLike,
} from "@/lib/security/password-policy";
// import { time } from 'console'

export function SignUpForm({role, baseURL}:AuthParameters) {
  
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [password, setPassword] = useState('')
  const [repeatPassword, setRepeatPassword] = useState('')
  const [passwordPolicy, setPasswordPolicy] = useState<PasswordPolicyLike | null>(null)
  
  const fullNameRef = useRef('');
  const localeRef = useRef('');

  const router = useRouter()
  
  const rolePath = getRolePath(baseURL, role);

  const isInvitedOfficialRole =
    role === "barangay" || role === "city" || role === "municipality";

  const policyRules = useMemo(
    () => (passwordPolicy ? getPasswordPolicyRuleStatus(password, passwordPolicy) : []),
    [password, passwordPolicy]
  )
  const policyErrors = useMemo(
    () => (passwordPolicy ? validatePasswordWithPolicy(password, passwordPolicy) : []),
    [password, passwordPolicy]
  )
  const passwordsMatch = password === repeatPassword
  const canSubmit =
    !isLoading &&
    email.trim().length > 0 &&
    password.length > 0 &&
    repeatPassword.length > 0 &&
    passwordsMatch &&
    policyErrors.length === 0

  useEffect(() => {
    if(email.trim() === '') {
      setError(null);
    }
  }, [email])

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

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()

    const supabase = supabaseBrowser()

    setIsLoading(true)
    setError(null)

    if (isInvitedOfficialRole && email.trim() !== '') {
      const eligibility = await verifyOfficialInviteEligibilityAction({
        email,
        routeRole: role,
      });

      if (!eligibility.ok) {
        setError(eligibility.message)
        setIsLoading(false)
        return
      }

      fullNameRef.current = eligibility.fullName
      localeRef.current = eligibility.locale
    }
    
    if (role === 'citizen' && !localeRef.current) {
      setError('Please select your barangay')
      setIsLoading(false)
      return
    }

    if (!passwordsMatch) {
      setError('Passwords do not match')
      setIsLoading(false)
      return
    }

    const errors = passwordPolicy ? validatePasswordWithPolicy(password, passwordPolicy) : []
    if (errors.length > 0) {
      setError(errors[0]);
      setIsLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: rolePath,
          data: {
            fullName: fullNameRef.current,
            access: {
              role,
              locale: localeRef.current
            }
          }
        },
      })

      if (error) throw error

      // Detect "already exists" without relying on error
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        if (isInvitedOfficialRole) {
          throw new Error("Account already exists. Use your invite/reset link in email to set your password.");
        }
        throw new Error("Account already exists. Please log in.");
      }

      router.push(`${rolePath}/sign-up-success`)      
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
          <CardTitle className="text-2xl">Sign up</CardTitle>
          <CardDescription>Create a new {`${role === 'citizen' ? role : role + ' official'}`} account</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSignUp}>
            <div className="flex flex-col gap-6">
              {role === 'citizen' &&
                <>
                  <div className="grid gap-2">
                    <Label htmlFor="fullName">Full Name</Label>
                    <Input
                      id="fullName"
                      type="text"
                      placeholder="Juan B. Dela Cruz"
                      required
                      onChange={(e) => fullNameRef.current = e.target.value}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label
                      htmlFor='barangay'
                    >Barangay</Label>
                    <Select
                      onValueChange={(e) => localeRef.current = e}
                      name='barangay'
                    >
                      <SelectTrigger id="barangay" className="w-full max-w-64">
                        <SelectValue placeholder="Choose your barangay" />
                      </SelectTrigger>
                      <SelectContent>
                        {ListOfBarangays.map((barangay) => (
                          <SelectItem
                            key={barangay}
                            value={barangay.toLowerCase()}
                          >
                            {barangay}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              }
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder={getRoleEmailPlaceholder(role)}
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center">
                  <Label htmlFor="password">Password</Label>
                </div>
                <Input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {passwordPolicy ? (
                <PasswordPolicyChecklist rules={policyRules} className="space-y-1" />
              ) : null}
              <div className="grid gap-2">
                <div className="flex items-center">
                  <Label htmlFor="repeat-password">Repeat Password</Label>
                </div>
                <Input
                  id="repeat-password"
                  type="password"
                  required
                  value={repeatPassword}
                  onChange={(e) => setRepeatPassword(e.target.value)}
                />
              </div>
              {repeatPassword.length > 0 && !passwordsMatch ? (
                <p className="text-sm text-red-500">Passwords do not match.</p>
              ) : null}
              {error && <p className="text-sm text-red-500">{error}</p>}
              <Button type="submit" className="w-full" disabled={!canSubmit}>
                {isLoading ? 'Creating an account...' : 'Sign up'}
              </Button>
            </div>
            <div className="mt-4 text-center text-sm">
              Already have an account?{' '}
              <Link href={`${rolePath}/sign-in`} className="underline underline-offset-4">
                Login
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
