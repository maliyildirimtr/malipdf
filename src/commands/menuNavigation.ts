export type MenuMove = 'next' | 'previous' | 'first' | 'last';

export function moveMenuIndex(enabled: readonly boolean[], currentIndex: number, move: MenuMove): number {
  const available = enabled.map((value, index) => value ? index : -1).filter((index) => index >= 0);
  if (available.length === 0) return -1;
  if (move === 'first') return available[0];
  if (move === 'last') return available[available.length - 1];
  const currentPosition = available.indexOf(currentIndex);
  if (move === 'next') return available[currentPosition < 0 ? 0 : (currentPosition + 1) % available.length];
  return available[currentPosition < 0 ? available.length - 1 : (currentPosition - 1 + available.length) % available.length];
}

export function findTypeaheadMenuIndex(
  labels: readonly string[],
  enabled: readonly boolean[],
  currentIndex: number,
  query: string,
): number {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized || labels.length === 0) return -1;
  for (let offset = 1; offset <= labels.length; offset++) {
    const index = (Math.max(currentIndex, -1) + offset) % labels.length;
    if (enabled[index] && labels[index]?.toLocaleLowerCase().startsWith(normalized)) return index;
  }
  return -1;
}
