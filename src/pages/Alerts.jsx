import { useEffect, useMemo } from 'react';
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
  Zap,
  Clock,
  ArrowRight
} from 'lucide-react';
import { useDeviceContext } from '../contexts/deviceContextCore';
import { useAlerts } from '../hooks/useAlerts';

const getAlertVisuals = (alert) => {
  const tag = (alert?.tag || '').toLowerCase();
  const title = (alert?.title || '').toLowerCase();
  const body = (alert?.body || '').toLowerCase();

  // Strip leading raw emojis (like ⚠️) so the typography remains crisp
  const cleanTitle = (alert?.title || 'VoltSense Alert')
    .replace(/^[\s\p{Extended_Pictographic}\uFE0F]+/u, '')
    .trim() || 'VoltSense Alert';

  if (tag.includes('overcurrent') || title.includes('overcurrent') || body.includes('overcurrent')) {
    return {
      cleanTitle,
      category: 'Power Trip',
      Icon: Zap,
      badgeClass: 'bg-red-50 text-red-600 border-red-200/80',
      watermarkClass: 'text-red-500/[0.04]',
      isShutdown: false
    };
  }

  if (tag.includes('shutdown') || tag.includes('inactivity') || body.includes('shut down') || body.includes('empty') || title.includes('empty')) {
    return {
      cleanTitle,
      category: 'Auto Shutdown',
      Icon: Timer,
      badgeClass: 'bg-amber-50 text-amber-600 border-amber-200/80',
      watermarkClass: 'text-amber-500/[0.04]',
      isShutdown: true
    };
  }

  if (tag.includes('power') || title.includes('power')) {
    return {
      cleanTitle,
      category: 'System Power',
      Icon: Power,
      badgeClass: 'bg-maroon-50 text-maroon-800 border-maroon-200/80',
      watermarkClass: 'text-maroon-900/[0.03]',
      isShutdown: false
    };
  }

  return {
    cleanTitle,
    category: 'Notification',
    Icon: Bell,
    badgeClass: 'bg-gray-50 text-gray-700 border-gray-200/80',
    watermarkClass: 'text-gray-900/[0.03]',
    isShutdown: false
  };
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

  const grouped = useMemo(() => {
    const groups = [];
    let current = null;

    alerts.forEach((alert) => {
      const day = alert.at ? new Date(alert.at).toDateString() : 'Unknown date';
      if (!current || current.day !== day) {
        current = { day, label: formatStamp(alert.at).split(',')[0] || 'Unknown date', items: [] };
        groups.push(current);
      }
      current.items.push(alert);
    });

    return groups;
  }, [alerts]);

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
          <article className="relative rounded-3xl border bg-white/85 backdrop-blur-xl border-amber-200/80 shadow-[0_4px_20px_rgb(0,0,0,0.03)] p-4 md:p-5 overflow-hidden group">
            <Timer
              strokeWidth={1.5}
              className="absolute -right-3 -bottom-3 w-20 h-20 md:w-24 md:h-24 text-amber-500/[0.04] transform transition-transform duration-700 group-hover:scale-110 group-hover:rotate-12 pointer-events-none"
            />
            <div className="flex items-start gap-3.5 md:gap-4 relative z-10">
              <div className="w-10 h-10 md:w-11 md:h-11 rounded-2xl bg-amber-50 text-amber-600 border border-amber-200/80 flex items-center justify-center shrink-0 shadow-sm transition-transform duration-300 group-hover:scale-105">
                <Timer className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200/60">
                      Auto Shutdown
                    </span>
                    <h3 className="text-sm md:text-base font-bold text-gray-900 truncate">Room became empty</h3>
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-widest bg-maroon-100 text-maroon-800 border border-maroon-200">
                      New
                    </span>
                  </div>
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 text-[10px] font-bold shrink-0">
                    <CircleCheck className="w-3 h-3" />
                    Delivered
                  </span>
                </div>
                <p className="text-xs md:text-sm text-gray-600 mt-1 leading-relaxed">
                  The lounge has been unoccupied for 15 minutes. Power will shut off in 5 minutes
                  unless you tap Keep Power On.
                </p>
                <div className="flex items-center gap-2 mt-3 pt-2 border-t border-gray-100/80 text-[10px] md:text-xs font-medium text-gray-400">
                  <Clock className="w-3.5 h-3.5 text-gray-400" />
                  <span>Just now · example</span>
                  <span className="text-gray-300">•</span>
                  <Link
                    to="/"
                    className="font-bold text-maroon-800 hover:text-maroon-900 inline-flex items-center gap-0.5 hover:underline"
                  >
                    Open Dashboard
                    <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
              </div>
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

              <div className="space-y-2">
                {group.items.map((alert) => {
                  const meta = OUTCOME[alert.outcome] || OUTCOME.unknown;
                  const { Icon: OutcomeIcon } = meta;
                  const visual = getAlertVisuals(alert);
                  const { Icon: AlertIcon } = visual;
                  const isUnread =
                    lastSeenId === null || (lastSeenId !== undefined && alert.at > lastSeenId);

                  return (
                    <article
                      key={alert.id}
                      className={`relative rounded-3xl border p-4 md:p-5 transition-all duration-300 ease-apple-spring overflow-hidden group ${
                        isUnread
                          ? 'bg-white border-maroon-300/80 shadow-[0_8px_30px_rgb(128,0,0,0.06)]'
                          : 'bg-white/85 backdrop-blur-xl border-white/60 hover:border-gray-200 shadow-[0_4px_20px_rgb(0,0,0,0.03)] hover:shadow-md'
                      }`}
                    >
                      {/* Subtle watermark in the side, matching dashboard cards */}
                      <AlertIcon
                        strokeWidth={1.5}
                        className={`absolute -right-3 -bottom-3 w-20 h-20 md:w-24 md:h-24 ${visual.watermarkClass} transform transition-transform duration-700 group-hover:scale-110 group-hover:rotate-12 pointer-events-none`}
                      />

                      <div className="flex items-start gap-3.5 md:gap-4 relative z-10">
                        {/* Type badge on the left */}
                        <div
                          className={`w-10 h-10 md:w-11 md:h-11 rounded-2xl flex items-center justify-center shrink-0 border shadow-sm transition-transform duration-300 group-hover:scale-105 ${visual.badgeClass}`}
                        >
                          <AlertIcon className="w-5 h-5" />
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                            <div className="flex items-center gap-2 min-w-0 flex-wrap">
                              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 bg-gray-100/80 px-2 py-0.5 rounded-md border border-gray-200/60">
                                {visual.category}
                              </span>
                              <h3 className="text-sm md:text-base font-bold text-gray-900 truncate">
                                {visual.cleanTitle}
                              </h3>
                              {isUnread && (
                                <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-widest bg-maroon-100 text-maroon-800 border border-maroon-200">
                                  New
                                </span>
                              )}
                            </div>

                            {/* Status outcome pill on the right */}
                            <span
                              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-[10px] font-bold tracking-tight shrink-0 ${meta.className}`}
                            >
                              <OutcomeIcon className="w-3 h-3" />
                              {meta.label}
                            </span>
                          </div>

                          <p className="text-xs md:text-sm text-gray-600 mt-1 leading-relaxed break-words">
                            {alert.body}
                          </p>

                          <div className="flex items-center gap-2 mt-3 pt-2 border-t border-gray-100/80 text-[10px] md:text-xs font-medium text-gray-400">
                            <Clock className="w-3.5 h-3.5 text-gray-400" />
                            <span>{formatStamp(alert.at)}</span>
                            {visual.isShutdown && (
                              <>
                                <span className="text-gray-300">•</span>
                                <Link
                                  to="/"
                                  className="font-bold text-maroon-800 hover:text-maroon-900 inline-flex items-center gap-0.5 hover:underline"
                                >
                                  Open Dashboard
                                  <ArrowRight className="w-3 h-3" />
                                </Link>
                              </>
                            )}
                          </div>
                        </div>
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
    </div>
  );
};

export default Alerts;
