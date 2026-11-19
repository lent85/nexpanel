import { describe, it } from 'node:test';
import assert from 'node:assert';
import { PasswordHasher } from '../src/auth/passwords.js';
import { TotpService } from '../src/auth/totp.js';
import { RbacService, AuthContext } from '../src/rbac/rbac.js';

describe('PasswordHasher', () => {
  it('hashes and verifies passwords accurately', async () => {
    const raw = 'Str0ngP@ssw0rd!2026';
    const hash = await PasswordHasher.hash(raw);

    assert.strictEqual(hash.startsWith('scrypt:v1:'), true);
    assert.strictEqual(await PasswordHasher.verify(raw, hash), true);
    assert.strictEqual(await PasswordHasher.verify('wrong_password', hash), false);
  });

  it('rejects passwords shorter than 12 characters', async () => {
    await assert.rejects(
      async () => {
        await PasswordHasher.hash('short');
      },
      { message: 'Password must be at least 12 characters' }
    );
  });

  it('generates random strong passwords', () => {
    const pwd = PasswordHasher.generateStrongPassword(24);
    assert.strictEqual(pwd.length, 24);
  });
});

describe('TotpService', () => {
  it('generates TOTP setup, validates codes and handles single-use recovery codes', async () => {
    const setup = await TotpService.generateSetup('admin_user');
    assert.ok(setup.secret);
    assert.strictEqual(setup.qrCodeUrl.startsWith('data:image/png;base64,'), true);
    assert.strictEqual(setup.recoveryCodes.length, 10);
    assert.strictEqual(setup.hashedRecoveryCodes.length, 10);

    // Verify recovery code
    const code = setup.recoveryCodes[0];
    const check1 = TotpService.verifyRecoveryCode(code, setup.hashedRecoveryCodes);
    assert.strictEqual(check1.valid, true);
    assert.strictEqual(check1.remainingHashedCodes.length, 9);

    // Re-verify the same used code -> fails
    const check2 = TotpService.verifyRecoveryCode(code, check1.remainingHashedCodes);
    assert.strictEqual(check2.valid, false);
  });
});

describe('RbacService', () => {
  const adminCtx: AuthContext = { userId: 'u-1', role: 'admin' };
  const managerCtx: AuthContext = { userId: 'u-2', role: 'site_manager' };
  const userCtx: AuthContext = { userId: 'u-3', role: 'user', assignedSiteIds: ['site-abc'] };
  const clientCtx: AuthContext = { userId: 'u-4', role: 'client', assignedSiteIds: ['site-abc'] };

  it('enforces Admin capabilities', () => {
    assert.strictEqual(RbacService.can(adminCtx, 'admin:access'), true);
    assert.strictEqual(RbacService.can(adminCtx, 'users:manage'), true);
    assert.strictEqual(RbacService.can(adminCtx, 'sites:create'), true);
    assert.strictEqual(RbacService.can(adminCtx, 'secrets:reveal'), true);
  });

  it('enforces Site Manager restrictions (no Admin Area / user management)', () => {
    assert.strictEqual(RbacService.can(managerCtx, 'admin:access'), false);
    assert.strictEqual(RbacService.can(managerCtx, 'users:manage'), false);
    assert.strictEqual(RbacService.can(managerCtx, 'sites:create'), true);
    assert.strictEqual(RbacService.can(managerCtx, 'sites:delete'), true);
  });

  it('enforces User permissions limited to assigned sites', () => {
    assert.strictEqual(RbacService.can(userCtx, 'sites:create'), false);
    assert.strictEqual(RbacService.can(userCtx, 'sites:edit', 'site-abc'), true);
    assert.strictEqual(RbacService.can(userCtx, 'sites:edit', 'site-xyz'), false);
  });

  it('enforces Client read-only restrictions', () => {
    assert.strictEqual(RbacService.can(clientCtx, 'sites:view', 'site-abc'), true);
    assert.strictEqual(RbacService.can(clientCtx, 'sites:edit', 'site-abc'), false);
    assert.strictEqual(RbacService.can(clientCtx, 'db:create'), false);
    assert.strictEqual(RbacService.can(clientCtx, 'secrets:reveal'), false);
  });
});
