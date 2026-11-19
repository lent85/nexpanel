import React, { useState } from 'react';
import {
  Globe,
  Database,
  Download,
  Shield,
  Server,
  RefreshCw,
  Plus,
  Trash2,
  ExternalLink,
  CheckCircle,
  AlertTriangle,
  RotateCcw
} from 'lucide-react';

interface SiteItem {
  id: string;
  domain: string;
  type: string;
  phpVersion?: string;
  status: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'sites' | 'import' | 'engines' | 'security' | 'edge'>('sites');
  const [sites, setSites] = useState<SiteItem[]>([
    { id: '1', domain: 'example.com', type: 'wordpress', phpVersion: '8.3', status: 'live' },
    { id: '2', domain: 'api.example.com', type: 'nodejs', status: 'live' }
  ]);
  const [newDomain, setNewDomain] = useState('');
  const [newType, setNewType] = useState('wordpress');
  const [newPhp, setNewPhp] = useState('8.3');
  const [isCreating, setIsCreating] = useState(false);

  // CloudPanel Import state
  const [importSource, setImportSource] = useState<'backup_tar' | 'local_tar_gz' | 'live_ssh'>('backup_tar');
  const [importFile, setImportFile] = useState('/tmp/cloudpanel-backup.tar');
  const [dryRunRan, setDryRunRan] = useState(false);
  const [importRunning, setImportRunning] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const [rolledBack, setRolledBack] = useState(false);

  const handleCreateSite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDomain) return;
    const newSite: SiteItem = {
      id: Math.random().toString(36).substring(2, 9),
      domain: newDomain,
      type: newType,
      phpVersion: newType === 'wordpress' || newType === 'php' ? newPhp : undefined,
      status: 'live'
    };
    setSites([newSite, ...sites]);
    setNewDomain('');
    setIsCreating(false);
  };

  const handleDeleteSite = (id: string) => {
    setSites(sites.filter((s) => s.id !== id));
  };

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

        {/* Architectural Directives Badges */}
        <div className="hidden md:flex items-center space-x-3 text-xs">
          <span className="px-2.5 py-1 rounded-full bg-emerald-950/80 border border-emerald-800 text-emerald-400 font-medium flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            R1: NPM 2.16.0 (:80/:443)
          </span>
          <span className="px-2.5 py-1 rounded-full bg-indigo-950/80 border border-indigo-800 text-indigo-400 font-medium">
            R2: Pluggable DB Engines
          </span>
          <span className="px-2.5 py-1 rounded-full bg-amber-950/80 border border-amber-800 text-amber-400 font-medium">
            R3: CloudPanel Import Ready
          </span>
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
            Sites & Vhosts
          </button>

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

          <button
            onClick={() => setActiveTab('security')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-sm transition ${
              activeTab === 'security'
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
            }`}
          >
            <Shield className="w-4 h-4" />
            Security & Firewall
          </button>
        </aside>

        {/* Content Area */}
        <main className="flex-1 bg-slate-900 border border-slate-800 rounded-2xl p-6">
          {/* Sites Tab */}
          {activeTab === 'sites' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold">Managed Sites</h2>
                  <p className="text-sm text-slate-400">WordPress, PHP, Node.js, Python, Static, and Reverse Proxy origins</p>
                </div>
                <button
                  onClick={() => setIsCreating(true)}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 shadow-lg shadow-indigo-600/20"
                >
                  <Plus className="w-4 h-4" />
                  New Site
                </button>
              </div>

              {/* Create Site Form */}
              {isCreating && (
                <form onSubmit={handleCreateSite} className="bg-slate-950 border border-slate-800 p-5 rounded-xl space-y-4">
                  <h3 className="font-semibold text-sm">Create New Site Origin</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">Domain Name</label>
                      <input
                        type="text"
                        placeholder="example.com"
                        value={newDomain}
                        onChange={(e) => setNewDomain(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">Site Type</label>
                      <select
                        value={newType}
                        onChange={(e) => setNewType(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                      >
                        <option value="wordpress">WordPress (Auto-scaffold)</option>
                        <option value="php">Standard PHP</option>
                        <option value="nodejs">Node.js</option>
                        <option value="python">Python (WSGI)</option>
                        <option value="static">Static HTML</option>
                        <option value="reverse_proxy">Reverse Proxy</option>
                      </select>
                    </div>
                    {(newType === 'wordpress' || newType === 'php') && (
                      <div>
                        <label className="text-xs text-slate-400 block mb-1">PHP Version</label>
                        <select
                          value={newPhp}
                          onChange={(e) => setNewPhp(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                        >
                          <option value="8.3">PHP 8.3 (Default)</option>
                          <option value="8.2">PHP 8.2</option>
                          <option value="8.1">PHP 8.1</option>
                          <option value="8.4">PHP 8.4</option>
                          <option value="7.4">PHP 7.4 (Legacy)</option>
                        </select>
                      </div>
                    )}
                  </div>
                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setIsCreating(false)}
                      className="px-4 py-1.5 text-sm text-slate-400 hover:text-white"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-1.5 rounded-lg text-sm font-medium"
                    >
                      Provision Site
                    </button>
                  </div>
                </form>
              )}

              {/* Site Table */}
              <div className="border border-slate-800 rounded-xl overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-950/60 text-slate-400 text-xs border-b border-slate-800">
                    <tr>
                      <th className="py-3 px-4 font-medium">Domain</th>
                      <th className="py-3 px-4 font-medium">Type</th>
                      <th className="py-3 px-4 font-medium">PHP/Runtime</th>
                      <th className="py-3 px-4 font-medium">Status</th>
                      <th className="py-3 px-4 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {sites.map((s) => (
                      <tr key={s.id} className="hover:bg-slate-800/30 transition">
                        <td className="py-3.5 px-4 font-semibold text-white flex items-center gap-2">
                          {s.domain}
                          <a href={`http://${s.domain}`} target="_blank" rel="noreferrer" className="text-slate-500 hover:text-slate-300">
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </td>
                        <td className="py-3.5 px-4 capitalize text-slate-300">{s.type}</td>
                        <td className="py-3.5 px-4 text-slate-400">{s.phpVersion ? `PHP ${s.phpVersion}` : '—'}</td>
                        <td className="py-3.5 px-4">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-950/80 border border-emerald-800 text-emerald-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                            {s.status}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <button
                            onClick={() => handleDeleteSite(s.id)}
                            className="p-1.5 text-slate-500 hover:text-rose-400 transition rounded-lg hover:bg-slate-800"
                            title="Delete to Trash"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* CloudPanel Import Tab */}
          {activeTab === 'import' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold">CloudPanel Migration & Import</h2>
                <p className="text-sm text-slate-400">Import sites directly with Dry-Run diff simulation and 1-Click Rollback (R3)</p>
              </div>

              {/* Source Selector */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <button
                  onClick={() => setImportSource('backup_tar')}
                  className={`p-4 rounded-xl border text-left transition ${
                    importSource === 'backup_tar'
                      ? 'border-indigo-500 bg-indigo-950/20 text-white'
                      : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:bg-slate-800/40'
                  }`}
                >
                  <p className="font-semibold text-sm text-white mb-1">Source A: Remote backup.tar</p>
                  <p className="text-xs">CloudPanel full site backup with vhost, htdocs, and MySQL dump</p>
                </button>

                <button
                  onClick={() => setImportSource('local_tar_gz')}
                  className={`p-4 rounded-xl border text-left transition ${
                    importSource === 'local_tar_gz'
                      ? 'border-indigo-500 bg-indigo-950/20 text-white'
                      : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:bg-slate-800/40'
                  }`}
                >
                  <p className="font-semibold text-sm text-white mb-1">Source B: File Pair</p>
                  <p className="text-xs">Separate local-files.tar.gz + local-db.sql.gz pair</p>
                </button>

                <button
                  onClick={() => setImportSource('live_ssh')}
                  className={`p-4 rounded-xl border text-left transition ${
                    importSource === 'live_ssh'
                      ? 'border-indigo-500 bg-indigo-950/20 text-white'
                      : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:bg-slate-800/40'
                  }`}
                >
                  <p className="font-semibold text-sm text-white mb-1">Source C: Live Server SSH</p>
                  <p className="text-xs">Direct remote extraction from a running CloudPanel instance</p>
                </button>
              </div>

              {/* Source Input */}
              <div className="bg-slate-950 border border-slate-800 p-5 rounded-xl space-y-4">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Archive Path or Source Reference</label>
                  <input
                    type="text"
                    value={importFile}
                    onChange={(e) => setImportFile(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>

                {/* Actions */}
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setDryRunRan(true);
                      setRolledBack(false);
                    }}
                    className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Simulate Dry-Run Diff
                  </button>

                  <button
                    disabled={!dryRunRan || importRunning || importDone}
                    onClick={() => {
                      setImportRunning(true);
                      setTimeout(() => {
                        setImportRunning(false);
                        setImportDone(true);
                      }, 1200);
                    }}
                    className={`px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 ${
                      dryRunRan && !importDone
                        ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30'
                        : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                    }`}
                  >
                    <Download className="w-4 h-4" />
                    {importRunning ? 'Importing Site...' : 'Execute Import'}
                  </button>

                  {importDone && !rolledBack && (
                    <button
                      onClick={() => setRolledBack(true)}
                      className="bg-rose-950 border border-rose-800 hover:bg-rose-900 text-rose-300 px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2"
                    >
                      <RotateCcw className="w-4 h-4" />
                      1-Click Rollback
                    </button>
                  )}
                </div>
              </div>

              {/* Dry Run Diff Viewer */}
              {dryRunRan && (
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
                      Dry-Run Simulation Output
                    </span>
                    <span className="text-xs text-emerald-400 flex items-center gap-1">
                      <CheckCircle className="w-3.5 h-3.5" /> Simulation Validated
                    </span>
                  </div>
                  <div className="text-xs font-mono bg-slate-900 p-4 rounded-lg text-slate-300 space-y-1 overflow-x-auto">
                    <p className="text-emerald-400">[VALID] Site Domain: wp-site.example.com</p>
                    <p className="text-slate-400">[INFO] Detected Runtime: WordPress (PHP 8.3)</p>
                    <p className="text-slate-400">[INFO] Target Database Engine: Internal MySQL 8.4 (Docker)</p>
                    <p className="text-slate-400">[INFO] Database: wp_live_db (14 tables, ~12.4 MB)</p>
                    <p className="text-slate-400">[INFO] Edge Route: NPM Proxy Host forward -&gt; site-wp-site-example-com-web:8080</p>
                    <p className="text-amber-400">[GUARD] Integrity check passed. Zero modifications made in dry-run mode.</p>
                  </div>
                </div>
              )}

              {importDone && (
                <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-800 text-emerald-300 text-sm flex items-center gap-3">
                  <CheckCircle className="w-5 h-5 text-emerald-400" />
                  <div>
                    <p className="font-semibold">Import Completed Successfully</p>
                    <p className="text-xs text-emerald-400/80">Site, database, users, and NPM proxy host were created idempotently.</p>
                  </div>
                </div>
              )}

              {rolledBack && (
                <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-300 text-sm flex items-center gap-3">
                  <RotateCcw className="w-5 h-5 text-rose-400" />
                  <div>
                    <p className="font-semibold">Import Rolled Back Cleanly</p>
                    <p className="text-xs text-rose-400/80">Database, site files, and proxy routes were safely purged to pre-import state.</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Database Engines Tab */}
          {activeTab === 'engines' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold">Database Engines Registry</h2>
                <p className="text-sm text-slate-400">Pluggable DB engines per site (R2). Private metadata PostgreSQL DB is strictly isolated.</p>
              </div>

              <div className="border border-slate-800 rounded-xl overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-950/60 text-slate-400 text-xs border-b border-slate-800">
                    <tr>
                      <th className="py-3 px-4 font-medium">Engine Name</th>
                      <th className="py-3 px-4 font-medium">Mode</th>
                      <th className="py-3 px-4 font-medium">Type</th>
                      <th className="py-3 px-4 font-medium">Host : Port</th>
                      <th className="py-3 px-4 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    <tr className="hover:bg-slate-800/30">
                      <td className="py-3.5 px-4 font-semibold text-white">Default MySQL 8.4</td>
                      <td className="py-3.5 px-4 text-slate-300 font-mono text-xs">internal-docker</td>
                      <td className="py-3.5 px-4 text-slate-300">MySQL 8.4</td>
                      <td className="py-3.5 px-4 text-slate-400 font-mono text-xs">nexpanel-mysql:3306</td>
                      <td className="py-3.5 px-4">
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-950 border border-emerald-800 text-emerald-400">
                          Active (Default)
                        </span>
                      </td>
                    </tr>
                    <tr className="hover:bg-slate-800/30">
                      <td className="py-3.5 px-4 font-semibold text-white">External Host MariaDB</td>
                      <td className="py-3.5 px-4 text-slate-300 font-mono text-xs">external-docker</td>
                      <td className="py-3.5 px-4 text-slate-300">MariaDB 11.4</td>
                      <td className="py-3.5 px-4 text-slate-400 font-mono text-xs">mariadb-custom:3306</td>
                      <td className="py-3.5 px-4">
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-950 border border-indigo-800 text-indigo-400">
                          Immutable
                        </span>
                      </td>
                    </tr>
                    <tr className="hover:bg-slate-800/30">
                      <td className="py-3.5 px-4 font-semibold text-white">AWS RDS PostgreSQL</td>
                      <td className="py-3.5 px-4 text-slate-300 font-mono text-xs">external-remote</td>
                      <td className="py-3.5 px-4 text-slate-300">PostgreSQL 16</td>
                      <td className="py-3.5 px-4 text-slate-400 font-mono text-xs">rds.example.com:5432</td>
                      <td className="py-3.5 px-4">
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-950 border border-indigo-800 text-indigo-400">
                          Connected
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Edge Proxy Tab */}
          {activeTab === 'edge' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold">Edge Reverse Proxy (Nginx Proxy Manager)</h2>
                <p className="text-sm text-slate-400">Ports 80/443 exclusively owned by NPM 2.16.0. Panel forwards strictly by container names (R1).</p>
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

          {/* Security Tab */}
          {activeTab === 'security' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold">Security, Firewall & Vault</h2>
                <p className="text-sm text-slate-400">UFW firewall rules, secret encryption (AES-256-GCM), and 2FA settings.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
    </div>
  );
}
