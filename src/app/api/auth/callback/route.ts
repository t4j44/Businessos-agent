/*
 * Google OAuth provider setup instructions for Supabase:
 * 1. Go to Google Cloud Console (console.cloud.google.com)
 * 2. Create a new project or select an existing one
 * 3. Navigate to APIs & Services > Credentials
 * 4. Configure OAuth consent screen if not done already
 * 5. Create Credentials > OAuth client ID
 * 6. Application type: Web application
 * 7. Add Authorized Redirect URIs: <YOUR_SUPABASE_URL>/auth/v1/callback
 * 8. Copy Client ID and Client Secret
 * 9. Go to Supabase Dashboard > Authentication > Providers > Google
 * 10. Enable Google, paste Client ID and Secret, and save
 */

import { createRouteClient } from '@/lib/supabase-route';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');

  if (code) {
    const supabase = await createRouteClient();
    
    // Exchange the auth code for a user session
    await supabase.auth.exchangeCodeForSession(code);
    
    // Gather details about the authenticated user
    const { data: { user } } = await supabase.auth.getUser();
    
    if (user) {
      // Check if user has an associated client record
      const { data: client } = await supabase
        .from('clients')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (client) {
        // Known client, proceed to Dashboard
        return NextResponse.redirect(new URL('/dashboard', request.url));
      } else {
        // Unknown client, push to Onboarding
        return NextResponse.redirect(new URL('/onboarding', request.url));
      }
    }
  }

  // Fallback to login if something goes wrong or no code was provided
  return NextResponse.redirect(new URL('/login', request.url));
}