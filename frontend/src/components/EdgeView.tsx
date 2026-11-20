import React from 'react';

export const EdgeView: React.FC = () => {
  return (
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
  );
};
