import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const pad = (n) => n.toString().padStart(2, '0');
const hours = Array.from({length: 12}, (_, i) => pad(i + 1));
const minutes = Array.from({length: 60}, (_, i) => pad(i));
const periods = ['AM', 'PM'];

// Row height in px. This MUST match the `h-10` class on each row below — the scroll index maths
// below divides/multiplies by it, so changing one without the other silently mis-snaps the picker.
const ROW_HEIGHT_PX = 40;

const ScrollColumn = ({ items, value, onChange }) => {
  const scrollRef = useRef(null);
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimeout = useRef(null);

  useEffect(() => {
    // Only auto-scroll if the user isn't actively scrolling
    if (scrollRef.current && !isScrolling) {
      const index = items.indexOf(value);
      if (index !== -1) {
         scrollRef.current.scrollTop = index * ROW_HEIGHT_PX;
      }
    }
  }, [value, items, isScrolling]);

  const handleScroll = (e) => {
    setIsScrolling(true);
    
    // Clear existing timeout
    if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
    
    // Set a timeout to detect when scrolling stops
    scrollTimeout.current = setTimeout(() => {
      setIsScrolling(false);
      const y = e.target.scrollTop;
      const index = Math.max(0, Math.min(items.length - 1, Math.round(y / ROW_HEIGHT_PX)));
      if (items[index] && items[index] !== value) {
        onChange(items[index]);
      }
      // Force snap alignment just in case
      e.target.scrollTop = index * ROW_HEIGHT_PX;
    }, 150);
  };

  return (
    <div 
      ref={scrollRef}
      onScroll={handleScroll}
      className="h-[200px] overflow-y-auto overflow-x-hidden snap-y snap-mandatory hide-scrollbar flex-1 text-center"
      style={{ padding: '80px 0' }}
    >
      {items.map(item => (
        <div 
          key={item} 
          className={`h-10 flex items-center justify-center snap-center text-lg md:text-xl transition-all duration-200 ${item === value ? 'text-maroon-900 font-black scale-110' : 'text-gray-400 font-bold scale-95'}`}
        >
          {item}
        </div>
      ))}
    </div>
  );
};

export const TimePicker = ({ value, onChange, label }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isRendered, setIsRendered] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [h, setH] = useState('12');
  const [m, setM] = useState('00');
  const [p, setP] = useState('AM');

  useEffect(() => {
    if (value) {
      const [hv, mv] = value.split(':');
      let hourNum = parseInt(hv, 10);
      setP(hourNum >= 12 ? 'PM' : 'AM');
      if (hourNum === 0) hourNum = 12;
      else if (hourNum > 12) hourNum -= 12;
      setH(pad(hourNum));
      setM(mv);
    }
  }, [value, isOpen]);

  useEffect(() => {
    if (isOpen) {
      setIsRendered(true);
      const timer = setTimeout(() => setIsVisible(true), 50);
      return () => clearTimeout(timer);
    } else {
      setIsVisible(false);
      const timer = setTimeout(() => setIsRendered(false), 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const handleSave = () => {
    let hourNum = parseInt(h, 10);
    if (p === 'PM' && hourNum < 12) hourNum += 12;
    if (p === 'AM' && hourNum === 12) hourNum = 0;
    onChange(`${pad(hourNum)}:${m}`);
    setIsOpen(false);
  };

  const displayTime = `${h}:${m} ${p}`;

  return (
    <>
      <div>
        <label className="block text-[10px] md:text-xs font-bold text-gray-500 uppercase tracking-widest mb-1.5 px-1">{label}</label>
        <button 
          onClick={() => setIsOpen(true)}
          className="w-full bg-gray-50 border border-gray-100 rounded-2xl px-3 py-2.5 md:px-4 md:py-3.5 text-gray-900 font-bold text-center focus:outline-none focus:border-maroon-300 focus:ring-4 focus:ring-maroon-50 transition-all shadow-sm flex justify-center items-center"
        >
          <span>{displayTime}</span>
        </button>
      </div>

      {isRendered && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center safe-modal overflow-y-auto">
          <div className={`fixed inset-0 bg-black/20 backdrop-blur-sm transition-opacity duration-300 ${isVisible ? 'opacity-100' : 'opacity-0'}`} onClick={() => setIsOpen(false)} />
          <div className={`bg-white rounded-3xl w-full max-w-sm overflow-hidden z-10 my-auto shadow-2xl transition-all duration-300 ease-apple-spring transform ${isVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}>
            <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <button onClick={() => setIsOpen(false)} className="text-gray-500 font-bold px-4 py-2 text-sm rounded-xl hover:bg-gray-100 transition-colors">Cancel</button>
              <h3 className="font-bold text-gray-900 uppercase tracking-widest text-xs">{label}</h3>
              <button onClick={handleSave} className="text-maroon-800 font-bold px-4 py-2 text-sm rounded-xl hover:bg-maroon-50 transition-colors">Save</button>
            </div>
            
            <div className="p-6 flex justify-center gap-2 relative select-none">
              {/* Highlight bar in the center */}
              <div className="absolute top-1/2 left-4 right-4 h-10 -translate-y-1/2 bg-maroon-50 rounded-xl -z-10" />
              
              <ScrollColumn items={hours} value={h} onChange={setH} />
              <div className="text-xl font-bold text-maroon-900 flex items-center h-full">:</div>
              <ScrollColumn items={minutes} value={m} onChange={setM} />
              <div className="w-2" />
              <ScrollColumn items={periods} value={p} onChange={setP} />
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};
