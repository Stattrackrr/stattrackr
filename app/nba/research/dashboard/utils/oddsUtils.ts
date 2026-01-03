// Types and utilities for odds/alt lines

export type AltLineItem = {
  bookmaker: string;
  line: number;
  over: string;
  under: string;
  isPickem?: boolean;
  variantLabel?: string | null;
};

export const partitionAltLineItems = (lines: AltLineItem[]): { primary: AltLineItem[]; alternate: AltLineItem[]; milestones: AltLineItem[] } => {
  // Separate milestones from over/under lines
  const milestones: AltLineItem[] = [];
  const overUnderLines: AltLineItem[] = [];
  
  for (const line of lines) {
    if (line.variantLabel === 'Milestone') {
      milestones.push(line);
    } else {
      overUnderLines.push(line);
    }
  }
  
  // USER REQUEST: Show ALL over/under lines (not just one per bookmaker)
  // Don't separate into primary/alternate - show everything except milestones
  // Sort all over/under lines by line value
  overUnderLines.sort((a, b) => a.line - b.line);
  
  // Sort milestones by line value
  milestones.sort((a, b) => a.line - b.line);
  
  // Return all over/under lines as "primary" (they'll all be shown)
  // Keep alternate empty (no separation needed)
  // Milestones are excluded as requested
  return { primary: overUnderLines, alternate: [] as AltLineItem[], milestones: [] as AltLineItem[] };
};
