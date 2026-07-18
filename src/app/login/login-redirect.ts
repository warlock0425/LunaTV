const LOGIN_REDIRECT_BASE = 'https://lunatv.invalid';

export function getSafeLoginRedirect(redirect: string | null): string {
  const value = redirect?.trim();
  if (!value || value[0] !== '/' || value[1] === '/' || value[1] === '\\') {
    return '/';
  }

  try {
    const parsed = new URL(value, LOGIN_REDIRECT_BASE);
    if (parsed.origin !== LOGIN_REDIRECT_BASE) return '/';
    const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    if (path[0] !== '/' || path[1] === '/' || path[1] === '\\') return '/';
    return path;
  } catch {
    return '/';
  }
}
