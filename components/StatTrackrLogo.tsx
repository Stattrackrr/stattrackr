"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

export function StatTrackrLogo({ className = "w-16 h-16" }: { className?: string }) {
  return (
    <div className={`${className} relative flex-shrink-0 overflow-visible`}>
      <Image
        src="/images/transparent-photo.png"
        alt="StatTrackr Logo"
        width={200}
        height={200}
        className="w-full h-full object-contain"
        priority
        unoptimized
      />
    </div>
  );
}

export function StatTrackrLogoWithText({ 
  logoSize = "w-12 h-12", 
  textSize = "text-3xl",
  className = "",
  isDark = false,
  textGradient = false
}: { 
  logoSize?: string;
  textSize?: string;
  className?: string;
  isDark?: boolean;
  /** Purple gradient text (left = purple, right = lighter purple) */
  textGradient?: boolean;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const textClassName = textGradient
    ? `font-bold ${textSize} bg-gradient-to-r from-purple-800 to-purple-400 bg-clip-text text-transparent`
    : `font-bold ${textSize} ${mounted && isDark ? 'text-white' : 'text-black'}`;

  return (
    <div className={`flex items-center gap-4 ${className}`}>
      <StatTrackrLogo className={logoSize} />
      <span className={textClassName}>
        StatTrackr
      </span>
    </div>
  );
}
