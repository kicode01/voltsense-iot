import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Lock, LogIn, UserPlus } from 'lucide-react';
import { auth, googleProvider } from '../lib/firebase';
import { errorMessage, errorCode } from '../lib/errors';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult
} from 'firebase/auth';

// iOS/Android home-screen installs have no popup context, and iOS Safari blocks popups entirely
// when launched standalone. Use the redirect flow there; popup elsewhere.
const prefersRedirectFlow = () => {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isMobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  const isStandalone =
    window.matchMedia?.('(display-mode: standalone)')?.matches === true ||
    window.navigator.standalone === true;
  return isMobileUA || isStandalone;
};

const Login = () => {
  const navigate = useNavigate();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Completes the Google redirect handshake when the browser returns to the app.
  useEffect(() => {
    let cancelled = false;
    getRedirectResult(auth)
      .then((result) => {
        if (!cancelled && result?.user) navigate('/dashboard');
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Google redirect sign-in failed:', err);
        setError('Google Sign-In failed. Please try again.');
      });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const handleEmailAuth = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (isSignUp) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      navigate('/dashboard');
    } catch (err) {
      setError(errorMessage(err, 'Could not sign in. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError('');
    setLoading(true);
    try {
      if (prefersRedirectFlow()) {
        await signInWithRedirect(auth, googleProvider);
        return; // The page navigates away; the redirect result is handled on return.
      }
      await signInWithPopup(auth, googleProvider);
      navigate('/dashboard');
    } catch (err) {
      console.error(err);
      const code = errorCode(err);
      // Popups can still be blocked on desktop (extensions, strict settings) — fall back.
      if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
        try {
          await signInWithRedirect(auth, googleProvider);
          return;
        } catch (redirectErr) {
          console.error('Google redirect fallback failed:', redirectErr);
        }
      }
      setError('Google Sign-In failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-app bg-[#F4F5F7] relative flex flex-col items-center justify-center px-4 pt-[calc(1rem_+_var(--safe-top))] pb-[calc(1rem_+_var(--safe-bottom))] selection:bg-maroon-500/30 overflow-hidden font-sans">
      
      {/* Premium Apple-style ambient background glow */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[0%] left-[10%] w-[60vw] h-[60vw] rounded-full bg-maroon-300/20 blur-[100px] mix-blend-multiply animate-pulse" style={{ animationDuration: '8s' }} />
        <div className="absolute bottom-[0%] right-[10%] w-[60vw] h-[60vw] rounded-full bg-red-400/10 blur-[120px] mix-blend-multiply animate-pulse" style={{ animationDuration: '12s' }} />
      </div>

      <div className="relative z-10 w-full max-w-md bg-white/70 backdrop-blur-2xl border border-white/60 rounded-[2.5rem] p-8 md:p-10 animate-in fade-in slide-in-from-bottom-8 duration-700 ease-apple-spring">
        <div className="text-center mb-8">
          <img 
            src="/logo.svg" 
            alt="VoltSense Logo" 
            className="w-20 h-20 mx-auto rounded-[1.5rem] mb-6" 
          />
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 mb-2">
            VoltSense
          </h1>
          <p className="text-gray-400 text-xs font-bold uppercase tracking-widest">
            {isSignUp ? 'Create New Account' : 'System Authentication'}
          </p>
        </div>

        <form onSubmit={handleEmailAuth} className="space-y-5">
          {error && (
            <div className="p-4 bg-red-50/80 backdrop-blur-sm border border-red-100 rounded-2xl text-red-600 text-sm text-center font-bold animate-in fade-in zoom-in-95 duration-300">
              {error}
            </div>
          )}
          
          <div className="space-y-1.5">
            <label htmlFor="email-input" className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest ml-1">Email Address</label>
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none transition-transform group-focus-within:scale-110">
                <Mail className="w-5 h-5 text-gray-400 group-focus-within:text-maroon-600 transition-colors" />
              </div>
              <input
                id="email-input"
                name="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-white/60 backdrop-blur-md border border-gray-200/80 py-4 pl-12 pr-4 text-gray-900 placeholder-gray-400 focus:outline-none focus:border-maroon-500 focus:ring-4 focus:ring-maroon-500/10 transition-all duration-300 font-medium rounded-2xl hover:bg-white/80"
                placeholder="admin@voltsense.local"
                autoComplete="email"
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password-input" className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest ml-1">Password</label>
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none transition-transform group-focus-within:scale-110">
                <Lock className="w-5 h-5 text-gray-400 group-focus-within:text-maroon-600 transition-colors" />
              </div>
              <input
                id="password-input"
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-white/60 backdrop-blur-md border border-gray-200/80 py-4 pl-12 pr-4 text-gray-900 placeholder-gray-400 focus:outline-none focus:border-maroon-500 focus:ring-4 focus:ring-maroon-500/10 transition-all duration-300 font-medium rounded-2xl hover:bg-white/80"
                placeholder="••••••••"
                autoComplete={isSignUp ? "new-password" : "current-password"}
                required
                minLength={6}
              />
            </div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-4 px-4 font-bold bg-maroon-800 text-white rounded-2xl hover:bg-maroon-900 transition-all duration-300 ease-out transform-gpu hover:scale-[1.02] active:scale-[0.98] uppercase tracking-wider text-sm disabled:opacity-75 disabled:hover:scale-100"
            >
              {loading ? (
                <svg className="w-4 h-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                isSignUp ? <UserPlus className="w-4 h-4" /> : <LogIn className="w-4 h-4" />
              )}
              {loading 
                ? (isSignUp ? 'Creating Account...' : 'Authenticating...') 
                : (isSignUp ? 'Create Account' : 'Authenticate')
              }
            </button>
          </div>
        </form>

        <div className="mt-6 text-center text-[11px] font-bold uppercase tracking-widest text-gray-500">
          {isSignUp ? 'Already have an account? ' : 'Need an account? '}
          <button 
            type="button" 
            onClick={() => { setIsSignUp(!isSignUp); setError(''); }}
            className="text-maroon-700 hover:text-maroon-900 transition-colors"
          >
            {isSignUp ? 'Sign In' : 'Sign Up'}
          </button>
        </div>

        <div className="mt-8 flex items-center gap-4">
          <div className="h-px bg-gradient-to-r from-transparent via-gray-200 to-gray-200 flex-1" />
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Or continue with</span>
          <div className="h-px bg-gradient-to-l from-transparent via-gray-200 to-gray-200 flex-1" />
        </div>

        <button
          onClick={handleGoogleLogin}
          type="button"
          disabled={loading}
          className="mt-8 w-full flex items-center justify-center gap-3 py-3.5 px-4 bg-white/80 backdrop-blur-md border border-gray-200/80 text-gray-700 rounded-2xl hover:bg-white transition-all duration-300 ease-out transform-gpu hover:scale-[1.02] active:scale-[0.98] font-bold text-sm disabled:opacity-60 disabled:hover:scale-100"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Google
        </button>
        
      </div>
    </div>
  );
};

export default Login;

