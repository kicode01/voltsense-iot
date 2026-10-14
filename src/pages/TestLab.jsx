import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  FlaskConical,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Download,
  Zap,
  Gauge,
  Sliders,
  Trash2,
  Check,
  Power,
  RotateCcw,
  Sparkles,
  Activity
} from 'lucide-react';
import { useDeviceContext } from '../contexts/deviceContextCore';
import { useRoomData } from '../hooks/useRoomData';

const LOAD_PRESETS = [
  { label: '60W Incandescent Bulb', current: 0.26, voltage: 230, power: 59.8 },
  { label: '100W Incandescent Bulb', current: 0.43, voltage: 230, power: 98.9 },
  { label: '45W Laptop Charger (PF ~0.55)', current: 0.35, voltage: 230, power: 44.2 },
  { label: '1000W Electric Kettle / Iron', current: 4.35, voltage: 230, power: 1000.5 },
  { label: 'Custom Test Load', current: 0.0, voltage: 230, power: 0.0 }
];

const LOCAL_STORAGE_TRIALS_KEY = 'voltsense_validation_trials_v1';

const TestLab = () => {
  const { activeDeviceId } = useDeviceContext();
  const { roomData, togglePortRelay, updateDeviceSetting } = useRoomData(activeDeviceId);

  const [selectedPort, setSelectedPort] = useState('port_01');
  const [selectedPreset, setSelectedPreset] = useState(LOAD_PRESETS[0].label);

  // Multimeter Reference Inputs
  const [refCurrent, setRefCurrent] = useState('0.26');
  const [refVoltage, setRefVoltage] = useState('230.0');

  // Calibration Factor Inputs (synced from roomData or default)
  const [calMvPerV, setCalMvPerV] = useState('4.60');
  const [nominalV, setNominalV] = useState('230');
  const [savingCal, setSavingCal] = useState(false);
  const [calSavedNotice, setCalSavedNotice] = useState(false);

  // Trials Logger
  const [trials, setTrials] = useState(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_TRIALS_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [copiedMarkdown, setCopiedMarkdown] = useState(false);

  // Sync calibration settings from device
  useEffect(() => {
    if (roomData?.settings) {
      if (roomData.settings.voltage_cal_mv_per_v !== undefined) {
        setCalMvPerV(String(roomData.settings.voltage_cal_mv_per_v));
      }
      if (roomData.settings.nominal_voltage !== undefined) {
        setNominalV(String(roomData.settings.nominal_voltage));
      }
    }
  }, [roomData]);

  // Persist trials
  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_STORAGE_TRIALS_KEY, JSON.stringify(trials));
    } catch {
      // Ignore quota errors
    }
  }, [trials]);

  // Handle Preset changes
  const handlePresetSelect = (presetLabel) => {
    setSelectedPreset(presetLabel);
    const found = LOAD_PRESETS.find(p => p.label === presetLabel);
    if (found && found.current > 0) {
      setRefCurrent(String(found.current));
      setRefVoltage(String(found.voltage));
    }
  };

  // Live telemetry for selected port (or demo fallbacks)
  const isDemo = !activeDeviceId;
  const currentPortData = roomData?.ports?.[selectedPort] || {
    name: selectedPort === 'port_01' ? 'Smart Socket 1' : selectedPort === 'port_02' ? 'Smart Socket 2' : 'Smart Socket 3',
    current_amps: isDemo ? 0.264 : 0.0,
    voltage: isDemo ? 229.4 : 230.0,
    power_watts: isDemo ? 60.5 : 0.0,
    power_factor: isDemo ? 0.99 : 1.0,
    relay_status: true
  };

  const measuredCurrent = Number(currentPortData.current_amps) || 0;
  const measuredVoltage = Number(currentPortData.voltage) || Number(nominalV) || 230.0;
  const measuredPower = Number(currentPortData.power_watts) || (measuredCurrent * measuredVoltage);
  const powerIsMeasured = roomData?.voltage_source === 'measured';

  // Reference values parsed
  const numRefCurrent = parseFloat(refCurrent) || 0;
  const numRefVoltage = parseFloat(refVoltage) || 0;
  const numRefPower = numRefCurrent * numRefVoltage;

  // Real-time Percentage Errors
  const currentErrorPct = numRefCurrent > 0
    ? Math.abs((measuredCurrent - numRefCurrent) / numRefCurrent) * 100
    : 0;

  const voltageErrorPct = numRefVoltage > 0
    ? Math.abs((measuredVoltage - numRefVoltage) / numRefVoltage) * 100
    : 0;

  const powerErrorPct = numRefPower > 0
    ? Math.abs((measuredPower - numRefPower) / numRefPower) * 100
    : 0;

  // Grade badge based on current error
  const getAccuracyGrade = (err) => {
    if (numRefCurrent <= 0) return { label: 'Awaiting Reference', color: 'bg-gray-100 text-gray-600 border-gray-200' };
    if (err < 3.0) return { label: 'Grade A (Excellent <3%)', color: 'bg-emerald-50 text-emerald-800 border-emerald-200' };
    if (err <= 7.0) return { label: 'Grade B (Acceptable <7%)', color: 'bg-blue-50 text-blue-800 border-blue-200' };
    return { label: 'Calibration Needed (>7%)', color: 'bg-amber-50 text-amber-800 border-amber-200' };
  };

  const currentGrade = getAccuracyGrade(currentErrorPct);

  // Save calibration factor to RTDB
  const handleSaveCalibration = async () => {
    setSavingCal(true);
    const parsedMv = parseFloat(calMvPerV);
    const parsedV = parseFloat(nominalV);

    if (!isNaN(parsedMv) && parsedMv > 0) {
      await updateDeviceSetting('voltage_cal_mv_per_v', parsedMv);
    }
    if (!isNaN(parsedV) && parsedV >= 50 && parsedV <= 300) {
      await updateDeviceSetting('nominal_voltage', parsedV);
    }

    setSavingCal(false);
    setCalSavedNotice(true);
    setTimeout(() => setCalSavedNotice(false), 2500);
  };

  // Log a trial run
  const handleLogTrial = () => {
    if (numRefCurrent <= 0) return;

    const newTrial = {
      id: Date.now(),
      trialNumber: trials.length + 1,
      port: currentPortData.name || selectedPort,
      loadName: selectedPreset,
      refCurrent: numRefCurrent.toFixed(3),
      measuredCurrent: measuredCurrent.toFixed(3),
      currentError: currentErrorPct.toFixed(2),
      refPower: numRefPower.toFixed(1),
      measuredPower: measuredPower.toFixed(1),
      powerError: powerErrorPct.toFixed(2),
      accuracy: Math.max(0, 100 - currentErrorPct).toFixed(2),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    };

    setTrials(prev => [newTrial, ...prev]);
  };

  // Clear all trials
  const handleClearTrials = () => {
    if (window.confirm('Are you sure you want to clear all logged validation trials?')) {
      setTrials([]);
    }
  };

  // Mean statistics across trials
  const trialStats = useMemo(() => {
    if (trials.length === 0) return { meanError: 0, meanAccuracy: 0, count: 0 };
    const totalError = trials.reduce((sum, t) => sum + parseFloat(t.currentError), 0);
    const totalAccuracy = trials.reduce((sum, t) => sum + parseFloat(t.accuracy), 0);
    return {
      meanError: (totalError / trials.length).toFixed(2),
      meanAccuracy: (totalAccuracy / trials.length).toFixed(2),
      count: trials.length
    };
  }, [trials]);

  // Export to Markdown
  const handleCopyMarkdown = () => {
    if (trials.length === 0) return;

    let md = `### VoltSense Sensor Accuracy Trials (Chapter 4 Benchmark)\n\n`;
    md += `| Trial | Test Load | Port | Reference Current (DMM) | VoltSense Current | Error (%) | Accuracy (%) | Reference Power (W) | VoltSense Power (W) |\n`;
    md += `| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |\n`;

    trials.forEach(t => {
      md += `| #${t.trialNumber} | ${t.loadName} | ${t.port} | ${t.refCurrent} A | ${t.measuredCurrent} A | ${t.currentError}% | ${t.accuracy}% | ${t.refPower} W | ${t.measuredPower} W |\n`;
    });

    md += `\n**Mean Current Percentage Error:** ${trialStats.meanError}%\n`;
    md += `**Overall Mean Accuracy:** ${trialStats.meanAccuracy}%\n`;
    md += `*Instruments used: Digital True-RMS Multimeter / Clamp Meter vs. VoltSense ACS712 & ZMPT101B.*`;

    navigator.clipboard.writeText(md);
    setCopiedMarkdown(true);
    setTimeout(() => setCopiedMarkdown(false), 2500);
  };

  // Export to CSV
  const handleDownloadCsv = () => {
    if (trials.length === 0) return;

    const headers = ['Trial', 'Test Load', 'Port', 'Reference Current (A)', 'VoltSense Current (A)', 'Current Error (%)', 'Accuracy (%)', 'Reference Power (W)', 'VoltSense Power (W)', 'Time'];
    const rows = trials.map(t => [
      t.trialNumber,
      `"${t.loadName}"`,
      `"${t.port}"`,
      t.refCurrent,
      t.measuredCurrent,
      t.currentError,
      t.accuracy,
      t.refPower,
      t.measuredPower,
      `"${t.timestamp}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `VoltSense_Validation_Trials_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex flex-col gap-5 animate-in fade-in duration-500 pb-12">
      
      {/* Top Header Card */}
      <div className="bg-white/90 backdrop-blur-xl p-4 md:p-6 rounded-3xl border border-white/20 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            to="/dashboard"
            className="w-10 h-10 rounded-2xl bg-gray-100 hover:bg-gray-200 text-gray-700 flex items-center justify-center transition-colors shrink-0"
            title="Return to Dashboard"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg md:text-xl font-bold text-gray-900 tracking-tight leading-tight">
                Sensor Validation & Bench Test Lab
              </h2>
              <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-800 border border-emerald-200">
                <FlaskConical className="w-3 h-3 text-emerald-600" /> Chapter 4
              </span>
            </div>
            <p className="text-gray-500 text-xs md:text-sm font-medium mt-0.5">
              Live accuracy benchmarking, calibration trimmer, and thesis trial data recorder
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto">
          {isDemo ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" /> Demo Bench Mode
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-mono font-bold bg-maroon-50 text-maroon-800 border border-maroon-100">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              {activeDeviceId}
            </span>
          )}
        </div>
      </div>

      {/* Port Channel Switcher */}
      <div className="flex items-center justify-between bg-white border border-gray-100 rounded-2xl p-2 shadow-sm gap-2 overflow-x-auto">
        <div className="flex items-center gap-1.5">
          {['port_01', 'port_02', 'port_03'].map((portId, idx) => {
            const isSelected = selectedPort === portId;
            const pData = roomData?.ports?.[portId];
            const portName = pData?.name || `Port 0${idx + 1}`;
            const isOn = pData?.relay_status !== false;

            return (
              <button
                key={portId}
                onClick={() => setSelectedPort(portId)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap ${
                  isSelected
                    ? 'bg-maroon-800 text-white shadow-md shadow-maroon-900/20'
                    : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${isOn ? 'bg-emerald-400' : 'bg-gray-300'}`} />
                {portName}
              </button>
            );
          })}
        </div>

        <button
          onClick={() => togglePortRelay(selectedPort, !currentPortData.relay_status)}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
            currentPortData.relay_status
              ? 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200'
              : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
          }`}
        >
          <Power className="w-3.5 h-3.5" />
          {currentPortData.relay_status ? 'Trip Relay OFF' : 'Energize Port ON'}
        </button>
      </div>

      {/* 3-Column Bench Layout (Bento Grid) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        
        {/* Column 1: Live VoltSense Telemetry (lg:col-span-4) */}
        <div className="lg:col-span-4 bg-white border border-gray-100 rounded-3xl p-5 md:p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-bold uppercase tracking-widest text-gray-400 flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-maroon-800" /> Device Telemetry
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                Live Sensor Read
              </span>
            </div>

            <div className="space-y-4">
              <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block mb-1">
                  Reported Current (ACS712)
                </span>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-3xl font-mono font-bold text-gray-900">
                    {measuredCurrent.toFixed(3)}
                  </span>
                  <span className="text-sm font-bold text-gray-500 uppercase">Amperes</span>
                </div>
              </div>

              <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                    Mains Voltage
                  </span>
                  <span className="text-[9px] font-bold uppercase text-maroon-700 bg-maroon-50 px-1.5 py-0.5 rounded">
                    {powerIsMeasured ? 'ZMPT101B' : 'Nominal'}
                  </span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-mono font-bold text-gray-900">
                    {measuredVoltage.toFixed(1)}
                  </span>
                  <span className="text-sm font-bold text-gray-500 uppercase">Volts AC</span>
                </div>
              </div>

              <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block mb-1">
                  Calculated Power ({powerIsMeasured ? 'Real' : 'Apparent'})
                </span>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-mono font-bold text-gray-900">
                    {measuredPower.toFixed(1)}
                  </span>
                  <span className="text-sm font-bold text-gray-500 uppercase">
                    {powerIsMeasured ? 'Watts' : 'VA'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-[11px] text-gray-400 font-medium">
            <span>Sampling: 100ms (5 full cycles)</span>
            <span>Relay: {currentPortData.relay_status ? 'Active' : 'Isolated'}</span>
          </div>
        </div>

        {/* Column 2: Reference Multimeter Input (lg:col-span-4) */}
        <div className="lg:col-span-4 bg-white border border-gray-100 rounded-3xl p-5 md:p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-bold uppercase tracking-widest text-gray-400 flex items-center gap-1.5">
              <Gauge className="w-3.5 h-3.5 text-blue-600" /> Reference Standard
            </span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
              Multimeter / Clamp
            </span>
          </div>

          {/* Test Load Presets */}
          <div className="mb-4">
            <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-1.5">
              Select Test Load Preset
            </label>
            <select
              value={selectedPreset}
              onChange={(e) => handlePresetSelect(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-maroon-300 transition-all"
            >
              {LOAD_PRESETS.map((p) => (
                <option key={p.label} value={p.label}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          {/* Multimeter Manual Inputs */}
          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-1">
                Multimeter Current Reading (Amps)
              </label>
              <div className="relative">
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  max="10"
                  value={refCurrent}
                  onChange={(e) => setRefCurrent(e.target.value)}
                  placeholder="e.g. 0.260"
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-lg font-mono font-bold text-gray-900 outline-none focus:ring-2 focus:ring-maroon-300 transition-all"
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400">
                  A
                </span>
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-1">
                Multimeter Grid Voltage (Volts)
              </label>
              <div className="relative">
                <input
                  type="number"
                  step="0.1"
                  min="50"
                  max="300"
                  value={refVoltage}
                  onChange={(e) => setRefVoltage(e.target.value)}
                  placeholder="e.g. 230.0"
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-lg font-mono font-bold text-gray-900 outline-none focus:ring-2 focus:ring-maroon-300 transition-all"
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400">
                  V
                </span>
              </div>
            </div>

            <div className="bg-blue-50/60 rounded-2xl p-3 border border-blue-100 flex items-center justify-between">
              <span className="text-[11px] font-bold text-blue-900">Reference Power ($V \times I$):</span>
              <span className="text-sm font-mono font-bold text-blue-900">
                {numRefPower.toFixed(1)} W
              </span>
            </div>
          </div>
        </div>

        {/* Column 3: Real-Time Accuracy & Error Analysis (lg:col-span-4) */}
        <div className="lg:col-span-4 bg-white border border-gray-100 rounded-3xl p-5 md:p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-bold uppercase tracking-widest text-gray-400 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-emerald-600" /> Error Calculation
              </span>
              <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${currentGrade.color}`}>
                {currentGrade.label}
              </span>
            </div>

            <div className="space-y-3">
              {/* Current Error */}
              <div className="p-3.5 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block">
                    Current Percentage Error
                  </span>
                  <span className="text-xl font-mono font-bold text-gray-900">
                    {currentErrorPct.toFixed(2)}%
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block">
                    Accuracy
                  </span>
                  <span className="text-xl font-mono font-bold text-emerald-700">
                    {Math.max(0, 100 - currentErrorPct).toFixed(2)}%
                  </span>
                </div>
              </div>

              {/* Voltage Error */}
              <div className="p-3.5 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block">
                    Voltage Error
                  </span>
                  <span className="text-sm font-mono font-bold text-gray-700">
                    {voltageErrorPct.toFixed(2)}%
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block">
                    Power Error
                  </span>
                  <span className="text-sm font-mono font-bold text-gray-700">
                    {powerErrorPct.toFixed(2)}%
                  </span>
                </div>
              </div>

              <p className="text-[11px] text-gray-500 leading-snug px-1 font-mono">
                Formula: Error % = (|VoltSense - Multimeter| / Multimeter) × 100
              </p>
            </div>
          </div>

          <button
            onClick={handleLogTrial}
            disabled={numRefCurrent <= 0}
            className="w-full mt-5 py-3 rounded-2xl bg-maroon-800 hover:bg-maroon-900 disabled:bg-gray-200 disabled:text-gray-400 text-white font-bold text-sm transition-all shadow-md shadow-maroon-900/20 flex items-center justify-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4" /> Log Current Trial Run
          </button>
        </div>

      </div>

      {/* Live Calibration Trimmer (Moved from Settings) */}
      <div className="bg-white border border-gray-100 rounded-3xl p-5 md:p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-maroon-50 rounded-2xl flex items-center justify-center shrink-0">
            <Sliders className="w-5 h-5 text-maroon-800" />
          </div>
          <div>
            <h3 className="text-sm md:text-base font-bold text-gray-900 leading-tight">
              Live Firmware Calibration Factors
            </h3>
            <p className="text-xs text-gray-500 font-medium">
              Adjust parameters in NVS memory to immediately calibrate voltage & power calculations
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-1">
              Voltage Cal Factor (mV/V)
            </label>
            <input
              type="number"
              step="0.01"
              value={calMvPerV}
              onChange={(e) => setCalMvPerV(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm font-semibold text-gray-900 outline-none focus:ring-2 focus:ring-maroon-300"
            />
            <span className="text-[10px] text-gray-400 mt-1 block">
              ZMPT101B gain ratio. Increase if reported voltage is too low.
            </span>
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-1">
              Nominal Supply Voltage (V)
            </label>
            <input
              type="number"
              step="1"
              value={nominalV}
              onChange={(e) => setNominalV(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm font-semibold text-gray-900 outline-none focus:ring-2 focus:ring-maroon-300"
            />
            <span className="text-[10px] text-gray-400 mt-1 block">
              Used when no voltage sensor is fitted (mode A fallback).
            </span>
          </div>

          <div className="flex flex-col justify-end">
            <button
              onClick={handleSaveCalibration}
              disabled={savingCal}
              className="w-full py-2.5 px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs uppercase tracking-wider transition-colors flex items-center justify-center gap-1.5 shadow-sm"
            >
              {savingCal ? (
                <>Applying to Device...</>
              ) : calSavedNotice ? (
                <><Check className="w-3.5 h-3.5" /> Calibrated & Saved!</>
              ) : (
                <><RotateCcw className="w-3.5 h-3.5" /> Apply Calibration</>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Chapter 4 Experimental Trials Table */}
      <div className="bg-white border border-gray-100 rounded-3xl p-5 md:p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-gray-900 leading-tight">
                Experimental Trials Record (Chapter 4)
              </h3>
              <span className="text-xs font-bold text-maroon-800 bg-maroon-50 px-2 py-0.5 rounded-full border border-maroon-100">
                {trials.length} {trials.length === 1 ? 'Trial' : 'Trials'}
              </span>
            </div>
            <p className="text-xs text-gray-500 font-medium mt-0.5">
              Empirical data log comparing VoltSense readings against Digital Multimeter standards
            </p>
          </div>

          {trials.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={handleCopyMarkdown}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
                title="Copy formatted Markdown table for Word or LaTeX thesis manuscript"
              >
                {copiedMarkdown ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedMarkdown ? 'Copied Table!' : 'Copy for Thesis'}
              </button>

              <button
                onClick={handleDownloadCsv}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-maroon-50 hover:bg-maroon-100 text-maroon-800 border border-maroon-100 transition-colors"
                title="Download CSV file for spreadsheet analysis"
              >
                <Download className="w-3.5 h-3.5" /> Export CSV
              </button>

              <button
                onClick={handleClearTrials}
                className="p-1.5 rounded-xl text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                title="Clear all recorded trials"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {trials.length === 0 ? (
          <div className="p-8 text-center bg-gray-50 rounded-2xl border border-gray-100">
            <FlaskConical className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <h4 className="text-sm font-bold text-gray-700">No Validation Trials Logged Yet</h4>
            <p className="text-xs text-gray-400 max-w-sm mx-auto mt-1">
              Connect a test load to a port, enter your multimeter readings above, and tap 
              <strong> "Log Current Trial Run"</strong> to generate your thesis validation dataset.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-gray-100 text-[10px] font-bold uppercase tracking-wider text-gray-400 bg-gray-50/50">
                  <th className="py-2.5 px-3">#</th>
                  <th className="py-2.5 px-3">Test Load</th>
                  <th className="py-2.5 px-3">Channel</th>
                  <th className="py-2.5 px-3">Ref (DMM)</th>
                  <th className="py-2.5 px-3">VoltSense</th>
                  <th className="py-2.5 px-3">Error (%)</th>
                  <th className="py-2.5 px-3">Accuracy</th>
                  <th className="py-2.5 px-3">Time</th>
                  <th className="py-2.5 px-2 text-right">Del</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 font-mono">
                {trials.map((t) => (
                  <tr key={t.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="py-2.5 px-3 font-sans font-bold text-gray-700">#{t.trialNumber}</td>
                    <td className="py-2.5 px-3 font-sans font-medium text-gray-900">{t.loadName}</td>
                    <td className="py-2.5 px-3 font-sans text-gray-600">{t.port}</td>
                    <td className="py-2.5 px-3 font-bold text-gray-700">{t.refCurrent} A</td>
                    <td className="py-2.5 px-3 font-bold text-maroon-900">{t.measuredCurrent} A</td>
                    <td className="py-2.5 px-3 font-bold text-amber-700">{t.currentError}%</td>
                    <td className="py-2.5 px-3 font-bold text-emerald-700">{t.accuracy}%</td>
                    <td className="py-2.5 px-3 text-[10px] text-gray-400 font-sans">{t.timestamp}</td>
                    <td className="py-2.5 px-2 text-right">
                      <button
                        onClick={() => setTrials(prev => prev.filter(x => x.id !== t.id))}
                        className="text-gray-300 hover:text-red-500 p-1 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-gray-200 bg-gray-50/70 font-sans">
                <tr>
                  <td colSpan={5} className="py-3 px-3 text-xs font-bold text-gray-800">
                    Summary Mean Statistics ({trials.length} Trials Logged):
                  </td>
                  <td className="py-3 px-3 font-mono font-bold text-xs text-amber-800">
                    {trialStats.meanError}%
                  </td>
                  <td className="py-3 px-3 font-mono font-bold text-xs text-emerald-800">
                    {trialStats.meanAccuracy}%
                  </td>
                  <td colSpan={2} className="py-3 px-3 text-right text-[10px] text-gray-400">
                    Validation Grade: {parseFloat(trialStats.meanError) < 5 ? 'A (Thesis Ready)' : 'B (Acceptable)'}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Environmental Sensors Verification Checklist */}
      <div className="bg-white border border-gray-100 rounded-3xl p-5 md:p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="w-4 h-4 text-maroon-800" />
          <h3 className="text-sm md:text-base font-bold text-gray-900">
            Occupancy Dual-Sensor Diagnostic Checklist
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-2xl bg-gray-50 border border-gray-100">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-gray-800">HC-SR501 PIR Motion Sensor</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${roomData?.occupied ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-200 text-gray-600'}`}>
                {roomData?.occupied ? 'Motion Active' : 'Idle'}
              </span>
            </div>
            <ul className="text-[11px] text-gray-500 space-y-1.5 list-disc pl-4">
              <li><strong>Tx Trimpot (Time Delay):</strong> Must be set almost fully counter-clockwise (~3 to 5 seconds).</li>
              <li><strong>Jumper Mode:</strong> Must be set to <strong>H</strong> (Repeat Trigger), not L.</li>
              <li><strong>Sx Sensitivity:</strong> Middle position (~4 meters) to prevent false triggers through doorways.</li>
            </ul>
          </div>

          <div className="p-4 rounded-2xl bg-gray-50 border border-gray-100">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-gray-800">mmWave Radar (LD2410)</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${roomData?.settings?.mmwave_enabled !== false ? 'bg-maroon-100 text-maroon-800' : 'bg-gray-200 text-gray-600'}`}>
                {roomData?.settings?.mmwave_enabled !== false ? 'Radar Enabled' : 'Disabled'}
              </span>
            </div>
            <ul className="text-[11px] text-gray-500 space-y-1.5 list-disc pl-4">
              <li><strong>Stillness Detection:</strong> Detects micro-movements (breathing, typing) when person sits still.</li>
              <li><strong>Distance Gates:</strong> Trim max distance gate to ~3m so it doesn't sense people in outside halls.</li>
              <li><strong>Enclosure Window:</strong> Ensure radar faces front plastic window with no metal obstruction.</li>
            </ul>
          </div>
        </div>
      </div>

    </div>
  );
};

export default TestLab;
