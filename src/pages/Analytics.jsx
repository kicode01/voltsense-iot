import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area, CartesianGrid } from 'recharts';
import { Calendar, PlugZap, ChevronDown, AlertTriangle, BarChart3, Clock, Zap, Activity, Layers, Plug, Calculator, PieChart } from 'lucide-react';
import { useDeviceContext } from '../contexts/deviceContextCore';
import { useHistoryData, generateMockData } from '../hooks/useHistoryData';
import { useRoomData } from '../hooks/useRoomData';
import { Link } from 'react-router-dom';
import CustomDatePicker from '../components/CustomDatePicker';

const timeRanges = ['Today', 'Yesterday', 'Last 7 Days', 'This Month', 'Custom'];

// Compact label for the picker button. A custom range arrives as "10/01/25 - 10/15/25", which is
// far too wide for the header row, so it collapses to "10/01 - 10/15".
const rangeLabel = (timeRange) => {
  if (timeRange === 'Last 7 Days') return '7 Days';
  if (timeRange === 'This Month') return 'Month';
  if (timeRange === 'Yesterday') return 'Yesterday';
  const custom = timeRange.match(/^(\d{1,2}\/\d{1,2})(?:\/\d{2,4})?\s*-\s*(\d{1,2}\/\d{1,2})(?:\/\d{2,4})?$/);
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
  const [selectedOutletTab, setSelectedOutletTab] = useState('all');
  const [activeOutletIndex, setActiveOutletIndex] = useState(0);
  const [shareViewMode, setShareViewMode] = useState('ribbon');
  const dropdownRef = useRef(null);
  const carouselRef = useRef(null);

  const { activeDeviceId, devicesLoading } = useDeviceContext();

  const { historyData: currentData, loading: historyLoading } = useHistoryData(activeDeviceId, timeRange);
  const { roomData } = useRoomData(activeDeviceId);



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
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
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

  const totalEnergy = Number(dataToRender?.totals?.energy) || 3.2;
  const MERALCO_RATE_PHP = 12.00; // Standard Philippine residential kWh rate

  const defaultPortShare = {
    port_01: { name: 'Port 1', icon: 'plug', share: 0.58, volts: 220, amps: 0.25, watts: 55.0, pf: 0.98 },
    port_02: { name: 'Port 2', icon: 'plug', share: 0.11, volts: 220, amps: 0.10, watts: 21.0, pf: 0.95 },
    port_03: { name: 'Port 3', icon: 'plug', share: 0.31, volts: 220, amps: 0.20, watts: 44.0, pf: 0.92 },
  };

  const portColors = {
    port_01: '#852636',
    port_02: '#d97706',
    port_03: '#2563eb'
  };

  const portThemes = {
    port_01: {
      color: '#852636',
      gradient: 'from-[#852636] to-[#b83b52]',
      bgLight: 'bg-[#852636]/[0.03]',
      borderCard: 'border-[#852636]/20 hover:border-[#852636]/40',
      textAccent: 'text-[#852636]',
      badge: 'bg-[#852636]/10 text-[#852636] border-[#852636]/20',
      formulaBg: 'bg-[#852636]/[0.04] border-[#852636]/15',
      dotColor: 'bg-[#852636]',
    },
    port_02: {
      color: '#d97706',
      gradient: 'from-amber-500 to-amber-600',
      bgLight: 'bg-amber-500/[0.03]',
      borderCard: 'border-amber-500/20 hover:border-amber-500/40',
      textAccent: 'text-amber-700',
      badge: 'bg-amber-50 text-amber-700 border-amber-200',
      formulaBg: 'bg-amber-50/60 border-amber-200/60',
      dotColor: 'bg-amber-500',
    },
    port_03: {
      color: '#2563eb',
      gradient: 'from-blue-600 to-indigo-600',
      bgLight: 'bg-blue-500/[0.03]',
      borderCard: 'border-blue-500/20 hover:border-blue-500/40',
      textAccent: 'text-blue-700',
      badge: 'bg-blue-50 text-blue-700 border-blue-200',
      formulaBg: 'bg-blue-50/60 border-blue-200/60',
      dotColor: 'bg-blue-600',
    }
  };

  const outletList = ['port_01', 'port_02', 'port_03'].map((portKey) => {
    const rawPort = roomData?.ports?.[portKey] || {};
    const fallback = defaultPortShare[portKey];
    const portNumber = portKey === 'port_01' ? 1 : portKey === 'port_02' ? 2 : 3;
    const name = `Port ${portNumber}`;
    const isRelayOn = rawPort.relay_status !== undefined ? Boolean(rawPort.relay_status) : true;
    
    // Energy in kWh for this outlet
    const energyKwh = Number(rawPort.energy_kwh) > 0 
      ? Number(rawPort.energy_kwh) 
      : Number((totalEnergy * fallback.share).toFixed(2));
    
    const percentage = totalEnergy > 0 ? Math.min(100, Math.round((energyKwh / totalEnergy) * 100)) : 0;
    
    const volts = Number(rawPort.voltage) > 0 ? Number(rawPort.voltage) : fallback.volts;
    const rawAmps = rawPort.current_amps !== undefined ? Number(rawPort.current_amps) : (isDemo ? fallback.amps : 0);
    const amps = isRelayOn ? (rawAmps > 0.08 ? rawAmps : 0) : 0;
    const pf = Number(rawPort.power_factor) > 0 ? Number(rawPort.power_factor) : (amps > 0 ? fallback.pf : 0);
    const rawWatts = rawPort.power_watts !== undefined ? Number(rawPort.power_watts) : (isDemo ? fallback.watts : Number((volts * amps * (pf || 1)).toFixed(1)));
    const watts = isRelayOn ? (amps > 0 ? rawWatts : 0) : 0;
    const costPhp = (energyKwh * MERALCO_RATE_PHP).toFixed(2);

    return {
      id: portKey,
      name,
      label: `Port ${portNumber}`,
      icon: 'plug',
      isRelayOn,
      energyKwh,
      percentage,
      volts,
      amps,
      watts,
      pf,
      costPhp,
      color: portColors[portKey] || '#852636',
      theme: portThemes[portKey] || portThemes.port_01
    };
  });

  const handleCarouselScroll = (e) => {
    const { scrollLeft, offsetWidth } = e.currentTarget;
    if (offsetWidth > 0) {
      const index = Math.round(scrollLeft / (offsetWidth * 0.82));
      setActiveOutletIndex(Math.max(0, Math.min(index, 2)));
    }
  };

  const scrollToOutletIndex = (index) => {
    setActiveOutletIndex(index);
    if (carouselRef.current && carouselRef.current.children[index]) {
      carouselRef.current.children[index].scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center'
      });
    }
  };

  const outletChartData = outletList.map(o => ({
    name: o.name,
    fullName: o.name,
    kwh: Number(o.energyKwh.toFixed(2)),
    color: o.color
  }));

  const displayedOutlets = selectedOutletTab === 'all' 
    ? outletList 
    : outletList.filter(o => o.id === selectedOutletTab);

  const renderOutletIcon = (iconName, colorClass) => {
    return <Plug className={colorClass} strokeWidth={1.5} />;
  };

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
              : timeRange === 'Yesterday'
              ? 'No history recorded for yesterday yet. The device archives daily rollups at midnight (00:00). If this prototype was powered on today, yesterday’s record is empty.'
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

      {/* Metric Stat Cards: 2 cols on mobile, 4 cols on desktop */}
      <div className="analytics-metrics grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
        <div className="relative bg-white border border-gray-100 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-4 md:p-6 transition-all duration-300 hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] group overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500 delay-100 fill-mode-both">
          <PlugZap strokeWidth={1.5} className="absolute -right-3 -bottom-3 w-20 h-20 md:w-24 md:h-24 text-maroon-900/[0.03] transform transition-transform duration-700 group-hover:scale-110 group-hover:-rotate-12 pointer-events-none" />
          <div className="relative z-10">
            <div className="text-gray-500 text-[10px] md:text-xs font-bold uppercase tracking-widest mb-3 flex items-center gap-2">
              Total Energy
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl md:text-5xl font-bold text-gray-900 tracking-tighter transition-all" key={dataToRender?.totals?.energy}>
                {(Number(dataToRender?.totals?.energy) || 0).toFixed(2)}
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

        {/* Desktop-Only Stat Card 3: Average Active Load */}
        <div className="hidden lg:block relative bg-white border border-gray-100 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-4 md:p-6 transition-all duration-300 hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] group overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500 delay-300 fill-mode-both">
          <Zap strokeWidth={1.5} className="absolute -right-3 -bottom-3 w-20 h-20 md:w-24 md:h-24 text-maroon-900/[0.03] transform transition-transform duration-700 group-hover:scale-110 group-hover:-rotate-12 pointer-events-none" />
          <div className="relative z-10">
            <div className="text-gray-500 text-[10px] md:text-xs font-bold uppercase tracking-widest mb-3 flex items-center gap-2">
              Avg Active Power
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl md:text-5xl font-bold text-gray-900 tracking-tighter transition-all">
                {Number(dataToRender?.totals?.hours) > 0 ? (((Number(dataToRender?.totals?.energy) || 0) * 1000) / Number(dataToRender?.totals?.hours)).toFixed(0) : '0'}
              </span>
              <span className="text-gray-400 text-sm font-bold uppercase tracking-widest">Watts</span>
            </div>
          </div>
        </div>

        {/* Desktop-Only Stat Card 4: Occupancy Duty Cycle */}
        <div className="hidden lg:block relative bg-white border border-gray-100 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-4 md:p-6 transition-all duration-300 hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] group overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500 delay-400 fill-mode-both">
          <Activity strokeWidth={1.5} className="absolute -right-3 -bottom-3 w-20 h-20 md:w-24 md:h-24 text-maroon-900/[0.03] transform transition-transform duration-700 group-hover:scale-110 group-hover:rotate-12 pointer-events-none" />
          <div className="relative z-10">
            <div className="text-gray-500 text-[10px] md:text-xs font-bold uppercase tracking-widest mb-3 flex items-center gap-2">
              Room Utilization
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl md:text-5xl font-bold text-gray-900 tracking-tighter transition-all">
                {dataToRender?.occupancy?.length ? Math.round((dataToRender.occupancy.filter(o => o.occupied > 0).length / dataToRender.occupancy.length) * 100) : 0}
              </span>
              <span className="text-gray-400 text-sm font-bold uppercase tracking-widest">% time</span>
            </div>
          </div>
        </div>
      </div>

      {/* Dual Charts Container: 1 col on mobile, 2 cols on desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-5">
        {/* Energy Chart */}
        <div className="analytics-energy-chart bg-white border border-gray-100 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-4 md:p-6 transition-all duration-300 hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] animate-in fade-in slide-in-from-bottom-4 duration-500 delay-300 fill-mode-both flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <h3 className="text-[10px] md:text-xs font-bold text-gray-500 uppercase tracking-widest">Energy Usage (kWh)</h3>
              <span className="text-[9px] md:text-[10px] font-semibold text-gray-400 bg-gray-50 px-2 py-0.5 rounded-md border border-gray-100">
                {timeRange === 'Today' ? 'Hourly (24h)' : timeRange === 'Yesterday' ? 'Daily Rollup' : 'Daily Trend'}
              </span>
            </div>
            {!activeDeviceId && (
              <p className="text-[10px] text-gray-400 mt-1 mb-4 md:mb-6 font-medium">Daily power consumption history.</p>
            )}
            {activeDeviceId && <div className="mb-4 md:mb-6" />}
          </div>
          
          <div className="h-48 md:h-64 lg:h-72 w-full -ml-2 md:ml-0 relative">
            {isChartsReady ? (
              <div className="absolute inset-0 animate-in fade-in duration-500">
                {(!dataToRender?.energy || dataToRender.energy.length === 0) ? (
                  <div className="w-full h-full flex flex-col items-center justify-center text-gray-400">
                    <BarChart3 className="w-8 h-8 md:w-10 md:h-10 mb-2 opacity-20" />
                    <p className="text-[10px] md:text-xs font-bold uppercase tracking-widest text-gray-400/60">No energy data yet</p>
                  </div>
                ) : dataToRender.energy.length === 1 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dataToRender.energy} barSize={48} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                      <XAxis dataKey="label" stroke="#9ca3af" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis stroke="#9ca3af" fontSize={12} tickLine={false} axisLine={false} width={40} />
                      <Tooltip 
                        cursor={{fill: '#f9fafb'}}
                        contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e5e7eb', color: '#111827', boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)', padding: '12px', borderRadius: '12px', fontWeight: 'bold' }}
                        formatter={(val) => [`${Number(val).toFixed(2)} kWh`, 'Energy']}
                      />
                      <Bar dataKey="kwh" fill="#852636" radius={[6, 6, 0, 0]} animationDuration={1000} />
                    </BarChart>
                  </ResponsiveContainer>
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
                        formatter={(val) => [`${Number(val).toFixed(2)} kWh`, 'Energy']}
                      />
                      <Area type="monotone" dataKey="kwh" stroke="#852636" strokeWidth={3} fillOpacity={1} fill="url(#colorKwh)" animationDuration={1000} dot={{ r: 3, fill: '#852636' }} activeDot={{ r: 5 }} />
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
        <div className="analytics-occupancy-chart bg-white border border-gray-100 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-4 md:p-6 mb-4 md:mb-0 transition-all duration-300 hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] animate-in fade-in slide-in-from-bottom-4 duration-500 delay-500 fill-mode-both flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <h3 className="text-[10px] md:text-xs font-bold text-gray-500 uppercase tracking-widest">Occupancy Timeline</h3>
              <span className="text-[9px] md:text-[10px] font-semibold text-gray-400 bg-gray-50 px-2 py-0.5 rounded-md border border-gray-100">
                {timeRange === 'Today' ? 'Hourly Activity' : timeRange === 'Yesterday' ? 'Daily Status' : 'Daily Activity'}
              </span>
            </div>
            {!activeDeviceId && (
              <p className="text-[10px] text-gray-400 mt-1 mb-4 md:mb-6 font-medium">Motion sensor data tracking room usage.</p>
            )}
            {activeDeviceId && <div className="mb-4 md:mb-6" />}
          </div>
          
          <div className="h-48 md:h-64 lg:h-72 w-full -ml-2 md:ml-0 relative">
            {isChartsReady ? (
              <div className="absolute inset-0 animate-in fade-in duration-500">
                {(!dataToRender?.occupancy || dataToRender.occupancy.length === 0) ? (
                  <div className="w-full h-full flex flex-col items-center justify-center text-gray-400">
                    <BarChart3 className="w-8 h-8 md:w-10 md:h-10 mb-2 opacity-20" />
                    <p className="text-[10px] md:text-xs font-bold uppercase tracking-widest text-gray-400/60">No occupancy data yet</p>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dataToRender.occupancy} barSize={dataToRender.occupancy.length === 1 ? 48 : 24} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
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

      {/* Per-Outlet Monitoring & Energy Breakdown */}
      <div className="analytics-outlets scroll-mt-24 bg-white border border-gray-100 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-4 md:p-6 transition-all duration-300 hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] animate-in fade-in slide-in-from-bottom-4 duration-500 delay-500 fill-mode-both">
        {/* Header & Mobile Filter Tabs */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-maroon-50 text-maroon-800 flex items-center justify-center border border-maroon-100 shrink-0">
                <Layers className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-base md:text-lg font-bold text-gray-900 tracking-tight leading-tight">
                  Per-Outlet Monitoring &amp; Energy Breakdown
                </h3>
                <p className="text-gray-500 text-[11px] md:text-xs font-medium mt-0.5">
                  Real-time electrical telemetry and power calculations per socket
                </p>
              </div>
            </div>
          </div>

          {/* Segmented Filter Pills */}
          <div className="flex items-center gap-1 bg-gray-100/90 p-1 rounded-2xl self-start sm:self-auto shrink-0 overflow-x-auto max-w-full hide-scrollbar border border-gray-200/50">
            <button
              onClick={() => setSelectedOutletTab('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all duration-200 whitespace-nowrap ${
                selectedOutletTab === 'all'
                  ? 'bg-white text-maroon-800 shadow-2xs'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              All Outlets
            </button>
            {outletList.map((outlet) => (
              <button
                key={`tab-${outlet.id}`}
                onClick={() => setSelectedOutletTab(outlet.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all duration-200 whitespace-nowrap ${
                  selectedOutletTab === outlet.id
                    ? 'bg-white shadow-2xs font-extrabold'
                    : 'text-gray-500 hover:text-gray-900'
                }`}
                style={selectedOutletTab === outlet.id ? { color: outlet.color } : {}}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: outlet.color }}
                />
                {outlet.name}
              </button>
            ))}
          </div>
        </div>

        {/* Outlet Cards Layout: Carousel on Mobile (< md), 3-col Bento Grid on Desktop */}
        <div
          ref={carouselRef}
          onScroll={handleCarouselScroll}
          className={`${
            displayedOutlets.length > 1
              ? 'flex md:grid md:grid-cols-3 overflow-x-auto snap-x snap-mandatory gap-3.5 pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 hide-scrollbar'
              : 'grid grid-cols-1 max-w-xl mx-auto'
          }`}
        >
          {displayedOutlets.map((outlet) => (
            <div 
              key={outlet.id} 
              className={`bg-white border rounded-2xl sm:rounded-3xl p-4 sm:p-5 flex flex-col justify-between transition-all duration-300 relative overflow-hidden group shadow-[0_4px_20px_rgb(0,0,0,0.03)] hover:shadow-lg ${
                displayedOutlets.length > 1 ? 'w-[86vw] sm:w-[320px] md:w-auto shrink-0 snap-center' : 'w-full'
              } ${outlet.theme.borderCard}`}
            >
              {/* Top Colored Accent Stripe */}
              <div 
                className={`absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r ${outlet.theme.gradient}`} 
              />
              
              <div>
                {/* Header: Label, Icon, Status */}
                <div className="flex items-start justify-between gap-2 mb-3.5 pt-1">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div 
                      className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:scale-105 border shadow-2xs"
                      style={{ 
                        backgroundColor: `${outlet.color}12`, 
                        borderColor: `${outlet.color}25`,
                        color: outlet.color 
                      }}
                    >
                      {renderOutletIcon(outlet.icon, "w-5 h-5")}
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-base font-bold text-gray-900 leading-tight truncate">
                        {outlet.name}
                      </h4>
                      <span className="text-[10px] font-semibold text-gray-400 block mt-0.5 uppercase tracking-wider">
                        Socket {outlet.label.replace('Port ', '')} • 220V AC
                      </span>
                    </div>
                  </div>

                  {/* Live Status Pill */}
                  <span className={`shrink-0 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border shadow-2xs transition-all ${
                    !outlet.isRelayOn 
                      ? 'bg-gray-100 text-gray-400 border-gray-200' 
                      : (outlet.watts > 6 || outlet.amps > 0.08)
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-amber-50 text-amber-700 border-amber-200'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      !outlet.isRelayOn 
                        ? 'bg-gray-400' 
                        : (outlet.watts > 6 || outlet.amps > 0.08)
                        ? 'bg-emerald-500 animate-pulse'
                        : 'bg-amber-500'
                    }`} />
                    {!outlet.isRelayOn 
                      ? 'Relay Off' 
                      : (outlet.watts > 6 || outlet.amps > 0.08)
                      ? 'Active'
                      : 'Standby'}
                  </span>
                </div>

                {/* Energy & Consumption Bento Card */}
                <div className="bg-gray-50/70 border border-gray-100 rounded-2xl p-3 sm:p-3.5 mb-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                      Energy Consumed
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${outlet.theme.badge}`}>
                      {outlet.percentage}% Share
                    </span>
                  </div>
                  
                  <div className="flex items-baseline justify-between mb-2.5">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight">
                        {outlet.energyKwh.toFixed(2)}
                      </span>
                      <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">kWh</span>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-bold text-gray-800">₱{outlet.costPhp}</span>
                      <span className="text-[9px] text-gray-400 font-semibold block uppercase tracking-wider">est. cost</span>
                    </div>
                  </div>

                  {/* Dual-Tone Gradient Progress Bar */}
                  <div className="w-full bg-gray-200/80 rounded-full h-2 overflow-hidden p-0.5">
                    <div 
                      className={`h-full rounded-full transition-all duration-700 ease-out bg-gradient-to-r ${outlet.theme.gradient}`} 
                      style={{ width: `${Math.max(5, outlet.percentage)}%` }}
                    />
                  </div>
                </div>

                {/* Live Electrical Telemetry: 2x2 Bento Tiles */}
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div className="bg-white border border-gray-100 rounded-xl p-2.5 shadow-2xs">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400 block mb-0.5">
                      Voltage (RMS)
                    </span>
                    <div className="flex items-baseline gap-1">
                      <span className="text-sm sm:text-base font-extrabold text-gray-900">
                        {outlet.volts.toFixed(0)}
                      </span>
                      <span className="text-[10px] font-bold text-gray-400 uppercase">V</span>
                    </div>
                  </div>

                  <div className="bg-white border border-gray-100 rounded-xl p-2.5 shadow-2xs">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400 block mb-0.5">
                      Current (RMS)
                    </span>
                    <div className="flex items-baseline gap-1">
                      <span className="text-sm sm:text-base font-extrabold text-gray-900">
                        {outlet.amps.toFixed(2)}
                      </span>
                      <span className="text-[10px] font-bold text-gray-400 uppercase">A</span>
                    </div>
                  </div>

                  <div className="bg-white border border-gray-100 rounded-xl p-2.5 shadow-2xs">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400 block mb-0.5">
                      Active Power
                    </span>
                    <div className="flex items-baseline gap-1">
                      <span className={`text-sm sm:text-base font-extrabold ${outlet.watts > 0 ? outlet.theme.textAccent : 'text-gray-900'}`}>
                        {outlet.watts.toFixed(1)}
                      </span>
                      <span className="text-[10px] font-bold text-gray-400 uppercase">W</span>
                    </div>
                  </div>

                  <div className="bg-white border border-gray-100 rounded-xl p-2.5 shadow-2xs">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400 block mb-0.5">
                      Power Factor
                    </span>
                    <div className="flex items-baseline gap-1">
                      <span className="text-sm sm:text-base font-extrabold text-gray-900">
                        {outlet.pf.toFixed(2)}
                      </span>
                      <span className="text-[9px] font-bold text-gray-400 uppercase">PF</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Mathematical Telemetry Formula Chip */}
              <div className={`rounded-xl p-2.5 border ${outlet.theme.formulaBg} transition-all duration-300`}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <Calculator className={`w-3 h-3 ${outlet.theme.textAccent}`} />
                    <span className={`text-[9px] font-bold uppercase tracking-wider ${outlet.theme.textAccent}`}>
                      Formula (P = V × I × PF)
                    </span>
                  </div>
                  <span className={`text-[10px] font-black ${outlet.theme.textAccent} font-mono`}>
                    {outlet.watts.toFixed(1)} W
                  </span>
                </div>
                <div className="flex items-center gap-1 text-[10px] font-mono text-gray-600 overflow-x-auto hide-scrollbar py-0.5">
                  <span className="bg-white border border-gray-200/70 px-1.5 py-0.5 rounded font-bold shadow-2xs whitespace-nowrap">
                    {outlet.volts.toFixed(0)}V
                  </span>
                  <span className="text-gray-400 font-bold">×</span>
                  <span className="bg-white border border-gray-200/70 px-1.5 py-0.5 rounded font-bold shadow-2xs whitespace-nowrap">
                    {outlet.amps.toFixed(2)}A
                  </span>
                  <span className="text-gray-400 font-bold">×</span>
                  <span className="bg-white border border-gray-200/70 px-1.5 py-0.5 rounded font-bold shadow-2xs whitespace-nowrap">
                    {outlet.pf.toFixed(2)}
                  </span>
                  <span className="text-gray-400 font-bold">=</span>
                  <span className={`px-1.5 py-0.5 rounded font-bold ${outlet.theme.badge} whitespace-nowrap`}>
                    {outlet.watts.toFixed(1)}W
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Carousel Pagination Dots (Mobile Only when All are shown) */}
        {displayedOutlets.length > 1 && (
          <div className="flex items-center justify-center gap-1.5 mt-3 md:hidden">
            {outletList.map((outlet, idx) => (
              <button
                key={`dot-${outlet.id}`}
                onClick={() => scrollToOutletIndex(idx)}
                aria-label={`Jump to ${outlet.name}`}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  activeOutletIndex === idx 
                    ? `w-6 ${outlet.theme.dotColor}` 
                    : 'w-1.5 bg-gray-200'
                }`}
              />
            ))}
          </div>
        )}

        {/* Outlet Consumption Comparison Section */}
        <div className="mt-7 pt-6 border-t border-gray-100">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <div className="flex items-center gap-2">
                <PieChart className="w-4 h-4 text-maroon-800" />
                <h4 className="text-xs md:text-sm font-bold uppercase tracking-wider text-gray-700">
                  Outlet Energy Share Comparison
                </h4>
              </div>
              <p className="text-[11px] text-gray-400 font-medium mt-0.5">
                Total aggregate consumption: <span className="font-bold text-gray-700">{totalEnergy.toFixed(2)} kWh</span> (~₱{(totalEnergy * MERALCO_RATE_PHP).toFixed(2)})
              </p>
            </div>

            {/* View Mode Switcher: Ribbon Bar vs Recharts Bar */}
            <div className="flex items-center gap-1 bg-gray-100 p-0.5 rounded-xl self-start sm:self-auto border border-gray-200/40">
              <button
                onClick={() => setShareViewMode('ribbon')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all ${
                  shareViewMode === 'ribbon'
                    ? 'bg-white text-gray-900 shadow-2xs font-extrabold'
                    : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                Distribution Bar
              </button>
              <button
                onClick={() => setShareViewMode('chart')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all ${
                  shareViewMode === 'chart'
                    ? 'bg-white text-gray-900 shadow-2xs font-extrabold'
                    : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                Bar Chart
              </button>
            </div>
          </div>

          {shareViewMode === 'ribbon' ? (
            <div>
              {/* Proportional Multi-Segment Ribbon Bar */}
              <div className="w-full bg-gray-100 p-1 rounded-2xl flex items-center gap-1 shadow-inner overflow-hidden mb-3.5">
                {outletList.map((outlet) => {
                  const widthPct = totalEnergy > 0 ? Math.max(8, outlet.percentage) : 33.3;
                  return (
                    <div
                      key={`ribbon-${outlet.id}`}
                      style={{ width: `${widthPct}%` }}
                      className={`h-5 sm:h-6 rounded-xl bg-gradient-to-r ${outlet.theme.gradient} transition-all duration-700 ease-out relative flex items-center justify-center text-[10px] font-bold text-white shadow-2xs px-1`}
                      title={`${outlet.name}: ${outlet.energyKwh.toFixed(2)} kWh (${outlet.percentage}%)`}
                    >
                      <span className="truncate drop-shadow-xs font-mono">
                        {outlet.percentage}%
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* 3 Metric Summary Cards - Single compact row on mobile, full bento on desktop */}
              <div className="grid grid-cols-3 gap-1.5 sm:gap-3.5">
                {outletList.map((outlet) => (
                  <div
                    key={`summary-${outlet.id}`}
                    onClick={() => setSelectedOutletTab(selectedOutletTab === outlet.id ? 'all' : outlet.id)}
                    className={`p-2 sm:p-3 rounded-xl sm:rounded-2xl border transition-all duration-300 cursor-pointer ${
                      selectedOutletTab === outlet.id 
                        ? `${outlet.theme.borderCard} ${outlet.theme.bgLight} shadow-sm ring-1 ring-current`
                        : 'bg-gray-50/70 border-gray-100 hover:bg-white hover:shadow-2xs'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1 sm:mb-2">
                      <div className="flex items-center gap-1 sm:gap-2 min-w-0">
                        <span className={`w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full shrink-0 ${outlet.theme.dotColor}`} />
                        <span className="text-[11px] sm:text-xs font-bold text-gray-800 truncate">{outlet.name}</span>
                      </div>
                      <span className={`text-[8px] sm:text-[9px] font-bold px-1 sm:px-1.5 py-0.2 sm:py-0.5 rounded-full border shrink-0 ${outlet.theme.badge}`}>
                        {outlet.percentage}%
                      </span>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between">
                      <div className="flex items-baseline gap-0.5 sm:gap-1">
                        <span className="text-xs sm:text-base font-extrabold text-gray-900">
                          {outlet.energyKwh.toFixed(2)}
                        </span>
                        <span className="text-[9px] sm:text-[10px] font-bold text-gray-400">kWh</span>
                      </div>
                      <span className="text-[10px] sm:text-xs font-semibold text-gray-600">
                        ₱{outlet.costPhp}
                      </span>
                    </div>

                    <div className="flex items-center justify-between mt-1 sm:mt-2 pt-1 sm:pt-2 border-t border-gray-100/80 text-[8px] sm:text-[10px] text-gray-500 font-medium">
                      <span className="hidden sm:inline">Live draw</span>
                      <span className={`font-bold ${outlet.watts > 0 ? outlet.theme.textAccent : 'text-gray-600'}`}>
                        {outlet.watts.toFixed(1)}W
                      </span>
                      <span className={`text-[8px] sm:text-[9px] font-semibold uppercase ${
                        outlet.watts > 6 ? 'text-emerald-600' : 'text-gray-400'
                      }`}>
                        {outlet.watts > 6 ? 'Active' : 'Idle'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* Responsive Recharts Bar Chart */
            <div className="h-44 sm:h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart 
                  data={outletChartData} 
                  barSize={24} 
                  layout="vertical" 
                  margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
                  <XAxis 
                    type="number" 
                    stroke="#9ca3af" 
                    fontSize={11} 
                    tickLine={false} 
                    axisLine={false} 
                    unit=" kWh" 
                  />
                  <YAxis 
                    type="category" 
                    dataKey="name" 
                    stroke="#4b5563" 
                    fontSize={11} 
                    tickLine={false} 
                    axisLine={false} 
                    width={70} 
                  />
                  <Tooltip
                    contentStyle={{ 
                      backgroundColor: '#ffffff', 
                      borderColor: '#e5e7eb', 
                      borderRadius: '16px', 
                      boxShadow: '0 8px 30px rgba(0,0,0,0.06)',
                      fontWeight: 'bold',
                      fontSize: '12px'
                    }}
                    formatter={(val) => [`${Number(val).toFixed(2)} kWh`, 'Energy']}
                  />
                  <Bar dataKey="kwh" radius={[0, 8, 8, 0]}>
                    {outletChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>


    </div>
    </>
  );
};

export default Analytics;
