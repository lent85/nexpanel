import jwt from 'jsonwebtoken';
import * as crypto from 'node:crypto';
import { UserRole } from '../db/types.js';
import { getEnv } from '../config/env.js';

export interface TokenPayload {
  sub: string; // user id
  username: string;
  email: string;
  role: UserRole;
  scopes?: string[];
  type: 'access' | 'refresh' | '2fa_challenge';
}

export class JwtService {
  public static signAccessToken(payload: Omit<TokenPayload, 'type'>): string {
    const env = getEnv();
    return jwt.sign(
      { ...payload, type: 'access' },
      env.JWT_SECRET,
      { expiresIn: env.JWT_ACCESS_EXPIRY as any }
    );
  }

  public static sign2FaChallengeToken(payload: { sub: string; username: string; email: string; role: UserRole }): string {
    const env = getEnv();
    return jwt.sign(
      { ...payload, type: '2fa_challenge', scopes: ['2fa:verify'] },
      env.JWT_SECRET,
      { expiresIn: '5m' }
    );
  }

  public static verify2FaChallengeToken(token: string): TokenPayload {
    const payload = JwtService.verify(token);
    if (payload.type !== '2fa_challenge') {
      const err = new Error('Invalid token: expected 2FA challenge token');
      (err as any).statusCode = 401;
      throw err;
    }
    return payload;
  }

  public static signRefreshToken(payload: Omit<TokenPayload, 'type'>): { token: string; hash: string } {
    const env = getEnv();
    const token = jwt.sign(
      { ...payload, type: 'refresh' },
      env.JWT_SECRET,
      { expiresIn: env.JWT_REFRESH_EXPIRY as any }
    );
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    return { token, hash };
  }

  public static verify(token: string): TokenPayload {
    const env = getEnv();
    const decoded = jwt.verify(token, env.JWT_SECRET) as TokenPayload;
    return decoded;
  }
}
