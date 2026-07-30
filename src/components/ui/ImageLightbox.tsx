import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Download, ChevronLeft, ChevronRight } from 'lucide-react';

interface ImageLightboxProps {
  src: string;
  title: string;
  onClose: () => void;
  images?: { src: string; title: string }[];
  currentIndex?: number;
}

export default function ImageLightbox({ src, title, onClose, images, currentIndex }: ImageLightboxProps) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [localIndex, setLocalIndex] = useState<number>(currentIndex !== undefined ? currentIndex : -1);
  
  const [isImgLoading, setIsImgLoading] = useState(true);
  
  const imgRef = useRef<HTMLImageElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Gesture refs for pinch-to-zoom
  const initialDistance = useRef<number | null>(null);
  const initialScale = useRef<number>(1);
  const lastTouchTime = useRef<number>(0);

  // Synchronize localIndex with props when they change
  useEffect(() => {
    if (currentIndex !== undefined) {
      setLocalIndex(currentIndex);
    } else if (images && src) {
      const idx = images.findIndex(img => img.src === src);
      if (idx !== -1) {
        setLocalIndex(idx);
      }
    }
  }, [src, currentIndex, images]);

  const hasMultiple = images && images.length > 1;
  
  const currentSrc = (hasMultiple && images && localIndex >= 0 && localIndex < images.length)
    ? images[localIndex].src
    : src;
  
  const currentTitle = (hasMultiple && images && localIndex >= 0 && localIndex < images.length)
    ? images[localIndex].title
    : title;

  const handlePrev = () => {
    if (!hasMultiple || !images) return;
    setLocalIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1));
  };

  const handleNext = () => {
    if (!hasMultiple || !images) return;
    setLocalIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0));
  };

  // Reset states when image changes
  useEffect(() => {
    setIsImgLoading(true);
    setScale(1);
    setPosition({ x: 0, y: 0 });
    
    if (imgRef.current && imgRef.current.complete) {
      setIsImgLoading(false);
    }
  }, [currentSrc]);

  // Handle immediate check when ref is assigned or updated
  const handleRef = (el: HTMLImageElement | null) => {
    imgRef.current = el;
    if (el && el.complete) {
      setIsImgLoading(false);
    }
  };

  // Disable pull-to-refresh and page scroll when lightbox is active
  useEffect(() => {
    const originalBodyOverscroll = document.body.style.overscrollBehaviorY;
    const originalHtmlOverscroll = document.documentElement.style.overscrollBehaviorY;
    const originalBodyOverflow = document.body.style.overflow;
    const originalHtmlOverflow = document.documentElement.style.overflow;

    // Apply strict containment to prevent any pull-to-refresh or page bounces
    document.body.style.overscrollBehaviorY = 'contain';
    document.documentElement.style.overscrollBehaviorY = 'contain';
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    return () => {
      document.body.style.overscrollBehaviorY = originalBodyOverscroll;
      document.documentElement.style.overscrollBehaviorY = originalHtmlOverscroll;
      document.body.style.overflow = originalBodyOverflow;
      document.documentElement.style.overflow = originalHtmlOverflow;
    };
  }, []);

  // Handle keys (Escape, ArrowLeft, ArrowRight)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft' && hasMultiple) {
        handlePrev();
      } else if (e.key === 'ArrowRight' && hasMultiple) {
        handleNext();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, hasMultiple, localIndex, images]);

  const handleDownload = async () => {
    try {
      if (currentSrc.startsWith('data:')) {
        const a = document.createElement('a');
        a.href = currentSrc;
        a.download = `${currentTitle.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'foto'}.jpg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else {
        const response = await fetch(currentSrc);
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = `${currentTitle.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'foto'}.jpg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
      }
    } catch (error) {
      console.error("Gagal mendownload gambar:", error);
      const a = document.createElement('a');
      a.href = currentSrc;
      a.target = '_blank';
      a.download = `${currentTitle.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'foto'}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  // Mouse drag handlers (Desktop)
  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale <= 1) return;
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || scale <= 1) return;
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Double click / Double tap to toggle zoom
  const handleDoubleTap = () => {
    if (scale > 1) {
      setScale(1);
      setPosition({ x: 0, y: 0 });
    } else {
      setScale(2.5);
    }
  };

  const handleImageClick = (e: React.MouseEvent) => {
    // Detect double click
    if (e.detail === 2) {
      handleDoubleTap();
    }
  };

  // Pinch & drag touch handlers (Mobile)
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // Pinch initialization
      setIsDragging(false);
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      initialDistance.current = dist;
      initialScale.current = scale;
    } else if (e.touches.length === 1) {
      // Single finger drag or double tap detection
      const now = Date.now();
      const DOUBLE_TAP_DELAY = 300;
      if (now - lastTouchTime.current < DOUBLE_TAP_DELAY) {
        handleDoubleTap();
        lastTouchTime.current = 0;
        return;
      }
      lastTouchTime.current = now;

      if (scale > 1) {
        setIsDragging(true);
        const touch = e.touches[0];
        setDragStart({ x: touch.clientX - position.x, y: touch.clientY - position.y });
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && initialDistance.current !== null) {
      // Handle pinch zoom
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const nextScale = (dist / initialDistance.current) * initialScale.current;
      setScale(Math.max(1, Math.min(nextScale, 4)));
    } else if (e.touches.length === 1 && isDragging && scale > 1) {
      // Handle drag
      const touch = e.touches[0];
      setPosition({
        x: touch.clientX - dragStart.x,
        y: touch.clientY - dragStart.y
      });
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    initialDistance.current = null;
  };

  return createPortal(
    <div 
      ref={containerRef}
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-between bg-slate-950/95 backdrop-blur-md p-4 transition-all duration-300 select-none animate-in fade-in duration-200 touch-none overscroll-contain"
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Top Header */}
      <div className="w-full max-w-4xl flex items-center justify-between z-10 py-3 border-b border-slate-800/60 shrink-0">
        <div className="text-slate-100 font-semibold text-sm md:text-base line-clamp-1 pr-4 flex items-center gap-2">
          <span>{currentTitle || 'Pratinjau Foto'}</span>
          {hasMultiple && images && (
            <span className="text-xs bg-slate-800 text-slate-300 px-2.5 py-0.5 rounded-full border border-slate-700 font-mono shrink-0">
              {localIndex + 1} / {images.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Download Button in Header */}
          <button 
            onClick={handleDownload}
            className="text-blue-400 hover:text-blue-300 transition-colors p-2.5 bg-slate-900/60 hover:bg-slate-800 rounded-full cursor-pointer shadow-lg outline-none ring-2 ring-transparent focus:ring-blue-500 flex items-center gap-1.5 text-xs font-semibold"
            title="Unduh Foto"
            id="lightbox_download"
          >
            <Download className="w-4 h-4 md:w-5 h-5" />
            <span className="hidden sm:inline">Unduh</span>
          </button>
          
          {/* Close Button */}
          <button 
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors p-2.5 bg-slate-900/60 hover:bg-slate-800 rounded-full cursor-pointer shadow-lg outline-none ring-2 ring-transparent focus:ring-blue-500"
            title="Tutup"
            id="close_lightbox_btn"
          >
            <X className="w-4 h-4 md:w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Main Stage */}
      <div 
        className="flex-1 w-full max-w-4xl flex items-center justify-center relative overflow-hidden my-4 rounded-xl border border-slate-800/40 bg-slate-900/20"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{ cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
      >
        {/* Left Arrow Button */}
        {hasMultiple && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handlePrev();
            }}
            className="absolute left-4 top-1/2 -translate-y-1/2 z-30 p-3 rounded-full bg-slate-950/70 hover:bg-slate-900 text-slate-200 border border-slate-850 hover:text-white transition-all cursor-pointer shadow-lg hover:scale-105 active:scale-95 flex items-center justify-center outline-none ring-2 ring-transparent focus:ring-blue-500"
            title="Foto Sebelumnya"
            id="lightbox_prev_btn"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}

        {/* Right Arrow Button */}
        {hasMultiple && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleNext();
            }}
            className="absolute right-4 top-1/2 -translate-y-1/2 z-30 p-3 rounded-full bg-slate-950/70 hover:bg-slate-900 text-slate-200 border border-slate-850 hover:text-white transition-all cursor-pointer shadow-lg hover:scale-105 active:scale-95 flex items-center justify-center outline-none ring-2 ring-transparent focus:ring-blue-500"
            title="Foto Berikutnya"
            id="lightbox_next_btn"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        )}

        {/* Loading Spinner for full-size image */}
        {isImgLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/20 z-10 pointer-events-none">
            <div className="w-10 h-10 rounded-full border-4 border-slate-700/50 border-t-blue-500 animate-spin" />
          </div>
        )}

        <div 
          className={`transition-transform duration-100 ease-out flex items-center justify-center transition-opacity duration-300 ${isImgLoading ? 'opacity-40' : 'opacity-100'}`}
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`
          }}
          onClick={handleImageClick}
        >
          <img
            ref={handleRef}
            src={currentSrc}
            alt={currentTitle}
            onLoad={() => setIsImgLoading(false)}
            onError={() => setIsImgLoading(false)}
            className="max-w-[90vw] max-h-[75vh] object-contain rounded-md shadow-2xl pointer-events-none"
            referrerPolicy="no-referrer"
          />
        </div>


      </div>
    </div>,
    document.body
  );
}
