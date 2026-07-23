import { useState, useEffect } from 'react';

interface LazyImageProps {
  src: string;
  alt: string;
  onClick?: () => void;
  className?: string;
  containerClassName?: string;
}

export default function LazyImage({ src, alt, onClick, className = "", containerClassName = "" }: LazyImageProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState(false);

  // When src changes, reset states!
  useEffect(() => {
    setIsLoaded(false);
    setError(false);
  }, [src]);

  return (
    <div className={`relative overflow-hidden bg-slate-100 dark:bg-slate-900/50 ${containerClassName}`}>
      {/* Shimmering Skeleton Placeholder */}
      {!isLoaded && !error && (
        <div className="absolute inset-0 bg-slate-200 dark:bg-slate-800 animate-pulse flex items-center justify-center">
          <div className="w-5.5 h-5.5 rounded-full border-2 border-slate-300 dark:border-slate-600 border-t-blue-500 animate-spin" />
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-100 dark:bg-slate-900 text-[10px] sm:text-xs text-slate-400 dark:text-slate-500 italic">
          Gagal Memuat Foto
        </div>
      )}

      <img
        src={src}
        alt={alt}
        onLoad={() => setIsLoaded(true)}
        onError={() => setError(true)}
        onClick={onClick}
        className={`transition-all duration-500 ease-out ${
          isLoaded && !error ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
        } ${className}`}
        referrerPolicy="no-referrer"
        style={{ display: error ? 'none' : 'block' }}
      />
    </div>
  );
}
