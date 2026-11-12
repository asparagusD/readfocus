// Build-time check of the VITE_ variables a deployed build bakes in (C14.2).
// vite.config.js runs it on Vercel builds only (VERCEL=1), so local, CI and
// e2e builds are unchanged. Without it, a missing variable would silently fall
// back to localhost for the API and to the dev Supabase project (lib/api.js,
// lib/supabase.js).

export const REQUIRED = ['VITE_API_URL', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0']);

function urlProblem(name, value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return `${name} is not a URL`;
  }
  if (url.protocol !== 'https:') return `${name} must start with https://`;
  if (LOCAL_HOSTS.has(url.hostname)) return `${name} points at ${url.hostname}`;
  if (value.endsWith('/')) return `${name} must not end with /`;
  return null;
}

// The browser key must be the publishable (anon) one. A secret key, or a legacy
// JWT whose role is service_role, bypasses row-level security (CLAUDE.md constraint 4).
function keyProblem(value) {
  if (value.startsWith('sb_secret_')) return 'VITE_SUPABASE_ANON_KEY is a secret key, not the publishable key';
  const parts = value.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload.role === 'service_role') return 'VITE_SUPABASE_ANON_KEY is the service-role key';
    } catch {
      return 'VITE_SUPABASE_ANON_KEY looks like a JWT but cannot be read';
    }
  }
  return null;
}

/** Problems with a deploy's VITE_ variables: { errors, warnings }, each a list of sentences. */
export function checkDeployEnv(env) {
  const errors = REQUIRED.filter((name) => !env[name]).map((name) => `${name} is not set`);
  for (const name of ['VITE_API_URL', 'VITE_SUPABASE_URL']) {
    if (env[name]) errors.push(urlProblem(name, env[name]));
  }
  if (env.VITE_SUPABASE_ANON_KEY) errors.push(keyProblem(env.VITE_SUPABASE_ANON_KEY));
  const warnings = [];
  if (!env.VITE_SITE_URL) warnings.push('VITE_SITE_URL is not set: no canonical link, relative share image');
  else warnings.push(urlProblem('VITE_SITE_URL', env.VITE_SITE_URL));
  return { errors: errors.filter(Boolean), warnings: warnings.filter(Boolean) };
}

/** True when the build runs on Vercel (system variable VERCEL=1). */
export const isVercelBuild = (env) => env.VERCEL === '1';
