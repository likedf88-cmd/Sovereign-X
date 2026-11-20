import React, { useState } from 'react';
import { X, Mail, ShieldCheck, ExternalLink, Lock, User } from 'lucide-react';
import {
  FIREBASE_PROVIDERS_URL,
  signInWithApple,
  signInWithEmail,
  signInWithGithub,
  signInWithGoogle,
  signUpWithEmail,
} from '../firebase';

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ open, onClose }) => {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [providerHint, setProviderHint] = useState<string | null>(null);

  if (!open) return null;

  const handleError = (err: unknown, providerName: string) => {
    const code = (err as { code?: string })?.code || '';
    const msg = err instanceof Error ? err.message : String(err);

    if (
      code === 'auth/operation-not-allowed' ||
      code === 'auth/unauthorized-domain' ||
      msg.includes('operation-not-allowed')
    ) {
      setErrorMsg(`${providerName} sign-in is not enabled yet in Firebase Authentication.`);
      setProviderHint(providerName);
    } else if (code === 'auth/popup-closed-by-user') {
      setErrorMsg('Sign-in popup was closed before completion.');
      setProviderHint(null);
    } else {
      setErrorMsg(msg.replace('Firebase: ', ''));
      setProviderHint(null);
    }
  };

  const runOAuth = async (fn: () => Promise<unknown>, name: string) => {
    setErrorMsg(null);
    setProviderHint(null);
    setLoading(true);
    try {
      await fn();
      onClose();
    } catch (err) {
      handleError(err, name);
    } finally {
      setLoading(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setProviderHint(null);
    if (!email.trim() || password.length < 6) {
      setErrorMsg('Enter a valid email and a password of at least 6 characters.');
      return;
    }
    setLoading(true);
    try {
      if (mode === 'signin') {
        await signInWithEmail(email.trim(), password);
      } else {
        await signUpWithEmail(email.trim(), password, displayName || email.split('@')[0]);
      }
      onClose();
    } catch (err) {
      handleError(err, 'Email/Password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div className="w-full max-w-md bg-[#0B0F1A] border border-white/12 rounded-2xl p-6 sm:p-8 shadow-2xl">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h2 id="auth-modal-title" className="text-2xl font-bold font-display text-white">
              {mode === 'signin' ? 'Enter Sovereign X' : 'Claim Your Crest'}
            </h2>
            <p className="text-sm text-slate-400 mt-1">
              Sync avatars, credits, loyalty streaks, and media across PC, Mobile, and Console.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sign in dialog"
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-6">
          <button
            type="button"
            disabled={loading}
            onClick={() => runOAuth(signInWithGoogle, 'Google')}
            className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg bg-white text-slate-950 hover:bg-slate-200 text-xs font-semibold transition-colors whitespace-nowrap"
          >
            <span className="font-bold">G</span>
            <span>Google</span>
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => runOAuth(signInWithApple, 'Apple')}
            className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg bg-[#161D2F] border border-white/15 text-white hover:bg-[#1E2942] text-xs font-semibold transition-colors whitespace-nowrap"
          >
            <span className="font-bold"></span>
            <span>Apple</span>
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => runOAuth(signInWithGithub, 'GitHub')}
            className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg bg-[#161D2F] border border-white/15 text-white hover:bg-[#1E2942] text-xs font-semibold transition-colors whitespace-nowrap"
          >
            <span className="font-bold">GH</span>
            <span>GitHub</span>
          </button>
        </div>

        <div className="flex items-center gap-3 mb-5">
          <div className="h-px flex-1 bg-white/10" />
          <span className="text-xs text-slate-400">or continue with email</span>
          <div className="h-px flex-1 bg-white/10" />
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#121827] rounded-lg mb-4">
          <button
            type="button"
            onClick={() => {
              setMode('signin');
              setErrorMsg(null);
            }}
            className={`flex-1 py-2 text-xs font-semibold rounded-md transition-colors ${
              mode === 'signin'
                ? 'bg-[#2563EB] text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('signup');
              setErrorMsg(null);
            }}
            className={`flex-1 py-2 text-xs font-semibold rounded-md transition-colors ${
              mode === 'signup'
                ? 'bg-[#2563EB] text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Create Account
          </button>
        </div>

        <form onSubmit={handleEmailSubmit} className="space-y-3.5">
          {mode === 'signup' && (
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Display Name
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Vanguard Player"
                  maxLength={64}
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-[#121827] border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#3B82F6]"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Email Address
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@domain.com"
                className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-[#121827] border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#3B82F6]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 6 characters"
                className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-[#121827] border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#3B82F6]"
              />
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-lg bg-red-950/60 border border-red-500/40 text-xs text-red-200 space-y-2">
              <p>{errorMsg}</p>
              {providerHint && (
                <div className="text-slate-300 space-y-1 pt-1 border-t border-white/10">
                  <p>
                    Enable <strong>{providerHint}</strong> inside Firebase Authentication Sign-in
                    providers:
                  </p>
                  <a
                    href={FIREBASE_PROVIDERS_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-[#60A5FA] hover:underline font-semibold"
                  >
                    <span>Open Firebase Sign-in Providers</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-60 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>
              {loading
                ? 'Authenticating...'
                : mode === 'signin'
                  ? 'Sign In with Email'
                  : 'Create Sovereign Account'}
            </span>
          </button>
        </form>
      </div>
    </div>
  );
};
