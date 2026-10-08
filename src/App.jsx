import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './lib/firebase';
import { lazy, Suspense, Component } from 'react';
import Layout from './components/Layout';
import { DeviceProvider } from './contexts/DeviceContext';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Alerts = lazy(() => import('./pages/Alerts'));
const Settings = lazy(() => import('./pages/Settings'));
const Login = lazy(() => import('./pages/Login'));

const useAuth = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setIsAuthenticated(!!user);
      setLoading(false);

      // Register this device for push once we know who the user is.
      //
      // The uid is required: a token with no owner is unreachable, which is exactly the bug this
      // replaces (the app used to mint a token on login and then throw it away).
      //
      // Everything here is best-effort. `enablePushForUser` returns null for every ordinary
      // "no push here" case — iOS Safari in a normal tab (Web Push on iOS only works once the app
      // is added to the Home Screen), iOS < 16.4, Android WebViews, non-secure origins, a denied
      // permission prompt — and those must not surface as errors. It never throws, but the dynamic
      // import is wrapped anyway so a chunk-load failure cannot take the tree down.
      if (user) {
        import('./lib/pushNotifications')
          .then(({ enablePushForUser }) => enablePushForUser(user.uid))
          .catch((err) => console.warn('Push registration skipped:', err?.message || err));
      }
    });

    return unsubscribe;
  }, []);

  return { isAuthenticated, loading };
};

const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();
  
  if (loading) {
    return (
      <div className="min-h-app bg-[#F0F2F5] flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-maroon-100 border-t-maroon-800 rounded-full animate-spin" />
      </div>
    );
  }
  
  return isAuthenticated ? children : <Navigate to="/login" />;
};

// Catches anything thrown during render OR inside an effect/commit. Without a boundary,
// React unmounts the entire tree and the user is left staring at a blank white page with
// no clue what happened. Turning that into a readable message makes failures diagnosable
// from a screenshot alone.
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Unhandled application error:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-app bg-[#F0F2F5] flex flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-lg font-bold text-gray-900">Something went wrong</h1>
        <p className="text-sm text-gray-500 max-w-sm break-words">
          {String(this.state.error?.message || this.state.error)}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="px-5 py-2.5 rounded-2xl bg-maroon-800 text-white text-sm font-bold"
        >
          Reload
        </button>
      </div>
    );
  }
}

function App() {
  return (
    <ErrorBoundary>
      <DeviceProvider>
        <Router>
          <Suspense fallback={
            <div className="min-h-app bg-[#F0F2F5] flex items-center justify-center">
              <div className="w-10 h-10 border-4 border-maroon-100 border-t-maroon-800 rounded-full animate-spin" />
            </div>
          }>
            <Routes>
              <Route path="/login" element={<Login />} />

              <Route path="/" element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }>
                <Route index element={<Navigate to="/dashboard" replace />} />
                <Route path="dashboard" element={<Dashboard />} />
                <Route path="analytics" element={<Analytics />} />
                <Route path="alerts" element={<Alerts />} />
                <Route path="settings" element={<Settings />} />
              </Route>
            </Routes>
          </Suspense>
        </Router>
      </DeviceProvider>
    </ErrorBoundary>
  );
}

export default App;
