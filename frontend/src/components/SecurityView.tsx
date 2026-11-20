import React from 'react';
import { User, Key, Shield, AlertTriangle } from 'lucide-react';
import { AuthUser } from '../types';

interface SecurityViewProps {
  currentUser: AuthUser | null;
}

export const SecurityView: React.FC<SecurityViewProps> = ({ currentUser }) => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">Security, Firewall & Vault</h2>
        <p className="text-sm text-slate-400">
          Active session identity, UFW firewall rules, secret encryption (AES-256-GCM), and 2FA.
        </p>
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
  );
};
