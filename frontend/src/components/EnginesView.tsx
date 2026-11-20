import React from 'react';

export const EnginesView: React.FC = () => {
  return (
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
  );
};
