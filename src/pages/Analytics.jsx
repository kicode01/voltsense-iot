import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area, CartesianGrid } from 'recharts';
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
  const dropdownRef = useRef(null);

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

  // 1. Gather raw energy for each port to calculate proper relative distribution
  const rawPortEnergies = ['port_01', 'port_02', 'port_03'].map((portKey) => {
    const rawPort = roomData?.ports?.[portKey] || {};
    const fallback = defaultPortShare[portKey];
    const hasLiveTodayPortEnergy = timeRange === 'Today' && Number(rawPort.energy_kwh) > 0;
    const energyKwh = hasLiveTodayPortEnergy 
      ? Number(rawPort.energy_kwh) 
      : Number((totalEnergy * fallback.share).toFixed(2));
    return { portKey, rawPort, fallback, energyKwh };
  });

  const sumAllPortsEnergy = rawPortEnergies.reduce((acc, p) => acc + p.energyKwh, 0);

  const outletList = rawPortEnergies.map(({ portKey, rawPort, fallback, energyKwh }) => {
    const portNumber = portKey === 'port_01' ? 1 : portKey === 'port_02' ? 2 : 3;
    const name = `Port ${portNumber}`;
    const isRelayOn = rawPort.relay_status !== undefined ? Boolean(rawPort.relay_status) : true;
    
    // Proportional percentage across all 3 ports (strictly sums to 100%)
    const percentage = sumAllPortsEnergy > 0 
      ? Math.max(1, Math.min(100, Math.round((energyKwh / sumAllPortsEnergy) * 100))) 
      : Math.round(fallback.share * 100);
    
    // Period active runtime & estimated average active load
    const periodHours = Number((totalHours * fallback.share).toFixed(1));
    const avgWatts = periodHours > 0 
      ? Math.round((energyKwh * 1000) / periodHours) 
      : fallback.watts;

    // Time-series readings for this port across the selected period
    const readings = (dataToRender?.energy || []).map((pt) => ({
      label: pt.label,
      kwh: Number((pt.kwh * (sumAllPortsEnergy > 0 ? (energyKwh / sumAllPortsEnergy) : fallback.share)).toFixed(2)),
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

      {/* Per-Outlet Monitoring & Energy Breakdown (Table & Logs Format) */}
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
            <p className="text-[11px] text-gray-400 font-medium mt-0.5">
              Structured telemetry summary and interval consumption logs per port.
            </p>
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
              All Ports
            </button>
            {outletList.map((outlet) => (
              <button
                key={`tab-${outlet.id}`}
                onClick={() => setSelectedOutletTab(outlet.id)}
                aria-label={`Filter by ${outlet.name}`}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all duration-200 whitespace-nowrap ${
                  selectedOutletTab === outlet.id
                    ? 'bg-white text-maroon-800 shadow-2xs font-extrabold'
                    : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                {outlet.name}
              </button>
            ))}
          </div>
        </div>

        {/* 1. Port Summary & Live Telemetry Table */}
        <div className="border border-gray-100 rounded-2xl overflow-hidden mb-5">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[640px]">
              <thead>
                <tr className="bg-gray-50/80 border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                  <th className="py-3 px-4">Port</th>
                  <th className="py-3 px-4">State</th>
                  <th className="py-3 px-4">Live Telemetry</th>
                  <th className="py-3 px-4">Est. Runtime</th>
                  <th className="py-3 px-4">Avg Active Load</th>
                  <th className="py-3 px-4">Period Energy</th>
                  <th className="py-3 px-4 w-44">Usage Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-xs sm:text-sm">
                {displayedOutlets.map((outlet) => {
                  const isDrawing = outlet.isRelayOn && (outlet.watts > 1.5 || outlet.amps > 0.02);
                  const isSelected = selectedOutletTab === outlet.id;

                  return (
                    <tr
                      key={outlet.id}
                      onClick={() => setSelectedOutletTab(isSelected ? 'all' : outlet.id)}
                      className={`transition-colors duration-200 cursor-pointer ${
                        isDrawing
                          ? 'bg-maroon-50/20 hover:bg-maroon-50/40'
                          : 'hover:bg-gray-50/80'
                      }`}
                    >
                      {/* Port Name & Icon */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border transition-all duration-300 ${
                              !outlet.isRelayOn
                                ? 'bg-gray-100 text-gray-400 border-gray-200/70'
                                : isDrawing
                                ? 'bg-maroon-800 text-white border-maroon-900 shadow-2xs'
                                : 'bg-maroon-50 text-maroon-800 border-maroon-200/70'
                            }`}
                          >
                            <Plug strokeWidth={1.75} className="w-3.5 h-3.5" />
                          </div>
                          <span className="font-bold text-gray-900">{outlet.name}</span>
                        </div>
                      </td>

                      {/* State Pill (Maroon Hierarchy) */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold border transition-all duration-300 ${
                            !outlet.isRelayOn
                              ? 'bg-gray-100 text-gray-500 border-gray-200/90'
                              : isDrawing
                              ? 'bg-maroon-800 text-white border-maroon-900 shadow-2xs'
                              : 'bg-maroon-100/80 text-maroon-900 border-maroon-300/80'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                              !outlet.isRelayOn
                                ? 'bg-gray-400'
                                : isDrawing
                                ? 'bg-emerald-400 animate-pulse'
                                : 'bg-maroon-600'
                            }`}
                          />
                          {!outlet.isRelayOn ? 'Switched Off' : isDrawing ? 'In Use' : 'Standby'}
                        </span>
                      </td>

                      {/* Live Telemetry (V / A / W) */}
                      <td className="py-3.5 px-4 whitespace-nowrap tabular-nums">
                        {outlet.isRelayOn ? (
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-700">
                            <span>{outlet.volts.toFixed(0)} V</span>
                            <span className="text-gray-300">·</span>
                            <span className={isDrawing ? 'text-maroon-800 font-bold' : 'text-gray-600'}>
                              {outlet.amps.toFixed(2)} A
                            </span>
                            <span className="text-gray-300">·</span>
                            <span className={isDrawing ? 'text-maroon-800 font-bold' : 'text-gray-500'}>
                              {outlet.watts.toFixed(1)} {powerUnitShort}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs font-medium text-gray-400">0 V · 0.00 A · 0.0 {powerUnitShort}</span>
                        )}
                      </td>

                      {/* Est. Runtime */}
                      <td className="py-3.5 px-4 whitespace-nowrap tabular-nums font-semibold text-gray-700">
                        {outlet.periodHours} <span className="text-xs font-medium text-gray-400">hrs</span>
                      </td>

                      {/* Avg Active Load */}
                      <td className="py-3.5 px-4 whitespace-nowrap tabular-nums font-semibold text-gray-700">
                        {outlet.avgWatts} <span className="text-xs font-medium text-gray-400">{powerUnitShort}</span>
                      </td>

                      {/* Period Energy */}
                      <td className="py-3.5 px-4 whitespace-nowrap tabular-nums">
                        <span className="font-extrabold text-gray-900">{outlet.energyKwh.toFixed(2)}</span>{' '}
                        <span className="text-[10px] font-bold text-gray-400 uppercase">kWh</span>
                      </td>

                      {/* Usage Share Progress Bar */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-2.5">
                          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${Math.max(4, outlet.percentage)}%`,
                                backgroundColor: outlet.color
                              }}
                            />
                          </div>
                          <span className="text-xs font-bold text-maroon-900 tabular-nums w-9 text-right">
                            {outlet.percentage}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {selectedOutletTab === 'all' && (
                <tfoot>
                  <tr className="bg-gray-50/60 border-t border-gray-100 text-xs font-bold text-gray-600">
                    <td className="py-2.5 px-4" colSpan={3}>
                      Total Combined ({rangeLabel(timeRange)})
                    </td>
                    <td className="py-2.5 px-4 tabular-nums">
                      {outletList.reduce((acc, o) => acc + o.periodHours, 0).toFixed(1)} hrs
                    </td>
                    <td className="py-2.5 px-4 tabular-nums">
                      {Math.round(outletList.reduce((acc, o) => acc + o.avgWatts, 0) / 3)} {powerUnitShort} avg
                    </td>
                    <td className="py-2.5 px-4 tabular-nums text-gray-900 font-extrabold">
                      {sumAllPortsEnergy.toFixed(2)} kWh
                    </td>
                    <td className="py-2.5 px-4 text-right tabular-nums text-maroon-900">
                      100%
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* 2. Interval History Logs Table */}
        <div className="border border-gray-100 rounded-2xl overflow-hidden">
          <div className="bg-gray-50/70 px-4 py-2.5 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-maroon-800" />
              <span className="text-[10px] md:text-xs font-bold text-gray-600 uppercase tracking-wider">
                Interval Readings Log ({selectedOutletTab === 'all' ? 'All Ports' : displayedOutlets[0]?.name})
              </span>
            </div>
            <span className="text-[10px] font-semibold text-gray-400">
              {(dataToRender?.energy || []).length} intervals recorded
            </span>
          </div>

          <div className="max-h-72 overflow-y-auto overflow-x-auto divide-y divide-gray-100">
            {(dataToRender?.energy || []).length > 0 ? (
              <table className="w-full text-left border-collapse min-w-[540px]">
                <thead className="sticky top-0 bg-white border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-wider z-10">
                  <tr>
                    <th className="py-2.5 px-4">Interval</th>
                    {selectedOutletTab === 'all' ? (
                      <>
                        <th className="py-2.5 px-4">Port 1</th>
                        <th className="py-2.5 px-4">Port 2</th>
                        <th className="py-2.5 px-4">Port 3</th>
                        <th className="py-2.5 px-4">Total Energy</th>
                      </>
                    ) : (
                      <>
                        <th className="py-2.5 px-4">Outlet</th>
                        <th className="py-2.5 px-4">Energy Logged</th>
                        <th className="py-2.5 px-4">Est. Load</th>
                      </>
                    )}
                    <th className="py-2.5 px-4 text-right">Log Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 text-xs tabular-nums">
                  {[...(dataToRender?.energy || [])].reverse().map((pt, idx) => {
                    const p1Kwh = Number((pt.kwh * (outletList[0].percentage / 100)).toFixed(2));
                    const p2Kwh = Number((pt.kwh * (outletList[1].percentage / 100)).toFixed(2));
                    const p3Kwh = Number((pt.kwh * (outletList[2].percentage / 100)).toFixed(2));
                    const rowTotal = Number((p1Kwh + p2Kwh + p3Kwh).toFixed(2));
                    const focused = displayedOutlets[0] || outletList[0];
                    const singleKwh = Number((pt.kwh * (focused.percentage / 100)).toFixed(2));
                    const hasDraw = selectedOutletTab === 'all' ? rowTotal > 0 : singleKwh > 0;

                    return (
                      <tr key={`log-${pt.label}-${idx}`} className="hover:bg-gray-50/70 transition-colors">
                        <td className="py-2.5 px-4 font-semibold text-gray-700 whitespace-nowrap">
                          {pt.label}
                        </td>
                        {selectedOutletTab === 'all' ? (
                          <>
                            <td className="py-2.5 px-4 text-gray-600">
                              <span className={p1Kwh > 0 ? 'font-bold text-gray-900' : 'text-gray-400'}>
                                {p1Kwh.toFixed(2)}
                              </span>{' '}
                              <span className="text-[10px] text-gray-400">kWh</span>
                            </td>
                            <td className="py-2.5 px-4 text-gray-600">
                              <span className={p2Kwh > 0 ? 'font-bold text-gray-900' : 'text-gray-400'}>
                                {p2Kwh.toFixed(2)}
                              </span>{' '}
                              <span className="text-[10px] text-gray-400">kWh</span>
                            </td>
                            <td className="py-2.5 px-4 text-gray-600">
                              <span className={p3Kwh > 0 ? 'font-bold text-gray-900' : 'text-gray-400'}>
                                {p3Kwh.toFixed(2)}
                              </span>{' '}
                              <span className="text-[10px] text-gray-400">kWh</span>
                            </td>
                            <td className="py-2.5 px-4 font-bold text-maroon-900">
                              {rowTotal.toFixed(2)} <span className="text-[10px] font-semibold text-gray-400">kWh</span>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="py-2.5 px-4 font-semibold text-gray-800">{focused.name}</td>
                            <td className="py-2.5 px-4">
                              <span className={singleKwh > 0 ? 'font-bold text-maroon-900' : 'text-gray-400'}>
                                {singleKwh.toFixed(2)}
                              </span>{' '}
                              <span className="text-[10px] text-gray-400">kWh</span>
                            </td>
                            <td className="py-2.5 px-4 text-gray-600">
                              {singleKwh > 0 ? `${focused.avgWatts} ${powerUnitShort}` : `0 ${powerUnitShort}`}
                            </td>
                          </>
                        )}
                        <td className="py-2.5 px-4 text-right whitespace-nowrap">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                              hasDraw
                                ? 'bg-maroon-100/80 text-maroon-900 border-maroon-300/70'
                                : 'bg-gray-100 text-gray-500 border-gray-200/80'
                            }`}
                          >
                            {hasDraw ? 'Active Draw' : 'Standby / 0 kWh'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="py-8 text-center text-xs text-gray-400 font-medium">
                No interval logs recorded for this period.
              </div>
            )}
          </div>
        </div>
      </div>


    </div>
    </>
  );
};

export default Analytics;
