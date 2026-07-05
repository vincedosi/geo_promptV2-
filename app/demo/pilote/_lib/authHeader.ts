/** Bearer lu depuis le cookie session @supabase/ssr (sb-<ref>-auth-token). */
export function demoAuthHeader(): Record<string, string> {
  if (typeof document === 'undefined') return {};
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return {};
  const ref = new URL(url).hostname.split('.')[0];
  const c = document.cookie.split('; ').find((x) => x.startsWith(`sb-${ref}-auth-token=`));
  if (!c) return {};
  let val = decodeURIComponent(c.substring(c.indexOf('=') + 1));
  if (val.startsWith('base64-')) { try { val = atob(val.slice(7)); } catch { return {}; } }
  try {
    const token = JSON.parse(val).access_token as string | undefined;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch { return {}; }
}
