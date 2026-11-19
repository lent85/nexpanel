import * as crypto from 'node:crypto';

/**
 * Uses scrypt (or Argon2id compatible scheme) for secure password hashing.
 * Output format: scrypt:v1:<salt-hex>:<hash-hex>
 */
export class PasswordHasher {
  private static readonly KEY_LEN = 64;
  private static readonly SCRYPT_OPTIONS: crypto.ScryptOptions = {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 32 * 1024 * 1024
  };

  public static async hash(password: string): Promise<string> {
    if (password.length < 12) {
      throw new Error('Password must be at least 12 characters');
    }

    const salt = crypto.randomBytes(16);
    return new Promise((resolve, reject) => {
      crypto.scrypt(password, salt, PasswordHasher.KEY_LEN, PasswordHasher.SCRYPT_OPTIONS, (err, derivedKey) => {
        if (err) return reject(err);
        resolve(`scrypt:v1:${salt.toString('hex')}:${derivedKey.toString('hex')}`);
      });
    });
  }

  public static async verify(password: string, storedHash: string): Promise<boolean> {
    const parts = storedHash.split(':');
    if (parts.length !== 4 || parts[0] !== 'scrypt' || parts[1] !== 'v1') {
      return false;
    }

    const salt = Buffer.from(parts[2], 'hex');
    const expectedKey = Buffer.from(parts[3], 'hex');

    return new Promise((resolve) => {
      crypto.scrypt(password, salt, PasswordHasher.KEY_LEN, PasswordHasher.SCRYPT_OPTIONS, (err, derivedKey) => {
        if (err) return resolve(false);
        resolve(crypto.timingSafeEqual(expectedKey, derivedKey));
      });
    });
  }

  public static generateStrongPassword(length = 24): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+';
    const bytes = crypto.randomBytes(length);
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars[bytes[i] % chars.length];
    }
    return result;
  }

  public static generateRandomPassword(length = 24): string {
    return this.generateStrongPassword(length);
  }
}
