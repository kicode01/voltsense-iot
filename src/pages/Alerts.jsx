import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Bell,
  BellOff,
  CheckCheck,
  TriangleAlert,
  Power,
  Loader2,
  Timer,
  Zap
} from 'lucide-react';
import { useDeviceContext } from '../contexts/deviceContextCore';
import { useAlerts } from '../hooks/useAlerts';

const getAlertDetails = (alert) => {
  const tag = (alert?.tag || '').toLowerCase();
  const title = (alert?.title || '').toLowerCase();
  const body = (alert?.body || '').toLowerCase();

  // Strip leading emojis
  const cleanRawTitle = (alert?.title || '')
    .replace(/^[\s\p{Extended_Pictographic}\uFE0F]+/u, '')
    .trim();

  // Determine concise title based on content without repeating "VoltSense Alert"
  let resolvedTitle = cleanRawTitle;
  if (!cleanRawTitle || cleanRawTitle.toLowerCase() === 'voltsense alert') {
    if (tag.includes('shutdown') || body.includes('shut down') || body.includes('empty')) {
      resolvedTitle = 'Auto-Shutdown Warning';
    } else if (tag.includes('overcurrent') || body.includes('current')) {
      resolvedTitle = 'Overcurrent Trip';
    } else {
      resolvedTitle = 'System Notice';
    }
  }

  if (tag.includes('overcurrent') || title.includes('overcurrent') || body.includes('overcurrent')) {
    return {
      title: resolvedTitle,
      Icon: Zap,
      iconWrapClass: 'bg-maroon-50 text-maroon-800 border-maroon-200 shadow-inner'
    };
  }

  if (tag.includes('shutdown') || tag.includes('inactivity') || body.includes('shut down') || body.includes('empty')) {
    return {
      title: resolvedTitle,
      Icon: Timer,
      iconWrapClass: 'bg-maroon-50/50 text-maroon-700 border-maroon-100 shadow-inner'
    };
  }

  if (tag.includes('power') || title.includes('power')) {
    return {
      title: resolvedTitle,
      Icon: Power,
      iconWrapClass: 'bg-maroon-50/50 text-maroon-700 border-maroon-100 shadow-inner'
    };
  }

  return {
    title: resolvedTitle,
    Icon: Bell,
    iconWrapClass: 'bg-gray-100/80 text-gray-400 border-gray-200/80 shadow-inner'
  };
};

const formatTimeOnly = (ms) => {
  if (!ms) return '';
  const date = new Date(ms);
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};

const formatShortDate = (ms) => {
  if (!ms) return '—';
  const date = new Date(ms);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) return 'Today';

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();
  if (isYesterday) return 'Yesterday';

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

// Outcome schema contract preserved for client-server telemetry verification
const OUTCOME = {
  sent: {
    label: 'Delivered'
  },
  partial: {
    label: 'Partial'
  },
  failed: {
    label: 'Failed'
  },
  skipped: {
    label: 'Logged only'
  },
  unknown: {
    label: 'Recorded'
  }
};
void OUTCOME;

const Alerts = () => {
  const { activeDeviceId, devicesLoading, userId } = useDeviceContext();
  const { alerts, loading, error, unreadCount, lastSeenId, markAllSeen } = useAlerts(
    activeDeviceId,
    userId
  );

  // Opening the tab is the act of reading it. Marking is idempotent, so this is safe to run on
  // every arrival; the hook skips the write when the marker is already current.
  useEffect(() => {
    if (!loading && unreadCount > 0) {
      markAllSeen();
    }
  }, [loading, unreadCount, markAllSeen]);

  const [filter, setFilter] = useState('all');

  const filteredAlerts = useMemo(() => {
    if (filter === 'all') return alerts;
    return alerts.filter((alert) => {
      const tag = (alert?.tag || '').toLowerCase();
      const title = (alert?.title || '').toLowerCase();
      const body = (alert?.body || '').toLowerCase();
      if (filter === 'shutdown') {
        return tag.includes('shutdown') || tag.includes('inactivity') || body.includes('shut down') || body.includes('empty');
      }
      if (filter === 'overcurrent') {
        return tag.includes('overcurrent') || title.includes('overcurrent') || body.includes('current');
      }
      return true;
    });
  }, [alerts, filter]);

  const busy = devicesLoading || loading;

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header card — same shell as Analytics/Settings so the three pages feel like one product. */}
      <div className="alerts-header flex items-center justify-between bg-white/90 backdrop-blur-xl p-4 md:p-6 rounded-3xl border border-white/20 shadow-[0_8px_30px_rgb(0,0,0,0.04)] gap-2">
        <div className="min-w-0 pr-2">
          <h2 className="text-lg md:text-xl font-bold text-gray-900 tracking-tight leading-tight truncate">Alerts</h2>
          <p className="text-gray-500 text-[10px] md:text-sm font-medium mt-0.5 leading-tight truncate">
            {busy
              ? 'Loading the alert history…'
              : alerts.length === 0
                ? 'Nothing recorded yet'
                : `${alerts.length} recorded · newest first`}
          </p>
        </div>

        {unreadCount > 0 && !busy && (
          <button
            onClick={markAllSeen}
            className="flex items-center gap-1.5 bg-gray-50 text-gray-700 px-3 md:px-4 py-2 md:py-2.5 rounded-xl md:rounded-2xl border border-gray-100 text-[10px] md:text-sm font-bold uppercase tracking-wider hover:bg-white hover:shadow-md transition-all duration-300 ease-out focus:outline-none focus:ring-2 focus:ring-maroon-50"
          >
            <CheckCheck className="w-3.5 h-3.5 md:w-4 md:h-4 text-maroon-800" />
            Mark all read
          </button>
        )}
      </div>

      {/* No device paired — the hook has nothing to subscribe to. Show a representative alert so
          the user can see what an entry will look like, instead of three empty cards. */}
      {!busy && !activeDeviceId && (
        <div className="mt-6">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2 px-1">
            Preview · what an alert looks like
          </p>
          <div className="rounded-2xl border border-gray-100 bg-white shadow-sm p-3.5 md:p-4 flex items-start gap-3">
            <div className="w-9 h-9 rounded-2xl bg-maroon-50/50 text-maroon-700 border border-maroon-100 shadow-inner flex items-center justify-center shrink-0">
              <Timer className="w-4 h-4" strokeWidth={1.5} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-2 min-w-0">
                  <h3 className="text-xs md:text-sm font-bold text-gray-900 truncate">
                    Auto-Shutdown Warning
                  </h3>
                </div>
                <span className="text-[11px] font-semibold text-gray-500 tabular-nums shrink-0">
                  Today · Just now
                </span>
              </div>
              <p className="text-xs text-gray-600 leading-relaxed break-words">
                The lounge has been unoccupied for 15 minutes. Power will shut off in 5 minutes unless you tap Keep Power On.
              </p>
            </div>
          </div>
          <div className="rounded-3xl bg-white/60 border border-gray-200/70 p-6 mt-3 text-center">
            <BellOff className="w-7 h-7 text-gray-300 mx-auto mb-2" />
            <h3 className="text-sm font-bold text-gray-800">No device paired yet</h3>
            <p className="text-xs text-gray-500 mt-1 max-w-xs mx-auto">
              Alerts are recorded the moment your VoltSense has something to say. Pair one in
              Settings to see live entries here.
            </p>
            <Link
              to="/settings"
              className="inline-block mt-4 px-5 py-2.5 rounded-2xl bg-maroon-800 text-white text-xs font-bold hover:bg-maroon-900 transition-colors"
            >
              Go to Settings
            </Link>
          </div>
        </div>
      )}

      {error && !busy && (
        <div className="rounded-3xl bg-red-50 border border-red-200/70 p-6 mt-6">
          <h2 className="text-sm font-bold text-red-800 flex items-center gap-2">
            <TriangleAlert className="w-4 h-4" />
            Could not read the alert history
          </h2>
          <p className="text-xs text-red-700/80 mt-1 break-words">
            {String(error?.message || error)}
          </p>
        </div>
      )}

      {busy && (
        <div className="mt-6 flex items-center justify-center min-h-[40vh]">
          <Loader2 className="w-8 h-8 text-maroon-800 animate-spin" />
        </div>
      )}

      {!busy && activeDeviceId && alerts.length === 0 && !error && (
        <div className="rounded-3xl bg-white border border-gray-200/70 p-10 text-center mt-6">
          <div className="w-14 h-14 rounded-2xl bg-gray-50 flex items-center justify-center mx-auto mb-4">
            <Bell className="w-6 h-6 text-gray-300" />
          </div>
          <h2 className="text-sm font-bold text-gray-800">No alerts yet</h2>
          <p className="text-xs text-gray-500 mt-1 max-w-xs mx-auto">
            When the device trips an alert — inactivity, a port left on, a power incident — it is
            recorded here, whether or not a notification reached your phone.
          </p>
        </div>
      )}

      {/* Unified Event Log Table */}
      {!busy && alerts.length > 0 && (
        <div className="bg-white p-4 md:p-6 rounded-3xl border border-gray-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)] mt-6">
          {/* Table Header + Segmented Category Filter */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-base md:text-lg font-bold text-gray-900">System Event Log</h3>
              <p className="text-xs text-gray-500 font-medium">
                {filteredAlerts.length} {filteredAlerts.length === 1 ? 'entry' : 'entries'} shown · newest first
              </p>
            </div>
            <div className="flex items-center gap-1 bg-[#f2eeed] p-1 rounded-xl border border-gray-300/60 shadow-[inset_0_1.5px_3px_rgba(0,0,0,0.08)] self-start sm:self-auto overflow-x-auto max-w-full no-scrollbar">
              {[
                { id: 'all', label: `All (${alerts.length})` },
                { id: 'shutdown', label: 'Shutdown' },
                { id: 'overcurrent', label: 'Overcurrent' },
              ].map((item) => (
                <button
                  key={item.id}
                  onClick={() => setFilter(item.id)}
                  className={`px-2.5 md:px-3 py-1.5 rounded-lg text-[10px] md:text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap shrink-0 ${
                    filter === item.id
                      ? 'bg-maroon-800 text-white shadow-[0_1px_2px_rgba(0,0,0,0.2)]'
                      : 'text-gray-500 hover:text-gray-900'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {filteredAlerts.length === 0 ? (
            <div className="rounded-2xl border border-gray-100 bg-gray-50/40 p-8 text-center">
              <p className="text-xs text-gray-500 font-medium">No alerts match the selected category filter.</p>
              <button
                onClick={() => setFilter('all')}
                className="mt-2.5 text-xs font-bold text-maroon-800 underline hover:text-maroon-900"
              >
                Show all alerts
              </button>
            </div>
          ) : (
            <div className="rounded-2xl border border-gray-100 overflow-hidden">
              {/* Mobile Compact Stacked Log Rows (No horizontal scroll) */}
              <div className="md:hidden divide-y divide-gray-100 max-h-[620px] overflow-y-auto custom-scrollbar">
                {filteredAlerts.map((alert) => {
                  const details = getAlertDetails(alert);
                  const { Icon: AlertIcon } = details;
                  const isUnread =
                    lastSeenId === null || (lastSeenId !== undefined && alert.at > lastSeenId);

                  return (
                    <div
                      key={alert.id}
                      className={`p-3.5 transition-colors ${
                        isUnread ? 'bg-maroon-50/20' : 'bg-white hover:bg-gray-50/60'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className={`w-8 h-8 rounded-2xl flex items-center justify-center shrink-0 border ${details.iconWrapClass}`}
                          >
                            <AlertIcon className="w-4 h-4" strokeWidth={1.5} />
                          </span>
                          <span className="font-bold text-gray-900 text-xs truncate">
                            {details.title}
                          </span>
                          {isUnread && (
                            <span className="w-1.5 h-1.5 rounded-full bg-maroon-700 shrink-0" />
                          )}
                        </div>
                        <span className="text-[11px] font-semibold text-gray-500 tabular-nums shrink-0">
                          {formatShortDate(alert.at)} · {formatTimeOnly(alert.at)}
                        </span>
                      </div>

                      <p className="text-xs text-gray-600 leading-relaxed break-words pl-10">
                        {alert.body}
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* Desktop Structured Table View */}
              <div className="hidden md:block max-h-[620px] overflow-y-auto custom-scrollbar">
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 z-10 bg-gray-50/95 backdrop-blur-xs">
                    <tr className="border-b border-gray-100 text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
                      <th className="py-3 px-4 w-[240px]">Event</th>
                      <th className="py-3 px-4">Details</th>
                      <th className="py-3 px-4 text-right w-[160px]">Date & Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-xs md:text-sm">
                    {filteredAlerts.map((alert) => {
                      const details = getAlertDetails(alert);
                      const { Icon: AlertIcon } = details;
                      const isUnread =
                        lastSeenId === null || (lastSeenId !== undefined && alert.at > lastSeenId);

                      return (
                        <tr
                          key={alert.id}
                          className={`transition-colors ${
                            isUnread
                              ? 'bg-maroon-50/20 hover:bg-maroon-50/35'
                              : 'hover:bg-maroon-50/15'
                          }`}
                        >
                          {/* Event Column */}
                          <td className="py-3.5 px-4 align-middle">
                            <div className="flex items-center gap-3">
                              <span
                                className={`w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 border ${details.iconWrapClass}`}
                              >
                                <AlertIcon className="w-4 h-4" strokeWidth={1.5} />
                              </span>
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="font-bold text-gray-900 text-xs md:text-sm leading-snug">
                                  {details.title}
                                </span>
                                {isUnread && (
                                  <span
                                    className="w-2 h-2 rounded-full bg-maroon-700 shrink-0"
                                    title="Unread"
                                  />
                                )}
                              </div>
                            </div>
                          </td>

                          {/* Details / Message Column */}
                          <td className="py-3.5 px-4 align-middle text-xs md:text-sm text-gray-600 leading-relaxed max-w-2xl break-words">
                            {alert.body}
                          </td>

                          {/* Timestamp Column */}
                          <td className="py-3.5 px-4 align-middle text-right whitespace-nowrap">
                            <div className="font-bold text-gray-800 text-xs tabular-nums">
                              {formatShortDate(alert.at)}
                            </div>
                            <div className="text-[11px] font-medium text-gray-400 tabular-nums mt-0.5">
                              {formatTimeOnly(alert.at)}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <p className="text-[10px] text-gray-400 text-center pt-4">
            The newest 200 alerts are kept. Older entries are removed automatically.
          </p>
        </div>
      )}
    </div>
  );
};

export default Alerts;
