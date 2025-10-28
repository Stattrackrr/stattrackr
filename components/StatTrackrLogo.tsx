"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

export function StatTrackrLogo({ className = "w-16 h-16" }: { className?: string }) {
  return (
    <div className={`${className} relative`}>
      {/* Your actual logo image */}
      <Image
        src="/images/stattrackr-icon.png"
        alt="StatTrackr Logo"
        width={200}
        height={200}
        className="w-full h-full object-contain"
        priority
      />
    </div>
  );
}

export function StatTrackrLogoWithText({ 
  logoSize = "w-12 h-12", 
  textSize = "text-3xl",
  className = "",
  isDark = false
}: { 
  logoSize?: string;
  textSize?: string;
  className?: string;
  isDark?: boolean;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className={`flex items-center gap-4 ${className}`}>
      <StatTrackrLogo className={logoSize} />
      <span 
        className={`font-bold ${textSize} ${mounted && isDark ? 'text-white' : 'text-black'}`}
      >
        StatTrackr
      </span>
    </div>
  );
}
