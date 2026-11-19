import * as fs from 'node:fs';
import * as path from 'node:path';

export interface BrandConfig {
  name: string;
  cliName: string;
  containerPrefix: string;
  version: string;
  license: string;
  description: string;
}

const defaultBrand: BrandConfig = {
  name: 'NexPanel',
  cliName: 'nxctl',
  containerPrefix: 'nexpanel-',
  version: '1.0.0',
  license: 'Apache-2.0',
  description: 'Docker-native server control panel with external NPM reverse proxy and pluggable database engines'
};

export function loadBrandConfig(customPath?: string): BrandConfig {
  const brandPath = customPath || path.resolve(process.cwd(), 'brand.json');
  try {
    if (fs.existsSync(brandPath)) {
      const data = fs.readFileSync(brandPath, 'utf8');
      return { ...defaultBrand, ...JSON.parse(data) };
    }
  } catch {
    // fallback to default
  }
  return defaultBrand;
}

export const brand = loadBrandConfig();
