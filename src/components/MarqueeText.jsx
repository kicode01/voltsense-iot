import React, { useRef, useState, useEffect } from 'react';

export default function MarqueeText({ text, className }) {
  const containerRef = useRef(null);
  const textRef = useRef(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    const textEl = textRef.current;
    if (!container || !textEl) return;

    const checkOverflow = () => {
      setIsOverflowing(textEl.scrollWidth > container.clientWidth);
    };

    checkOverflow();
    // Re-measure once the webfont has settled — the first paint can use fallback metrics.
    const timeoutId = setTimeout(checkOverflow, 100);

    // A ResizeObserver beats a window `resize` listener: it also fires when the container changes
    // size without the window doing so — device rotation, entering rename mode, the nav bar
    // appearing, or a sibling growing.
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(checkOverflow) : null;
    if (observer) {
      observer.observe(container);
    } else {
      window.addEventListener('resize', checkOverflow);
    }

    return () => {
      clearTimeout(timeoutId);
      if (observer) observer.disconnect();
      else window.removeEventListener('resize', checkOverflow);
    };
  }, [text]);

  return (
    <div 
      ref={containerRef} 
      className={`relative overflow-hidden whitespace-nowrap w-full min-w-0 ${className}`}
      style={{
        maskImage: isOverflowing ? 'linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%)' : 'none',
        WebkitMaskImage: isOverflowing ? 'linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%)' : 'none'
      }}
    >
      <div 
        ref={textRef}
        className={`inline-block ${isOverflowing ? 'animate-marquee-infinite w-max' : ''}`}
      >
        <span className={isOverflowing ? 'pr-8' : ''}>{text}</span>
        {isOverflowing && (
          <span className="pr-8">{text}</span>
        )}
      </div>
    </div>
  );
}
