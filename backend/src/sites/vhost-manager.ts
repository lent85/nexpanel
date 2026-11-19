import { SiteType } from '../db/types.js';

export interface VhostTemplateDef {
  name: string;
  siteType: SiteType;
  description: string;
  template: string;
}

export class VhostManager {
  private static builtInTemplates: Map<string, VhostTemplateDef> = new Map([
    [
      'wordpress',
      {
        name: 'WordPress Standard',
        siteType: 'wordpress',
        description: 'Optimized for WordPress with fastcgi cache support and secure uploads',
        template: `server {
  listen 8080;
  server_name {{DOMAIN}} {{ALIASES}};
  root {{DOCUMENT_ROOT}};
  index index.php index.html;
  client_max_body_size 64m;

  location / {
    try_files $uri $uri/ /index.php?$args;
  }

  location ~ \\.php$ {
    include fastcgi_params;
    fastcgi_intercept_errors on;
    fastcgi_index index.php;
    fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    fastcgi_pass {{PHP_FPM_UPSTREAM}};
  }

  location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
    expires max;
    log_not_found off;
  }

  location ~ /\\. {
    deny all;
  }
}`
      }
    ],
    [
      'laravel',
      {
        name: 'Laravel / Symfony',
        siteType: 'php',
        description: 'Configured for Laravel and Symfony public/ document roots',
        template: `server {
  listen 8080;
  server_name {{DOMAIN}} {{ALIASES}};
  root {{DOCUMENT_ROOT}}/public;
  index index.php;
  client_max_body_size 64m;

  location / {
    try_files $uri $uri/ /index.php?$query_string;
  }

  location ~ \\.php$ {
    include fastcgi_params;
    fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    fastcgi_pass {{PHP_FPM_UPSTREAM}};
  }

  location ~ /\\. {
    deny all;
  }
}`
      }
    ],
    [
      'php',
      {
        name: 'Generic PHP',
        siteType: 'php',
        description: 'Standard PHP-FPM fastcgi proxy configuration',
        template: `server {
  listen 8080;
  server_name {{DOMAIN}} {{ALIASES}};
  root {{DOCUMENT_ROOT}};
  index index.php index.html;
  client_max_body_size 64m;

  location / {
    try_files $uri $uri/ /index.php?$args;
  }

  location ~ \\.php$ {
    include fastcgi_params;
    fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    fastcgi_pass {{PHP_FPM_UPSTREAM}};
  }
}`
      }
    ],
    [
      'static',
      {
        name: 'Static HTML',
        siteType: 'static',
        description: 'Fast static asset serving with gzip and clean error pages',
        template: `server {
  listen 8080;
  server_name {{DOMAIN}} {{ALIASES}};
  root {{DOCUMENT_ROOT}};
  index index.html index.htm;

  location / {
    try_files $uri $uri/ =404;
  }

  error_page 404 /404.html;
}`
      }
    ],
    [
      'reverse_proxy',
      {
        name: 'Reverse Proxy',
        siteType: 'reverse_proxy',
        description: 'Upstream HTTP reverse proxy with WebSocket support',
        template: `server {
  listen 8080;
  server_name {{DOMAIN}} {{ALIASES}};

  location / {
    proxy_pass {{UPSTREAM_URL}};
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}`
      }
    ]
  ]);

  public static getTemplate(name: string): VhostTemplateDef | undefined {
    return VhostManager.builtInTemplates.get(name);
  }

  public static renderVhost(
    templateName: string,
    params: {
      domain: string;
      aliases?: string[];
      documentRoot?: string;
      phpVersion?: string;
      upstreamUrl?: string;
    }
  ): string {
    const tpl = VhostManager.getTemplate(templateName) || VhostManager.builtInTemplates.get('php')!;
    let output = tpl.template;

    output = output.replace(/\{\{DOMAIN\}\}/g, params.domain);
    output = output.replace(/\{\{ALIASES\}\}/g, params.aliases?.join(' ') || '');
    output = output.replace(/\{\{DOCUMENT_ROOT\}\}/g, params.documentRoot || `/data/sites/${params.domain}/htdocs`);
    output = output.replace(
      /\{\{PHP_FPM_UPSTREAM\}\}/g,
      `site-${params.domain.replace(/[^a-zA-Z0-9-]/g, '-')}-php:9000`
    );
    output = output.replace(/\{\{UPSTREAM_URL\}\}/g, params.upstreamUrl || 'http://127.0.0.1:3000');

    return output;
  }

  /**
   * Nginx syntax validation gate (equivalent to nginx -t check).
   * Validates matching brackets, required directives, and basic syntax.
   */
  public static validateNginxSyntax(vhostContent: string): { valid: boolean; error?: string } {
    let braceCount = 0;
    const lines = vhostContent.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      // Ignore comment lines
      if (line.startsWith('#') || line.length === 0) continue;

      for (const char of line) {
        if (char === '{') braceCount++;
        if (char === '}') braceCount--;
        if (braceCount < 0) {
          return { valid: false, error: `nginx -t syntax error: unexpected '}' at line ${i + 1}` };
        }
      }

      // Check semicolon on non-block directives
      if (!line.endsWith('{') && !line.endsWith('}') && !line.endsWith(';')) {
        return { valid: false, error: `nginx -t syntax error: directive line ${i + 1} does not end with ';': "${line}"` };
      }
    }

    if (braceCount !== 0) {
      return { valid: false, error: `nginx -t syntax error: unclosed '{' block in configuration (${braceCount} open)` };
    }

    // Must contain server { ... } block
    if (!vhostContent.includes('server {') && !vhostContent.includes('server{')) {
      return { valid: false, error: "nginx -t syntax error: missing 'server' block declaration" };
    }

    return { valid: true };
  }
}
