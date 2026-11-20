import React, { useState } from 'react';
import { AlertTriangle, Lock, User, Key, ShieldCheck, Server, Globe, Eye } from 'lucide-react';
import { AuthUser } from '../types';

interface AuthViewProps {
  setupRequired: boolean;
  onLoginSuccess: (user: AuthUser, token: string) => void;
  onSetupSuccess: (user: AuthUser, token: string) => void;
}

export const AuthView: React.FC<AuthViewProps> = ({
  setupRequired,
  onLoginSuccess,
  onSetupSuccess
}) => {
  // Login State
  const [loginIdentifier, setLoginIdentifier] = useState('admin');
  const [loginPassword, setLoginPassword] = useState('AdminPassword123!');
  const [loginTotp, setLoginTotp] = useState('');
  const [requires2Fa, setRequires2Fa] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginSubmitting, setLoginSubmitting] = useState(false);

  // Setup State
  const [setupEmail, setSetupEmail] = useState('admin@nexpanel.local');
  const [setupUsername, setSetupUsername] = useState('admin');
  const [setupPassword, setSetupPassword] = useState('AdminPassword123!');
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupSubmitting, setSetupSubmitting] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setLoginSubmitting(true);

    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: loginIdentifier,
          password: loginPassword,
          totpToken: loginTotp || undefined
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error?.message || 'Login failed. Please verify credentials.');
      }

      if (data.requires2Fa) {
        setRequires2Fa(true);
        setLoginSubmitting(false);
        return;
      }

      const accessToken = data.tokens.accessToken;
      localStorage.setItem('nexpanel_token', accessToken);
      setRequires2Fa(false);
      onLoginSuccess(data.user, accessToken);
    } catch (err: any) {
      setLoginError(err.message);
    } finally {
      setLoginSubmitting(false);
    }
  };

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setSetupError(null);
    setSetupSubmitting(true);

    try {
      const res = await fetch('/api/v1/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: setupEmail,
          username: setupUsername,
          password: setupPassword
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error?.message || 'Setup failed. Password must be at least 12 characters.');
      }

      const accessToken = data.tokens.accessToken;
      localStorage.setItem('nexpanel_token', accessToken);
      onSetupSuccess(data.user, accessToken);
    } catch (err: any) {
      setSetupError(err.message);
    } finally {
      setSetupSubmitting(false);
    }
  };

  if (setupRequired) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-8 space-y-6">
          <div className="text-center space-y-2">
            <div className="inline-flex w-14 h-14 rounded-2xl bg-indigo-600 items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/40 text-2xl mb-2">
              N
            </div>
            <h1 className="text-2xl font-bold tracking-tight">NexPanel Initial Setup</h1>
            <p className="text-xs text-slate-400">
              Create your initial <span className="text-indigo-400 font-semibold">Super Administrator</span> account.
            </p>
          </div>

          {setupError && (
            <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-300 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{setupError}</span>
            </div>
          )}

          <form onSubmit={handleSetup} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Email Address</label>
              <input
                type="email"
                required
                value={setupEmail}
                onChange={(e) => setSetupEmail(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500 text-white"
                placeholder="admin@nexpanel.local"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Super Admin Username</label>
              <input
                type="text"
                required
                value={setupUsername}
                onChange={(e) => setSetupUsername(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500 text-white"
                placeholder="admin"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Master Password (min. 12 chars)</label>
              <input
                type="password"
                required
                minLength={12}
                value={setupPassword}
                onChange={(e) => setSetupPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500 text-white font-mono"
                placeholder="••••••••••••••••"
              />
              <p className="text-[11px] text-slate-500 mt-1">Hashed with Argon2id + AES-256-GCM Vault protection.</p>
            </div>

            <button
              type="submit"
              disabled={setupSubmitting}
              className="w-full py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-semibold text-sm text-white shadow-lg shadow-indigo-600/30 transition disabled:opacity-50"
            >
              {setupSubmitting ? 'Creating Super Admin...' : 'Initialize NexPanel & Login'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6">
      <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-8 space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex w-14 h-14 rounded-2xl bg-indigo-600 items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/40 text-2xl mb-2">
            N
          </div>
          <h1 className="text-2xl font-bold tracking-tight">NexPanel Security Gateway</h1>
          <p className="text-xs text-slate-400">
            Sign in with your role credentials to access your authorized scope.
          </p>
        </div>

        {loginError && (
          <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-300 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{loginError}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Username or Email</label>
            <div className="relative">
              <input
                type="text"
                required
                value={loginIdentifier}
                onChange={(e) => setLoginIdentifier(e.target.value)}
                className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500 text-white"
                placeholder="admin or dev@nexpanel.local"
              />
              <User className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Password</label>
            <div className="relative">
              <input
                type="password"
                required
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500 text-white font-mono"
                placeholder="••••••••••••••••"
              />
              <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
            </div>
          </div>

          {requires2Fa && (
            <div>
              <label className="block text-xs font-semibold text-amber-400 mb-1">2FA Security Token (TOTP)</label>
              <div className="relative">
                <input
                  type="text"
                  required
                  value={loginTotp}
                  onChange={(e) => setLoginTotp(e.target.value)}
                  className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-slate-950 border border-amber-600 text-sm focus:outline-none focus:border-amber-400 text-white font-mono tracking-widest"
                  placeholder="6-digit code or recovery code"
                />
                <Key className="w-4 h-4 text-amber-500 absolute left-3.5 top-3" />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loginSubmitting}
            className="w-full py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-semibold text-sm text-white shadow-lg shadow-indigo-600/30 transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <ShieldCheck className="w-4 h-4" />
            {loginSubmitting ? 'Authenticating...' : 'Sign In to Panel'}
          </button>
        </form>

        {/* Quick RBAC Role Presets for Testing */}
        <div className="pt-4 border-t border-slate-800 text-center space-y-2.5">
          <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Quick RBAC Role Presets:</p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <button
              type="button"
              onClick={() => {
                setLoginIdentifier('admin');
                setLoginPassword('AdminPassword123!');
              }}
              className="p-2 rounded-lg bg-indigo-950/70 border border-indigo-800 text-indigo-300 hover:bg-indigo-900 transition text-left"
            >
              <div className="font-bold flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-indigo-400" />
                Super Admin
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">All Sites & Users</div>
            </button>

            <button
              type="button"
              onClick={() => {
                setLoginIdentifier('manager');
                setLoginPassword('ManagerPassword123!');
              }}
              className="p-2 rounded-lg bg-cyan-950/70 border border-cyan-800 text-cyan-300 hover:bg-cyan-900 transition text-left"
            >
              <div className="font-bold flex items-center gap-1">
                <Server className="w-3 h-3 text-cyan-400" />
                Site Manager
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">All Sites (No Users)</div>
            </button>

            <button
              type="button"
              onClick={() => {
                setLoginIdentifier('developer');
                setLoginPassword('DeveloperPassword123!');
              }}
              className="p-2 rounded-lg bg-emerald-950/70 border border-emerald-800 text-emerald-300 hover:bg-emerald-900 transition text-left"
            >
              <div className="font-bold flex items-center gap-1">
                <Globe className="w-3 h-3 text-emerald-400" />
                Scoped User
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">Node & PHP Sites</div>
            </button>

            <button
              type="button"
              onClick={() => {
                setLoginIdentifier('client');
                setLoginPassword('ClientPassword123!');
              }}
              className="p-2 rounded-lg bg-amber-950/70 border border-amber-800 text-amber-300 hover:bg-amber-900 transition text-left"
            >
              <div className="font-bold flex items-center gap-1">
                <Eye className="w-3 h-3 text-amber-400" />
                Scoped Client
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">WordPress (Read-Only)</div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
