import { z } from 'zod';
import * as dotenv from 'dotenv';
import * as path from 'node:path';

dotenv.config();

const booleanFromString = z.preprocess((val) => {
  if (typeof val === 'string') {
    const lower = val.trim().toLowerCase();
    if (lower === 'false' || lower === '0' || lower === 'no' || lower === '') return false;
    if (lower === 'true' || lower === '1' || lower === 'yes') return true;
  }
  return Boolean(val);
}, z.boolean());

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PANEL_PORT: z.coerce.number().default(8443),
  PANEL_HOST: z.string().default('0.0.0.0'),
  PANEL_DOMAIN: z.string().default('panel.example.com'),
  PANEL_BASE_URL: z.string().default('https://panel.example.com'),
  PANEL_TIMEZONE: z.string().default('Asia/Bangkok'),
  PANEL_DEFAULT_PHP: z.string().default('8.3'),
  PANEL_DEFAULT_DB_ENGINE: z.string().default('internal-mysql'),
  VAULT_KEY_PATH: z.string().default(path.resolve(process.cwd(), 'data/panel/vault.key')),
  JWT_SECRET: z.string().default('nexpanel_jwt_secret_change_me_in_production_min32chars'),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),
  
  // Panel Metadata DB
  PANEL_DB_HOST: z.string().default('localhost'),
  PANEL_DB_PORT: z.coerce.number().default(5432),
  PANEL_DB_USER: z.string().default('nexpanel'),
  PANEL_DB_PASSWORD: z.string().default('nexpanel_secret'),
  PANEL_DB_NAME: z.string().default('nexpanel'),
  PANEL_DB_USE_MEMORY: booleanFromString.default(false), // Robust boolean parsing

  // Edge / NPM
  NPM_BASE_URL: z.string().default('http://npm:81'),
  NPM_ADMIN_EMAIL: z.string().default('admin@example.com'),
  NPM_ADMIN_PASSWORD: z.string().default('changeme'),
  NPM_NETWORK: z.string().default('proxy'),
  NPM_LETSENCRYPT_EMAIL: z.string().default('admin@example.com'),

  // Site Defaults
  SITES_DATA_DIR: z.string().default(path.resolve(process.cwd(), 'data/sites')),
  PANEL_DATA_DIR: z.string().default(path.resolve(process.cwd(), 'data/panel'))
}).refine((data) => {
  if (data.NODE_ENV === 'production') {
    if (!data.JWT_SECRET || data.JWT_SECRET.includes('change_me') || data.JWT_SECRET.length < 32) {
      return false;
    }
  }
  return true;
}, {
  message: 'In production mode, JWT_SECRET must be explicitly configured and be at least 32 characters long',
  path: ['JWT_SECRET']
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (!cachedEnv) {
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
      console.error('Invalid environment variables:', result.error.format());
      throw new Error('Invalid environment configuration');
    }
    cachedEnv = result.data;
  }
  return cachedEnv;
}

export function resetEnvCache(): void {
  cachedEnv = null;
}
