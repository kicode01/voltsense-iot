import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area, CartesianGrid } from 'recharts';
import { Calendar, PlugZap, ChevronDown, AlertTriangle, BarChart3, Clock } from 'lucide-react';
import { useDeviceContext } from '../contexts/deviceContextCore';
import { useHistoryData, generateMockData } from '../hooks/useHistoryData';
import { Link } from 'react-router-dom';
import CustomDatePicker from '../components/CustomDatePicker';

const timeRanges = ['Today', 'Yesterday', 'Last 7 Days', 'This Month', 'Custom'];

// Compact label for the picker button. A custom range arrives as "10/01/25 - 10/15/25", which is
// far too wide for the header row, so it collapses to "10/01 - 10/15".
const rangeLabel = (timeRange) => {
  if (timeRange === 'Last 7 Days') return '7 Days';
  if (timeRange === 'This Month') return 'Month';
  if (timeRange === 'Yesterday') return 'Y-Day';
  const custom = timeRange.match(/^(\d{1,2}\/\d{1,2})\/\d{2}\s*-\s*(\d{1,2}\/\d{1,2})\/\d{2}$/);
  if (custom) return `${custom[1]} - ${custom[2]}`;
  return timeRange;
};

// A `YYYY-MM-DD` string must be parsed as LOCAL midnight. `new Date('2026-10-05')` is parsed as
// UTC midnight, which is the previous day anywhere west of UTC — so mixing the two forms shifts
// every comparison and every min/max bound by one day.
const parseLocalDate = (value) => new Date(`${value}T00:00:00`);

const Analytics = () => {
  const [timeRange, setTimeRange] = useState('Today');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [isCustomModalRendered, setIsCustomModalRendered] = useState(false);
  const [isCustomModalVisible, setIsCustomModalVisible] = useState(false);
  const [customRange, setCustomRange] = useState({ start: '', end: '' });
  const [isChartsReady, setIsChartsReady] = useState(false);
  const dropdownRef = useRef(null);

  const { activeDeviceId, devicesLoading } = useDeviceContext();

  const { historyData: currentData, loading: historyLoading } = useHistoryData(activeDeviceId, timeRange);



  useEffect(() => {
    const timer = setTimeout(() => setIsChartsReady(true), 600);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (showCustomModal) {
      setIsCustomModalRendered(true);
      const timer = setTimeout(() => setIsCustomModalVisible(true), 50);
      return () => clearTimeout(timer);
    } else {
      setIsCustomModalVisible(false);
      const timer = setTimeout(() => setIsCustomModalRendered(false), 300);
      return () => clearTimeout(timer);
    }
  }, [showCustomModal]);

  if (devicesLoading || historyLoading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[50vh]">
        <div className="w-10 h-10 border-4 border-maroon-100 border-t-maroon-800 rounded-full animate-spin" />
      </div>
    );
  }

  const isDemo = !activeDeviceId || !currentData;
  const demoData = isDemo ? generateMockData(timeRange) : null;

  const dataToRender = isDemo ? demoData : currentData;

  // A paired device with a real (but EMPTY) result set. This is distinct from the demo case and
  // from a crash, and it used to be the silent one: picking a custom range whose days the device had
  // not recorded rendered a blank chart with no explanation, which reads as a broken feature. Say
  // what happened instead.
  const isEmpty =
    !isDemo && !historyLoading &&
    (!dataToRender?.energy || dataToRender.energy.length === 0);
  const isCustomRange = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.test(String(timeRange));

  return (
    <>
    <div className="flex flex-col gap-4 md:gap-5 animate-in fade-in duration-500 pb-10">
      
      {isDemo && (
        <div className="bg-maroon-50 border border-maroon-100 text-maroon-800 px-4 py-3 rounded-2xl flex items-center justify-between text-sm font-medium">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-maroon-600" />
            <span>No device paired. Showing demo analytics.</span>
          </div>
          <Link to="/settings" className="bg-maroon-800 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-maroon-900 transition-colors">
            Pair Device
          </Link>
        </div>
      )}

      {isEmpty && (
        <div className="bg-amber-50 border border-amber-100 text-amber-800 px-4 py-3 rounded-2xl flex items-start gap-2 text-sm font-medium">
          <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <span>
            {isCustomRange
              ? 'No recorded data for this range. The device keeps 31 days of daily history, and the latest day updates as it runs.'
              : 'No recorded data yet for this range. Telemetry appears once the device has been running.'}
          </span>
        </div>
      )}

      <div className="analytics-date-picker relative z-50 flex items-center justify-between bg-white/90 backdrop-blur-xl p-4 md:p-6 rounded-3xl border border-white/20 shadow-[0_8px_30px_rgb(0,0,0,0.04)] gap-2">
        <div className="min-w-0 pr-2">
          <h2 className="text-lg md:text-xl font-bold text-gray-900 tracking-tight leading-tight truncate">Analytics</h2>
          <p className="text-gray-500 text-[10px] md:text-sm font-medium mt-0.5 leading-tight truncate">Energy & occupancy</p>
        </div>
        
        <div className="relative shrink-0" ref={dropdownRef}>
          <button 
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="flex items-center gap-1.5 bg-gray-50 text-gray-700 px-3 md:px-4 py-2 md:py-2.5 rounded-xl md:rounded-2xl border border-gray-100 text-[10px] md:text-sm font-bold uppercase tracking-wider hover:bg-white hover:shadow-md transition-all duration-300 ease-out focus:outline-none focus:ring-2 focus:ring-maroon-50"
          >
            <Calendar className="w-3.5 h-3.5 md:w-4 md:h-4 text-maroon-800" />
            <span>{rangeLabel(timeRange)}</span>
            <ChevronDown className={`w-3 h-3 md:w-4 md:h-4 text-gray-400 transition-transform duration-300 ${isDropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {/* Dropdown Menu */}
          {isDropdownOpen && (
            <div className="absolute right-0 mt-2 w-36 md:w-40 bg-white border border-gray-100 rounded-2xl shadow-xl shadow-gray-200/50 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
              {timeRanges.map((range) => (
                <button
                  key={range}
                  onClick={() => {
                    if (range === 'Custom') {
                      setShowCustomModal(true);
                      setIsDropdownOpen(false);
                    } else {
                      setTimeRange(range);
                      setIsDropdownOpen(false);
                    }
                  }}
                  className={`w-full text-left px-4 py-3 text-xs md:text-sm font-bold uppercase tracking-wider transition-colors whitespace-nowrap ${
                    timeRange === range 
                      ? 'bg-maroon-50 text-maroon-800' 
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  {range}
                </button>
              ))}
            </div>
          )}
          {/* Custom Date Modal */}
          {isCustomModalRendered && createPortal(
            <div className="fixed inset-0 z-[100] flex items-center justify-center safe-modal overflow-y-auto">
              <div 
                className={`fixed inset-0 bg-black/20 backdrop-blur-sm transition-opacity duration-300 ${isCustomModalVisible ? 'opacity-100' : 'opacity-0'}`} 
                onClick={() => setShowCustomModal(false)}
              />
              <div className={`bg-white rounded-3xl p-6 shadow-2xl w-full max-w-sm my-auto transition-all duration-300 ease-apple-spring transform ${isCustomModalVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}>
                <h3 className="text-lg font-bold text-gray-900 mb-4">Custom Date Range</h3>
                <div className="flex flex-col gap-4">
                  <CustomDatePicker 
                    label="Start Date"
                    value={customRange.start}
                    maxDate={customRange.end}
                    onChange={(val) => {
                      let updates = { start: val };
                      // If the new start date is after the current end date, clear the end date
                      if (customRange.end && parseLocalDate(val) > parseLocalDate(customRange.end)) {
                        updates.end = '';
                      }
                      setCustomRange({...customRange, ...updates});
                    }}
                  />
                  <CustomDatePicker 
                    label="End Date"
                    value={customRange.end}
                    minDate={customRange.start}
                    maxDate={customRange.start ? (() => {
                      const max = parseLocalDate(customRange.start);
                      max.setDate(max.getDate() + 30);
                      const yyyy = max.getFullYear();
                      const mm = String(max.getMonth() + 1).padStart(2, '0');
                      const dd = String(max.getDate()).padStart(2, '0');
                      return `${yyyy}-${mm}-${dd}`;
                    })() : undefined}
                    onChange={(val) => setCustomRange({...customRange, end: val})}
                  />
                </div>
                <div className="flex gap-3 mt-6">
                  <button 
                    onClick={() => setShowCustomModal(false)}
                    className="flex-1 py-2.5 rounded-xl font-bold text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    disabled={!customRange.start || !customRange.end}
                    onClick={() => {
                      const formatDate = (dateString) => {
                        const [y, m, d] = dateString.split('-');
                        return `${m}/${d}/${y.slice(2)}`;
                      };
                      setTimeRange(`${formatDate(customRange.start)} - ${formatDate(customRange.end)}`);
                      setShowCustomModal(false);
                    }}
                    className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-all ${
                      (!customRange.start || !customRange.end)
                        ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                        : 'text-white bg-maroon-800 hover:bg-maroon-900'
                    }`}
                  >
                    Apply
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )}
        </div>
      </div>

      {!activeDeviceId && (
        <p className="text-[10px] text-gray-400 font-medium px-2 mb-2">Filter the dashboard by different time ranges to view specific history.</p>
      )}

      <div className="analytics-metrics grid grid-cols-2 gap-4 md:gap-5">
        <div className="relative bg-white border border-gray-100 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-4 md:p-6 transition-all duration-300 hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] group overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500 delay-100 fill-mode-both">
          <PlugZap strokeWidth={1.5} className="absolute -right-3 -bottom-3 w-20 h-20 md:w-24 md:h-24 text-maroon-900/[0.03] transform transition-transform duration-700 group-hover:scale-110 group-hover:-rotate-12 pointer-events-none" />
          <div className="relative z-10">
            <div className="text-gray-500 text-[10px] md:text-xs font-bold uppercase tracking-widest mb-3 flex items-center gap-2">
              Total Energy
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl md:text-5xl font-bold text-gray-900 tracking-tighter transition-all" key={dataToRender?.totals?.energy}>
                {(Number(dataToRender?.totals?.energy) || 0).toFixed(timeRange === 'Last 7 Days' ? 1 : 2)}
              </span>
              <span className="text-gray-400 text-xs md:text-sm font-bold uppercase tracking-widest">kWh</span>
            </div>
          </div>
        </div>
        <div className="relative bg-white border border-gray-100 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-4 md:p-6 transition-all duration-300 hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] group overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500 delay-200 fill-mode-both">
          <Clock strokeWidth={1.5} className="absolute -right-3 -bottom-3 w-20 h-20 md:w-24 md:h-24 text-maroon-900/[0.03] transform transition-transform duration-700 group-hover:scale-110 group-hover:rotate-12 pointer-events-none" />
          <div className="relative z-10">
            <div className="text-gray-500 text-[10px] md:text-xs font-bold uppercase tracking-widest mb-3 flex items-center gap-2">
              Active Hours
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl md:text-5xl font-bold text-gray-900 tracking-tighter transition-all" key={dataToRender?.totals?.hours}>
                {(Number(dataToRender?.totals?.hours) || 0).toFixed(1)}
              </span>
              <span className="text-gray-400 text-sm font-bold uppercase tracking-widest">hrs</span>
            </div>
          </div>
        </div>
      </div>

      {/* Energy Chart */}
      <div className="analytics-energy-chart bg-white border border-gray-100 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-4 md:p-6 transition-all duration-300 hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] animate-in fade-in slide-in-from-bottom-4 duration-500 delay-300 fill-mode-both">
        <h3 className="text-[10px] md:text-xs font-bold text-gray-500 uppercase tracking-widest">Energy Usage (kWh)</h3>
        {!activeDeviceId && (
          <p className="text-[10px] text-gray-400 mt-1 mb-4 md:mb-6 font-medium">Daily power consumption history.</p>
        )}
        {activeDeviceId && <div className="mb-4 md:mb-6" />}
        
        <div className="h-48 md:h-64 w-full -ml-2 md:ml-0 relative">
          {isChartsReady ? (
            <div className="absolute inset-0 animate-in fade-in duration-500">
              {(!dataToRender?.energy || dataToRender.energy.length === 0) ? (
                <div className="w-full h-full flex flex-col items-center justify-center text-gray-400">
                  <BarChart3 className="w-8 h-8 md:w-10 md:h-10 mb-2 opacity-20" />
                  <p className="text-[10px] md:text-xs font-bold uppercase tracking-widest text-gray-400/60">No energy data yet</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dataToRender.energy} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorKwh" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#852636" stopOpacity={0.15}/>
                        <stop offset="95%" stopColor="#852636" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                    <XAxis dataKey="label" stroke="#9ca3af" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="#9ca3af" fontSize={12} tickLine={false} axisLine={false} width={40} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e5e7eb', color: '#111827', boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)', padding: '12px', borderRadius: '12px', fontWeight: 'bold' }}
                      itemStyle={{ color: '#852636' }}
                    />
                    <Area type="monotone" dataKey="kwh" stroke="#852636" strokeWidth={3} fillOpacity={1} fill="url(#colorKwh)" animationDuration={1000} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-8 h-8 border-4 border-maroon-100 border-t-maroon-800 rounded-full animate-spin opacity-50" />
            </div>
          )}
        </div>
      </div>

      {/* Occupancy Chart */}
      <div className="analytics-occupancy-chart bg-white border border-gray-100 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-4 md:p-6 mb-4 md:mb-0 transition-all duration-300 hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] animate-in fade-in slide-in-from-bottom-4 duration-500 delay-500 fill-mode-both">
        <h3 className="text-[10px] md:text-xs font-bold text-gray-500 uppercase tracking-widest">Occupancy Timeline</h3>
        {!activeDeviceId && (
          <p className="text-[10px] text-gray-400 mt-1 mb-4 md:mb-6 font-medium">Motion sensor data tracking room usage.</p>
        )}
        {activeDeviceId && <div className="mb-4 md:mb-6" />}
        
        <div className="h-40 md:h-48 w-full -ml-2 md:ml-0 relative">
          {isChartsReady ? (
            <div className="absolute inset-0 animate-in fade-in duration-500">
              {(!dataToRender?.occupancy || dataToRender.occupancy.length === 0) ? (
                <div className="w-full h-full flex flex-col items-center justify-center text-gray-400">
                  <BarChart3 className="w-8 h-8 md:w-10 md:h-10 mb-2 opacity-20" />
                  <p className="text-[10px] md:text-xs font-bold uppercase tracking-widest text-gray-400/60">No occupancy data yet</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dataToRender.occupancy} barSize={24} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                    <XAxis dataKey="label" stroke="#9ca3af" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="#9ca3af" fontSize={12} tickLine={false} axisLine={false} ticks={[0, 1]} tickFormatter={(val) => val ? 'Yes' : 'No'} width={40} />
                    <Tooltip 
                      cursor={{fill: '#f9fafb'}}
                      contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e5e7eb', color: '#111827', boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)', padding: '12px', borderRadius: '12px', fontWeight: 'bold' }}
                      formatter={(value) => [value ? 'Occupied' : 'Vacant', 'Status']}
                    />
                    <Bar dataKey="occupied" fill="#852636" radius={[4, 4, 0, 0]} animationDuration={1000} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-8 h-8 border-4 border-maroon-100 border-t-maroon-800 rounded-full animate-spin opacity-50" />
            </div>
          )}
        </div>
      </div>


    </div>
    </>
  );
};

export default Analytics;
