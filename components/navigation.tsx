"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Navigation() {
  const pathname = usePathname();
  const linkBase =
    "px-8 py-3 rounded-lg text-base font-medium transition-colors";

  return (
    <nav className="flex items-center justify-center gap-6 pt-10 pb-6">
      <Link
        href="/journal"
        className={`${linkBase} border ${
          pathname === "/journal"
            ? "bg-emerald-600 text-white border-emerald-600"
            : "text-emerald-600 border-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
        }`}
      >
        Journal
      </Link>
      <Link
        href="/research"
        className={`${linkBase} border ${
          pathname?.startsWith("/research")
            ? "bg-emerald-600 text-white border-emerald-600"
            : "text-emerald-600 border-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
        }`}
      >
        Research
      </Link>
    </nav>
  );
}
