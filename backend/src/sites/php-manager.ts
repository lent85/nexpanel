export interface PhpSettings {
  memoryLimit: string; // e.g. "256M"
  maxExecutionTime: number; // e.g. 300
  uploadMaxFilesize: string; // e.g. "64M"
  postMaxSize: string; // e.g. "64M"
  maxInputVars: number; // e.g. 3000
  displayErrors: boolean;
  opcacheEnabled: boolean;
  timezone: string;
}

export const DEFAULT_PHP_SETTINGS: PhpSettings = {
  memoryLimit: '256M',
  maxExecutionTime: 300,
  uploadMaxFilesize: '64M',
  postMaxSize: '64M',
  maxInputVars: 3000,
  displayErrors: false,
  opcacheEnabled: true,
  timezone: 'Asia/Bangkok'
};

export class PhpManager {
  public static readonly SUPPORTED_VERSIONS = [
    '7.1', '7.2', '7.3', '7.4',
    '8.0', '8.1', '8.2', '8.3', '8.4', '8.5'
  ] as const;

  public static isSupported(version: string): boolean {
    return (PhpManager.SUPPORTED_VERSIONS as readonly string[]).includes(version);
  }

  public static getImageForVersion(version: string): string {
    if (!PhpManager.isSupported(version)) {
      throw new Error(`Unsupported PHP version '${version}'. Supported versions: ${PhpManager.SUPPORTED_VERSIONS.join(', ')}`);
    }
    return `nexpanel/php:${version}-fpm`;
  }

  public static renderPhpIni(settings: Partial<PhpSettings> = {}): string {
    const s = { ...DEFAULT_PHP_SETTINGS, ...settings };
    return `; NexPanel Per-Site PHP Configuration Override
memory_limit = ${s.memoryLimit}
max_execution_time = ${s.maxExecutionTime}
upload_max_filesize = ${s.uploadMaxFilesize}
post_max_size = ${s.postMaxSize}
max_input_vars = ${s.maxInputVars}
display_errors = ${s.displayErrors ? 'On' : 'Off'}
date.timezone = "${s.timezone}"
opcache.enable = ${s.opcacheEnabled ? '1' : '0'}
opcache.memory_consumption = 128
opcache.interned_strings_buffer = 16
opcache.max_accelerated_files = 10000
`;
  }

  public static renderFpmPoolConfig(siteSlug: string, siteUid = 1001): string {
    return `[${siteSlug}]
user = ${siteUid}
group = ${siteUid}
listen = 0.0.0.0:9000
pm = dynamic
pm.max_children = 20
pm.start_servers = 2
pm.min_spare_servers = 1
pm.max_spare_servers = 3
pm.max_requests = 500
clear_env = no
catch_workers_output = yes
`;
  }
}
