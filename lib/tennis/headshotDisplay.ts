/** `crop=wide` zooms padded studio shots; `crop=tight` un-zooms WTA close-ups. */
export function tennisComAvatarImgStyle(
  url?: string | null
): { transform?: string; transformOrigin?: string; objectFit?: 'contain'; objectPosition?: string } | undefined {
  const raw = String(url || '');
  if (/(?:^|[?&])crop=wide(?:&|$)/i.test(raw)) {
    return { transform: 'scale(1.55) translateY(-5%)', transformOrigin: 'center 34%' };
  }
  if (/(?:^|[?&])crop=tight(?:&|$)/i.test(raw)) {
    return {
      objectFit: 'contain',
      objectPosition: 'center 22%',
      transform: 'scale(0.92)',
      transformOrigin: 'center 36%',
    };
  }
  return undefined;
}
