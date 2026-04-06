import { corsHeaders } from '@supabase/supabase-js/cors'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const url = new URL(req.url)
    const provider = url.searchParams.get('provider')
    const userId = url.searchParams.get('user_id')

    if (!provider || !userId) {
      return new Response(JSON.stringify({ error: 'Missing provider or user_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // Build OAuth URL based on provider
    if (provider === 'google_calendar' || provider === 'google_sheets') {
      const clientId = Deno.env.get('GOOGLE_CLIENT_ID')
      if (!clientId) {
        return new Response(JSON.stringify({ error: 'Google OAuth not configured. Add GOOGLE_CLIENT_ID secret.' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const redirectUri = `${supabaseUrl}/functions/v1/oauth-callback`
      const scopes = [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/userinfo.email',
      ].join(' ')

      const state = JSON.stringify({ provider, user_id: userId })
      const stateEncoded = btoa(state)

      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
      authUrl.searchParams.set('client_id', clientId)
      authUrl.searchParams.set('redirect_uri', redirectUri)
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('scope', scopes)
      authUrl.searchParams.set('access_type', 'offline')
      authUrl.searchParams.set('prompt', 'consent')
      authUrl.searchParams.set('state', stateEncoded)

      return new Response(JSON.stringify({ url: authUrl.toString() }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (provider === 'notion') {
      const notionClientId = Deno.env.get('NOTION_CLIENT_ID')
      if (!notionClientId) {
        return new Response(JSON.stringify({ error: 'Notion OAuth not configured. Add NOTION_CLIENT_ID secret.' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const redirectUri = `${supabaseUrl}/functions/v1/oauth-callback`
      const state = JSON.stringify({ provider, user_id: userId })
      const stateEncoded = btoa(state)

      const authUrl = new URL('https://api.notion.com/v1/oauth/authorize')
      authUrl.searchParams.set('client_id', notionClientId)
      authUrl.searchParams.set('redirect_uri', redirectUri)
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('owner', 'user')
      authUrl.searchParams.set('state', stateEncoded)

      return new Response(JSON.stringify({ url: authUrl.toString() }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ error: `Unknown provider: ${provider}` }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
