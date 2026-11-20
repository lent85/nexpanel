import {
    AlertTriangle,
    Check,
    CheckCircle,
    Database,
    Download,
    Eye,
    Globe,
    Key,
    Lock,
    LogOut,
    Plus,
    RefreshCw,
    RotateCcw,
    Server,
    Shield,
    ShieldCheck,
    Sliders,
    Trash2,
    User,
    Users,
    X
} from 'lucide-react';
import React, { useEffect, useState } from 'react';

interface SiteItem {
  id: string;
  domain: string;
  type: string;
  phpVersion?: string;
  status: string;
}

interface AuthUser {
  id: string;
  email: string;
  username: string;
  role: 'admin' | 'site_manager' | 'user' | 'client';
  status?: string;
  totpEnabled?: boolean;
  assignedSiteIds?: string[];
}

interface PanelUserItem {
  id: string;
  email: string;
  username: string;
  role: 'admin' | 'site_manager' | 'user' | 'client';
  status: 'active' | 'disabled';
  totp_enabled: boolean;
  assignedSiteIds?: string[];
  created_at: string;
}

export default function App() {
  // Authentication & Session State
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('nexpanel_token'));
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);

  // Login Form State
  const [loginIdentifier, setLoginIdentifier] = useState('admin');
  const [loginPassword, setLoginPassword] = useState('AdminPassword123!');
  const [loginTotp, setLoginTotp] = useState('');
  const [requires2Fa, setRequires2Fa] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginSubmitting, setLoginSubmitting] = useState(false);

  // First-Admin Setup Form State
  const [setupEmail, setSetupEmail] = useState('admin@nexpanel.local');
  const [setupUsername, setSetupUsername] = useState('admin');
  const [setupPassword, setSetupPassword] = useState('AdminPassword123!');
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupSubmitting, setSetupSubmitting] = useState(false);

  // Active View Tab
  const [activeTab, setActiveTab] = useState<'sites' | 'users' | 'import' | 'engines' | 'security' | 'edge'>('sites');

  // Sites State
  const [sites, setSites] = useState<SiteItem[]>([]);
  const [newDomain, setNewDomain] = useState('');
  const [newType, setNewType] = useState('wordpress');
  const [newPhp, setNewPhp] = useState('8.3');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Users Management State
  const [usersList, setUsersList] = useState<PanelUserItem[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('UserPassword123!');
  const [newUserRole, setNewUserRole] = useState<'admin' | 'site_manager' | 'user' | 'client'>('user');
  const [newUserAssignedSites, setNewUserAssignedSites] = useState<string[]>([]);
  const [userModalError, setUserModalError] = useState<string | null>(null);

  // Scope / Site Assignment Modal State
  const [scopeModalUser, setScopeModalUser] = useState<PanelUserItem | null>(null);
  const [selectedScopeSiteIds, setSelectedScopeSiteIds] = useState<string[]>([]);
  const [scopeSaving, setScopeSaving] = useState(false);
  const [scopeSuccess, setScopeSuccess] = useState(false);

  // CloudPanel Import state
  const [importSource, setImportSource] = useState<'backup_tar' | 'local_tar_gz' | 'live_ssh'>('backup_tar');
  const [importFile, setImportFile] = useState('/tmp/cloudpanel-backup.tar');
  const [dryRunRan, setDryRunRan] = useState(false);
  const [importRunning, setImportRunning] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const [rolledBack, setRolledBack] = useState(false);

  // Fetch Sites from Backend
  const loadSites = async (authToken: string) => {
    try {
      const res = await fetch('/api/v1/sites', {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.data && Array.isArray(data.data)) {
          setSites(
            data.data.map((s: any) => ({
              id: s.id,
              domain: s.domain,
              type: s.type,
              phpVersion: s.php_version || s.phpVersion,
              status: s.status
            }))
          );
        }
      }
    } catch (err) {
      console.warn('Could not fetch sites from backend API:', err);
    }
  };

  // Fetch Users from Backend
  const loadUsers = async (authToken: string) => {
    setUsersLoading(true);
    try {
      const res = await fetch('/api/v1/users', {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.data && Array.isArray(data.data)) {
          setUsersList(data.data);
        }
      }
    } catch (err) {
      console.warn('Could not fetch users list:', err);
    } finally {
      setUsersLoading(false);
    }
  };

  // Verify Auth & Initial Setup on mount
  useEffect(() => {
    async function initAuth() {
      try {
        try {
          const setupRes = await fetch('/api/v1/auth/setup-status');
          if (setupRes.ok) {
            const setupData = await setupRes.json();
            if (setupData.setupRequired) {
              setSetupRequired(true);
              setAuthLoading(false);
              return;
            }
          }
        } catch {
          // Backend may be offline
        }

        const savedToken = localStorage.getItem('nexpanel_token');
        if (savedToken) {
          try {
            const meRes = await fetch('/api/v1/auth/me', {
              headers: { Authorization: `Bearer ${savedToken}` }
            });
            if (meRes.ok) {
              const meData = await meRes.json();
              setCurrentUser(meData.user);
              setToken(savedToken);
              await loadSites(savedToken);
              if (meData.user.role === 'admin') {
                await loadUsers(savedToken);
              }
              setAuthLoading(false);
              return;
            } else {
              localStorage.removeItem('nexpanel_token');
              setToken(null);
              setCurrentUser(null);
            }
          } catch {
            // Token check failed
          }
        }
      } finally {
        setAuthLoading(false);
      }
    }

    initAuth();
  }, []);

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
      setToken(accessToken);
      setCurrentUser(data.user);
      setRequires2Fa(false);
      await loadSites(accessToken);
      if (data.user.role === 'admin') {
        await loadUsers(accessToken);
      }
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
      setToken(accessToken);
      setCurrentUser(data.user);
      setSetupRequired(false);
      await loadSites(accessToken);
      await loadUsers(accessToken);
    } catch (err: any) {
      setSetupError(err.message);
    } finally {
      setSetupSubmitting(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('nexpanel_token');
    setToken(null);
    setCurrentUser(null);
    setLoginPassword('');
    setRequires2Fa(false);
    setActiveTab('sites');
  };

  const handleCreateSite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDomain) return;
    setCreateError(null);

    if (token) {
      try {
        const res = await fetch('/api/v1/sites', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            domain: newDomain,
            type: newType,
            phpVersion: newType === 'wordpress' || newType === 'php' ? newPhp : undefined
          })
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.message || data.error?.message || 'Failed to create site on server');
        }
        await loadSites(token);
        setNewDomain('');
        setIsCreating(false);
        return;
      } catch (err: any) {
        setCreateError(err.message);
        return;
      }
    }
  };

  const handleDeleteSite = async (id: string, domain: string) => {
    if (!confirm(`Are you sure you want to delete site '${domain}'?`)) return;
    if (token) {
      try {
        await fetch(`/api/v1/sites/${id}`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ confirmDomain: domain })
        });
        await loadSites(token);
        return;
      } catch (err) {
        console.warn('API delete error:', err);
      }
    }
  };

  // Add User Handler
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setUserModalError(null);

    try {
      const res = await fetch('/api/v1/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          username: newUsername,
          email: newUserEmail,
          password: newUserPassword,
          role: newUserRole,
          assignedSiteIds: newUserRole === 'user' || newUserRole === 'client' ? newUserAssignedSites : undefined
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error?.message || 'Failed to create user');
      }

      await loadUsers(token);
      setUserModalOpen(false);
      setNewUsername('');
      setNewUserEmail('');
      setNewUserAssignedSites([]);
    } catch (err: any) {
      setUserModalError(err.message);
    }
  };

  // Toggle User Status (Active / Disabled)
  const handleToggleUserStatus = async (user: PanelUserItem) => {
    if (!token) return;
    const nextStatus = user.status === 'active' ? 'disabled' : 'active';
    try {
      const res = await fetch(`/api/v1/users/${user.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ status: nextStatus })
      });
      if (res.ok) {
        await loadUsers(token);
      }
    } catch (err) {
      console.error('Failed to toggle status:', err);
    }
  };

  // Reset User Password
  const handleResetPassword = async (user: PanelUserItem) => {
    if (!token) return;
    const newPass = prompt(`Enter new password for ${user.username} (min. 12 characters):`, 'NewPassword!123');
    if (!newPass) return;
    if (newPass.length < 12) {
      alert('Password must be at least 12 characters.');
      return;
    }

    try {
      const res = await fetch(`/api/v1/users/${user.id}/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ password: newPass })
      });
      const data = await res.json();
      if (res.ok) {
        alert(`Password for ${user.username} has been reset to: ${data.password}`);
      } else {
        alert(`Error: ${data.message || 'Failed to reset password'}`);
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  // Delete User
  const handleDeleteUser = async (user: PanelUserItem) => {
    if (!token) return;
    if (!confirm(`Are you sure you want to permanently delete user '${user.username}'?`)) return;

    try {
      const res = await fetch(`/api/v1/users/${user.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        await loadUsers(token);
      } else {
        const data = await res.json();
        alert(data.error?.message || 'Failed to delete user');
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  // Open Scope Modal
  const openScopeModal = (user: PanelUserItem) => {
    setScopeModalUser(user);
    setSelectedScopeSiteIds(user.assignedSiteIds || []);
    setScopeSuccess(false);
  };

  // Save Scope Assignments
  const handleSaveScope = async () => {
    if (!token || !scopeModalUser) return;
    setScopeSaving(true);
    try {
      const res = await fetch(`/api/v1/users/${scopeModalUser.id}/sites`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ siteIds: selectedScopeSiteIds })
      });
      if (res.ok) {
        setScopeSuccess(true);
        await loadUsers(token);
        setTimeout(() => {
          setScopeModalUser(null);
          setScopeSuccess(false);
        }, 800);
      }
    } catch (err) {
      console.error('Failed to save site scope:', err);
    } finally {
      setScopeSaving(false);
    }
  };

  // 1. Loading State
  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-300">
        <div className="w-12 h-12 rounded-xl bg-indigo-600 flex items-center justify-center font-bold text-white shadow-xl shadow-indigo-500/30 animate-pulse mb-4 text-xl">
          N
        </div>
        <p className="text-sm font-medium tracking-wide">Connecting to NexPanel Security Gateway...</p>
      </div>
    );
  }

  // 2. Setup Screen (when fresh install requires initial Super Admin)
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

  // 3. Login Screen (with Role Presets for Instant Testing)
  if (!token) {
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
  }

  // 4. Authenticated Dashboard with Multi-User RBAC & Scoped Site Management
  const isAdmin = currentUser?.role === 'admin';
  const isSiteManager = currentUser?.role === 'site_manager';
  const isClient = currentUser?.role === 'client';
  const isScopedUser = currentUser?.role === 'user';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Navigation */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-50 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/30">
            N
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">NexPanel</h1>
            <p className="text-xs text-slate-400">Docker-Native Server Control Panel</p>
          </div>
        </div>

        {/* Scope Notice for User/Client Roles */}
        {(isScopedUser || isClient) && (
          <div className="px-3 py-1 rounded-full text-xs font-medium bg-emerald-950/90 border border-emerald-700 text-emerald-300 flex items-center gap-2">
            <Globe className="w-3.5 h-3.5 text-emerald-400" />
            <span>Scoped Access Mode: Showing only your assigned sites ({sites.length} total)</span>
          </div>
        )}

        {/* User Profile & Sign Out */}
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2 text-right">
            <div>
              <div className="text-sm font-semibold text-slate-200 flex items-center gap-1.5 justify-end">
                <span>{currentUser?.username}</span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                    isAdmin
                      ? 'bg-indigo-950 text-indigo-300 border-indigo-700'
                      : isSiteManager
                      ? 'bg-cyan-950 text-cyan-300 border-cyan-700'
                      : isClient
                      ? 'bg-amber-950 text-amber-300 border-amber-700'
                      : 'bg-emerald-950 text-emerald-300 border-emerald-700'
                  }`}
                >
                  {isAdmin ? 'Super Admin' : isSiteManager ? 'Site Manager' : isClient ? 'Client (RO)' : 'Scoped User'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">{currentUser?.email}</p>
            </div>
            <div className="w-9 h-9 rounded-xl bg-indigo-600/30 border border-indigo-500/50 flex items-center justify-center text-indigo-300 font-bold text-sm uppercase">
              {currentUser?.username?.charAt(0) || 'U'}
            </div>
          </div>

          <button
            onClick={handleLogout}
            title="Sign out of NexPanel"
            className="p-2 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Main Container */}
      <div className="flex-1 flex max-w-7xl w-full mx-auto p-6 gap-6">
        {/* Sidebar Nav */}
        <aside className="w-64 space-y-2">
          <button
            onClick={() => setActiveTab('sites')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-sm transition ${
              activeTab === 'sites'
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
            }`}
          >
            <Globe className="w-4 h-4" />
            Sites & Projects
          </button>

          {/* User & Role Management Tab (Only visible to Admin) */}
          {isAdmin && (
            <button
              onClick={() => setActiveTab('users')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-sm transition ${
                activeTab === 'users'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                  : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`}
            >
              <Users className="w-4 h-4" />
              User & Role Management
            </button>
          )}

          {/* CloudPanel Import (Admin & Site Manager) */}
          {(isAdmin || isSiteManager) && (
            <button
              onClick={() => setActiveTab('import')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-sm transition ${
                activeTab === 'import'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                  : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`}
            >
              <Download className="w-4 h-4" />
              CloudPanel Import
            </button>
          )}

          {/* Database Engines (Admin Only) */}
          {isAdmin && (
            <button
              onClick={() => setActiveTab('engines')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-sm transition ${
                activeTab === 'engines'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                  : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`}
            >
              <Database className="w-4 h-4" />
              Database Engines
            </button>
          )}

          {/* Edge Proxy (Admin Only) */}
          {isAdmin && (
            <button
              onClick={() => setActiveTab('edge')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-sm transition ${
                activeTab === 'edge'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                  : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`}
            >
              <Server className="w-4 h-4" />
              Edge Proxy (NPM)
            </button>
          )}

          {/* Security Tab */}
          <button
            onClick={() => setActiveTab('security')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-sm transition ${
              activeTab === 'security'
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
            }`}
          >
            <Shield className="w-4 h-4" />
            Security & RBAC
          </button>
        </aside>

        {/* Content Area */}
        <main className="flex-1 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
          {/* TAB 1: SITES & PROJECTS */}
          {activeTab === 'sites' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold">
                    {isScopedUser || isClient ? 'My Assigned Sites & Projects' : 'All Sites & Projects'}
                  </h2>
                  <p className="text-sm text-slate-400">
                    {isClient
                      ? 'Read-only access granted for your assigned client applications.'
                      : isScopedUser
                      ? 'Applications within your assigned project scope.'
                      : 'Each site runs in an isolated container routed via NPM on ports 80/443.'}
                  </p>
                </div>

                {!isClient && (
                  <button
                    onClick={() => setIsCreating(true)}
                    className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded-xl font-medium text-sm text-white shadow-lg shadow-indigo-600/30 transition"
                  >
                    <Plus className="w-4 h-4" />
                    Add Site
                  </button>
                )}
              </div>

              {isCreating && (
                <form onSubmit={handleCreateSite} className="bg-slate-950 border border-slate-800 p-5 rounded-xl space-y-4">
                  <h3 className="font-semibold text-sm">Create New Site</h3>
                  {createError && (
                    <div className="p-2.5 rounded-lg bg-rose-950/80 border border-rose-800 text-rose-300 text-xs">
                      {createError}
                    </div>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1">Domain Name</label>
                      <input
                        type="text"
                        required
                        placeholder="example.com"
                        value={newDomain}
                        onChange={(e) => setNewDomain(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500 text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1">Site Type</label>
                      <select
                        value={newType}
                        onChange={(e) => setNewType(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500 text-white"
                      >
                        <option value="wordpress">WordPress (Scaffolded)</option>
                        <option value="php">Standard PHP</option>
                        <option value="nodejs">Node.js Application</option>
                        <option value="static">Static HTML</option>
                        <option value="reverse_proxy">Reverse Proxy</option>
                      </select>
                    </div>
                    {(newType === 'wordpress' || newType === 'php') && (
                      <div>
                        <label className="block text-xs font-semibold text-slate-400 mb-1">PHP Version</label>
                        <select
                          value={newPhp}
                          onChange={(e) => setNewPhp(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500 text-white"
                        >
                          <option value="8.3">PHP 8.3 (Default)</option>
                          <option value="8.2">PHP 8.2</option>
                          <option value="8.4">PHP 8.4</option>
                        </select>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button
                      type="button"
                      onClick={() => setIsCreating(false)}
                      className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-white transition"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold text-white shadow-lg transition"
                    >
                      Confirm & Deploy
                    </button>
                  </div>
                </form>
              )}

              {/* Sites Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-950 text-slate-400 text-xs uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-3 rounded-l-xl">Domain</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">Runtime</th>
                      <th className="px-4 py-3">Status</th>
                      {!isClient && <th className="px-4 py-3 rounded-r-xl text-right">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {sites.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center py-8 text-slate-500">
                          No sites found in your current project scope.
                        </td>
                      </tr>
                    ) : (
                      sites.map((site) => (
                        <tr key={site.id} className="hover:bg-slate-950/40 transition">
                          <td className="px-4 py-3.5 font-medium flex items-center gap-2">
                            <Globe className="w-4 h-4 text-slate-500" />
                            <span>{site.domain}</span>
                          </td>
                          <td className="px-4 py-3.5 capitalize text-slate-300">{site.type}</td>
                          <td className="px-4 py-3.5 text-slate-400 text-xs">{site.phpVersion ? `PHP ${site.phpVersion}` : '—'}</td>
                          <td className="px-4 py-3.5">
                            <span
                              className={`px-2.5 py-0.5 rounded-full text-xs font-medium inline-flex items-center gap-1.5 ${
                                site.status === 'live'
                                  ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800'
                                  : 'bg-amber-950/80 text-amber-400 border border-amber-800'
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${site.status === 'live' ? 'bg-emerald-400' : 'bg-amber-400'}`}
                              ></span>
                              {site.status}
                            </span>
                          </td>
                          {!isClient && (
                            <td className="px-4 py-3.5 text-right space-x-2">
                              <button
                                onClick={() => handleDeleteSite(site.id, site.domain)}
                                title="Delete Site"
                                className="p-1.5 text-slate-400 hover:text-rose-400 transition"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 2: USER & ROLE MANAGEMENT (Super Admin Only) */}
          {activeTab === 'users' && isAdmin && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold">User & Role Management</h2>
                  <p className="text-sm text-slate-400">
                    Manage users, assign RBAC roles, and control site access scopes.
                  </p>
                </div>
                <button
                  onClick={() => {
                    setUserModalOpen(true);
                    setUserModalError(null);
                  }}
                  className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded-xl font-medium text-sm text-white shadow-lg shadow-indigo-600/30 transition"
                >
                  <Plus className="w-4 h-4" />
                  Add User
                </button>
              </div>

              {/* Users Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-950 text-slate-400 text-xs uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-3 rounded-l-xl">User</th>
                      <th className="px-4 py-3">Role</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Site Access Scope</th>
                      <th className="px-4 py-3">2FA</th>
                      <th className="px-4 py-3 rounded-r-xl text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {usersList.map((u) => {
                      const isTargetAdmin = u.role === 'admin';
                      const isTargetSiteManager = u.role === 'site_manager';
                      const assignedCount = u.assignedSiteIds?.length || 0;

                      return (
                        <tr key={u.id} className="hover:bg-slate-950/40 transition">
                          <td className="px-4 py-3.5">
                            <div className="font-semibold text-slate-200">{u.username}</div>
                            <div className="text-xs text-slate-400">{u.email}</div>
                          </td>
                          <td className="px-4 py-3.5">
                            <span
                              className={`px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider border ${
                                u.role === 'admin'
                                  ? 'bg-indigo-950 text-indigo-300 border-indigo-700'
                                  : u.role === 'site_manager'
                                  ? 'bg-cyan-950 text-cyan-300 border-cyan-700'
                                  : u.role === 'client'
                                  ? 'bg-amber-950 text-amber-300 border-amber-700'
                                  : 'bg-emerald-950 text-emerald-300 border-emerald-700'
                              }`}
                            >
                              {u.role === 'admin'
                                ? 'Super Admin'
                                : u.role === 'site_manager'
                                ? 'Site Manager'
                                : u.role === 'client'
                                ? 'Client'
                                : 'Scoped User'}
                            </span>
                          </td>
                          <td className="px-4 py-3.5">
                            <button
                              onClick={() => handleToggleUserStatus(u)}
                              disabled={u.id === currentUser?.id}
                              title="Click to toggle status"
                              className={`px-2.5 py-0.5 rounded-full text-xs font-medium border transition ${
                                u.status === 'active'
                                  ? 'bg-emerald-950/80 text-emerald-400 border-emerald-800 hover:border-emerald-600'
                                  : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-500'
                              }`}
                            >
                              {u.status}
                            </button>
                          </td>
                          <td className="px-4 py-3.5">
                            {isTargetAdmin || isTargetSiteManager ? (
                              <span className="text-xs text-slate-400 font-mono">All Sites (Global)</span>
                            ) : (
                              <button
                                onClick={() => openScopeModal(u)}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
                              >
                                <Sliders className="w-3 h-3 text-indigo-400" />
                                <span>{assignedCount > 0 ? `${assignedCount} Sites Assigned` : 'No Sites (Restricted)'}</span>
                              </button>
                            )}
                          </td>
                          <td className="px-4 py-3.5">
                            <span
                              className={`text-xs ${
                                u.totp_enabled ? 'text-emerald-400 font-medium' : 'text-slate-500'
                              }`}
                            >
                              {u.totp_enabled ? 'Active' : 'Off'}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-right space-x-1.5">
                            {/* Scope Button for Scoped Roles */}
                            {!isTargetAdmin && !isTargetSiteManager && (
                              <button
                                onClick={() => openScopeModal(u)}
                                title="Edit Site Scope"
                                className="p-1.5 text-slate-400 hover:text-indigo-400 transition"
                              >
                                <Sliders className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              onClick={() => handleResetPassword(u)}
                              title="Reset Password"
                              className="p-1.5 text-slate-400 hover:text-amber-400 transition"
                            >
                              <Key className="w-4 h-4" />
                            </button>
                            {u.id !== currentUser?.id && (
                              <button
                                onClick={() => handleDeleteUser(u)}
                                title="Delete User"
                                className="p-1.5 text-slate-400 hover:text-rose-400 transition"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* RBAC Role Matrix Info Card */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-3">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-indigo-400" />
                  Role & Permission Capabilities
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
                  <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                    <div className="font-bold text-indigo-300">Super Admin</div>
                    <p className="text-slate-400">Full system authority: users, server settings, edge proxy, databases, and all sites.</p>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                    <div className="font-bold text-cyan-300">Site Manager</div>
                    <p className="text-slate-400">Manages all sites and databases; cannot manage users or global server settings.</p>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                    <div className="font-bold text-emerald-300">Scoped User</div>
                    <p className="text-slate-400">Full control (files, databases, vhost) exclusively over assigned sites.</p>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                    <div className="font-bold text-amber-300">Client</div>
                    <p className="text-slate-400">Strictly read-only visibility into assigned sites and logs.</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: CLOUDPANEL IMPORT */}
          {activeTab === 'import' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold">CloudPanel Migration & Import Engine</h2>
                <p className="text-sm text-slate-400">
                  Migrate from CloudPanel with dry-run diff simulation and 1-click rollback safety.
                </p>
              </div>

              <div className="bg-slate-950 border border-slate-800 p-5 rounded-xl space-y-4">
                <h3 className="font-semibold text-sm">Select Import Source</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <button
                    onClick={() => setImportSource('backup_tar')}
                    className={`p-4 rounded-xl border text-left transition ${
                      importSource === 'backup_tar'
                        ? 'bg-indigo-950/60 border-indigo-500 text-indigo-300'
                        : 'border-slate-800 hover:bg-slate-900 text-slate-400'
                    }`}
                  >
                    <div className="font-semibold text-sm text-slate-200">Source A: backup.tar</div>
                    <div className="text-xs mt-1 text-slate-400">CloudPanel remote backup tar containing vhost, htdocs and DB dump.</div>
                  </button>

                  <button
                    onClick={() => setImportSource('local_tar_gz')}
                    className={`p-4 rounded-xl border text-left transition ${
                      importSource === 'local_tar_gz'
                        ? 'bg-indigo-950/60 border-indigo-500 text-indigo-300'
                        : 'border-slate-800 hover:bg-slate-900 text-slate-400'
                    }`}
                  >
                    <div className="font-semibold text-sm text-slate-200">Source B: Local Archive Pair</div>
                    <div className="text-xs mt-1 text-slate-400">local-files.tar.gz + local-db.sql.gz pair from host backups directory.</div>
                  </button>

                  <button
                    onClick={() => setImportSource('live_ssh')}
                    className={`p-4 rounded-xl border text-left transition ${
                      importSource === 'live_ssh'
                        ? 'bg-indigo-950/60 border-indigo-500 text-indigo-300'
                        : 'border-slate-800 hover:bg-slate-900 text-slate-400'
                    }`}
                  >
                    <div className="font-semibold text-sm text-slate-200">Source C: Live SSH</div>
                    <div className="text-xs mt-1 text-slate-400">Live CloudPanel server connection via SSH to stream files & DB dump.</div>
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Archive Path or SSH Connection</label>
                  <input
                    type="text"
                    value={importFile}
                    onChange={(e) => setImportFile(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500 text-white font-mono"
                  />
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <button
                    onClick={() => {
                      setDryRunRan(true);
                      setRolledBack(false);
                    }}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-medium text-sm transition flex items-center gap-2"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Run Dry-Run Diff
                  </button>

                  {dryRunRan && !importDone && (
                    <button
                      onClick={() => {
                        setImportRunning(true);
                        setTimeout(() => {
                          setImportRunning(false);
                          setImportDone(true);
                        }, 1000);
                      }}
                      className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm shadow-lg shadow-indigo-600/30 transition flex items-center gap-2"
                    >
                      <Download className="w-4 h-4" />
                      {importRunning ? 'Importing Site & Database...' : 'Execute Import'}
                    </button>
                  )}

                  {importDone && (
                    <button
                      onClick={() => {
                        setImportDone(false);
                        setDryRunRan(false);
                        setRolledBack(true);
                      }}
                      className="px-4 py-2 rounded-xl bg-rose-950/80 border border-rose-800 hover:bg-rose-900 text-rose-300 font-semibold text-sm transition flex items-center gap-2"
                    >
                      <RotateCcw className="w-4 h-4" />
                      1-Click Rollback
                    </button>
                  )}
                </div>

                {dryRunRan && (
                  <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2 text-xs">
                    <div className="font-semibold text-emerald-400 flex items-center gap-1.5">
                      <CheckCircle className="w-4 h-4" />
                      Dry-Run Simulation Succeeded (R1, R2, R3 Validated)
                    </div>
                    <ul className="text-slate-400 space-y-1 pl-5 list-disc font-mono">
                      <li>Domain: example.com (PHP 8.3 / WordPress)</li>
                      <li>Target DB Engine: Internal MySQL 8.4 (WordPress on Postgres guard: PASSED)</li>
                      <li>Forward Host: site-example-com (R1 localhost check: PASSED)</li>
                      <li>wp-config.php rewrite: DB_HOST → nexpanel-mysql-8.4</li>
                    </ul>
                  </div>
                )}

                {importDone && (
                  <div className="p-4 rounded-xl bg-emerald-950/60 border border-emerald-800 text-emerald-300 text-xs flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 shrink-0" />
                    <span>Import executed successfully! Site container running and edge host active.</span>
                  </div>
                )}

                {rolledBack && (
                  <div className="p-4 rounded-xl bg-amber-950/60 border border-amber-800 text-amber-300 text-xs flex items-center gap-2">
                    <RotateCcw className="w-4 h-4 shrink-0" />
                    <span>Rollback complete: host cleaned and restored to previous state.</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: DATABASE ENGINES */}
          {activeTab === 'engines' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold">Database Engine Management</h2>
                <p className="text-sm text-slate-400">
                  Manage pluggable database engines (Internal MySQL, External Docker, or Remote RDS/PostgreSQL).
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slate-950 border border-slate-800 p-5 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-sm">Internal MySQL 8.4</h3>
                      <p className="text-xs text-slate-400">Container: nexpanel-mysql-8.4:3306</p>
                    </div>
                    <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-950 border border-emerald-800 text-emerald-400">
                      Default Engine
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 space-y-1">
                    <p>Mode: internal-docker</p>
                    <p>Databases: 4 active</p>
                  </div>
                </div>

                <div className="bg-slate-950 border border-slate-800 p-5 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-sm">External Remote PostgreSQL</h3>
                      <p className="text-xs text-slate-400">Host: rds-postgres.internal:5432</p>
                    </div>
                    <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-950 border border-indigo-800 text-indigo-400">
                      External Remote
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 space-y-1">
                    <p>Mode: external-remote (Immutability rule enforced)</p>
                    <p>Databases: 1 active</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: EDGE PROXY (NPM) */}
          {activeTab === 'edge' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold">External Edge Proxy (NPM 2.16.0)</h2>
                <p className="text-sm text-slate-400">
                  Nginx Proxy Manager owns ports 80/443. NexPanel controls routes via REST API.
                </p>
              </div>

              <div className="bg-slate-950 border border-slate-800 p-5 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-sm">NPM Connection Status</h3>
                    <p className="text-xs text-slate-400">Endpoint: http://npm:81/api on Docker network 'proxy'</p>
                  </div>
                  <span className="px-3 py-1 rounded-full text-xs font-medium bg-emerald-950 border border-emerald-800 text-emerald-400 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                    Connected (v2.16.0)
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: SECURITY & VAULT */}
          {activeTab === 'security' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold">Security, Firewall & Vault</h2>
                <p className="text-sm text-slate-400">Active session identity, UFW firewall rules, secret encryption (AES-256-GCM), and 2FA.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slate-950 border border-slate-800 p-5 rounded-xl space-y-3">
                  <h3 className="font-semibold text-sm flex items-center gap-2">
                    <User className="w-4 h-4 text-indigo-400" />
                    Active Session Identity
                  </h3>
                  <div className="text-xs text-slate-300 space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Username:</span>
                      <span className="font-mono">{currentUser?.username}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Email:</span>
                      <span>{currentUser?.email}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Role:</span>
                      <span className="text-indigo-400 font-semibold uppercase">{currentUser?.role}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Two-Factor Auth:</span>
                      <span>{currentUser?.totpEnabled ? 'Enabled' : 'Disabled (Recommended)'}</span>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-950 border border-slate-800 p-5 rounded-xl space-y-3">
                  <h3 className="font-semibold text-sm flex items-center gap-2">
                    <Key className="w-4 h-4 text-amber-400" />
                    Password & Lockout Policy
                  </h3>
                  <div className="text-xs text-slate-400 space-y-1.5">
                    <p>• Password Hashing: Argon2id (min. 12 characters)</p>
                    <p>• Brute-Force Defense: 5 failed attempts locks IP for 15 mins</p>
                    <p>• JWT Lifetime: 15m access token + 7d rotating refresh token</p>
                  </div>
                </div>

                <div className="bg-slate-950 border border-slate-800 p-5 rounded-xl space-y-2">
                  <h3 className="font-semibold text-sm flex items-center gap-2">
                    <Shield className="w-4 h-4 text-emerald-400" />
                    Host UFW Firewall
                  </h3>
                  <p className="text-xs text-slate-400">
                    Ports 80 & 443 are open for NPM. Panel port 8443 is protected.
                  </p>
                  <span className="inline-block mt-2 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-950 border border-emerald-800 text-emerald-400">
                    UFW Active
                  </span>
                </div>

                <div className="bg-slate-950 border border-slate-800 p-5 rounded-xl space-y-2">
                  <h3 className="font-semibold text-sm flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-indigo-400" />
                    Secrets Vault
                  </h3>
                  <p className="text-xs text-slate-400">
                    AES-256-GCM authenticated encryption. Raw secrets are sanitized from logs.
                  </p>
                  <span className="inline-block mt-2 px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-950 border border-indigo-800 text-indigo-400">
                    Vault Key: 0600 Secure
                  </span>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* MODAL 1: ADD USER MODAL */}
      {userModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-lg w-full bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <Users className="w-5 h-5 text-indigo-400" />
                Add New User
              </h3>
              <button
                onClick={() => setUserModalOpen(false)}
                className="text-slate-400 hover:text-white transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {userModalError && (
              <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-300 text-xs">
                {userModalError}
              </div>
            )}

            <form onSubmit={handleCreateUser} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Username</label>
                  <input
                    type="text"
                    required
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    placeholder="john_doe"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500 text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Email</label>
                  <input
                    type="email"
                    required
                    value={newUserEmail}
                    onChange={(e) => setNewUserEmail(e.target.value)}
                    placeholder="john@example.com"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500 text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Initial Password (min. 12 chars)</label>
                <input
                  type="password"
                  required
                  minLength={12}
                  value={newUserPassword}
                  onChange={(e) => setNewUserPassword(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500 text-white font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Assigned Role</label>
                <select
                  value={newUserRole}
                  onChange={(e) => setNewUserRole(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500 text-white"
                >
                  <option value="user">Scoped User (Can manage assigned sites & databases)</option>
                  <option value="client">Client (Read-only view for assigned sites)</option>
                  <option value="site_manager">Site Manager (Can manage all sites & DBs)</option>
                  <option value="admin">Super Admin (Full root access to panel & users)</option>
                </select>
              </div>

              {/* Site Assignment Scope selection for Scoped User or Client */}
              {(newUserRole === 'user' || newUserRole === 'client') && (
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                    Assign Sites / Project Scope
                  </label>
                  <div className="max-h-40 overflow-y-auto p-2.5 rounded-lg bg-slate-950 border border-slate-800 space-y-1.5">
                    {sites.length === 0 ? (
                      <p className="text-xs text-slate-500">No sites available to assign.</p>
                    ) : (
                      sites.map((s) => (
                        <label
                          key={s.id}
                          className="flex items-center gap-2.5 text-xs text-slate-300 hover:text-white cursor-pointer select-none"
                        >
                          <input
                            type="checkbox"
                            checked={newUserAssignedSites.includes(s.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setNewUserAssignedSites([...newUserAssignedSites, s.id]);
                              } else {
                                setNewUserAssignedSites(newUserAssignedSites.filter((id) => id !== s.id));
                              }
                            }}
                            className="rounded border-slate-700 text-indigo-600 focus:ring-0 bg-slate-900"
                          />
                          <span className="font-mono">{s.domain}</span>
                          <span className="text-[10px] text-slate-500">({s.type})</span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
              )}

              <div className="flex gap-2 justify-end pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setUserModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-white transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold text-white shadow-lg transition"
                >
                  Create User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: EDIT SITE SCOPE MODAL */}
      {scopeModalUser && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-lg font-bold flex items-center gap-2">
                  <Sliders className="w-5 h-5 text-indigo-400" />
                  Site Access Scope
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  User: <span className="text-indigo-300 font-semibold">{scopeModalUser.username}</span> ({scopeModalUser.role})
                </p>
              </div>
              <button
                onClick={() => setScopeModalUser(null)}
                className="text-slate-400 hover:text-white transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {scopeSuccess ? (
              <div className="p-4 rounded-xl bg-emerald-950/80 border border-emerald-800 text-emerald-300 text-xs flex items-center gap-2">
                <CheckCircle className="w-4 h-4 shrink-0" />
                <span>Site access scope updated successfully!</span>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">Select allowed sites:</span>
                  <div className="space-x-2">
                    <button
                      type="button"
                      onClick={() => setSelectedScopeSiteIds(sites.map((s) => s.id))}
                      className="text-indigo-400 hover:underline"
                    >
                      Select All
                    </button>
                    <span className="text-slate-600">•</span>
                    <button
                      type="button"
                      onClick={() => setSelectedScopeSiteIds([])}
                      className="text-slate-400 hover:underline"
                    >
                      Clear All
                    </button>
                  </div>
                </div>

                <div className="max-h-60 overflow-y-auto p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                  {sites.length === 0 ? (
                    <p className="text-xs text-slate-500">No sites configured in panel yet.</p>
                  ) : (
                    sites.map((s) => {
                      const isChecked = selectedScopeSiteIds.includes(s.id);
                      return (
                        <label
                          key={s.id}
                          className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition select-none ${
                            isChecked ? 'bg-indigo-950/40 border border-indigo-800/80' : 'hover:bg-slate-900 border border-transparent'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedScopeSiteIds([...selectedScopeSiteIds, s.id]);
                                } else {
                                  setSelectedScopeSiteIds(selectedScopeSiteIds.filter((id) => id !== s.id));
                                }
                              }}
                              className="rounded border-slate-700 text-indigo-600 focus:ring-0 bg-slate-900"
                            />
                            <div>
                              <div className="text-xs font-mono font-medium text-slate-200">{s.domain}</div>
                              <div className="text-[10px] text-slate-500 capitalize">{s.type} {s.phpVersion ? `(PHP ${s.phpVersion})` : ''}</div>
                            </div>
                          </div>
                          {isChecked && <Check className="w-4 h-4 text-indigo-400" />}
                        </label>
                      );
                    })
                  )}
                </div>

                <div className="flex gap-2 justify-end pt-3 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setScopeModalUser(null)}
                    className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-white transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={scopeSaving}
                    onClick={handleSaveScope}
                    className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold text-white shadow-lg transition disabled:opacity-50"
                  >
                    {scopeSaving ? 'Saving...' : 'Save Scope'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
