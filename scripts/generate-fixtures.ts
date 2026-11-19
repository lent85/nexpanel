import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import * as crypto from 'node:crypto';
import * as tar from 'tar';

const FIXTURES_DIR = path.resolve(process.cwd(), 'fixtures/cloudpanel');
const TEMP_BUILD_DIR = path.resolve(FIXTURES_DIR, 'temp-build');

async function main() {
  console.log('Generating synthetic CloudPanel fixtures...');
  if (fs.existsSync(TEMP_BUILD_DIR)) {
    fs.rmSync(TEMP_BUILD_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEMP_BUILD_DIR, { recursive: true });
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });

  // 1. Create WordPress files
  const wpDir = path.resolve(TEMP_BUILD_DIR, 'htdocs/example.com');
  fs.mkdirSync(wpDir, { recursive: true });

  const wpConfigContent = `<?php
define('DB_NAME', 'wp_example');
define('DB_USER', 'wp_example_user');
define('DB_PASSWORD', 'SecretWpPassword123!');
define('DB_HOST', 'localhost');
define('DB_CHARSET', 'utf8mb4');
define('DB_COLLATE', '');
$table_prefix = 'wp_';
define('WP_DEBUG', false);
if ( ! defined( 'ABSPATH' ) ) {
\tdefine( 'ABSPATH', __DIR__ . '/' );
}
require_once ABSPATH . 'wp-settings.php';
`;
  fs.writeFileSync(path.resolve(wpDir, 'wp-config.php'), wpConfigContent);

  const indexPhpContent = `<?php
define( 'WP_USE_THEMES', true );
require __DIR__ . '/wp-blog-header.php';
`;
  fs.writeFileSync(path.resolve(wpDir, 'index.php'), indexPhpContent);

  const themeDir = path.resolve(wpDir, 'wp-content/themes/twentytwentyfour');
  fs.mkdirSync(themeDir, { recursive: true });
  fs.writeFileSync(path.resolve(themeDir, 'style.css'), '/*\nTheme Name: Twenty Twenty-Four\nVersion: 1.1\n*/');

  // 2. Create Nightly DB dump in backups/
  const backupsDir = path.resolve(TEMP_BUILD_DIR, 'backups');
  fs.mkdirSync(backupsDir, { recursive: true });

  const sqlContent = `-- CloudPanel MySQL dump
-- Host: localhost    Database: wp_example
/*!40101 SET NAMES utf8mb4 */;
DROP TABLE IF EXISTS \`wp_options\`;
CREATE TABLE \`wp_options\` (
  \`option_id\` bigint unsigned NOT NULL AUTO_INCREMENT,
  \`option_name\` varchar(191) NOT NULL DEFAULT '',
  \`option_value\` longtext NOT NULL,
  \`autoload\` varchar(20) NOT NULL DEFAULT 'yes',
  PRIMARY KEY (\`option_id\`),
  UNIQUE KEY \`option_name\` (\`option_name\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO \`wp_options\` VALUES 
(1,'siteurl','https://example.com','yes'),
(2,'home','https://example.com','yes'),
(3,'blogname','Example Site','yes'),
(4,'admin_email','admin@example.com','yes');

DROP TABLE IF EXISTS \`wp_users\`;
CREATE TABLE \`wp_users\` (
  \`ID\` bigint unsigned NOT NULL AUTO_INCREMENT,
  \`user_login\` varchar(60) NOT NULL DEFAULT '',
  \`user_pass\` varchar(255) NOT NULL DEFAULT '',
  \`user_email\` varchar(100) NOT NULL DEFAULT '',
  PRIMARY KEY (\`ID\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO \`wp_users\` VALUES 
(1,'admin','$P$B1234567890abcdefghijklmnopqrst','admin@example.com');
`;

  const gzippedSql = zlib.gzipSync(Buffer.from(sqlContent, 'utf8'));
  const sqlDumpFile = path.resolve(backupsDir, 'wp_example-2026-11-18.sql.gz');
  fs.writeFileSync(sqlDumpFile, gzippedSql);

  // 3. Create Nginx vhost config
  const vhostDir = path.resolve(TEMP_BUILD_DIR, 'home/examplecom/conf/nginx');
  fs.mkdirSync(vhostDir, { recursive: true });

  const vhostContent = `server {
  listen 80;
  listen [::]:80;
  listen 443 ssl http2;
  listen [::]:443 ssl http2;
  server_name example.com www.example.com;
  root /home/examplecom/htdocs/example.com;

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
    fastcgi_pass php8.2-fpm;
  }

  location /wp-admin/ {
    # Custom snippet carried over
    try_files $uri $uri/ /index.php?$args;
  }
}
`;
  fs.writeFileSync(path.resolve(vhostDir, 'example.com.conf'), vhostContent);

  // 4. Pack into fixtures/cloudpanel/backup.tar (Remote backup variant A)
  const backupTarPath = path.resolve(FIXTURES_DIR, 'backup.tar');
  await tar.create(
    {
      file: backupTarPath,
      cwd: TEMP_BUILD_DIR
    },
    ['htdocs', 'backups', 'home']
  );
  console.log(`Created ${backupTarPath} (${fs.statSync(backupTarPath).size} bytes)`);

  // 5. Pack into fixtures/cloudpanel/local-files.tar.gz and db.sql.gz (Local pair variant B)
  const localFilesTarGz = path.resolve(FIXTURES_DIR, 'local-files.tar.gz');
  await tar.create(
    {
      file: localFilesTarGz,
      gzip: true,
      cwd: path.resolve(TEMP_BUILD_DIR, 'htdocs/example.com')
    },
    ['.']
  );
  console.log(`Created ${localFilesTarGz} (${fs.statSync(localFilesTarGz).size} bytes)`);

  const localDbGz = path.resolve(FIXTURES_DIR, 'local-db.sql.gz');
  fs.copyFileSync(sqlDumpFile, localDbGz);
  console.log(`Created ${localDbGz} (${fs.statSync(localDbGz).size} bytes)`);

  // 6. Create fixtures/cloudpanel/broken.tar (Truncated archive variant)
  const brokenTarPath = path.resolve(FIXTURES_DIR, 'broken.tar');
  const validTarBuf = fs.readFileSync(backupTarPath);
  // Truncate to half its size to create a corrupt/truncated tar
  const truncatedBuf = validTarBuf.subarray(0, Math.floor(validTarBuf.length / 2));
  fs.writeFileSync(brokenTarPath, truncatedBuf);
  console.log(`Created ${brokenTarPath} (${fs.statSync(brokenTarPath).size} bytes)`);

  // 7. Calculate and save sha256 checksums
  const checksums: Record<string, string> = {
    'backup.tar': crypto.createHash('sha256').update(fs.readFileSync(backupTarPath)).digest('hex'),
    'local-files.tar.gz': crypto.createHash('sha256').update(fs.readFileSync(localFilesTarGz)).digest('hex'),
    'local-db.sql.gz': crypto.createHash('sha256').update(fs.readFileSync(localDbGz)).digest('hex'),
    'broken.tar': crypto.createHash('sha256').update(fs.readFileSync(brokenTarPath)).digest('hex')
  };
  fs.writeFileSync(path.resolve(FIXTURES_DIR, 'checksums.json'), JSON.stringify(checksums, null, 2));

  // Clean up temp directory
  fs.rmSync(TEMP_BUILD_DIR, { recursive: true, force: true });
  console.log('Fixtures generated successfully.');
}

main().catch((err) => {
  console.error('Failed to generate fixtures:', err);
  process.exit(1);
});
