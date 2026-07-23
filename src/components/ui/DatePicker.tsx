import React, { useState, useEffect, useRef } from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, ChevronDown, X } from 'lucide-react';
import { getTodayWIB } from '../../lib/dateFormatter';
import { useAppContext } from '../../context/AppContext';

interface DatePickerProps {
  label?: string;
  value: string; // YYYY-MM-DD
  onChange: (date: string) => void;
  className?: string;
}

const MONTH_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

const DAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

// Helper to parse "YYYY-MM-DD" as a purely local Date object without UTC timezone shifts
const parseLocalDate = (dateStr: string) => {
  if (!dateStr) return new Date();
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
};

// Helper to format local Date object as "YYYY-MM-DD"
const formatLocalYYYYMMDD = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

interface CustomDropdownProps<T> {
  value: T;
  onChange: (val: T) => void;
  options: { label: string; value: T }[];
  className?: string;
  dropdownWidthClass?: string;
}

function CustomDropdown<T extends string | number>({
  value,
  onChange,
  options,
  className = '',
  dropdownWidthClass = 'w-full'
}: CustomDropdownProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const selectedOption = options.find(opt => opt.value === value) || options[0];

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between bg-slate-50 dark:bg-slate-700/80 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-900 dark:text-white border border-slate-300 dark:border-slate-600 rounded-xl px-1.5 sm:px-2.5 py-2 text-[10px] xs:text-[11px] sm:text-xs font-bold focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all cursor-pointer text-left shadow-xs gap-1"
      >
        <span className="whitespace-nowrap overflow-hidden text-ellipsis">{selectedOption?.label}</span>
        <ChevronDown className={`w-3 h-3 sm:w-3.5 sm:h-3.5 text-slate-400 dark:text-slate-500 shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180 text-blue-500' : ''}`} />
      </button>

      {isOpen && (
        <>
          {/* Transparent click screen overlay to dismiss safely without propagation or blur bugs */}
          <div className="fixed inset-0 z-[190]" onClick={() => setIsOpen(false)} />
          
          <div className={`absolute left-0 mt-1.5 ${dropdownWidthClass} max-h-56 overflow-y-auto z-[200] bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 py-1 scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-600 animate-in fade-in slide-in-from-top-1 duration-100`}>
            {options.map((opt) => {
              const isSelected = opt.value === value;
              return (
                <button
                  key={String(opt.value)}
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setIsOpen(false);
                  }}
                  className={`w-full text-left px-2.5 py-2 text-[11px] sm:text-xs font-medium transition-colors flex items-center justify-between ${
                    isSelected
                      ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 font-bold'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'
                  }`}
                >
                  <span className="whitespace-nowrap overflow-hidden text-ellipsis">{opt.label}</span>
                  {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-blue-600 dark:bg-blue-400 shrink-0 ml-1.5" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export default function DatePicker({ label, value, onChange, className = '' }: DatePickerProps) {
  const { datePickerStyle } = useAppContext();
  
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<'days' | 'months' | 'years'>('days');

  // Fixed positioning state
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({});

  const [currentMonth, setCurrentMonth] = useState(() => {
    let d: Date;
    if (value) {
      d = parseLocalDate(value);
    } else {
      const todayStr = getTodayWIB();
      d = parseLocalDate(todayStr);
    }
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  // Calculate fixed position when opening
  const calculatePosition = () => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const popupWidth = 290;
    const popupHeight = 380; // estimated max height
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Horizontal: prioritas rata kiri dengan tombol,
    // kalau mepet kanan viewport → geser kiri, kalau mepet kiri viewport → clamp ke margin
    let left = rect.left;
    if (left + popupWidth > vw - margin) left = vw - popupWidth - margin;
    if (left < margin) left = margin;

    // Vertical: prefer below button, flip to above if not enough space
    const spaceBelow = vh - rect.bottom - margin;
    const spaceAbove = rect.top - margin;

    let top: number;
    let transformOrigin: string;

    if (spaceBelow >= popupHeight || spaceBelow >= spaceAbove) {
      // Open below — tepat di bawah tombol
      top = rect.bottom + 6;
      transformOrigin = 'top left';
    } else {
      // Open above — tepat di atas tombol
      top = rect.top - popupHeight - 6;
      if (top < margin) top = margin;
      transformOrigin = 'bottom left';
    }

    setPopupStyle({ position: 'fixed', top, left, width: popupWidth, transformOrigin });
  };

  const handleOpen = () => {
    calculatePosition();
    setIsOpen(true);
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        containerRef.current && !containerRef.current.contains(target) &&
        popupRef.current && !popupRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      // Recalculate on scroll/resize
      window.addEventListener('scroll', calculatePosition, true);
      window.addEventListener('resize', calculatePosition);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', calculatePosition, true);
      window.removeEventListener('resize', calculatePosition);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && value) {
      const d = parseLocalDate(value);
      setCurrentMonth(new Date(d.getFullYear(), d.getMonth(), 1));
    }
    if (!isOpen) {
      setView('days');
    }
  }, [isOpen, value]);

  // Return Klasik select dropdowns if configured
  if (datePickerStyle === 'klasik') {
    const dateObj = value ? parseLocalDate(value) : parseLocalDate(getTodayWIB());
    const selectedYear = dateObj.getFullYear();
    const selectedMonth = dateObj.getMonth() + 1; // 1-indexed
    const selectedDay = dateObj.getDate();

    const daysInMonth = new Date(selectedYear, selectedMonth, 0).getDate();
    const daysInMonthArray = Array.from({ length: daysInMonth }, (_, i) => i + 1);

    const handleDayChange = (newDay: number) => {
      const day = String(newDay).padStart(2, '0');
      const month = String(selectedMonth).padStart(2, '0');
      onChange(`${selectedYear}-${month}-${day}`);
    };

    const handleMonthChange = (newMonth: number) => {
      const maxDays = new Date(selectedYear, newMonth, 0).getDate();
      const day = String(Math.min(selectedDay, maxDays)).padStart(2, '0');
      const month = String(newMonth).padStart(2, '0');
      onChange(`${selectedYear}-${month}-${day}`);
    };

    const handleYearChange = (newYear: number) => {
      const maxDays = new Date(newYear, selectedMonth, 0).getDate();
      const day = String(Math.min(selectedDay, maxDays)).padStart(2, '0');
      const month = String(selectedMonth).padStart(2, '0');
      onChange(`${newYear}-${month}-${day}`);
    };

    const dayOptions = daysInMonthArray.map(d => ({ label: String(d).padStart(2, '0'), value: d }));
    const monthOptions = MONTH_NAMES.map((m, index) => ({ label: m, value: index + 1 }));
    const yearOptions = Array.from({ length: 16 }, (_, i) => 2020 + i).map(y => ({ label: String(y), value: y }));

    return (
      <div className={`flex flex-col gap-1 relative z-20 focus-within:z-50 ${className}`}>
        {label && <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">{label}</label>}
        <div className="flex items-center gap-1.5 w-full relative z-30">
          {/* Day Selector */}
          <CustomDropdown
            value={selectedDay}
            onChange={handleDayChange}
            options={dayOptions}
            className="flex-[1.2] min-w-[44px] xs:min-w-[52px] sm:min-w-[58px]"
            dropdownWidthClass="w-24"
          />
          
          {/* Month Selector */}
          <CustomDropdown
            value={selectedMonth}
            onChange={handleMonthChange}
            options={monthOptions}
            className="flex-[2.2] min-w-[80px] xs:min-w-[95px] sm:min-w-[105px]"
            dropdownWidthClass="w-40"
          />
          
          {/* Year Selector */}
          <CustomDropdown
            value={selectedYear}
            onChange={handleYearChange}
            options={yearOptions}
            className="flex-[1.5] min-w-[62px] xs:min-w-[70px] sm:min-w-[78px]"
            dropdownWidthClass="w-28"
          />
        </div>
      </div>
    );
  }

  const handlePrevMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  const handleNextMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  const generateDays = () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();
    
    const days = [];
    
    // Prev month padding
    for (let i = 0; i < firstDay; i++) {
      days.push({
        day: daysInPrevMonth - firstDay + i + 1,
        isCurrentMonth: false,
        date: new Date(year, month - 1, daysInPrevMonth - firstDay + i + 1)
      });
    }
    
    // Current month days
    for (let i = 1; i <= daysInMonth; i++) {
      days.push({
        day: i,
        isCurrentMonth: true,
        date: new Date(year, month, i)
      });
    }
    
    // Next month padding - only fill the remaining columns of the current row, do not create a separate row
    const totalNeeded = days.length <= 35 ? 35 : 42;
    const remainingDays = totalNeeded - days.length;
    for (let i = 1; i <= remainingDays; i++) {
      days.push({
        day: i,
        isCurrentMonth: false,
        date: new Date(year, month + 1, i)
      });
    }
    
    return days;
  };

  const handleSelectDate = (date: Date) => {
    onChange(formatLocalYYYYMMDD(date));
    setIsOpen(false);
  };

  const displayDate = value ? parseLocalDate(value).toLocaleDateString('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric'
  }) : 'Pilih Tanggal';

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {label && <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">{label}</label>}
      <button
        ref={buttonRef}
        type="button"
        onClick={handleOpen}
        className="w-full flex items-center justify-between px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white hover:border-blue-500 focus:ring-2 focus:ring-blue-500 outline-none transition-all text-left"
      >
        <span>{displayDate}</span>
        <CalendarIcon className="w-4 h-4 text-slate-500 dark:text-slate-400" />
      </button>

      {isOpen && (
        <>
          {/* Full-screen backdrop — z-[9998] mengalahkan sidebar (z-40) dan semua modal */}
          <div 
            className="fixed inset-0 z-[9998]"
            onClick={() => setIsOpen(false)}
          />
          {/* Popup kalender — fixed, posisi dihitung dari getBoundingClientRect */}
          <div
            ref={popupRef}
            style={popupStyle}
            className="z-[9999] bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-in fade-in zoom-in-95 duration-150"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-3 border-b border-slate-200 dark:border-slate-700 gap-2 bg-slate-50/50 dark:bg-slate-800/50">
              <span className="font-bold text-slate-800 dark:text-white flex items-center gap-1.5 text-xs sm:text-sm whitespace-nowrap">
                <CalendarIcon className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                Pilih
              </span>

              {/* Navigation Controls in line with header */}
              <div className="flex items-center gap-1">
                <button type="button" onClick={handlePrevMonth} className="p-1 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors flex-shrink-0">
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                
                <div className="flex gap-0.5">
                  <button 
                    type="button"
                    onClick={() => setView(view === 'months' ? 'days' : 'months')}
                    className={`px-1.5 py-0.5 rounded-md font-bold transition-colors text-[10px] sm:text-[11px] ${view === 'months' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400' : 'hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-white'}`}
                  >
                    {MONTH_NAMES[currentMonth.getMonth()].substring(0, 3)}
                  </button>
                  
                  <button
                    type="button"
                    onClick={() => setView(view === 'years' ? 'days' : 'years')}
                    className={`px-1.5 py-0.5 rounded-md font-bold transition-colors text-[10px] sm:text-[11px] ${view === 'years' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400' : 'hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-white'}`}
                  >
                    {currentMonth.getFullYear()}
                  </button>
                </div>

                <button type="button" onClick={handleNextMonth} className="p-1 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors flex-shrink-0">
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <button onClick={() => setIsOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>
          
            <div className="p-3">
              {view === 'days' && (
                <>
                  <div className="grid grid-cols-7 gap-0.5 mb-1.5">
                    {DAYS.map(day => (
                      <div key={day} className="text-center text-[10px] font-bold text-slate-400 dark:text-slate-500 py-0.5">
                        {day}
                      </div>
                    ))}
                  </div>
                  
                  <div className="grid grid-cols-7 gap-0.5">
                    {generateDays().map((d, i) => {
                      const dayStr = formatLocalYYYYMMDD(d.date);
                      const isSelected = value && dayStr === value;
                      const isToday = getTodayWIB() === dayStr;
                      
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => handleSelectDate(d.date)}
                          className={`
                            h-7 w-7 sm:h-8 sm:w-8 rounded-full flex items-center justify-center text-[11px] sm:text-xs font-semibold transition-colors mx-auto
                            ${!d.isCurrentMonth ? 'text-slate-300 dark:text-slate-600' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'}
                            ${isSelected ? '!bg-blue-600 !text-white hover:!bg-blue-700 shadow-sm' : ''}
                            ${isToday && !isSelected ? 'border border-blue-400 dark:border-blue-500 text-blue-600 dark:text-blue-400' : ''}
                          `}
                        >
                          {d.day}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              {view === 'months' && (
                <div className="grid grid-cols-3 gap-1.5">
                  {MONTH_NAMES.map((m, i) => (
                    <button
                      key={m}
                      onClick={() => {
                        setCurrentMonth(new Date(currentMonth.getFullYear(), i, 1));
                        setView('days');
                      }}
                      className={`py-2 rounded-lg text-[11px] sm:text-xs font-bold transition-colors ${currentMonth.getMonth() === i ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-50 dark:bg-slate-700/50 hover:bg-blue-50 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200'}`}
                    >
                      {m.substring(0, 3)}
                    </button>
                  ))}
                </div>
              )}

              {view === 'years' && (
                <div className="grid grid-cols-3 gap-1.5 max-h-[160px] overflow-y-auto custom-scrollbar pr-1">
                  {Array.from({ length: 11 }, (_, i) => 2020 + i).map(year => (
                    <button
                      key={year}
                      onClick={() => {
                        setCurrentMonth(new Date(year, currentMonth.getMonth(), 1));
                        setView('days');
                      }}
                      className={`py-2 rounded-lg text-[11px] sm:text-xs font-bold transition-colors ${currentMonth.getFullYear() === year ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-50 dark:bg-slate-700/50 hover:bg-blue-50 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200'}`}
                    >
                      {year}
                    </button>
                  ))}
                </div>
              )}
            </div>
            
            <div className="p-2.5 border-t border-slate-200 dark:border-slate-700 flex justify-end">
              <button 
                type="button"
                onClick={() => {
                  const todayStr = getTodayWIB();
                  handleSelectDate(parseLocalDate(todayStr));
                }}
                className="text-xs font-bold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
              >
                Hari Ini
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
