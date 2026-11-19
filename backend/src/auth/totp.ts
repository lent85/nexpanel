import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import * as crypto from 'node:crypto';
import { brand } from '../config/brand.js';

export interface TotpSetupResult {
  secret: string;
  qrCodeUrl: string;
  otpauthUrl: string;
  recoveryCodes: string[];
  hashedRecoveryCodes: string[];
}

export class TotpService {
  public static async generateSetup(username: string): Promise<TotpSetupResult> {
    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(username, brand.name, secret);
    const qrCodeUrl = await QRCode.toDataURL(otpauthUrl);

    // 10 random recovery codes
    const recoveryCodes: string[] = [];
    const hashedRecoveryCodes: string[] = [];
    for (let i = 0; i < 10; i++) {
      const code = crypto.randomBytes(4).toString('hex').toUpperCase(); // 8 chars e.g. A1B2C3D4
      recoveryCodes.push(code);
      hashedRecoveryCodes.push(crypto.createHash('sha256').update(code).digest('hex'));
    }

    return {
      secret,
      qrCodeUrl,
      otpauthUrl,
      recoveryCodes,
      hashedRecoveryCodes
    };
  }

  public static verify(token: string, secret: string): boolean {
    return authenticator.verify({ token, secret });
  }

  public static verifyRecoveryCode(code: string, hashedCodes: string[]): { valid: boolean; remainingHashedCodes: string[] } {
    const hash = crypto.createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
    const idx = hashedCodes.indexOf(hash);
    if (idx === -1) {
      return { valid: false, remainingHashedCodes: hashedCodes };
    }
    const remaining = [...hashedCodes];
    remaining.splice(idx, 1);
    return { valid: true, remainingHashedCodes: remaining };
  }
}
