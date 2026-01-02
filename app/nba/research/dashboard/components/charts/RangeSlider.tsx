'use client';

import { useState, useEffect, useRef, memo } from 'react';

export interface RangeSliderProps {
  min: number;
  max: number;
  valueMin: number;
  valueMax: number;
  onChange: (min: number, max: number) => void;
  step?: number;
  formatValue?: (val: number) => string;
}

const RangeSlider = memo(function RangeSlider({
  min,
  max,
  valueMin,
  valueMax,
  onChange,
  step = 0.5,
  formatValue = (val) => val.toString(),
}: RangeSliderProps) {
  const sliderRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<'min' | 'max' | null>(null);
  const [localMin, setLocalMin] = useState(valueMin);
  const [localMax, setLocalMax] = useState(valueMax);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    setLocalMin(valueMin);
    setLocalMax(valueMax);
  }, [valueMin, valueMax]);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(typeof window !== 'undefined' && window.innerWidth < 640);
    };
    if (typeof window !== 'undefined') {
      checkMobile();
      window.addEventListener('resize', checkMobile);
      return () => window.removeEventListener('resize', checkMobile);
    }
  }, []);

  const getPercentage = (value: number) => {
    return ((value - min) / (max - min)) * 100;
  };

  const getValueFromPosition = (clientX: number) => {
    if (!sliderRef.current) return 0;
    const rect = sliderRef.current.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const value = min + percent * (max - min);
    return Math.round(value / step) * step;
  };

  const handleStart = (clientX: number, handle: 'min' | 'max') => {
    setDragging(handle);
    
    const value = getValueFromPosition(clientX);
    if (handle === 'min') {
      const newMin = Math.max(min, Math.min(value, localMax - step));
      setLocalMin(newMin);
      onChange(newMin, localMax);
    } else {
      const newMax = Math.min(max, Math.max(value, localMin + step));
      setLocalMax(newMax);
      onChange(localMin, newMax);
    }
  };

  const handleMouseDown = (e: React.MouseEvent, handle: 'min' | 'max') => {
    e.preventDefault();
    handleStart(e.clientX, handle);
  };

  const handleTouchStart = (e: React.TouchEvent, handle: 'min' | 'max') => {
    e.preventDefault();
    e.stopPropagation();
    if (e.touches.length > 0) {
      handleStart(e.touches[0].clientX, handle);
    }
  };

  useEffect(() => {
    if (!dragging) return;

    const handleMove = (clientX: number) => {
      const value = getValueFromPosition(clientX);
      
      if (dragging === 'min') {
        const newMin = Math.max(min, Math.min(value, localMax - step));
        setLocalMin(newMin);
        onChange(newMin, localMax);
      } else {
        const newMax = Math.min(max, Math.max(value, localMin + step));
        setLocalMax(newMax);
        onChange(localMin, newMax);
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      handleMove(e.clientX);
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.touches.length > 0) {
        handleMove(e.touches[0].clientX);
      }
    };

    const handleEnd = () => {
      setDragging(null);
    };

    const handleMouseUp = () => {
      handleEnd();
    };

    const handleTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      handleEnd();
    };

    document.addEventListener('mousemove', handleMouseMove, { passive: false });
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd, { passive: false });
    document.addEventListener('touchcancel', handleTouchEnd, { passive: false });
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [dragging, localMin, localMax, min, max, step, onChange]);

  const minPercent = getPercentage(localMin);
  const maxPercent = getPercentage(localMax);

  const handleTrackClick = (clientX: number) => {
    const value = getValueFromPosition(clientX);
    const distToMin = Math.abs(value - localMin);
    const distToMax = Math.abs(value - localMax);
    
    if (distToMin < distToMax) {
      const newMin = Math.max(min, Math.min(value, localMax - step));
      setLocalMin(newMin);
      onChange(newMin, localMax);
    } else {
      const newMax = Math.min(max, Math.max(value, localMin + step));
      setLocalMax(newMax);
      onChange(localMin, newMax);
    }
  };

  return (
    <div 
      className="relative w-full sm:w-48 h-8 sm:h-8 select-none touch-none"
      style={{ 
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        touchAction: 'none'
      }}
    >
      {/* Track background */}
      <div className="absolute top-1/2 left-0 right-0 h-1 sm:h-1 bg-purple-500/30 -translate-y-1/2 rounded-full"></div>
      
      {/* Active range */}
      <div 
        className="absolute top-1/2 h-1 sm:h-1 bg-purple-600 -translate-y-1/2 rounded-full"
        style={{
          left: `${minPercent}%`,
          width: `${maxPercent - minPercent}%`,
        }}
      ></div>

      {/* Min handle */}
      <div
        className="absolute top-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing z-10 select-none touch-none"
        style={{ 
          left: `calc(${minPercent}% - ${isMobile ? '8px' : '8px'})`,
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
          touchAction: 'none'
        }}
        onMouseDown={(e) => handleMouseDown(e, 'min')}
        onTouchStart={(e) => handleTouchStart(e, 'min')}
      >
        <div className="w-4 h-4 sm:w-4 sm:h-4 rounded-full bg-purple-600 border-2 sm:border-2 border-white shadow-lg sm:shadow-lg"></div>
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 sm:mt-1 whitespace-nowrap pointer-events-none">
          <span className="text-xs sm:text-xs text-gray-300 dark:text-gray-400 font-medium">
            {formatValue(localMin)}
          </span>
        </div>
      </div>

      {/* Max handle */}
      <div
        className="absolute top-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing z-10 select-none touch-none"
        style={{ 
          left: `calc(${maxPercent}% - ${isMobile ? '8px' : '8px'})`,
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
          touchAction: 'none'
        }}
        onMouseDown={(e) => handleMouseDown(e, 'max')}
        onTouchStart={(e) => handleTouchStart(e, 'max')}
      >
        <div className="w-4 h-4 sm:w-4 sm:h-4 rounded-full bg-purple-600 border-2 sm:border-2 border-white shadow-lg sm:shadow-lg"></div>
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 sm:mt-1 whitespace-nowrap pointer-events-none">
          <span className="text-xs sm:text-xs text-gray-300 dark:text-gray-400 font-medium">
            {formatValue(localMax)}
          </span>
        </div>
      </div>

      {/* Invisible track for click detection */}
      <div
        ref={sliderRef}
        className="absolute top-0 left-0 right-0 h-full cursor-pointer select-none touch-none"
        style={{
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
          touchAction: 'none'
        }}
        onMouseDown={(e) => {
          if (e.target === sliderRef.current || (e.target as HTMLElement).closest('.cursor-grab')) {
            return;
          }
          e.preventDefault();
          handleTrackClick(e.clientX);
        }}
        onTouchStart={(e) => {
          if (e.target === sliderRef.current || (e.target as HTMLElement).closest('.cursor-grab')) {
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          if (e.touches.length > 0) {
            handleTrackClick(e.touches[0].clientX);
          }
        }}
      ></div>
    </div>
  );
}, (prev, next) => 
  prev.min === next.min &&
  prev.max === next.max &&
  prev.valueMin === next.valueMin &&
  prev.valueMax === next.valueMax &&
  prev.step === next.step
);

export default RangeSlider;

