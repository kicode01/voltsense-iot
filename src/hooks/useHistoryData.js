import { useState, useEffect } from 'react';
import { ref, onValue } from 'firebase/database';
import { db } from '../lib/firebase';

export const generateMockData = (range) => {
  if (range === 'Today' || range === 'Yesterday') {
    return {
      totals: { energy: range === 'Today' ? 3.2 : 4.1, hours: range === 'Today' ? 8.5 : 14.2 },
      energy: [
        { label: "00:00", kwh: 0.1 }, { label: "04:00", kwh: 0.2 }, { label: "08:00", kwh: 0.8 },
        { label: "12:00", kwh: 1.2 }, { label: "16:00", kwh: 0.5 }, { label: "20:00", kwh: 0.4 }
      ],
      occupancy: [
        { label: "00:00", occupied: 0 }, { label: "04:00", occupied: 0 }, { label: "08:00", occupied: 1 },
        { label: "12:00", occupied: 1 }, { label: "16:00", occupied: 1 }, { label: "20:00", occupied: 0 }
      ],
      usage: [
        { name: "Workstation", percentage: 80 }, { name: "Appliance", percentage: 10 }, { name: "Light", percentage: 10 }
      ],
      alerts: [
        { time: '08:30 AM', message: 'Workstation powered on', port: 'port_02' }
      ]
    };
  } else if (range === 'This Month' || range.includes('/')) {
    let numDays = 30;
    let startLabel = 1;
    
    // Parse the custom date range string to determine exact number of days
    if (range.includes('-') && range.includes('/')) {
      const parts = range.replace('Custom: ', '').split(' - ');
      if (parts.length === 2) {
        const parseDate = (str) => {
          const [m, d, y] = str.split('/');
          return new Date(`20${y}-${m}-${d}T00:00:00`);
        };
        const startDate = parseDate(parts[0]);
        const endDate = parseDate(parts[1]);
        // `isNaN(someDate)` works only by accident: isNaN coerces its argument with Number(), and a
        // Date's valueOf() is its timestamp — so an Invalid Date (NaN time) does compare as NaN. That
        // is the intent, but it is not what the call reads as. `isNaN(x.getTime())` says it directly.
        if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
          // Compare via getTime(). `endDate - startDate` does work — Dates coerce to numbers under
          // `-` — but it is the kind of implicit coercion that reads as a bug (the same expression
          // with `+` would concatenate two date STRINGS). Being explicit costs nothing.
          const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
          numDays = Math.min(Math.max(1, diffDays), 30);
          startLabel = startDate.getDate();
        }
      }
    }

    // Generate dynamic days of data
    const energyData = Array.from({ length: numDays }).map((_, i) => ({
      label: `${(startLabel + i - 1) % 31 + 1}`,
      kwh: Number((Math.random() * (2.5 - 1.0) + 1.0).toFixed(1))
    }));
    
    const occupancyData = Array.from({ length: numDays }).map((_, i) => ({
      label: `${(startLabel + i - 1) % 31 + 1}`,
      occupied: Math.random() > 0.3 ? 1 : 0
    }));

    const totalEnergy = energyData.reduce((sum, day) => sum + day.kwh, 0).toFixed(1);

    return {
      totals: { energy: Number(totalEnergy), hours: 180.5 },
      energy: energyData,
      occupancy: occupancyData,
      usage: [
        { name: "Appliance", percentage: 40 }, { name: "Workstation", percentage: 35 }, { name: "Light", percentage: 25 }
      ],
      alerts: [
        { time: 'Oct 12', message: 'High energy usage detected', port: 'system' }
      ]
    };
  }
  
  // Last 7 Days (fallback)
  return {
    totals: { energy: 12.4, hours: 48.5 },
    energy: [
      { label: "Mon", kwh: 1.2 }, { label: "Tue", kwh: 1.8 }, { label: "Wed", kwh: 1.5 },
      { label: "Thu", kwh: 2.1 }, { label: "Fri", kwh: 1.9 }, { label: "Sat", kwh: 2.5 }, { label: "Sun", kwh: 1.4 }
    ],
    occupancy: [
      { label: "Mon", occupied: 0 }, { label: "Tue", occupied: 1 }, { label: "Wed", occupied: 1 },
      { label: "Thu", occupied: 0 }, { label: "Fri", occupied: 1 }, { label: "Sat", occupied: 1 }, { label: "Sun", occupied: 1 }
    ],
    usage: [
      { name: "Workstation", percentage: 65 }, { name: "Appliance", percentage: 20 }, { name: "Light", percentage: 15 }
    ],
    alerts: [
      { time: '10:30 AM', message: 'Workstation usage spiked', port: 'port_02' },
      { time: 'Yesterday', message: 'Night mode activated', port: 'system' }
    ]
  };
};

/**
 * Maps a UI time-range label to a Firebase-safe history key.
 *
 * Firebase RTDB keys may not contain `. # $ [ ] /` — and a `/` silently creates a NESTED path
 * instead of erroring, so a naive `toLowerCase().replace(/ /g,'_')` on "Custom: 10/01/25 - 10/15/25"
 * would read from `devices/X/history/custom:_10/01/25_-_10/15/25` (six levels deep) and always
 * come back empty.
 *
 * NOTE: the firmware never writes a `custom_*` key — it cannot anticipate which range a user will
 * pick. Custom ranges are composed on the client from `history/days` instead; see
 * `composeCustomRange()` below. This function still produces the canonical custom key because it is
 * the stable identifier used elsewhere, but nothing reads that node.
 */
export const toHistoryKey = (timeRange) => {
  const raw = String(timeRange || '').trim();
  if (!raw) return 'today';

  const lower = raw.toLowerCase();
  if (lower === 'today') return 'today';
  if (lower === 'yesterday') return 'yesterday';
  if (lower === 'last 7 days') return 'last_7_days';
  if (lower === 'this month') return 'this_month';

  // Custom range: "Custom: 10/01/25 - 10/15/25" -> "custom_20251001_20251015"
  const parsed = parseCustomRange(raw);
  if (parsed) {
    const pad = (n) => String(n).padStart(2, '0');
    return `custom_${parsed.startY}${pad(parsed.startM)}${pad(parsed.startD)}_${parsed.endY}${pad(parsed.endM)}${pad(parsed.endD)}`;
  }

  // Fallback: collapse everything Firebase rejects into single underscores.
  return lower.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'today';
};

/**
 * Parse a custom-range label into numbered parts.
 *
 * Accepts "Custom: 10/01/25 - 10/15/25" and the bare "10/01/25 - 10/15/25" the picker also
 * produces. Two-digit years are assumed to be 2000s, matching the picker's own formatting.
 *
 * Returns null when the string is not a range, so callers can fall through.
 */
export const parseCustomRange = (timeRange) => {
  const raw = String(timeRange || '').trim();
  const match = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!match) return null;

  const normYear = (y) => (y.length === 2 ? `20${y}` : y);
  const [, m1, d1, y1, m2, d2, y2] = match;
  const pad = (n) => String(n).padStart(2, '0');

  const startISO = `${normYear(y1)}-${pad(m1)}-${pad(d1)}`;
  const endISO = `${normYear(y2)}-${pad(m2)}-${pad(d2)}`;

  // Local-time parsing, never `new Date('2026-10-05')` — that is UTC midnight and lands on the
  // previous day west of UTC, which would shift every range by one.
  const start = new Date(`${startISO}T00:00:00`);
  const end = new Date(`${endISO}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  if (end < start) return null;

  return {
    startISO, endISO, start, end,
    startY: normYear(y1), startM: pad(m1), startD: pad(d1),
    endY: normYear(y2), endM: pad(m2), endD: pad(d2)
  };
};

/**
 * Build a range payload from the device's raw daily records.
 *
 * The device publishes `history/days/<YYYY-MM-DD> = { e, m, p }` (see `publishDailyRecords()` in
 * the firmware) precisely so the client can answer a question the firmware cannot anticipate. This
 * walks the requested span in chronological order and emits the same shape the fixed ranges use, so
 * the charts need no special case.
 *
 * Days with no record are emitted as zero rather than skipped: a gap in the chart is far more
 * confusing than a flat zero, and skipping would silently compress the x-axis and misalign the
 * occupancy overlay.
 *
 * `maxDays` caps the span at the retention window (31 days on the device) — asking for more would
 * produce a chart of mostly-zeros that misrepresents the data as "no usage" rather than "not kept".
 */
export const composeCustomRange = (days, parsed, maxDays = 31) => {
  const empty = { totals: { energy: 0, hours: 0 }, energy: [], occupancy: [], usage: [], alerts: [] };
  if (!days || !parsed) return empty;

  const label = (d) => `${d.getDate()}/${d.getMonth() + 1}`;

  const energy = [];
  const occupancy = [];
  let totalEnergy = 0;
  let totalHours = 0;

  const cursor = new Date(parsed.start);
  let emitted = 0;

  while (cursor <= parsed.end && emitted < maxDays) {
    const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
    const rec = days[iso];
    // `Number()` because RTDB can hand back a numeric string, and `??` rather than `||` because 0
    // is a meaningful value here (a day with no usage is not the same as a missing day).
    const kwh = Number(rec?.e ?? 0) || 0;
    const minutes = Number(rec?.m ?? 0) || 0;

    energy.push({ label: label(cursor), kwh });
    occupancy.push({ label: label(cursor), occupied: minutes > 0 ? 1 : 0 });

    totalEnergy += kwh;
    totalHours += minutes / 60;

    cursor.setDate(cursor.getDate() + 1);
    emitted++;
  }

  return {
    totals: { energy: Number(totalEnergy.toFixed(3)), hours: Number(totalHours.toFixed(2)) },
    energy,
    occupancy,
    // Per-port breakdown is not recorded per-day on the device (only whole-room kWh), so this stays
    // empty rather than being invented. The chart renders its empty state honestly.
    usage: [],
    alerts: []
  };
};

export const useHistoryData = (roomId, timeRange) => {
  const [historyData, setHistoryData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!roomId) {
      setHistoryData(null);
      setLoading(false);
      return;
    }

    // Re-entering a loading state matters: without it the chart shows the PREVIOUS range's data
    // until the new snapshot lands, which reads as "the range switch did nothing".
    setLoading(true);

    // Custom ranges read `history/days` (the raw per-day records) and are composed here, because the
    // firmware cannot know in advance which range the user will pick. Everything else reads its own
    // pre-built node. See composeCustomRange() for why the composition is client-side.
    const custom = parseCustomRange(timeRange);
    const rangeKey = custom ? 'days' : toHistoryKey(timeRange);
    const historyRef = ref(db, `devices/${roomId}/history/${rangeKey}`);

    const unsubscribeDb = onValue(historyRef, (snapshot) => {
      const emptyData = {
        totals: { energy: 0, hours: 0 },
        energy: [],
        occupancy: [],
        usage: [],
        alerts: []
      };

      if (custom) {
        // A missing node is a legitimate state (a device that has not published since the firmware
        // update), and composeCustomRange handles it by returning the empty shape. That is the
        // honest answer: this range has no recorded data, rather than an error.
        setHistoryData(composeCustomRange(snapshot.val(), custom));
        setLoading(false);
        return;
      }

      if (snapshot.exists()) {
        const data = snapshot.val();
        setHistoryData({
          energy: data.energy || emptyData.energy,
          occupancy: data.occupancy || emptyData.occupancy,
          totals: data.totals || emptyData.totals,
          usage: data.usage || emptyData.usage,
          alerts: data.alerts || emptyData.alerts
        });
      } else {
        setHistoryData(emptyData);
      }
      setLoading(false);
    }, (error) => {
      console.error("Firebase error fetching history:", error);
      setHistoryData({
        totals: { energy: 0, hours: 0 },
        energy: [], occupancy: [], usage: [], alerts: []
      });
      setLoading(false);
    });

    return () => unsubscribeDb();
  }, [roomId, timeRange]);

  return { historyData, loading };
};
