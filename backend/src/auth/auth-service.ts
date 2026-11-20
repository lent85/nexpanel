import { v7 as uuidv7 } from 'uuid';
import { getDb } from '../db/index.js';
import { User, UserRole } from '../db/types.js';
import { PasswordHasher } from './passwords.js';
import { JwtService } from './jwt.js';
import { TotpService } from './totp.js';
import { AuditService } from '../audit/audit.js';
import { VaultService } from '../vault/vault.js';

let setupStartTime: number = Date.now();
const SETUP_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

export class AuthService {
  public static setSetupStartTime(time: number): void {
    setupStartTime = time;
  }

  public static async isSetupMode(): Promise<boolean> {
    const db = getDb();
    const res = await db.query<User>('SELECT id FROM users LIMIT 1');
    return res.rows.length === 0;
  }

  public static async canUseWebSetup(): Promise<boolean> {
    const isSetup = await AuthService.isSetupMode();
    if (!isSetup) return false;
    const elapsed = Date.now() - setupStartTime;
    return elapsed <= SETUP_TIMEOUT_MS;
  }

  public static async registerFirstAdmin(params: {
    email: string;
    username: string;
    password: string;
    ip?: string;
  }): Promise<{ user: User; accessToken: string; refreshToken: string }> {
    const isSetup = await AuthService.isSetupMode();
    if (!isSetup) {
      const err = new Error('Setup mode is closed. Administrator already exists.');
      (err as any).statusCode = 400;
      throw err;
    }

    const canWeb = await AuthService.canUseWebSetup();
    if (!canWeb) {
      const err = new Error('Setup mode expired after 15 minutes. Use CLI `nxctl user:add` to create administrator.');
      (err as any).statusCode = 403;
      throw err;
    }

    return AuthService.createUser({
      email: params.email,
      username: params.username,
      password: params.password,
      role: 'admin',
      ip: params.ip,
      isFirstAdmin: true
    });
  }

  public static async createUser(params: {
    email: string;
    username: string;
    password: string;
    role: UserRole;
    firstName?: string;
    lastName?: string;
    timezone?: string;
    language?: string;
    ip?: string;
    isFirstAdmin?: boolean;
    actorUserId?: string;
  }): Promise<{ user: User; accessToken: string; refreshToken: string }> {
    const db = getDb();

    // Check unique email and username
    const existing = await db.query<User>(
      'SELECT id FROM users WHERE email = $1 OR username = $2',
      [params.email.toLowerCase(), params.username.toLowerCase()]
    );
    if (existing.rows.length > 0) {
      const err = new Error('Email or username already exists');
      (err as any).statusCode = 409;
      throw err;
    }

    const passwordHash = await PasswordHasher.hash(params.password);
    const id = uuidv7();
    const now = new Date().toISOString();

    const user: User = {
      id,
      email: params.email.toLowerCase(),
      username: params.username.toLowerCase(),
      firstName: params.firstName,
      lastName: params.lastName,
      passwordHash,
      role: params.role,
      status: 'active',
      timezone: params.timezone || 'Asia/Bangkok',
      language: params.language || 'en',
      totpEnabled: false,
      createdAt: now,
      updatedAt: now
    };

    await db.execute(
      `INSERT INTO users (id, email, username, first_name, last_name, password_hash, role, status, timezone, language, totp_enabled, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        user.id,
        user.email,
        user.username,
        user.firstName || null,
        user.lastName || null,
        user.passwordHash,
        user.role,
        user.status,
        user.timezone,
        user.language,
        user.totpEnabled,
        user.createdAt,
        user.updatedAt
      ]
    );

    await AuditService.log({
      actorUserId: params.actorUserId || user.id,
      actorIp: params.ip,
      action: params.isFirstAdmin ? 'auth.setup.first_admin' : 'user.create',
      entityType: 'user',
      entityId: user.id,
      after: { id: user.id, username: user.username, email: user.email, role: user.role }
    });

    const accessToken = JwtService.signAccessToken({
      sub: user.id,
      username: user.username,
      email: user.email,
      role: user.role
    });

    const { token: refreshToken, hash: refreshHash } = JwtService.signRefreshToken({
      sub: user.id,
      username: user.username,
      email: user.email,
      role: user.role
    });

    await AuthService.createSession(user.id, refreshHash, params.ip);

    return { user, accessToken, refreshToken };
  }

  public static async login(params: {
    identifier?: string; // username or email
    password?: string;
    challengeToken?: string;
    totpToken?: string;
    recoveryCode?: string;
    ip?: string;
    userAgent?: string;
  }): Promise<{ user: User; accessToken?: string; refreshToken?: string; requires2Fa?: boolean; temp2FaToken?: string }> {
    const db = getDb();
    const ip = params.ip || '127.0.0.1';

    let user: User;
    let identifier = '';

    // A. 2FA Completion via Challenge Token
    if (params.challengeToken) {
      const challenge = JwtService.verify2FaChallengeToken(params.challengeToken);
      const res = await db.query<User>(
        'SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL',
        [challenge.sub]
      );
      if (res.rows.length === 0) {
        const err = new Error('User not found');
        (err as any).statusCode = 401;
        throw err;
      }
      const row: any = res.rows[0];
      user = {
        id: row.id,
        email: row.email,
        username: row.username,
        firstName: row.first_name || row.firstName,
        lastName: row.last_name || row.lastName,
        passwordHash: row.password_hash || row.passwordHash,
        role: row.role,
        status: row.status,
        timezone: row.timezone,
        language: row.language,
        totpEnabled: row.totp_enabled ?? row.totpEnabled ?? false,
        totpSecretRef: row.totp_secret_ref || row.totpSecretRef,
        recoveryCodesHash: row.recovery_codes_hash
          ? (typeof row.recovery_codes_hash === 'string' ? JSON.parse(row.recovery_codes_hash) : row.recovery_codes_hash)
          : [],
        lastLoginAt: row.last_login_at || row.lastLoginAt,
        lastLoginIp: row.last_login_ip || row.lastLoginIp,
        createdAt: row.created_at || row.createdAt,
        updatedAt: row.updated_at || row.updatedAt
      };

      if (user.status !== 'active') {
        const err = new Error('User account is disabled');
        (err as any).statusCode = 403;
        throw err;
      }
      identifier = user.username;
    } else {
      // B. Standard Password Flow
      if (!params.identifier || !params.password) {
        const err = new Error('Missing identifier or password');
        (err as any).statusCode = 400;
        throw err;
      }
      identifier = params.identifier.trim().toLowerCase();

      // 1. Check brute force lockout (5 failed attempts within 15 min)
      const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const recentFails = await db.query(
        `SELECT count(*) as count FROM login_attempts WHERE (identifier = $1 OR ip_address = $2) AND success = FALSE AND attempted_at >= $3`,
        [identifier, ip, fifteenMinAgo]
      );

      const failCount = parseInt((recentFails.rows[0] as any)?.count || '0', 10);
      if (failCount >= 5) {
        await AuditService.log({
          actorIp: ip,
          action: 'auth.login_locked',
          entityType: 'user',
          after: { identifier, reason: 'Brute force protection: 5 failed attempts in 15 minutes' }
        });
        const err = new Error('Account locked due to too many failed login attempts. Please try again after 15 minutes.');
        (err as any).statusCode = 429;
        throw err;
      }

      // 2. Fetch user
      const res = await db.query<User>(
        'SELECT * FROM users WHERE (email = $1 OR username = $1) AND deleted_at IS NULL',
        [identifier]
      );

      if (res.rows.length === 0) {
        await AuthService.recordLoginAttempt(identifier, ip, false);
        const err = new Error('Invalid credentials');
        (err as any).statusCode = 401;
        throw err;
      }

      const row: any = res.rows[0];
      user = {
        id: row.id,
        email: row.email,
        username: row.username,
        firstName: row.first_name || row.firstName,
        lastName: row.last_name || row.lastName,
        passwordHash: row.password_hash || row.passwordHash,
        role: row.role,
        status: row.status,
        timezone: row.timezone,
        language: row.language,
        totpEnabled: row.totp_enabled ?? row.totpEnabled ?? false,
        totpSecretRef: row.totp_secret_ref || row.totpSecretRef,
        recoveryCodesHash: row.recovery_codes_hash
          ? (typeof row.recovery_codes_hash === 'string' ? JSON.parse(row.recovery_codes_hash) : row.recovery_codes_hash)
          : [],
        lastLoginAt: row.last_login_at || row.lastLoginAt,
        lastLoginIp: row.last_login_ip || row.lastLoginIp,
        createdAt: row.created_at || row.createdAt,
        updatedAt: row.updated_at || row.updatedAt
      };

      if (user.status !== 'active') {
        const err = new Error('User account is disabled');
        (err as any).statusCode = 403;
        throw err;
      }

      // 3. Verify password
      const passwordValid = await PasswordHasher.verify(params.password, user.passwordHash);
      if (!passwordValid) {
        await AuthService.recordLoginAttempt(identifier, ip, false);
        const err = new Error('Invalid credentials');
        (err as any).statusCode = 401;
        throw err;
      }
    }

    // 4. Verify 2FA if enabled
    if (user.totpEnabled) {
      if (!params.totpToken && !params.recoveryCode) {
        // Return 2FA challenge token with restricted type
        const temp2FaToken = JwtService.sign2FaChallengeToken({
          sub: user.id,
          username: user.username,
          email: user.email,
          role: user.role
        });
        return { user, requires2Fa: true, temp2FaToken };
      }

      // Check TOTP token
      if (params.totpToken) {
        let rawSecret = user.totpSecretRef || '';
        if (VaultService.isEncrypted(rawSecret)) {
          try {
            rawSecret = VaultService.decrypt(rawSecret);
          } catch {}
        }
        const isValid = TotpService.verify(params.totpToken, rawSecret);
        if (!isValid) {
          await AuthService.recordLoginAttempt(identifier, ip, false);
          const err = new Error('Invalid two-factor authentication code');
          (err as any).statusCode = 401;
          throw err;
        }
      } else if (params.recoveryCode) {
        const hashedCodes = user.recoveryCodesHash || [];
        const check = TotpService.verifyRecoveryCode(params.recoveryCode, hashedCodes);
        if (!check.valid) {
          await AuthService.recordLoginAttempt(identifier, ip, false);
          const err = new Error('Invalid recovery code');
          (err as any).statusCode = 401;
          throw err;
        }

        // Consume the used recovery code
        await db.execute(
          'UPDATE users SET recovery_codes_hash = $1, updated_at = $2 WHERE id = $3',
          [JSON.stringify(check.remainingHashedCodes), new Date().toISOString(), user.id]
        );
        user.recoveryCodesHash = check.remainingHashedCodes;
      }
    }

    // 5. Successful login
    await AuthService.recordLoginAttempt(identifier, ip, true);

    const now = new Date().toISOString();
    await db.execute(
      `UPDATE users SET last_login_at = $1, last_login_ip = $2, updated_at = $3 WHERE id = $4`,
      [now, ip, now, user.id]
    );

    await AuditService.log({
      actorUserId: user.id,
      actorIp: ip,
      action: 'auth.login_success',
      entityType: 'user',
      entityId: user.id,
      after: { userId: user.id, username: user.username }
    });

    const accessToken = JwtService.signAccessToken({
      sub: user.id,
      username: user.username,
      email: user.email,
      role: user.role
    });

    const { token: refreshToken, hash: refreshHash } = JwtService.signRefreshToken({
      sub: user.id,
      username: user.username,
      email: user.email,
      role: user.role
    });

    await AuthService.createSession(user.id, refreshHash, ip, params.userAgent);

    return { user, accessToken, refreshToken };
  }

  private static async recordLoginAttempt(identifier: string, ip: string, success: boolean): Promise<void> {
    const db = getDb();
    const id = uuidv7();
    await db.execute(
      `INSERT INTO login_attempts (id, identifier, ip_address, success, attempted_at) VALUES ($1, $2, $3, $4, $5)`,
      [id, identifier, ip, success, new Date().toISOString()]
    );
  }

  private static async createSession(userId: string, tokenHash: string, ip?: string, userAgent?: string): Promise<void> {
    const db = getDb();
    const id = uuidv7();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

    await db.execute(
      `INSERT INTO sessions (id, user_id, token_hash, ip_address, user_agent, expires_at, created_at, last_active_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, userId, tokenHash, ip || null, userAgent || null, expiresAt, now.toISOString(), now.toISOString()]
    );
  }
}
