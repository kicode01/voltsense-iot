import { useState, useMemo } from 'react';
import { X, FlaskConical, Calculator, Copy, Trash2, Activity, ShieldCheck, Check } from 'lucide-react';

const PRESETS = [
  { name: 'Zero Idle / No Load', current: 0.0, voltage: 230.0, power: 0.0 },
  { name: 'Phone Charger (~15W)', current: 0.08, voltage: 230.0, power: 12.0 },
  { name: '100W Incandescent Bulb', current: 0.435, voltage: 230.0, power: 100.0 },
  { name: 'Electric Stand Fan (~55W)', current: 0.28, voltage: 230.0, power: 55.0 },
  { name: 'Electric Kettle (~1200W)', current: 5.22, voltage: 230.0, power: 1200.0 }
];

export default function SensorValidationModal({ isOpen, onClose, ports = {}, powerIsMeasured = false }) {
  const [selectedPortId, setSelectedPortId] = useState('port_01');
  const [loadName, setLoadName] = useState('100W Incandescent Bulb');
  const [refCurrent, setRefCurrent] = useState('0.44');
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

  // Get active software telemetry based on selected port
  const activePort = ports[selectedPortId] || {};
  const swCurrent = Number(activePort.current_amps || 0);
  const swPower = Number(activePort.power_watts || 0);
  const swVoltage = Number(activePort.voltage || (powerIsMeasured ? 0 : 230));
  const swPF = Number(activePort.power_factor || 0);

  // Parse reference inputs
  const numRefCurrent = parseFloat(refCurrent);
  const numRefVoltage = parseFloat(refVoltage);

  // Calculate error metrics
  const errorMetrics = useMemo(() => {
    const res = { currentErrAbs: 0, currentErrPct: 0, voltErrAbs: 0, voltErrPct: 0, rating: 'Pending' };

    // Current Error
    if (!isNaN(numRefCurrent)) {
      if (numRefCurrent === 0) {
        res.currentErrAbs = Math.abs(swCurrent);
        res.currentErrPct = swCurrent === 0 ? 0 : 100;
      } else {
        res.currentErrAbs = Math.abs(swCurrent - numRefCurrent);
        res.currentErrPct = (res.currentErrAbs / numRefCurrent) * 100;
      }
    }

    // Voltage Error
    if (!isNaN(numRefVoltage) && numRefVoltage > 0 && swVoltage > 0) {
      res.voltErrAbs = Math.abs(swVoltage - numRefVoltage);
      res.voltErrPct = (res.voltErrAbs / numRefVoltage) * 100;
    }

    // Overall Rating
    const evaluatedPct = numRefCurrent > 0 ? res.currentErrPct : res.voltErrPct;
    if (evaluatedPct <= 2.5) {
      res.rating = 'High Precision (< 2.5%)';
      res.color = 'text-emerald-700 bg-emerald-50 border-emerald-200';
    } else if (evaluatedPct <= 5.0) {
      res.rating = 'Standard Acceptable (< 5.0%)';
      res.color = 'text-blue-700 bg-blue-50 border-blue-200';
    } else {
      res.rating = 'Calibration Recommended (> 5.0%)';
      res.color = 'text-amber-700 bg-amber-50 border-amber-200';
    }

    return res;
  }, [swCurrent, swVoltage, numRefCurrent, numRefVoltage]);

  const handleApplyPreset = (preset) => {
    setLoadName(preset.name);
    setRefCurrent(preset.current.toString());
    setRefVoltage(preset.voltage.toString());
  };

  const handleAddTestPoint = () => {
    const newEntry = {
      id: Date.now(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      port: activePort.name || selectedPortId,
      load: loadName.trim() || 'Custom Appliance',
      swCurrent: swCurrent.toFixed(2),
      refCurrent: (!isNaN(numRefCurrent) ? numRefCurrent.toFixed(2) : '--'),
      currentErrPct: (!isNaN(numRefCurrent) && numRefCurrent > 0 ? errorMetrics.currentErrPct.toFixed(1) + '%' : (swCurrent === 0 ? '0.0%' : 'N/A')),
      swVoltage: (swVoltage > 0 ? swVoltage.toFixed(0) : '--'),
      refVoltage: (!isNaN(numRefVoltage) ? numRefVoltage.toFixed(0) : '--'),
      swPower: swPower.toFixed(1) + (powerIsMeasured ? ' W' : ' VA'),
      evaluation: errorMetrics.rating.split(' ')[0]
    };

    const updated = [newEntry, ...testLog];
    setTestLog(updated);
    try {
      localStorage.setItem('voltsense_test_validation_log', JSON.stringify(updated));
    } catch {
      // ignore storage error
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
    let md = '| # | Appliance / Load | Port | Reference (Meter) | VoltSense (App) | Error (%) | Evaluation |\n';
    md += '|---|---|---|---|---|---|---|\n';
    testLog.forEach((row, i) => {
      md += `| ${i + 1} | ${row.load} | ${row.port} | ${row.refCurrent} A (${row.refVoltage} V) | ${row.swCurrent} A (${row.swPower}) | ${row.currentErrPct} | ${row.evaluation} |\n`;
    });

    navigator.clipboard.writeText(md).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="bg-white border border-gray-200 rounded-3xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-gray-100 bg-gray-50/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-maroon-100/80 text-maroon-800 flex items-center justify-center shadow-sm">
              <FlaskConical className="w-5 h-5 text-maroon-800" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-gray-900 leading-tight">Hardware Validation Lab</h2>
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                  Testing Mode
                </span>
              </div>
              <p className="text-xs text-gray-500 font-medium">Verify software telemetry against calibrated physical multimeter readings</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-200/50 rounded-full transition-colors"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body (Scrollable) */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-6">
          {/* Channel Selector */}
          <div>
            <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2">
              Select Output Channel to Validate
            </label>
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {Object.keys(ports).map((pid) => {
                const port = ports[pid];
                const isSelected = selectedPortId === pid;
                return (
                  <button
                    key={pid}
                    type="button"
                    onClick={() => setSelectedPortId(pid)}
                    className={`p-3 rounded-2xl border text-left transition-all ${
                      isSelected 
                        ? 'border-maroon-800 bg-maroon-50/70 text-maroon-900 shadow-sm ring-1 ring-maroon-800' 
                        : 'border-gray-200 bg-white hover:bg-gray-50 text-gray-700'
                    }`}
                  >
                    <div className="text-xs font-bold truncate">{port.name || pid}</div>
                    <div className="text-[11px] text-gray-500 mt-0.5 flex items-center justify-between">
                      <span>{(Number(port.current_amps) || 0).toFixed(2)} A</span>
                      <span className={`w-2 h-2 rounded-full ${port.relay_status ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Quick Presets */}
          <div>
            <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2">
              Quick Reference Load Presets (Optional)
            </label>
            <div className="flex flex-wrap gap-1.5 sm:gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => handleApplyPreset(p)}
                  className="px-2.5 py-1 text-xs font-medium rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          {/* Side-by-Side Comparison Matrix */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Live Software Telemetry */}
            <div className="p-4 rounded-2xl border border-gray-200 bg-gray-50/50 space-y-3">
              <div className="flex items-center justify-between border-b border-gray-200 pb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-gray-700 flex items-center gap-1.5">
                  <Activity className="w-4 h-4 text-maroon-700" /> Live Software Telemetry
                </span>
                <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full animate-pulse">
                  Streaming
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <div className="text-[10px] font-bold text-gray-400 uppercase">Current (ACS712)</div>
                  <div className="text-2xl font-bold text-gray-900">{swCurrent.toFixed(2)} <span className="text-sm font-semibold text-gray-500">A</span></div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-gray-400 uppercase">Power Output</div>
                  <div className="text-2xl font-bold text-gray-900">{swPower.toFixed(1)} <span className="text-sm font-semibold text-gray-500">{powerIsMeasured ? 'W' : 'VA'}</span></div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-gray-400 uppercase">Voltage</div>
                  <div className="text-lg font-bold text-gray-900">{swVoltage > 0 ? `${swVoltage.toFixed(0)} V` : '--'}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-gray-400 uppercase">Power Factor</div>
                  <div className="text-lg font-bold text-gray-900">{swPF > 0 ? `PF ${swPF.toFixed(2)}` : '--'}</div>
                </div>
              </div>
            </div>

            {/* Reference Instrument Input */}
            <div className="p-4 rounded-2xl border border-gray-200 bg-white space-y-3 shadow-sm">
              <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-gray-700 flex items-center gap-1.5">
                  <Calculator className="w-4 h-4 text-blue-600" /> Physical Meter (Ground Truth)
                </span>
                <span className="text-[10px] font-semibold text-blue-600 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
                  User Input
                </span>
              </div>
              <div className="space-y-2.5 pt-1">
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Appliance / Load Name</label>
                  <input
                    type="text"
                    value={loadName}
                    onChange={(e) => setLoadName(e.target.value)}
                    placeholder="e.g. 100W Incandescent Bulb"
                    className="w-full px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-xl focus:outline-none focus:ring-1 focus:ring-maroon-800"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Multimeter Amps (A)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={refCurrent}
                      onChange={(e) => setRefCurrent(e.target.value)}
                      placeholder="0.44"
                      className="w-full px-3 py-1.5 text-xs font-bold border border-gray-300 rounded-xl focus:outline-none focus:ring-1 focus:ring-maroon-800"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Multimeter Volts (V)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={refVoltage}
                      onChange={(e) => setRefVoltage(e.target.value)}
                      placeholder="230.0"
                      className="w-full px-3 py-1.5 text-xs font-bold border border-gray-300 rounded-xl focus:outline-none focus:ring-1 focus:ring-maroon-800"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Real-Time Error Calculation & Evaluation Banner */}
          <div className={`p-4 rounded-2xl border flex flex-col sm:flex-row items-center justify-between gap-3 ${errorMetrics.color || 'bg-gray-50 border-gray-200 text-gray-800'}`}>
            <div className="flex items-center gap-3">
              <ShieldCheck className="w-6 h-6 shrink-0" />
              <div>
                <div className="text-xs font-bold uppercase tracking-wider">Calculated Accuracy Evaluation</div>
                <div className="text-sm font-semibold">
                  Current Error: <span className="font-bold">{errorMetrics.currentErrAbs.toFixed(3)} A</span> ({errorMetrics.currentErrPct.toFixed(1)}%) • Rating: <span className="font-bold">{errorMetrics.rating}</span>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={handleAddTestPoint}
              className="w-full sm:w-auto px-4 py-2 bg-maroon-800 hover:bg-maroon-900 text-white text-xs font-bold uppercase tracking-wider rounded-xl transition-all shadow-sm active:scale-95 shrink-0"
            >
              Record Test Point
            </button>
          </div>

          {/* Verification Table (For Defense & Reports) */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold text-gray-700 uppercase tracking-widest flex items-center gap-2">
                Recorded Test Log ({testLog.length} Points)
              </h3>
              <div className="flex items-center gap-2">
                {testLog.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={handleCopyMarkdown}
                      className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                      title="Copy Markdown Table for Presentation/Document"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copied ? 'Copied Table!' : 'Copy Table'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleClearLog}
                      className="p-1 text-gray-400 hover:text-red-600 rounded-lg transition-colors"
                      title="Clear Table"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>
            </div>

            {testLog.length === 0 ? (
              <div className="text-center py-6 border border-dashed border-gray-200 rounded-2xl text-xs text-gray-400">
                No test points recorded yet. Select an outlet, set your reference meter values, and click &ldquo;Record Test Point&rdquo;.
              </div>
            ) : (
              <div className="overflow-x-auto border border-gray-200 rounded-2xl">
                <table className="w-full text-left text-xs text-gray-700">
                  <thead className="bg-gray-50 border-b border-gray-200 text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                    <tr>
                      <th className="px-3 py-2">#</th>
                      <th className="px-3 py-2">Time</th>
                      <th className="px-3 py-2">Appliance / Load</th>
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
                        <td className="px-3 py-2 font-bold text-gray-400">{idx + 1}</td>
                        <td className="px-3 py-2 text-gray-400">{row.time}</td>
                        <td className="px-3 py-2 font-bold text-gray-900">{row.load}</td>
                        <td className="px-3 py-2">{row.port}</td>
                        <td className="px-3 py-2">{row.refCurrent} A</td>
                        <td className="px-3 py-2">{row.swCurrent} A <span className="text-[10px] text-gray-400">({row.swPower})</span></td>
                        <td className="px-3 py-2 font-bold text-gray-800">{row.currentErrPct}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-block px-2 py-0.5 text-[10px] font-bold rounded-full ${
                            row.evaluation === 'High' ? 'bg-emerald-100 text-emerald-800' :
                            row.evaluation === 'Standard' ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'
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

        {/* Modal Footer */}
        <div className="p-3 sm:p-4 border-t border-gray-100 bg-gray-50 flex items-center justify-between text-xs text-gray-500">
          <span>Formula: % Error = |App − Meter| / Meter × 100%</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold rounded-xl transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
