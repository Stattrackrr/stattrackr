function normalizeOrigin(candidate: string | null | undefined): string | null {
  if (!candidate) return null;

  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    return `${url.protocol}//${url.host}`.replace(/\/$/, '');
  } catch {
    return null;
  }
}

function getConfiguredOrigins(): string[] {
  const rawValues = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
    ...(process.env.ALLOWED_APP_ORIGINS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  ];

  if (process.env.NODE_ENV !== 'production') {
    rawValues.push('http://localhost:3000', 'http://127.0.0.1:3000');
  }

  return Array.from(
    new Set(
      rawValues
        .map((value) => normalizeOrigin(value))
        .filter((value): value is string => Boolean(value))
    )
  );
}

export function getAllowedAppOrigins(): string[] {
  return getConfiguredOrigins();
}

export function isAllowedAppOrigin(origin: string | null | undefined): boolean {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  return getConfiguredOrigins().includes(normalized);
}

export function getTrustedAppOrigin(options?: {
  requestedOrigin?: string | null;
  fallbackOrigin?: string | null;
}): string {
  const requestedOrigin = normalizeOrigin(options?.requestedOrigin);
  const fallbackOrigin = normalizeOrigin(options?.fallbackOrigin);
  const allowedOrigins = getConfiguredOrigins();

  if (allowedOrigins.length === 0) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'No trusted app origins are configured. Set NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_SITE_URL, VERCEL_URL, or ALLOWED_APP_ORIGINS.'
      );
    }
    return fallbackOrigin || 'http://localhost:3000';
  }

  if (requestedOrigin && allowedOrigins.includes(requestedOrigin)) {
    return requestedOrigin;
  }

  if (fallbackOrigin && allowedOrigins.includes(fallbackOrigin)) {
    return fallbackOrigin;
  }

  if (allowedOrigins.length > 0) {
    return allowedOrigins[0];
  }

  // Unreachable in practice because the empty allowlist case returns above,
  // but keep an explicit fallback for TypeScript exhaustiveness.
  return fallbackOrigin || 'http://localhost:3000';
}

export function buildTrustedAppUrl(
  path: string,
  options?: {
    requestedOrigin?: string | null;
    fallbackOrigin?: string | null;
  }
): string {
  const origin = getTrustedAppOrigin(options);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${origin}${normalizedPath}`;
}
