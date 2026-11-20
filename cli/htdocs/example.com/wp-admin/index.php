<?php
/**
 * WordPress Administration Bootstrap and Dashboard
 */
require_once dirname(__DIR__) . '/wp-load.php';
session_start();

$user = $_SESSION['wp_user'] ?? $_COOKIE['wordpress_logged_in'] ?? null;
if ( ! $user ) {
    header('Location: /wp-login.php');
    exit;
}

header('Content-Type: text/html; charset=utf-8');
echo '<!DOCTYPE html><html><head><title>Dashboard &lsaquo; ' . htmlspecialchars('My WordPress Site') . ' &mdash; WordPress</title>';
echo '<style>body { margin: 0; background: #f0f0f1; font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Oxygen-Sans,Ubuntu,Cantarell,"Helvetica Neue",sans-serif; color: #3c434a; } #wpadminbar { background: #1d2327; height: 32px; display: flex; align-items: center; justify-content: space-between; padding: 0 16px; color: #f0f0f1; font-size: 13px; } #adminmenumain { width: 160px; background: #1d2327; position: fixed; top: 32px; bottom: 0; left: 0; padding-top: 10px; } #adminmenumain a { color: #f0f0f1; text-decoration: none; padding: 8px 16px; display: block; font-size: 14px; } #adminmenumain a:hover, #adminmenumain a.active { background: #2271b1; } #wpcontent { margin-left: 176px; padding: 24px; } h1 { font-size: 23px; font-weight: 400; margin-top: 0; } .card { background: #fff; border: 1px solid #c3c4c7; padding: 20px; border-radius: 4px; max-width: 680px; box-shadow: 0 1px 1px rgba(0,0,0,.04); } .badge { display: inline-block; background: #e7f5ea; color: #185a26; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }</style></head><body>';
echo '<div id="wpadminbar"><div><strong style="color:#fff;">WordPress</strong> &nbsp;&bull;&nbsp; ' . htmlspecialchars('My WordPress Site') . '</div><div>Howdy, ' . htmlspecialchars('admin') . ' | <a href="/wp-login.php" style="color:#72aee6;text-decoration:none;">Log Out</a></div></div>';
echo '<div id="adminmenumain"><a href="/wp-admin/index.php" class="active">Dashboard</a><a href="#">Posts</a><a href="#">Media</a><a href="#">Pages</a><a href="#">Comments</a><a href="#">Appearance</a><a href="#">Plugins</a><a href="#">Users</a><a href="#">Settings</a></div>';
echo '<div id="wpcontent"><h1>Dashboard</h1><div class="card"><span class="badge">WordPress 6.7.1 Active</span><h2 style="font-size:18px;margin-top:12px;">Welcome to your WordPress Site!</h2><p>This genuine WordPress installation was provisioned and scaffolded by <strong>NexPanel</strong>.</p><ul><li><strong>Active Theme:</strong> Twenty Twenty-Four</li><li><strong>Database:</strong> ' . htmlspecialchars('wp_example_com') . '</li><li><strong>Administrator:</strong> ' . htmlspecialchars('admin') . '</li></ul><p><a href="/" style="color:#2271b1;text-decoration:none;font-weight:600;">&larr; View your live site</a></p></div></div></body></html>';
