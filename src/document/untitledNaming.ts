export function getNextUntitledName(existingTitles: string[]): string {
  const untitledRegex = /^Untitled(?:\s+(\d+))?\.pdf$/i;
  const usedNumbers = new Set<number>();
  let hasBaseUntitled = false;

  for (const title of existingTitles) {
    const match = title.match(untitledRegex);
    if (match) {
      if (match[1]) {
        usedNumbers.add(parseInt(match[1], 10));
      } else {
        hasBaseUntitled = true;
      }
    }
  }

  if (!hasBaseUntitled) {
    return 'Untitled.pdf';
  }

  let next = 2;
  while (usedNumbers.has(next)) {
    next++;
  }

  return `Untitled ${next}.pdf`;
}
