import type { Metadata } from "next";
import HomePage from "./home/page";

export const metadata: Metadata = {
  title: {
    absolute: "StatTrackr - Advanced Sports Statistic Dashboard",
  },
  description:
    "Advanced multi-sport statistics dashboard covering NBA, AFL, soccer and more. Analyze player statistics, team trends, game props, and matchup data with fast, data-driven tools.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "StatTrackr - Advanced Sports Statistic Dashboard",
    description:
      "Analyze multi-sport player stats, team trends, and game props with an advanced, fast sports statistic dashboard.",
    url: "/",
    type: "website",
    siteName: "StatTrackr",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "StatTrackr",
    url: "https://stattrackr.co/",
    description:
      "Advanced multi-sport statistics dashboard covering NBA, AFL, soccer and more.",
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <HomePage />
    </>
  );
}
