import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Standard for GCM
const AUTH_TAG_LENGTH = 16;

export interface VaultKeyMetadata {
  version: number;
  createdAt: string;
}

export class VaultService {
  private keyPath: string;
  private currentKey: Buffer | null = null;
  private previousKeys: Map<number, Buffer> = new Map();

  constructor(keyPath: string) {
    this.keyPath = keyPath;
  }

  public initialize(passphrase?: string): void {
    const dir = path.dirname(this.keyPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(this.keyPath)) {
      // Generate fresh 256-bit key
      const key = crypto.randomBytes(32);
      fs.writeFileSync(this.keyPath, key, { mode: 0o600 });
      // On Windows chmod is limited, but set 0o600 for POSIX
      try {
        fs.chmodSync(this.keyPath, 0o600);
      } catch {
        // ignore on Windows if not supported
      }
      this.currentKey = key;
    } else {
      this.currentKey = fs.readFileSync(this.keyPath);
      if (this.currentKey.length !== 32) {
        throw new Error(`Invalid vault key length at ${this.keyPath}, expected 32 bytes.`);
      }
    }
  }

  public getKey(): Buffer {
    if (!this.currentKey) {
      this.initialize();
    }
    return this.currentKey!;
  }

  /**
   * Encrypts plaintext string using AES-256-GCM.
   * Returns format: vault:enc:v1:<hex(iv)>:<hex(authTag)>:<hex(ciphertext)>
   */
  public encrypt(plaintext: string): string {
    const key = this.getKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final()
    ]);
    const authTag = cipher.getAuthTag();

    return `vault:enc:v1:${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
  }

  /**
   * Decrypts encrypted payload formatted as vault:enc:v1:<iv>:<authTag>:<ciphertext>
   */
  public decrypt(encryptedValue: string): string {
    if (!encryptedValue.startsWith('vault:enc:v1:')) {
      throw new Error('Unsupported encrypted payload format');
    }

    const parts = encryptedValue.split(':');
    if (parts.length !== 6) {
      throw new Error('Malformed encrypted vault string');
    }

    const ivHex = parts[3];
    const authTagHex = parts[4];
    const ciphertextHex = parts[5];

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const ciphertext = Buffer.from(ciphertextHex, 'hex');

    const key = this.getKey();
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]);

    return plaintext.toString('utf8');
  }

  /**
   * Rotates key: saves new key to file and registers old key to previousKeys.
   */
  public rotateKey(): Buffer {
    const oldKey = this.getKey();
    const newKey = crypto.randomBytes(32);
    this.previousKeys.set(Date.now(), oldKey);

    const backupPath = `${this.keyPath}.bak.${Date.now()}`;
    fs.copyFileSync(this.keyPath, backupPath);

    fs.writeFileSync(this.keyPath, newKey, { mode: 0o600 });
    this.currentKey = newKey;
    return newKey;
  }

  /**
   * Masks any sensitive value for display or logs.
   */
  public static mask(val?: string): string {
    if (!val) return '';
    return '••••••••';
  }

  private static defaultInstance: VaultService | null = null;

  public static getDefaultInstance(): VaultService {
    if (!this.defaultInstance) {
      const keyPath = process.env.VAULT_KEY_PATH || path.resolve(process.cwd(), 'data/vault.key');
      this.defaultInstance = new VaultService(keyPath);
      this.defaultInstance.initialize();
    }
    return this.defaultInstance;
  }

  public static reload(keyPath?: string): void {
    const targetPath = keyPath || process.env.VAULT_KEY_PATH || path.resolve(process.cwd(), 'data/vault.key');
    this.defaultInstance = new VaultService(targetPath);
    this.defaultInstance.initialize();
  }

  public static encrypt(plaintext: string): string {
    return this.getDefaultInstance().encrypt(plaintext);
  }

  public static decrypt(cipherRef: string): string {
    return this.getDefaultInstance().decrypt(cipherRef);
  }

  public static isEncrypted(value?: string | null): boolean {
    return typeof value === 'string' && value.startsWith('vault:enc:v1:');
  }

  /**
   * Deeply sanitizes objects to remove any passwords, keys, tokens before logging or auditing.
   */
  public static sanitizeObject(obj: unknown): unknown {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== 'object') return obj;

    if (Array.isArray(obj)) {
      return obj.map((item) => VaultService.sanitizeObject(item));
    }

    const sensitiveKeyPatterns = [
      /password/i,
      /secret/i,
      /token/i,
      /jwt/i,
      /credential/i,
      /key/i,
      /auth_?tag/i,
      /ciphertext/i
    ];

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (sensitiveKeyPatterns.some((pattern) => pattern.test(key))) {
        result[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        result[key] = VaultService.sanitizeObject(value);
      } else if (typeof value === 'string' && value.startsWith('vault:enc:')) {
        result[key] = '[ENCRYPTED_SECRET]';
      } else {
        result[key] = value;
      }
    }
    return result;
  }
}
