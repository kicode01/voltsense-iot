import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { Home, BarChart3, Bell, Settings as SettingsIcon, ChevronDown, Wifi } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { useDeviceContext } from '../contexts/deviceContextCore';
import { useAlerts } from '../hooks/useAlerts';
import AlertCatchUp from './AlertCatchUp';
import ViewportDebug from './ViewportDebug';

const Layout = () => {
  const location = useLocation();
  const { devices, activeDeviceId, setActiveDeviceId, userId } = useDeviceContext();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const dropdownRef = useRef(null);

  // The badge needs the unread count on every screen, not just the Alerts tab, so the subscription
  // lives here in the shell. It is one listener on one node, shared by desktop + mobile nav.
  const { alerts, loading: alertsLoading, lastSeenId, unreadCount } = useAlerts(
    activeDeviceId,
    userId
  );

  // Scroll state is now handled by the scroll container's onScroll event

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const navItems = [
    { name: 'Dashboard', path: '/dashboard', icon: Home },
    { name: 'Analytics', path: '/analytics', icon: BarChart3 },
    // Badge counts alerts recorded since this user last opened the tab. It is driven by the
    // server-written history, so it stays right even when a push notification never arrived.
    { name: 'Alerts', path: '/alerts', icon: Bell, badge: unreadCount },
    { name: 'Settings', path: '/settings', icon: SettingsIcon },
  ];

  return (
    <div className="app-shell bg-[#F4F5F7] flex flex-col font-sans selection:bg-maroon-500/30 overflow-hidden">
      {/* Apple-style ambient background glow */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-[20%] -left-[10%] w-[60vw] h-[60vw] rounded-full bg-maroon-300/20 blur-[120px] mix-blend-multiply" />
        <div className="absolute -bottom-[20%] -right-[10%] w-[60vw] h-[60vw] rounded-full bg-red-400/10 blur-[140px] mix-blend-multiply" />
      </div>

      {/* Top Header
          pt-[var(--safe-top)] pushes the bar below the iOS status bar / Dynamic Island and the
          Android status bar. Without it the header renders underneath them and is invisible
          when the app is installed as a PWA (standalone display mode). */}
      {/* Deliberately OPAQUE, with NO backdrop-blur. A backdrop-filter promotes the header
          to its own compositing layer and iOS then renders text inside it with grayscale
          antialiasing, which makes the wordmark and the device chip look soft/blurry. It
          also let the ambient glow bleed through as haze. Solid background keeps it crisp;
          only the shadow changes on scroll. */}
      <header className={`z-50 shrink-0 pt-[var(--safe-top)] pl-[var(--safe-left)] pr-[var(--safe-right)] bg-[#F0F2F5] transition-shadow duration-300 ${
        scrolled ? 'shadow-sm shadow-maroon-900/5' : ''
      }`}>
        <div className="max-w-5xl mx-auto px-4 md:px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo.svg" alt="VoltSense Logo" className="w-10 h-10" />
            <div className="flex flex-col">
              <h1 className="text-xl font-bold tracking-tight text-gray-900 leading-tight">VoltSense</h1>
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none">Smart Control</span>
            </div>
          </div>
          
          <div className="flex items-center gap-4 ml-auto md:ml-0">
            {/* Device Switcher */}
            {devices.length > 0 && (
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className="flex items-center gap-2 bg-white/70 border border-gray-200/60 px-3 py-1.5 rounded-xl text-sm font-bold text-gray-700 hover:bg-white hover:shadow-sm transition-all"
                >
                  <Wifi className="w-3.5 h-3.5 text-maroon-800" />
                  <span className="max-w-[80px] md:max-w-[120px] truncate font-mono text-xs">{activeDeviceId}</span>
                  <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-300 ${dropdownOpen ? 'rotate-180' : ''}`} />
                </button>
                
                {dropdownOpen && (
                  <div className="absolute right-0 mt-2 w-auto min-w-full bg-white border border-black/5 rounded-2xl shadow-[0_20px_40px_-15px_rgba(0,0,0,0.2)] z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 text-[10px] font-bold uppercase tracking-widest text-gray-500 whitespace-nowrap">
                      Select Device
                    </div>
                    <div className="max-h-60 overflow-y-auto">
                      {devices.map(mac => (
                        <button
                          key={mac}
                          onClick={() => {
                            setActiveDeviceId(mac);
                            setDropdownOpen(false);
                          }}
                          className={`w-full text-left px-4 py-3 text-xs font-mono font-bold transition-colors flex items-center justify-between whitespace-nowrap gap-6 ${
                            activeDeviceId === mac
                              ? 'bg-maroon-50 text-maroon-800'
                              : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                          }`}
                        >
                          {mac}
                          {activeDeviceId === mac && <div className="w-1.5 h-1.5 rounded-full bg-maroon-600" />}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          
          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname.startsWith(item.path);
              return (
                <NavLink
                  key={item.name}
                  to={item.path}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-bold transition-all duration-500 ease-apple-spring transform-gpu hover:scale-[1.02] active:scale-[0.98] ${
                    isActive 
                      ? 'bg-white text-maroon-800 shadow-md shadow-gray-200/50' 
                      : 'text-gray-500 hover:text-gray-900 hover:bg-white/50'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {item.name}
                  {item.badge > 0 && (
                    <span className="ml-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-maroon-700 text-white text-[10px] font-bold flex items-center justify-center leading-none">
                      {item.badge > 99 ? '99+' : item.badge}
                    </span>
                  )}
                </NavLink>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Main Content Area.
          pl/pr carry the horizontal safe area so landscape notches (iPhone in
          landscape is 47px each side) never sit on top of the content. */}
      <div
        className="flex-1 overflow-y-auto w-full relative z-10 app-scroll pl-[var(--safe-left)] pr-[var(--safe-right)]"
        onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 10)}
      >
        {/* pb-* clears the floating bottom nav plus the home indicator / gesture bar */}
        <main className="w-full max-w-5xl mx-auto px-4 md:px-6 py-6 pb-[calc(10rem_+_var(--safe-bottom))] md:pb-10 flex flex-col">
          <Outlet />
        </main>
      </div>

      {/* Mobile Bottom Nav.
          Sits 0.5rem above the home indicator / gesture bar (kept slightly tighter than
          the 1rem side margins so the pill hugs the bottom edge instead of floating high). */}
      <div
        data-debug="bottom-nav"
        className="md:hidden fixed z-50 bottom-[calc(0.5rem_+_var(--safe-bottom))] left-[calc(1rem_+_var(--safe-left))] right-[calc(1rem_+_var(--safe-right))]"
      >
        <div className="bg-white/90 backdrop-blur-xl border border-white/20 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.2)] rounded-3xl p-2">
          <nav className="flex items-center justify-around">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname.startsWith(item.path);
              return (
                <NavLink
                  key={item.name}
                  to={item.path}
                  className={`flex flex-col items-center justify-center w-full h-[60px] rounded-2xl transition-all duration-500 ease-apple-spring ${
                    isActive ? 'bg-maroon-50/80 text-maroon-800' : 'text-gray-400 hover:text-gray-600'
                  }`}
                >
                  <div className="relative">
                    <Icon className={`w-5 h-5 transition-transform duration-500 ease-apple-spring ${isActive ? 'scale-110' : 'scale-100'}`} />
                    {/* Anchored to the icon rather than the label: the label collapses to zero
                        height when the tab is inactive, so a badge inside it would vanish —
                        which is exactly the state the user needs to be told about. */}
                    {item.badge > 0 && (
                      <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-[3px] rounded-full bg-maroon-700 text-white text-[9px] font-bold flex items-center justify-center leading-none ring-2 ring-white">
                        {item.badge > 99 ? '99+' : item.badge}
                      </span>
                    )}
                  </div>
                  <div className={`grid transition-all duration-500 ease-apple-spring ${isActive ? 'grid-rows-[1fr] opacity-100 translate-y-1' : 'grid-rows-[0fr] opacity-0 translate-y-0'}`}>
                    <span className="overflow-hidden min-h-0 text-[10px] font-bold uppercase tracking-widest leading-none">
                      {item.name}
                    </span>
                  </div>
                </NavLink>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Add ?debug to the URL to inspect real viewport / safe-area values on-device. */}
      {new URLSearchParams(location.search).has('debug') && <ViewportDebug />}

      {/* Renders nothing. Summarises alerts that were recorded while the app was closed, as the
          fallback for whenever a push notification did not reach this phone. */}
      <AlertCatchUp
        alerts={alerts}
        loading={alertsLoading}
        lastSeenId={lastSeenId}
        deviceId={activeDeviceId}
      />
    </div>
  );
};

export default Layout;
