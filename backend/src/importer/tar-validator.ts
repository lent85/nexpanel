import * as fs from 'node:fs';

export interface TarValidationResult {
  valid: boolean;
  error?: string;
  fileSizeBytes: number;
}

export class TarValidator {
  private static readonly BLOCK_SIZE = 512;
  private static readonly TRAILER_SIZE = 1024; // Two 512-byte zero blocks

  public static async validate(filePath: string, expectedSizeBytes?: number): Promise<TarValidationResult> {
    if (!fs.existsSync(filePath)) {
      return { valid: false, error: 'File does not exist', fileSizeBytes: 0 };
    }

    const stat = fs.statSync(filePath);
    const size = stat.size;

    if (expectedSizeBytes !== undefined && size !== expectedSizeBytes) {
      return {
        valid: false,
        error: `Backup appears truncated (expected ${expectedSizeBytes} bytes, got ${size})`,
        fileSizeBytes: size
      };
    }

    // Minimum tar size must be at least the 1024-byte EOF marker
    if (size < TarValidator.TRAILER_SIZE) {
      return {
        valid: false,
        error: `Archive too small to be a valid tar archive (${size} bytes)`,
        fileSizeBytes: size
      };
    }

    // Size must be a multiple of 512
    if (size % TarValidator.BLOCK_SIZE !== 0) {
      return {
        valid: false,
        error: `Archive is corrupted: file size ${size} is not a multiple of ${TarValidator.BLOCK_SIZE} bytes`,
        fileSizeBytes: size
      };
    }

    // Check trailer: last 1024 bytes must be all zeros
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(TarValidator.TRAILER_SIZE);
    try {
      fs.readSync(fd, buffer, 0, TarValidator.TRAILER_SIZE, size - TarValidator.TRAILER_SIZE);
      const isAllZeros = buffer.every((byte) => byte === 0);
      if (!isAllZeros) {
        return {
          valid: false,
          error: 'Archive appears truncated: missing terminal EOF zero blocks',
          fileSizeBytes: size
        };
      }
    } finally {
      fs.closeSync(fd);
    }

    return { valid: true, fileSizeBytes: size };
  }
}
