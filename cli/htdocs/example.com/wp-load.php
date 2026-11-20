<?php
/**
 * Bootstrap file for setting the ABSPATH constant and loading wp-config.php.
 */
define( 'ABSPATH', __DIR__ . '/' );
error_reporting( E_CORE_ERROR | E_CORE_WARNING | E_COMPILE_ERROR | E_ERROR | E_PARSE | E_USER_ERROR | E_RECOVERABLE_ERROR );
if ( file_exists( ABSPATH . 'wp-config.php' ) ) {
    require_once ABSPATH . 'wp-config.php';
} else {
    header( 'HTTP/1.1 500 Internal Server Error' );
    die( 'wp-config.php not found.' );
}
