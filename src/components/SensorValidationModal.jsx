import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, FlaskConical, Copy, Trash2, ShieldCheck, Check, Sparkles } from 'lucide-react';

const PRESETS = [
  { label: '0A Idle', name: 'Zero Idle / No Load', current: 0.0, voltage: 230.0 },
  { label: 'Phone Charger', name: 'Phone Charger (~15W)', current: 0.08, voltage: 230.0 },
  { label: '100W Bulb', name: '100W Incandescent Bulb', current: 0.44, voltage: 230.0 },
  { label: 'Stand Fan', name: 'Electric Stand Fan (~55W)', current: 0.28, voltage: 230.0 },
  { label: 'Kettle', name: 'Electric Kettle (~1200W)', current: 5.22, voltage: 230.0 }
];

export default function SensorValidationModal({ isOpen, onClose, ports = {}, powerIsMeasured = false }) {
  const portKeys = Object.keys(ports);
  const [selectedPortId, setSelectedPortId] = useState(portKeys[0] || 'port_01');
  const [loadName, setLoadName] = useState('');
  const [refCurrent, setRefCurrent] = useState('');
  const [refVoltage, setRefVoltage] = useState('230.0');
  const [copied, setCopied] = useState(false);

  // Persistent test log in localStorage
  const [testLog, setTestLog] = useState(() => {
    try {
      const saved = localStorage.getItem('voltsense_test_validation_log');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Active software telemetry based on selected port
  const activePort = ports[selectedPortId] || {};
  const swCurrent = Number(activePort.current_amps || 0);
  const swPower = Number(activePort.power_watts || 0);
  const swVoltage = Number(activePort.voltage || (powerIsMeasured ? 0 : 230));
  const swPF = Number(activePort.power_factor || 0);

  // Parse reference inputs
  const numRefCurrent = parseFloat(refCurrent);
  const numRefVoltage = parseFloat(refVoltage);
  const hasInput = refCurrent !== '' && !isNaN(numRefCurrent);

  // Calculate error metrics
  const errorMetrics = useMemo(() => {
    if (!hasInput) {
      return { status: 'idle', message: 'Enter your physical multimeter reading to calculate error margin.' };
    }

    let currentErrAbs = 0;
    let currentErrPct = 0;

    if (numRefCurrent === 0) {
      currentErrAbs = Math.abs(swCurrent);
      currentErrPct = swCurrent === 0 ? 0 : 100;
    } else {
      currentErrAbs = Math.abs(swCurrent - numRefCurrent);
      currentErrPct = (currentErrAbs / numRefCurrent) * 100;
    }

    let voltErrAbs = 0;
    let voltErrPct = 0;
    if (!isNaN(numRefVoltage) && numRefVoltage > 0 && swVoltage > 0) {
      voltErrAbs = Math.abs(swVoltage - numRefVoltage);
      voltErrPct = (voltErrAbs / numRefVoltage) * 100;
    }

    let rating = 'High Precision';
    let badgeClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
    let dotClass = 'bg-emerald-500';

    if (currentErrPct <= 2.5) {
      rating = 'High Precision (< 2.5%)';
      badgeClass = 'bg-emerald-50 text-emerald-800 border-emerald-200';
      dotClass = 'bg-emerald-500';
    } else if (currentErrPct <= 5.0) {
      rating = 'Standard Acceptable (< 5.0%)';
      badgeClass = 'bg-blue-50 text-blue-800 border-blue-200';
      dotClass = 'bg-blue-500';
    } else {
      rating = 'Calibration Recommended (> 5.0%)';
      badgeClass = 'bg-amber-50 text-amber-800 border-amber-200';
      dotClass = 'bg-amber-500';
    }

    return {
      status: 'active',
      currentErrAbs,
      currentErrPct,
      voltErrAbs,
      voltErrPct,
      rating,
      badgeClass,
      dotClass
    };
  }, [hasInput, swCurrent, swVoltage, numRefCurrent, numRefVoltage]);

  const handleApplyPreset = (preset) => {
    setLoadName(preset.name);
    setRefCurrent(preset.current.toString());
    setRefVoltage(preset.voltage.toString());
  };

  const handleAddTestPoint = () => {
    if (!hasInput) return;
    const newEntry = {
      id: Date.now(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      port: activePort.name || selectedPortId,
      load: loadName.trim() || 'Reference Appliance',
      swCurrent: swCurrent.toFixed(2),
      refCurrent: numRefCurrent.toFixed(2),
      currentErrPct: errorMetrics.currentErrPct.toFixed(1) + '%',
      swPower: swPower.toFixed(1) + (powerIsMeasured ? ' W' : ' VA'),
      evaluation: errorMetrics.currentErrPct <= 2.5 ? 'High' : (errorMetrics.currentErrPct <= 5.0 ? 'Acceptable' : 'Check')
    };

    const updated = [newEntry, ...testLog];
    setTestLog(updated);
    try {
      localStorage.setItem('voltsense_test_validation_log', JSON.stringify(updated));
    } catch {
      // ignore
    }
  };

  const handleClearLog = () => {
    setTestLog([]);
    try {
      localStorage.removeItem('voltsense_test_validation_log');
    } catch {
      // ignore
    }
  };

  const handleCopyMarkdown = () => {
    if (testLog.length === 0) return;
    let md = '| # | Appliance / Load | Port | Reference Meter | VoltSense App | Error (%) | Status |\n';
    md += '|---|---|---|---|---|---|---|\n';
    testLog.forEach((row, i) => {
      md += `| ${i + 1} | ${row.load} | ${row.port} | ${row.refCurrent} A | ${row.swCurrent} A (${row.swPower}) | ${row.currentErrPct} | ${row.evaluation} |\n`;
    });

    navigator.clipboard.writeText(md).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (!isOpen) return null;

  return createPortal(
    <div 
      className="fixed inset-0 z-[100] flex items-center justify-center safe-modal overflow-y-auto bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div 
        className="bg-white border border-gray-200/80 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150 my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sleek Minimal Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-white">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gray-100 text-gray-800 flex items-center justify-center">
              <FlaskConical className="w-4 h-4 text-maroon-800" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-gray-900 tracking-tight">Sensor Validation & Accuracy Lab</h2>
                <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-md">
                  Testing Mode
                </span>
              </div>
              <p className="text-[11px] text-gray-500">Benchmark real-time telemetry against a physical multimeter</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Scrollable Content */}
        <div className="p-5 overflow-y-auto space-y-5 text-gray-800">

          {/* Compact Segmented Channel Tabs */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Channel Under Test</span>
              <span className="text-[11px] text-gray-400">Select an outlet to evaluate</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 p-1 bg-gray-50 rounded-xl border border-gray-200/70">
              {portKeys.map((pid) => {
                const port = ports[pid] || {};
                const isSelected = selectedPortId === pid;
                const amps = Number(port.current_amps || 0);
                return (
                  <button
                    key={pid}
                    type="button"
                    onClick={() => setSelectedPortId(pid)}
                    className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-between transition-all ${
                      isSelected 
                        ? 'bg-white text-gray-900 shadow-sm border border-gray-200/60 font-bold' 
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100/50'
                    }`}
                  >
                    <span className="truncate">{port.name || pid}</span>
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${isSelected ? 'bg-gray-100 text-gray-800 font-bold' : 'text-gray-400'}`}>
                      {amps.toFixed(2)}A
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Side-by-Side Comparison Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            
            {/* Left: Software Telemetry Card */}
            <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-100">
                <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Live Software Telemetry</span>
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> Streaming
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-2.5 rounded-lg bg-gray-50/70 border border-gray-100">
                  <span className="text-[10px] text-gray-500 font-medium block">Current (ACS712)</span>
                  <div className="text-xl font-bold text-gray-900 mt-0.5">
                    {swCurrent.toFixed(2)} <span className="text-xs font-normal text-gray-500">A</span>
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-gray-50/70 border border-gray-100">
                  <span className="text-[10px] text-gray-500 font-medium block">Power Output</span>
                  <div className="text-xl font-bold text-gray-900 mt-0.5">
                    {swPower.toFixed(1)} <span className="text-xs font-normal text-gray-500">{powerIsMeasured ? 'W' : 'VA'}</span>
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-gray-50/70 border border-gray-100">
                  <span className="text-[10px] text-gray-500 font-medium block">Voltage</span>
                  <div className="text-sm font-bold text-gray-800 mt-0.5">
                    {swVoltage > 0 ? `${swVoltage.toFixed(0)} V` : '--'}
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-gray-50/70 border border-gray-100">
                  <span className="text-[10px] text-gray-500 font-medium block">Power Factor</span>
                  <div className="text-sm font-bold text-gray-800 mt-0.5">
                    {swPF > 0 ? `PF ${swPF.toFixed(2)}` : '--'}
                  </div>
                </div>
              </div>

              <div className="text-[10px] text-gray-400 mt-3 pt-2 border-t border-gray-100">
                Channel: <span className="font-semibold text-gray-600">{activePort.name || selectedPortId}</span> • Mode: <span className="font-semibold text-gray-600">{powerIsMeasured ? 'Real Active Power' : 'Apparent Power'}</span>
              </div>
            </div>

            {/* Right: Physical Multimeter Reference Inputs */}
            <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-100">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Physical Meter (Ground Truth)</span>
                  <span className="text-[10px] font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                    Reference
                  </span>
                </div>

                <div className="space-y-2.5">
                  <div>
                    <label className="text-[10px] font-semibold text-gray-600 uppercase block mb-1">Appliance Name</label>
                    <input 
                      type="text"
                      placeholder="e.g. 100W Incandescent Bulb"
                      value={loadName}
                      onChange={(e) => setLoadName(e.target.value)}
                      className="w-full text-[16px] md:text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:border-maroon-800 focus:ring-1 focus:ring-maroon-800 font-medium"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-semibold text-gray-600 uppercase block mb-1">Meter Current (A)</label>
                      <input 
                        type="number"
                        step="0.01"
                        placeholder="e.g. 0.44"
                        value={refCurrent}
                        onChange={(e) => setRefCurrent(e.target.value)}
                        className="w-full text-[16px] md:text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:border-maroon-800 focus:ring-1 focus:ring-maroon-800 font-bold"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-gray-600 uppercase block mb-1">Meter Volts (V)</label>
                      <input 
                        type="number"
                        step="0.1"
                        placeholder="230.0"
                        value={refVoltage}
                        onChange={(e) => setRefVoltage(e.target.value)}
                        className="w-full text-[16px] md:text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:border-maroon-800 focus:ring-1 focus:ring-maroon-800 font-medium"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Quick Presets tucked neatly inside */}
              <div className="mt-3 pt-2 border-t border-gray-100 flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] text-gray-400 font-medium flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-amber-500" /> Presets:
                </span>
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => handleApplyPreset(p)}
                    className="text-[10px] px-2 py-0.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium transition-colors"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Refined Calculation Banner */}
          <div className="bg-gray-50 border border-gray-200/80 rounded-xl p-3.5 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 w-full sm:w-auto">
              <ShieldCheck className="w-5 h-5 text-gray-500 shrink-0" />
              {errorMetrics.status === 'idle' ? (
                <div className="text-xs text-gray-500 font-medium">
                  {errorMetrics.message}
                </div>
              ) : (
                <div className="text-xs">
                  <span className="text-gray-500">Current Error:</span>{' '}
                  <span className="font-bold text-gray-900">{errorMetrics.currentErrAbs.toFixed(3)} A</span>{' '}
                  <span className="text-gray-500">({errorMetrics.currentErrPct.toFixed(1)}%)</span> •{' '}
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${errorMetrics.badgeClass}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${errorMetrics.dotClass}`}></span>
                    {errorMetrics.rating}
                  </span>
                </div>
              )}
            </div>

            <button
              type="button"
              disabled={!hasInput}
              onClick={handleAddTestPoint}
              className={`w-full sm:w-auto px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all shadow-sm ${
                hasInput 
                  ? 'bg-maroon-800 hover:bg-maroon-900 text-white active:scale-95' 
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              Record Test Point
            </button>
          </div>

          {/* Test Log Table */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                Recorded Test Log ({testLog.length})
              </h3>
              {testLog.length > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyMarkdown}
                    className="flex items-center gap-1 text-[11px] font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 px-2.5 py-1 rounded-md transition-colors"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-gray-500" />}
                    <span>{copied ? 'Copied Markdown' : 'Copy Table'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleClearLog}
                    className="text-[11px] text-gray-400 hover:text-red-600 p-1 transition-colors"
                    title="Clear Log"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            {testLog.length === 0 ? (
              <div className="text-center py-5 border border-dashed border-gray-200 rounded-xl text-xs text-gray-400">
                No data points logged yet. Type your multimeter measurement above and click &ldquo;Record Test Point&rdquo;.
              </div>
            ) : (
              <div className="overflow-x-auto border border-gray-200 rounded-xl">
                <table className="w-full text-left text-xs text-gray-700">
                  <thead className="bg-gray-50 border-b border-gray-200 text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                    <tr>
                      <th className="px-3 py-2">#</th>
                      <th className="px-3 py-2">Time</th>
                      <th className="px-3 py-2">Load / Appliance</th>
                      <th className="px-3 py-2">Port</th>
                      <th className="px-3 py-2">Ref Meter</th>
                      <th className="px-3 py-2">VoltSense</th>
                      <th className="px-3 py-2">Error (%)</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 font-medium">
                    {testLog.map((row, idx) => (
                      <tr key={row.id} className="hover:bg-gray-50/50">
                        <td className="px-3 py-1.5 font-bold text-gray-400">{idx + 1}</td>
                        <td className="px-3 py-1.5 text-gray-400">{row.time}</td>
                        <td className="px-3 py-1.5 font-semibold text-gray-900">{row.load}</td>
                        <td className="px-3 py-1.5 text-gray-500">{row.port}</td>
                        <td className="px-3 py-1.5 font-mono">{row.refCurrent}A</td>
                        <td className="px-3 py-1.5 font-mono">{row.swCurrent}A</td>
                        <td className="px-3 py-1.5 font-bold text-gray-800">{row.currentErrPct}</td>
                        <td className="px-3 py-1.5">
                          <span className={`inline-block px-1.5 py-0.5 text-[9px] font-bold rounded ${
                            row.evaluation === 'High' ? 'bg-emerald-100 text-emerald-800' :
                            row.evaluation === 'Acceptable' ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'
                          }`}>
                            {row.evaluation}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Minimal Footer */}
        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/60 flex items-center justify-between text-[11px] text-gray-400">
          <span>Formula: % Error = |App − Meter| / Meter × 100%</span>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold rounded-lg transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
