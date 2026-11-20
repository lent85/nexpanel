import React, { useState } from 'react';
import { Globe, Plus, Trash2 } from 'lucide-react';
import { SiteItem, AuthUser } from '../types';

interface SitesViewProps {
  sites: SiteItem[];
  currentUser: AuthUser | null;
  token: string | null;
  onRefreshSites: () => Promise<void>;
}

export const SitesView: React.FC<SitesViewProps> = ({
  sites,
  currentUser,
  token,
  onRefreshSites
}) => {
  const [newDomain, setNewDomain] = useState('');
  const [newType, setNewType] = useState('wordpress');
  const [newPhp, setNewPhp] = useState('8.3');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const isClient = currentUser?.role === 'client';
  const isScopedUser = currentUser?.role === 'user';

  const handleCreateSite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDomain || !token) return;
    setCreateError(null);

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
      await onRefreshSites();
      setNewDomain('');
      setIsCreating(false);
    } catch (err: any) {
      setCreateError(err.message);
    }
  };

  const handleDeleteSite = async (id: string, domain: string) => {
    if (!confirm(`Are you sure you want to delete site '${domain}'?`)) return;
    if (!token) return;

    try {
      await fetch(`/api/v1/sites/${id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ confirmDomain: domain })
      });
      await onRefreshSites();
    } catch (err) {
      console.warn('API delete error:', err);
    }
  };

  return (
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
  );
};
