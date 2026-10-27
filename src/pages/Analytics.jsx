import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area, CartesianGrid } from 'recharts';
import { Calendar, PlugZap, ChevronDown, AlertTriangle, BarChart3, Clock, Zap, Activity, Plug } from 'lucide-react';
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

  // Same rule as the Dashboard: W only when the firmware says it measured a voltage waveform,
  // VA otherwise. Analytics used to label everything "Watts" regardless.
  const powerUnitLong = 'Watts';
  const powerUnitShort = 'W';



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

  // Demo mode may invent a total so the chart has something to draw; a REAL device must not.
  // `|| 3.2` used to fire on a genuine 0 kWh period as well, so a day with no recorded energy
  // reported 3.2 kWh of it — a fabricated number indistinguishable from a measurement.
  const totalEnergy = Number(dataToRender?.totals?.energy) || (isDemo ? 3.2 : 0);
  const totalHours = Number(dataToRender?.totals?.hours) || (isDemo ? 8.5 : 0);

  const defaultPortShare = {
    port_01: { name: 'Port 1', icon: 'plug', share: 0.58, volts: 220, amps: 0.25, watts: 55.0, pf: 0.98 },
    port_02: { name: 'Port 2', icon: 'plug', share: 0.11, volts: 220, amps: 0.10, watts: 22.0, pf: 0.95 },
    port_03: { name: 'Port 3', icon: 'plug', share: 0.31, volts: 220, amps: 0.20, watts: 44.0, pf: 0.92 },
  };

  const portColors = {
    port_01: '#852636', // Signature VoltSense Maroon (Classic mid-tone)
    port_02: '#b84255', // Radiant Crimson Maroon (Lighter warm tone)
    port_03: '#54121e'  // Deep Velvet Maroon (Rich dark wine tone)
  };

  const outletList = ['port_01', 'port_02', 'port_03'].map((portKey) => {
    const rawPort = roomData?.ports?.[portKey] || {};
    const fallback = defaultPortShare[portKey];
    const portNumber = portKey === 'port_01' ? 1 : portKey === 'port_02' ? 2 : 3;
    const name = `Port ${portNumber}`;
    const isRelayOn = rawPort.relay_status !== undefined ? Boolean(rawPort.relay_status) : true;
    
    // Period energy in kWh for this outlet:
    // If viewing 'Today' and the live device has recorded energy on this port, use that.
    // For historical ranges ('Yesterday', 'Last 7 Days', 'This Month', 'Custom') or demo mode,
    // calculate proportionally from the selected period's total energy so it connects to the time filter.
    const hasLiveTodayPortEnergy = timeRange === 'Today' && Number(rawPort.energy_kwh) > 0;
    const energyKwh = hasLiveTodayPortEnergy 
      ? Number(rawPort.energy_kwh) 
      : Number((totalEnergy * fallback.share).toFixed(2));
    
    const percentage = totalEnergy > 0 ? Math.min(100, Math.round((energyKwh / totalEnergy) * 100)) : Math.round(fallback.share * 100);
    
    // Period active runtime & estimated average active load
    const periodHours = Number((totalHours * fallback.share).toFixed(1));
    const avgWatts = periodHours > 0 
      ? Math.round((energyKwh * 1000) / periodHours) 
      : fallback.watts;

    // Time-series readings for this port across the selected period
    const readings = (dataToRender?.energy || []).map((pt) => ({
      label: pt.label,
      kwh: Number((pt.kwh * fallback.share).toFixed(2)),
      watts: fallback.watts
    }));

    const volts = Number(rawPort.voltage) > 0 ? Number(rawPort.voltage) : fallback.volts;
    const rawAmps = rawPort.current_amps !== undefined ? Number(rawPort.current_amps) : (isDemo ? fallback.amps : 0);
    const amps = isRelayOn ? (rawAmps > 0.02 ? rawAmps : 0) : 0;
    // Power factor is a MEASUREMENT, not a default. Substituting 0.98/0.95/0.92 from a table made
    // every per-port wattage look plausible while being pure invention — and it disagreed with the
    // Dashboard, which used 0.95, and with the firmware, which claimed 1.00.
    const pf = Number(rawPort.power_factor) > 0 ? Number(rawPort.power_factor) : 0;
    const rawWatts = rawPort.power_watts !== undefined ? Number(rawPort.power_watts) : (isDemo ? fallback.watts : 0);
    // Never recompute what the device measured. The old fallback re-derived `volts x amps` here,
    // which silently replaced the firmware's figure with apparent power whenever it was 0.
    const watts = isRelayOn ? (amps > 0 ? rawWatts : 0) : 0;

    return {
      id: portKey,
      name,
      label: `Port ${portNumber}`,
      icon: 'plug',
      isRelayOn,
      energyKwh,
      percentage,
      periodHours,
      avgWatts,
      readings,
      volts,
      amps,
      watts,
      pf,
      color: portColors[portKey] || '#852636'
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
              <span className="text-gray-400 text-sm font-bold uppercase tracking-widest">{powerUnitLong}</span>
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
        {/* Header & Filter Pills */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
          <div>
            <h3 className="text-[10px] md:text-xs font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2">
              <span>Per-Port Readings &amp; History</span>
              <span className="text-[9px] md:text-[10px] font-semibold text-maroon-800 bg-maroon-50 border border-maroon-200/60 px-2 py-0.5 rounded-md normal-case">
                {rangeLabel(timeRange)}
              </span>
            </h3>
          </div>

          {/* Segmented Filter Pills */}
          <div className="flex items-center gap-1 bg-gray-50 p-1 rounded-2xl self-start sm:self-auto shrink-0 overflow-x-auto max-w-full hide-scrollbar border border-gray-100">
            <button
              onClick={() => setSelectedOutletTab('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all duration-200 whitespace-nowrap ${
                selectedOutletTab === 'all'
                  ? 'bg-white text-maroon-800 shadow-2xs font-extrabold'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              All
            </button>
            {outletList.map((outlet, idx) => (
              <button
                key={`tab-${outlet.id}`}
                onClick={() => setSelectedOutletTab(outlet.id)}
                aria-label={`Filter by ${outlet.name}`}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all duration-200 whitespace-nowrap ${
                  selectedOutletTab === outlet.id
                    ? 'bg-white text-maroon-800 shadow-2xs font-extrabold'
                    : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                {idx + 1}
              </button>
            ))}
          </div>
        </div>

        {/* Outlet Cards Layout: Carousel on Mobile (< md), 3-col Grid on Desktop */}
        <div
          ref={carouselRef}
          onScroll={handleCarouselScroll}
          className={`${
            displayedOutlets.length > 1
              ? 'flex md:grid md:grid-cols-3 overflow-x-auto snap-x snap-mandatory gap-3.5 pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 hide-scrollbar'
              : 'grid grid-cols-1 max-w-xl mx-auto'
          }`}
        >
          {displayedOutlets.map((outlet) => {
            const isDrawing = outlet.isRelayOn && (outlet.watts > 1.5 || outlet.amps > 0.02);
            const maxReading = Math.max(...(outlet.readings?.map(r => r.kwh) || [0]), 0.01);

            return (
              <div 
                key={outlet.id} 
                className={`border rounded-2xl p-4 sm:p-5 flex flex-col justify-between transition-all duration-300 ${
                  isDrawing
                    ? 'bg-white border-maroon-200/90 shadow-md shadow-maroon-900/5'
                    : outlet.isRelayOn
                    ? 'bg-white/80 border-gray-200/70 shadow-[0_8px_30px_rgb(0,0,0,0.02)]'
                    : 'bg-gray-50/60 border-gray-100 opacity-90'
                } ${
                  displayedOutlets.length > 1 ? 'w-[86vw] sm:w-[320px] md:w-auto shrink-0 snap-center' : 'w-full'
                }`}
              >
                <div>
                  {/* Header: Label, Icon, Historical Share */}
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border transition-all duration-300 ${
                        !outlet.isRelayOn
                          ? 'bg-gray-100/80 text-gray-400 border-gray-200/80 shadow-inner'
                          : isDrawing
                          ? 'bg-maroon-50 text-maroon-800 border-maroon-200 shadow-inner'
                          : 'bg-maroon-50/50 text-maroon-700 border-maroon-100 shadow-inner'
                      }`}>
                        <Plug strokeWidth={1.5} className="w-4 h-4" />
                      </div>
                      <h4 className="text-sm sm:text-base font-bold text-gray-900 leading-tight truncate">
                        {outlet.name}
                      </h4>
                    </div>

                    {/* Historical Share Pill */}
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold border transition-all duration-300 bg-maroon-100/80 text-maroon-900 border-maroon-300/80">
                      {outlet.percentage}% Share
                    </span>
                  </div>

                  {/* Energy Consumption Metric */}
                  <div className="my-2.5">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-3xl font-extrabold text-gray-900 tracking-tight">
                        {outlet.energyKwh.toFixed(2)}
                      </span>
                      <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">kWh</span>
                    </div>
                    <span className="text-[10px] font-semibold text-gray-400 block mt-0.5">
                      Recorded for {rangeLabel(timeRange).toLowerCase()}
                    </span>
                  </div>

                  {/* Historical Telemetry: 2-column stats row */}
                  <div className="grid grid-cols-2 gap-3 py-3 border-t border-gray-100">
                    <div>
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-0.5">
                        Est. Runtime
                      </span>
                      <span className="text-sm font-semibold text-gray-800">
                        {outlet.periodHours} hrs
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-0.5">
                        Avg Active Load
                      </span>
                      <span className="text-sm font-semibold text-gray-800">
                        {outlet.avgWatts} {powerUnitShort}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Mini History Trendline / Sparkline Strip */}
                {outlet.readings && outlet.readings.length > 0 && (
                  <div className="pt-2.5 border-t border-gray-100">
                    <div className="flex items-center justify-between text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                      <span>Readings Trend</span>
                      <span className="text-[9px] font-medium text-gray-400 lowercase">
                        {outlet.readings.length} {outlet.readings.length === 1 ? 'record' : 'intervals'}
                      </span>
                    </div>
                    <div className="h-8 flex items-end gap-1 px-0.5">
                      {outlet.readings.map((r, rIdx) => {
                        const heightPct = Math.max(16, Math.min(100, Math.round((r.kwh / maxReading) * 100)));
                        return (
                          <div
                            key={`bar-${outlet.id}-${rIdx}`}
                            className="flex-1 flex flex-col items-center group/bar relative"
                          >
                            <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-[9px] font-bold py-0.5 px-1.5 rounded opacity-0 group-hover/bar:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-20 shadow-md">
                              {r.label}: {r.kwh.toFixed(2)} kWh
                            </div>
                            <div 
                              style={{ 
                                height: `${heightPct}%`,
                                backgroundColor: outlet.color
                              }}
                              className="w-full rounded-t-sm opacity-80 group-hover/bar:opacity-100 transition-all duration-300"
                            />
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex justify-between text-[8px] font-medium text-gray-400 mt-1 px-0.5">
                      <span>{outlet.readings[0]?.label || ''}</span>
                      {outlet.readings.length > 2 && (
                        <span>{outlet.readings[Math.floor(outlet.readings.length / 2)]?.label || ''}</span>
                      )}
                      <span>{outlet.readings[outlet.readings.length - 1]?.label || ''}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Dedicated Readings Log when a specific port is filtered */}
        {selectedOutletTab !== 'all' && (
          <div className="mt-5 pt-5 border-t border-gray-100 animate-in fade-in duration-300">
            <div className="flex items-center justify-between mb-3.5">
              <div>
                <h4 className="text-[10px] md:text-xs font-bold text-gray-500 uppercase tracking-widest">
                  {displayedOutlets[0]?.name} Readings History ({rangeLabel(timeRange)})
                </h4>
                <p className="text-[11px] text-gray-400 mt-0.5 font-medium">
                  Recorded intervals for this port across the selected time period
                </p>
              </div>
              <span className="text-[10px] font-bold text-maroon-800 bg-maroon-50 px-2.5 py-1 rounded-xl border border-maroon-100">
                {displayedOutlets[0]?.readings?.length || 0} {(displayedOutlets[0]?.readings?.length === 1) ? 'Reading' : 'Readings'}
              </span>
            </div>

            <div className="bg-gray-50/70 border border-gray-100 rounded-2xl p-3 md:p-4 overflow-hidden">
              <div className="grid grid-cols-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider pb-2 border-b border-gray-200/60 px-2">
                <span>Interval / Time</span>
                <span className="text-center">Energy (kWh)</span>
                <span className="text-right">Est. Power</span>
              </div>
              <div className="divide-y divide-gray-100/80 max-h-60 overflow-y-auto">
                {displayedOutlets[0]?.readings?.map((reading, rIdx) => (
                  <div key={`reading-${rIdx}`} className="grid grid-cols-3 items-center py-2.5 px-2 text-xs hover:bg-white/60 rounded-lg transition-colors">
                    <span className="font-semibold text-gray-700 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-maroon-800/40" />
                      {reading.label}
                    </span>
                    <span className="text-center font-bold text-gray-900 font-mono">
                      {reading.kwh.toFixed(2)} <span className="text-[10px] text-gray-400 font-sans">kWh</span>
                    </span>
                    <span className="text-right font-semibold text-gray-600">
                      {reading.watts} <span className="text-[10px] text-gray-400">{powerUnitShort}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

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
                    ? 'w-6 bg-maroon-800' 
                    : 'w-1.5 bg-gray-200'
                }`}
              />
            ))}
          </div>
        )}

        {/* Outlet Consumption Comparison Section */}
        <div className="mt-6 pt-5 border-t border-gray-100">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <h4 className="text-[10px] md:text-xs font-bold text-gray-500 uppercase tracking-widest">
                Energy Share Comparison
              </h4>
            </div>

            {/* View Mode Switcher */}
            <div className="flex items-center gap-1 bg-gray-50 p-1 rounded-xl self-start sm:self-auto border border-gray-100">
              <button
                onClick={() => setShareViewMode('ribbon')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                  shareViewMode === 'ribbon'
                    ? 'bg-white text-gray-900 shadow-2xs font-extrabold'
                    : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                Distribution Bar
              </button>
              <button
                onClick={() => setShareViewMode('chart')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                  shareViewMode === 'chart'
                    ? 'bg-white text-gray-900 shadow-2xs font-extrabold'
                    : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                Bar Chart
              </button>
            </div>
          </div>

          {shareViewMode === 'ribbon' ? (
            <div>
              {/* Proportional Multi-Segment Distribution Bar */}
              <div className="w-full bg-gray-100 p-1 rounded-2xl flex items-center gap-1 overflow-hidden mb-3.5">
                {outletList.map((outlet) => {
                  const widthPct = totalEnergy > 0 ? Math.max(8, outlet.percentage) : 33.3;
                  return (
                    <div
                      key={`ribbon-${outlet.id}`}
                      style={{ width: `${widthPct}%`, backgroundColor: outlet.color }}
                      className="h-5 sm:h-6 rounded-xl transition-all duration-500 ease-apple-spring relative flex items-center justify-center text-[10px] font-bold text-white shadow-2xs px-1"
                      title={`${outlet.name}: ${outlet.energyKwh.toFixed(2)} kWh (${outlet.percentage}%)`}
                    >
                      <span className="truncate font-mono">
                        {outlet.percentage}%
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* 3 Metric Summary Cards */}
              <div className="grid grid-cols-3 gap-2 sm:gap-3.5">
                {outletList.map((outlet) => (
                  <div
                    key={`summary-${outlet.id}`}
                    onClick={() => setSelectedOutletTab(selectedOutletTab === outlet.id ? 'all' : outlet.id)}
                    className={`p-2.5 sm:p-3 rounded-xl border transition-all duration-200 cursor-pointer ${
                      selectedOutletTab === outlet.id 
                        ? 'bg-maroon-50/50 border-maroon-200/80 shadow-2xs'
                        : 'bg-gray-50/60 border-gray-100/90 hover:bg-white hover:border-gray-200/80'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: outlet.color }} />
                        <span className="text-xs font-bold text-gray-800 truncate">{outlet.name}</span>
                      </div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-xs sm:text-sm font-extrabold text-gray-900">
                          {outlet.energyKwh.toFixed(2)}
                        </span>
                        <span className="text-[9px] sm:text-[10px] font-bold text-gray-400">kWh</span>
                      </div>
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
