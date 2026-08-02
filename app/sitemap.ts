import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://stattrackr.co";
  const now = new Date();

  return [
    {
      url: `${base}/`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${base}/home`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${base}/login`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${base}/pricing`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${base}/terms`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.2,
    },
    {
      url: `${base}/privacy`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.2,
    },
  ];
}
