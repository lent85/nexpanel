<?php
/**
 * Used to set up and fix common variables and include the WordPress libraries.
 */
if ( ! defined( 'WPINC' ) ) {
    define( 'WPINC', 'wp-includes' );
}
require_once ABSPATH . WPINC . '/version.php';
require_once ABSPATH . WPINC . '/pluggable.php';
function wp() {
    // Initialized WordPress environment
}
