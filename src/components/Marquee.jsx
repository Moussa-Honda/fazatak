import { useRef, useEffect } from 'react';
import { mergedQuotesText } from '../data/quotes';

const Marquee = () => {
  const containerRef = useRef(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.style.animationPlayState = 'running';
    }
  }, []);

  // Create seamless infinite content by repeating the text multiple times
  const repeatedContent = `${mergedQuotesText} ⭐️ `.repeat(10);

  return (
    <div className="bg-slate-800/90 border-y border-slate-600 overflow-hidden h-12 flex items-center relative">
      <div 
        ref={containerRef}
        className="whitespace-nowrap flex"
        style={{
          animationName: 'marquee',
          animationDuration: '30s',
          animationTimingFunction: 'linear',
          animationIterationCount: 'infinite',
          willChange: 'transform',
        }}
      >
        <span className="text-amber-400 text-sm font-medium px-4 py-2 leading-relaxed inline-block">
          {repeatedContent}
        </span>
        <span className="text-amber-400 text-sm font-medium px-4 py-2 leading-relaxed inline-block">
          {repeatedContent}
        </span>
      </div>
    </div>
  );
};

export default Marquee;
