import * as fs from 'node:fs';
import * as path from 'node:path';

export interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  sizeBytes: number;
  modifiedAt: string;
  permissions: string;
}

export class FileService {
  public static sanitizePath(baseDir: string, relativePath: string): string {
    const normalizedBase = path.resolve(baseDir);
    const resolved = path.resolve(normalizedBase, relativePath);

    // 1. Lexical boundary check: relative path must not escape baseDir
    const rel = path.relative(normalizedBase, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      const err = new Error('Path traversal detected: Access denied');
      (err as any).statusCode = 403;
      throw err;
    }

    // Sibling directory check: ensures /var/www/site1 does not match /var/www/site1-secret
    const baseWithSep = normalizedBase.endsWith(path.sep) ? normalizedBase : normalizedBase + path.sep;
    if (resolved !== normalizedBase && !resolved.startsWith(baseWithSep)) {
      const err = new Error('Path traversal detected: Access denied');
      (err as any).statusCode = 403;
      throw err;
    }

    // 2. Symlink escape check
    const realBase = fs.existsSync(normalizedBase) ? fs.realpathSync(normalizedBase) : normalizedBase;
    const realBaseWithSep = realBase.endsWith(path.sep) ? realBase : realBase + path.sep;

    if (fs.existsSync(resolved)) {
      const realResolved = fs.realpathSync(resolved);
      if (realResolved !== realBase && !realResolved.startsWith(realBaseWithSep)) {
        const err = new Error('Path traversal detected: Symlink escape denied');
        (err as any).statusCode = 403;
        throw err;
      }
    } else {
      let curr = path.dirname(resolved);
      while (!fs.existsSync(curr) && curr !== path.dirname(curr)) {
        curr = path.dirname(curr);
      }
      if (fs.existsSync(curr)) {
        const realParent = fs.realpathSync(curr);
        if (realParent !== realBase && !realParent.startsWith(realBaseWithSep)) {
          const err = new Error('Path traversal detected: Symlink escape denied');
          (err as any).statusCode = 403;
          throw err;
        }
      }
    }

    return resolved;
  }

  public static listFiles(baseDir: string, subPath = ''): FileItem[] {
    const targetDir = FileService.sanitizePath(baseDir, subPath);
    if (!fs.existsSync(targetDir)) {
      return [];
    }

    const entries = fs.readdirSync(targetDir, { withFileTypes: true });
    return entries.map((e) => {
      const fullPath = path.resolve(targetDir, e.name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        stat = { size: 0, mtime: new Date(), mode: 0 } as any;
      }

      const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
      const isDir = e.isDirectory();
      const perms = (stat.mode & 0o777).toString(8);

      return {
        name: e.name,
        path: relPath,
        isDirectory: isDir,
        sizeBytes: isDir ? 0 : stat.size,
        modifiedAt: stat.mtime.toISOString(),
        permissions: perms
      };
    });
  }

  public static readFile(baseDir: string, relativePath: string): string {
    const targetFile = FileService.sanitizePath(baseDir, relativePath);
    if (!fs.existsSync(targetFile)) {
      const err = new Error(`File not found: ${relativePath}`);
      (err as any).statusCode = 404;
      throw err;
    }
    return fs.readFileSync(targetFile, 'utf8');
  }

  public static writeFile(baseDir: string, relativePath: string, content: string): void {
    const targetFile = FileService.sanitizePath(baseDir, relativePath);
    const dir = path.dirname(targetFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(targetFile, content, 'utf8');
  }

  public static createDirectory(baseDir: string, relativePath: string): void {
    const targetDir = FileService.sanitizePath(baseDir, relativePath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
  }

  public static moveToTrash(baseDir: string, trashDir: string, relativePath: string): void {
    const targetFile = FileService.sanitizePath(baseDir, relativePath);
    if (!fs.existsSync(targetFile)) {
      const err = new Error(`File not found: ${relativePath}`);
      (err as any).statusCode = 404;
      throw err;
    }

    if (!fs.existsSync(trashDir)) {
      fs.mkdirSync(trashDir, { recursive: true });
    }

    const filename = path.basename(targetFile);
    const timestampedName = `${filename}.${Date.now()}`;
    const destination = path.resolve(trashDir, timestampedName);

    fs.renameSync(targetFile, destination);
  }
}
