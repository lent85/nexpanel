import fs from 'node:fs';
import path from 'node:path';

export interface ReadLogOptions {
  tail?: number;
  search?: string;
}

export class LogService {
  static getLogFilePath(logDir: string, logType: string): string {
    const filename = logType.endsWith('.log') ? logType : `${logType}.log`;
    return path.join(logDir, filename);
  }

  static appendLog(logDir: string, logType: string, line: string): void {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const filePath = this.getLogFilePath(logDir, logType);
    fs.appendFileSync(filePath, line.endsWith('\n') ? line : `${line}\n`, 'utf-8');
  }

  static readLogs(logDir: string, logType: string, options: ReadLogOptions = {}): string[] {
    const filePath = this.getLogFilePath(logDir, logType);
    if (!fs.existsSync(filePath)) {
      return [];
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    let lines = content.split('\n').filter((l) => l.length > 0);

    if (options.search) {
      const searchLower = options.search.toLowerCase();
      lines = lines.filter((l) => l.toLowerCase().includes(searchLower));
    }

    if (options.tail && options.tail > 0) {
      lines = lines.slice(-options.tail);
    }

    return lines;
  }
}

