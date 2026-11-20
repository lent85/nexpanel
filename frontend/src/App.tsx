import React, { useEffect, useState } from 'react';
import {
  Globe,
  LogOut,
  Users,
  Download,
  Database,
  Server,
  Shield
} from 'lucide-react';
import { SiteItem, AuthUser, PanelUserItem } from './types';
import { AuthView } from './components/AuthView';
import { SitesView } from './components/SitesView';
import { UsersView } from './components/UsersView';
import { ImportView } from './components/ImportView';
import { EnginesView } from './components/EnginesView';
import { EdgeView } from './components/EdgeView';
import { SecurityView } from './components/SecurityView';

export default function App() {
  // Authentication & Session State
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('nexpanel_token'));
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);

  // Active View Tab
  const [activeTab, setActiveTab] = useState<'sites' | 'users' | 'import' | 'engines' | 'security' | 'edge'>('sites');

  // Shared Data State
  const [sites, setSites] = useState<SiteItem[]>([]);
  const [usersList, setUsersList] = useState<PanelUserItem[]>([]);

  // Fetch Sites from Backend
  const loadSites = async (authToken?: string) => {
    const activeToken = authToken || token;
    if (!activeToken) return;

    try {
      const res = await fetch('/api/v1/sites', {
        headers: { Authorization: `Bearer ${activeToken}` }
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
  const loadUsers = async (authToken?: string) => {
    const activeToken = authToken || token;
    if (!activeToken) return;

    try {
      const res = await fetch('/api/v1/users', {
        headers: { Authorization: `Bearer ${activeToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.data && Array.isArray(data.data)) {
          setUsersList(data.data);
        }
      }
    } catch (err) {
      console.warn('Could not fetch users list:', err);
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

  const handleLoginSuccess = async (user: AuthUser, accessToken: string) => {
    setToken(accessToken);
    setCurrentUser(user);
    await loadSites(accessToken);
    if (user.role === 'admin') {
      await loadUsers(accessToken);
    }
  };

  const handleSetupSuccess = async (user: AuthUser, accessToken: string) => {
    setToken(accessToken);
    setCurrentUser(user);
    setSetupRequired(false);
    await loadSites(accessToken);
    await loadUsers(accessToken);
  };

  const handleLogout = () => {
    localStorage.removeItem('nexpanel_token');
    setToken(null);
    setCurrentUser(null);
    setActiveTab('sites');
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

  // 2. Auth or Setup Screen
  if (setupRequired || !token) {
    return (
      <AuthView
        setupRequired={setupRequired}
        onLoginSuccess={handleLoginSuccess}
        onSetupSuccess={handleSetupSuccess}
      />
    );
  }

  // 3. Authenticated Dashboard with Multi-User RBAC & Scoped Site Management
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
          {activeTab === 'sites' && (
            <SitesView
              sites={sites}
              currentUser={currentUser}
              token={token}
              onRefreshSites={() => loadSites()}
            />
          )}

          {activeTab === 'users' && isAdmin && (
            <UsersView
              usersList={usersList}
              currentUser={currentUser}
              sites={sites}
              token={token}
              onRefreshUsers={() => loadUsers()}
            />
          )}

          {activeTab === 'import' && (isAdmin || isSiteManager) && (
            <ImportView
              onImportCompleted={async () => {
                await loadSites();
              }}
            />
          )}

          {activeTab === 'engines' && isAdmin && <EnginesView />}

          {activeTab === 'edge' && isAdmin && <EdgeView />}

          {activeTab === 'security' && <SecurityView currentUser={currentUser} />}
        </main>
      </div>
    </div>
  );
}
