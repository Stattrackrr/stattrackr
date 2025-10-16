"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Navigation() {
  const pathname = usePathname();
  const linkBase =
    "px-8 py-3 rounded-lg text-base font-medium transition-colors";

  return (
    <nav className="flex items-center justify-center gap-6 pt-10 pb-6">
      {/* Navigation links removed */}
    </nav>
  );
}
