<?php
define('DB_NAME', 'wp_example');
define('DB_USER', 'wp_example_user');
define('DB_PASSWORD', 'Z8VlPZn3u5Q+ULNLBK7DFMd&');
define('DB_HOST', 'nexpanel-mysql');
define('DB_CHARSET', 'utf8mb4');
define('DB_COLLATE', '');
$table_prefix = 'wp_';
define('WP_DEBUG', false);
if ( ! defined( 'ABSPATH' ) ) {
	define( 'ABSPATH', __DIR__ . '/' );
}
require_once ABSPATH . 'wp-settings.php';
