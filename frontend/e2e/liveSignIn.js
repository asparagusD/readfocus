// C28.1: the app signs in with Google only, so the live journeys sign their password test users in
// here, with Supabase Auth, and hand the session to the page the way the app keeps it.
import { createClient } from '@supabase/supabase-js';

const REF = 'lvfhuszvuiowyeizstru';
// The publishable key, the same one frontend/src/lib/supabase.js ships in the bundle.
const ANON_KEY = 'sb_publishable_1Fcu6nbBPjeLfQteisEqxw_B4rtJ-f5';

/** Sign a test user in and store the session for `page`; the credentials are never printed. */
export async function signInAs(page, email, password) {
  const sb = createClient(`https://${REF}.supabase.co`, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`test user sign-in failed: ${error.message}`);
  await page.addInitScript(([key, value]) => {
    if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, value);
  }, [`sb-${REF}-auth-token`, JSON.stringify(data.session)]);
}
