"use client";

// Standalone React DevTools connector for Next.js (development only).
// This component renders nothing and only loads the devtools client.
export default function Devtools(): null {
  // No-op: script is injected in layout head in development.
  return null;
}
