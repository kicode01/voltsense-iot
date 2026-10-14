import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Bell,
  BellOff,
  CheckCheck,
  TriangleAlert,
  CircleCheck,
  CircleSlash,
  CircleAlert,
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
    return { title: resolvedTitle, Icon: Zap };
  }

  if (tag.includes('shutdown') || tag.includes('inactivity') || body.includes('shut down') || body.includes('empty')) {
    return { title: resolvedTitle, Icon: Timer };
  }

  if (tag.includes('power') || title.includes('power')) {
    return { title: resolvedTitle, Icon: Power };
  }

  return { title: resolvedTitle, Icon: Bell };
};

const formatTimeOnly = (ms) => {
  if (!ms) return '';
  const date = new Date(ms);
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};

// Outcome describes what the SERVER managed to do, not what the alert means. A history that said
// "delivered" for an alert nobody received would be worse than no history at all, so the badge is
// shown on every row, including the failures.
const OUTCOME = {
  sent: {
    label: 'Delivered',
    Icon: CircleCheck,
    className: 'bg-emerald-50 text-emerald-700 border-emerald-200/70'
  },
  partial: {
    label: 'Partly delivered',
    Icon: CircleAlert,
    className: 'bg-amber-50 text-amber-700 border-amber-200/70'
  },
  failed: {
    label: 'Not delivered',
    Icon: CircleSlash,
    className: 'bg-red-50 text-red-700 border-red-200/70'
  },
  skipped: {
    label: 'No recipients',
    Icon: BellOff,
    className: 'bg-gray-100 text-gray-600 border-gray-200'
  },
  unknown: {
    label: 'Recorded',
    Icon: CircleAlert,
    className: 'bg-gray-100 text-gray-600 border-gray-200'
  }
};

const formatStamp = (ms) => {
  if (!ms) return '';
  const date = new Date(ms);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  if (sameDay) return `Today, ${time}`;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();

  if (isYesterday) return `Yesterday, ${time}`;

  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
};

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
      if (filter === 'system') {
        return !tag.includes('shutdown') && !tag.includes('inactivity') && !body.includes('shut down') && !body.includes('empty') && !tag.includes('overcurrent') && !title.includes('overcurrent') && !body.includes('current');
      }
      return true;
    });
  }, [alerts, filter]);

  const grouped = useMemo(() => {
    const groups = [];
    let current = null;

    filteredAlerts.forEach((alert) => {
      const day = alert.at ? new Date(alert.at).toDateString() : 'Unknown date';
      if (!current || current.day !== day) {
        current = { day, label: formatStamp(alert.at).split(',')[0] || 'Unknown date', items: [] };
        groups.push(current);
      }
      current.items.push(alert);
    });

    return groups;
  }, [filteredAlerts]);

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

      {/* Category Filter Pills */}
      {!busy && alerts.length > 0 && (
        <div className="flex items-center gap-2 mt-4 overflow-x-auto pb-1 no-scrollbar">
          {[
            { id: 'all', label: `All (${alerts.length})` },
            { id: 'shutdown', label: 'Auto-Shutdown' },
            { id: 'overcurrent', label: 'Overcurrent' },
            { id: 'system', label: 'System Notice' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setFilter(item.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-300 whitespace-nowrap shrink-0 ${
                filter === item.id
                  ? 'bg-maroon-800 text-white shadow-sm'
                  : 'bg-white/80 text-gray-500 hover:text-gray-900 border border-gray-100 hover:bg-white'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      {/* No device paired — the hook has nothing to subscribe to. Show a representative alert so
          the user can see what an entry will look like, instead of three empty cards. */}
      {!busy && !activeDeviceId && (
        <div className="mt-6">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2 px-1">
            Preview · what an alert looks like
          </p>
          <article className="rounded-2xl border bg-white border-maroon-100 shadow-sm p-4 md:p-5 flex items-start gap-3.5 md:gap-4">
            <div className="w-10 h-10 md:w-11 md:h-11 rounded-2xl bg-maroon-50 text-maroon-800 border border-maroon-100 flex items-center justify-center shrink-0 shadow-sm">
              <Timer className="w-5 h-5 text-maroon-800" strokeWidth={1.75} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 mb-1">
                <div className="flex items-center gap-2 min-w-0">
                  <h3 className="text-sm md:text-base font-bold text-gray-900 truncate">
                    Room Became Empty
                  </h3>
                  <span className="w-2 h-2 rounded-full bg-maroon-600 shrink-0" />
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] font-medium text-gray-400">Just now</span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 text-[10px] font-bold">
                    <CircleCheck className="w-3 h-3" />
                    Delivered
                  </span>
                </div>
              </div>
              <p className="text-xs md:text-sm text-gray-600 leading-relaxed break-words">
                The lounge has been unoccupied for 15 minutes. Power will shut off in 5 minutes unless you tap Keep Power On.
              </p>
            </div>
          </article>
          <div className="rounded-3xl bg-white/60 border border-gray-200/70 p-6 mt-3 text-center">
            <BellOff className="w-7 h-7 text-gray-300 mx-auto mb-2" />
            <h3 className="text-sm font-bold text-gray-800">No device paired yet</h3>
            <p className="text-xs text-gray-500 mt-1 max-w-xs mx-auto">
              Alerts are recorded the moment your VoltSense has something to say. Pair one in
              Settings to see live entries here.
            </p>
            <Link
              to="/settings"
              className="inline-block px-5 py-2.5 rounded-2xl bg-maroon-800 text-white text-xs font-bold hover:bg-maroon-900 transition-colors"
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

      {!busy && grouped.length > 0 && (
        <div className="space-y-6 mt-6">
          {grouped.map((group) => (
            <section key={group.day}>
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2 px-1">
                {group.label}
              </h2>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {group.items.map((alert) => {
                  const meta = OUTCOME[alert.outcome] || OUTCOME.unknown;
                  const { Icon: OutcomeIcon } = meta;
                  const details = getAlertDetails(alert);
                  const { Icon: AlertIcon } = details;
                  const isUnread =
                    lastSeenId === null || (lastSeenId !== undefined && alert.at > lastSeenId);

                  return (
                    <article
                      key={alert.id}
                      className={`rounded-2xl border p-4 md:p-5 transition-all duration-300 ease-apple-spring flex items-start gap-3.5 md:gap-4 ${
                        isUnread
                          ? 'bg-white border-maroon-200/80 shadow-[0_4px_20px_rgb(128,0,0,0.04)]'
                          : 'bg-white/70 backdrop-blur-md border-white/60 hover:border-gray-200 shadow-sm'
                      }`}
                    >
                      {/* Clean themed icon on the left */}
                      <div
                        className={`w-10 h-10 md:w-11 md:h-11 rounded-2xl flex items-center justify-center shrink-0 border ${
                          isUnread
                            ? 'bg-maroon-50 text-maroon-800 border-maroon-100 shadow-sm'
                            : 'bg-gray-50 text-gray-400 border-gray-100'
                        }`}
                      >
                        <AlertIcon
                          className={`w-5 h-5 ${isUnread ? 'text-maroon-800' : 'text-gray-500'}`}
                          strokeWidth={1.75}
                        />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 mb-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <h3 className="text-sm md:text-base font-bold text-gray-900 truncate">
                              {details.title}
                            </h3>
                            {isUnread && (
                              <span className="w-2 h-2 rounded-full bg-maroon-600 shrink-0" />
                            )}
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[11px] font-medium text-gray-400">
                              {formatTimeOnly(alert.at)}
                            </span>
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold ${meta.className}`}
                            >
                              <OutcomeIcon className="w-3 h-3" />
                              {meta.label}
                            </span>
                          </div>
                        </div>

                        <p className="text-xs md:text-sm text-gray-600 leading-relaxed break-words">
                          {alert.body}
                        </p>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}

          <p className="text-[10px] text-gray-400 text-center pt-2 px-4">
            The newest 200 alerts are kept. Older entries are removed automatically.
          </p>
        </div>
      )}

      {!busy && alerts.length > 0 && grouped.length === 0 && (
        <div className="rounded-3xl bg-white border border-gray-200/70 p-8 text-center mt-6">
          <p className="text-xs text-gray-500 font-medium">No alerts match the selected category filter.</p>
          <button
            onClick={() => setFilter('all')}
            className="mt-3 text-xs font-bold text-maroon-800 underline hover:text-maroon-900"
          >
            Show all alerts
          </button>
        </div>
      )}
    </div>
  );
};

export default Alerts;
