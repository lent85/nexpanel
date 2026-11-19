export interface ProxyHostInput {
  domainNames: string[];
  forwardScheme: 'http' | 'https';
  forwardHost: string;
  forwardPort: number;
  certificateId?: number | 'new';
  sslForced?: boolean;
  hstsEnabled?: boolean;
  http2Support?: boolean;
  websocketSupport?: boolean;
  accessListId?: number;
  advancedConfig?: string;
  enabled?: boolean;
}

export interface CertInput {
  domainNames: string[];
  email: string;
  agreeTerms: boolean;
  dnsChallenge?: boolean;
  dnsProvider?: string;
  dnsCredentials?: Record<string, string>;
}

export interface CustomCertInput {
  name: string;
  certificate: string;
  key: string;
  intermediate?: string;
}

export interface AccessListUser {
  username: string;
  password?: string;
}

export interface AccessListClient {
  address: string;
  directive: 'allow' | 'deny';
}

export interface AccessListInput {
  name: string;
  satisfyAny?: boolean;
  passAuth?: boolean;
  items?: AccessListUser[];
  clients?: AccessListClient[];
}

export interface EdgeHost {
  id: number;
  domainNames: string[];
  forwardScheme: string;
  forwardHost: string;
  forwardPort: number;
  certificateId: number;
  sslForced: boolean;
  hstsEnabled: boolean;
  http2Support: boolean;
  websocketSupport: boolean;
  accessListId: number;
  enabled: boolean;
}

export interface EdgeCertificate {
  id: number;
  niceName: string;
  domainNames: string[];
  expiresOn?: string;
  provider: string;
}

export type DriftType = 'in_sync' | 'drifted' | 'missing_on_edge' | 'orphan_on_edge';

export interface HostDriftItem {
  domain: string;
  panelHostId?: string;
  edgeHostId?: number;
  status: DriftType;
  differences?: Record<string, { panel: unknown; edge: unknown }>;
}

export interface DriftReport {
  totalExpected: number;
  totalActual: number;
  inSync: number;
  drifted: number;
  missingOnEdge: number;
  orphanOnEdge: number;
  items: HostDriftItem[];
}

export interface EdgeProvider {
  readonly kind: 'npm';
  verifyConnection(): Promise<{ ok: boolean; version?: string; error?: string }>;
  createHost(input: ProxyHostInput): Promise<{ edgeId: number }>;
  updateHost(edgeId: number, input: Partial<ProxyHostInput>): Promise<void>;
  deleteHost(edgeId: number): Promise<void>;
  setHostEnabled(edgeId: number, enabled: boolean): Promise<void>;
  requestCertificate(input: CertInput): Promise<{ edgeCertId: number; expiresAt?: string }>;
  uploadCertificate(input: CustomCertInput): Promise<{ edgeCertId: number }>;
  listCertificates(): Promise<EdgeCertificate[]>;
  createAccessList(input: AccessListInput): Promise<{ edgeId: number }>;
  listHosts(): Promise<EdgeHost[]>;
}
