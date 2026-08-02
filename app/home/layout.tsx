import type { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    absolute: "StatTrackr - Advanced Sports Statistic Dashboard",
  },
  description:
    "Advanced multi-sport statistics dashboard covering NBA, AFL, soccer and more. Analyze player statistics, team trends, game props, and matchup data with fast, data-driven tools.",
  // Consolidate /home onto the root URL in search results
  alternates: {
    canonical: "/",
  },
  openGraph: {
    url: "/",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function HomeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
