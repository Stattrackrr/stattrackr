import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Read the StatTrackr Terms of Service. Rules and conditions for using our multi-sport statistics and research platform.",
  alternates: {
    canonical: "/terms",
  },
  openGraph: {
    title: "Terms of Service | StatTrackr",
    description:
      "Read the StatTrackr Terms of Service. Rules and conditions for using our multi-sport statistics and research platform.",
    url: "/terms",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function TermsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
