"use client";

import React, { useEffect } from "react";

// Minimal preloader that can be expanded to fetch from an API if needed.
// For now, it just calls onLoad([]) so the page works without a server dependency.

export type NameSuggestion = { id: string; full: string; teamAbbr: string | null };

type Props = {
  season: number;
  onLoad: (list: NameSuggestion[]) => void;
};

export default function PreloadSuggestions({ season, onLoad }: Props) {
  useEffect(() => {
    // Placeholder: call with empty list to keep UI functional
    onLoad([]);
  }, [season, onLoad]);

  return null;
}
