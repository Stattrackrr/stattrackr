import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Read the StatTrackr Privacy Policy. How we collect, use, and protect your information on our sports statistics platform.",
  alternates: {
    canonical: "/privacy",
  },
  openGraph: {
    title: "Privacy Policy | StatTrackr",
    description:
      "Read the StatTrackr Privacy Policy. How we collect, use, and protect your information on our sports statistics platform.",
    url: "/privacy",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function PrivacyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
