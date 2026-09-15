/** Extra zoom only for padded tennis.com studio portraits (`crop=wide`). */
export function tennisComAvatarImgStyle(
  url?: string | null
): { transform: string; transformOrigin: string } | undefined {
  if (!/(?:^|[?&])crop=wide(?:&|$)/i.test(String(url || ''))) return undefined;
  return { transform: 'scale(1.55) translateY(-5%)', transformOrigin: 'center 34%' };
}
