import { supabaseServer } from '@/lib/supabase/server'
import { getRequestNonce } from '@/lib/security/csp'
import { type EmailOtpType } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import { type NextRequest } from 'next/server'

function redirectWithHashPreserved(next: string, nonce: string | null) {
  const safeNextJson = JSON.stringify(next)
  const nonceAttr = nonce ? ` nonce="${nonce}"` : ''
  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Redirecting...</title>
  </head>
  <body>
    <p>Redirecting...</p>
    <script${nonceAttr}>
      (function () {
        var next = ${safeNextJson};
        var hash = window.location.hash || "";
        window.location.replace(next + hash);
      })();
    </script>
  </body>
</html>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    }
  )
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const _next = searchParams.get('next')
  const next = _next?.startsWith('/') && !_next.startsWith('//') ? _next : '/'
  if (token_hash && type) {
    const supabase = await supabaseServer()

    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash,
    })
    if (!error) {
      // redirect user to specified redirect URL or root of app
      redirect(next)
    } else {
      // redirect the user to an error page with some instructions
      redirect(`/error?error=${encodeURIComponent(error?.message ?? 'Unknown error')}`)
    }
  }

  // Hash-based callbacks (e.g. #access_token=...) are not visible to route handlers.
  // Return an HTML bridge so the browser can forward the fragment to `next`.
  return redirectWithHashPreserved(next, getRequestNonce(request))
}
