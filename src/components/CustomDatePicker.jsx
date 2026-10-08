import { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';

// `minDate` / `maxDate` are optional bounds. The `= null` defaults make that explicit: without them
// the destructured binding is inferred as required, so a caller legitimately omitting a bound (the
// Start-Date picker has no lower limit) reads as a type error even though the body already handles
// the null case on the next line.
const CustomDatePicker = ({ label, value, onChange, minDate = null, maxDate = null }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);
  
  const minDateObj = minDate ? new Date(`${minDate}T00:00:00`) : null;
  const maxDateObj = maxDate ? new Date(`${maxDate}T00:00:00`) : null;
  
  // Parse value or use current date for the calendar view
  // NOTE: Javascript Date parsing from YYYY-MM-DD creates a UTC date. 
  // We add 'T00:00:00' to ensure it's treated as local time.
  const selectedDate = value ? new Date(`${value}T00:00:00`) : null;
  
  const [currentMonth, setCurrentMonth] = useState(selectedDate ? selectedDate.getMonth() : new Date().getMonth());
  const [currentYear, setCurrentYear] = useState(selectedDate ? selectedDate.getFullYear() : new Date().getFullYear());

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const firstDay = new Date(currentYear, currentMonth, 1).getDay();
  
  const monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  const dayNames = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  };

  const handleDateSelect = (day) => {
    const newDate = new Date(currentYear, currentMonth, day);
    const yyyy = newDate.getFullYear();
    const mm = String(newDate.getMonth() + 1).padStart(2, '0');
    const dd = String(newDate.getDate()).padStart(2, '0');
    onChange(`${yyyy}-${mm}-${dd}`);
    setIsOpen(false);
  };

  const getDisplayDate = () => {
    if (!selectedDate) return 'Select date';
    return selectedDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="relative" ref={containerRef}>
      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">{label}</label>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-bold text-gray-700 outline-none hover:bg-white hover:border-maroon-200 hover:text-maroon-800 transition-all focus:ring-4 focus:ring-maroon-500/10 focus:border-maroon-300"
      >
        <span>{getDisplayDate()}</span>
        <Calendar className={`w-4 h-4 transition-colors ${isOpen ? 'text-maroon-600' : 'text-gray-400'}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-2 p-4 bg-white border border-gray-100 rounded-2xl shadow-xl z-50 w-[260px] animate-in fade-in zoom-in-95 duration-200 origin-top-left">
          <div className="flex items-center justify-between mb-4">
            <button onClick={handlePrevMonth} className="p-1.5 hover:bg-maroon-50 text-gray-500 hover:text-maroon-800 rounded-lg transition-colors">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-bold text-gray-900">{monthNames[currentMonth]} {currentYear}</span>
            <button onClick={handleNextMonth} className="p-1.5 hover:bg-maroon-50 text-gray-500 hover:text-maroon-800 rounded-lg transition-colors">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          
          <div className="grid grid-cols-7 gap-1 mb-2">
            {dayNames.map(day => (
              <div key={day} className="text-center text-[10px] font-bold text-gray-400 uppercase">
                {day}
              </div>
            ))}
          </div>
          
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: firstDay }).map((_, i) => (
              <div key={`empty-${i}`} className="w-8 h-8" />
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const thisDate = new Date(currentYear, currentMonth, day);
              const isSelected = selectedDate && selectedDate.getDate() === day && selectedDate.getMonth() === currentMonth && selectedDate.getFullYear() === currentYear;
              const isToday = new Date().getDate() === day && new Date().getMonth() === currentMonth && new Date().getFullYear() === currentYear;
              
              let isDisabled = false;
              if (minDateObj && thisDate < minDateObj) isDisabled = true;
              if (maxDateObj && thisDate > maxDateObj) isDisabled = true;

              return (
                <button
                  key={day}
                  disabled={isDisabled}
                  onClick={() => handleDateSelect(day)}
                  className={`w-8 h-8 mx-auto rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                    isDisabled 
                      ? 'text-gray-300 cursor-not-allowed'
                      : isSelected 
                        ? 'bg-maroon-800 text-white shadow-md shadow-maroon-900/20 scale-110 z-10' 
                        : isToday 
                          ? 'text-maroon-600 bg-maroon-50'
                          : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomDatePicker;
