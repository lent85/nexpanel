import React, { useState } from 'react';
import { Users, Plus, Sliders, Key, Trash2, ShieldCheck, X, Check } from 'lucide-react';
import { PanelUserItem, SiteItem, AuthUser } from '../types';

interface UsersViewProps {
  usersList: PanelUserItem[];
  currentUser: AuthUser | null;
  sites: SiteItem[];
  token: string | null;
  onRefreshUsers: () => Promise<void>;
}

export const UsersView: React.FC<UsersViewProps> = ({
  usersList,
  currentUser,
  sites,
  token,
  onRefreshUsers
}) => {
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

      await onRefreshUsers();
      setUserModalOpen(false);
      setNewUsername('');
      setNewUserEmail('');
      setNewUserAssignedSites([]);
    } catch (err: any) {
      setUserModalError(err.message);
    }
  };

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
        await onRefreshUsers();
      }
    } catch (err) {
      console.error('Failed to toggle status:', err);
    }
  };

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

  const handleDeleteUser = async (user: PanelUserItem) => {
    if (!token) return;
    if (!confirm(`Are you sure you want to permanently delete user '${user.username}'?`)) return;

    try {
      const res = await fetch(`/api/v1/users/${user.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        await onRefreshUsers();
      } else {
        const data = await res.json();
        alert(data.error?.message || 'Failed to delete user');
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  const openScopeModal = (user: PanelUserItem) => {
    setScopeModalUser(user);
    setSelectedScopeSiteIds(user.assignedSiteIds || []);
    setScopeSuccess(false);
  };

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
        await onRefreshUsers();
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

  return (
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

      {/* Add User Modal */}
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

      {/* Edit Site Scope Modal */}
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
                <Check className="w-4 h-4 shrink-0" />
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
};
