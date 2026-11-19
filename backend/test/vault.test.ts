import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { VaultService } from '../src/vault/vault.js';

describe('VaultService (AES-256-GCM)', () => {
  const testDir = path.resolve(process.cwd(), 'temp-test-vault');
  const keyPath = path.resolve(testDir, 'vault.key');

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('initializes and generates a 32-byte key file', () => {
    const vault = new VaultService(keyPath);
    vault.initialize();

    assert.strictEqual(fs.existsSync(keyPath), true);
    const key = fs.readFileSync(keyPath);
    assert.strictEqual(key.length, 32);
  });

  it('encrypts and decrypts secret strings correctly', () => {
    const vault = new VaultService(keyPath);
    vault.initialize();

    const secret = 'super_secret_db_password_1234!';
    const encrypted = vault.encrypt(secret);

    assert.strictEqual(encrypted.startsWith('vault:enc:v1:'), true);
    assert.strictEqual(encrypted.includes(secret), false);

    const decrypted = vault.decrypt(encrypted);
    assert.strictEqual(decrypted, secret);
  });

  it('masks secret values with bullet dots', () => {
    assert.strictEqual(VaultService.mask('my_secret'), '••••••••');
    assert.strictEqual(VaultService.mask(''), '');
  });

  it('deeply sanitizes objects to eliminate passwords and tokens', () => {
    const sensitiveObj = {
      domain: 'example.com',
      dbPassword: 'plain_password',
      config: {
        apiKey: 'sk-12345',
        nested: {
          secretToken: 'jwt_val'
        }
      },
      vaultEncrypted: 'vault:enc:v1:abc:def:ghi'
    };

    const sanitized: any = VaultService.sanitizeObject(sensitiveObj);

    assert.strictEqual(sanitized.domain, 'example.com');
    assert.strictEqual(sanitized.dbPassword, '[REDACTED]');
    assert.strictEqual(sanitized.config.apiKey, '[REDACTED]');
    assert.strictEqual(sanitized.config.nested.secretToken, '[REDACTED]');
    assert.strictEqual(sanitized.vaultEncrypted, '[ENCRYPTED_SECRET]');
  });

  it('supports key rotation without losing old key reference', () => {
    const vault = new VaultService(keyPath);
    vault.initialize();

    const originalKey = vault.getKey();
    const newKey = vault.rotateKey();

    assert.strictEqual(newKey.length, 32);
    assert.strictEqual(newKey.equals(originalKey), false);
  });
});
