"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function SiteHeader() {
  const pathname = usePathname();
  const linkBase =
    "px-6 py-2 rounded-lg text-sm transition-colors hover:bg-white/10 hover:text-white";

  return (
    <header className="w-full py-4 -mb-px bg-[var(--brand-bg)]">
      <nav className="flex items-center justify-center gap-4">
        <Link
          href="/journal"
          className={`${linkBase} ${pathname === "/journal" ? "bg-white/15 text-white" : "text-white/70"}`}
        >
          Journal
        </Link>
        <Link
          href="/research"
          className={`${linkBase} ${pathname?.startsWith("/research") ? "bg-white/15 text-white" : "text-white/70"}`}
        >
          Research
        </Link>
      </nav>
    </header>
  );
}
