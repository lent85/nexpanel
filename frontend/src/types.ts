export interface SiteItem {
  id: string;
  domain: string;
  type: string;
  phpVersion?: string;
  status: string;
}

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  role: 'admin' | 'site_manager' | 'user' | 'client';
  status?: string;
  totpEnabled?: boolean;
  assignedSiteIds?: string[];
}

export interface PanelUserItem {
  id: string;
  email: string;
  username: string;
  role: 'admin' | 'site_manager' | 'user' | 'client';
  status: 'active' | 'disabled';
  totp_enabled: boolean;
  assignedSiteIds?: string[];
  created_at: string;
}
