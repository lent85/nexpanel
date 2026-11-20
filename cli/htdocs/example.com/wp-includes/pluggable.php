<?php
if ( ! function_exists( 'wp_hash_password' ) ) {
    function wp_hash_password( $password ) { return password_hash( $password, PASSWORD_BCRYPT ); }
}
if ( ! function_exists( 'wp_check_password' ) ) {
    function wp_check_password( $password, $hash ) { return password_verify( $password, $hash ); }
}
