import * as fs from 'fs';
import * as path from 'path';
import type { LogConfig, AccessLogEntry } from '../types';
import { ConfigLoader } from '../config/loader';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class LoggerService {
  private static instance: LoggerService | null = null;
  private config: LogConfig;
  private currentDate: string;
  private currentFileIndex: number;
  private currentFileSize: number;
  private readonly accessLogPrefix = 'access';
  private readonly maxSizeBytes: number;
  private logDirAbsolute: string;

  private constructor() {
    this.config = ConfigLoader.getInstance().getLogConfig();
    this.currentDate = this.formatDate(new Date());
    this.currentFileIndex = 0;
    this.currentFileSize = 0;
    this.maxSizeBytes = this.config.maxFileSizeMb * 1024 * 1024;
    this.logDirAbsolute = path.resolve(process.cwd(), this.config.logDir);
    this.ensureLogDir();
    this.detectCurrentFileState();
  }

  public static getInstance(): LoggerService {
    if (LoggerService.instance === null) {
      LoggerService.instance = new LoggerService();
    }
    return LoggerService.instance;
  }

  public static reset(): void {
    LoggerService.instance = null;
  }

  public isEnabled(): boolean {
    return this.config.enabled;
  }

  public logAccess(entry: AccessLogEntry): void {
    if (!this.config.enabled) return;

    const level: LogLevel = entry.statusCode >= 500 ? 'error' : entry.statusCode >= 400 ? 'warn' : 'info';
    if (!this.shouldLog(level)) return;

    const logLine = this.formatAccessLog(entry);

    if (this.config.consoleEnabled) {
      this.writeToConsole(level, logLine);
    }

    if (this.config.fileEnabled) {
      void this.writeToFile(logLine);
    }
  }

  public debug(message: string, meta?: Record<string, unknown>): void {
    this.writeLog('debug', message, meta);
  }

  public info(message: string, meta?: Record<string, unknown>): void {
    this.writeLog('info', message, meta);
  }

  public warn(message: string, meta?: Record<string, unknown>): void {
    this.writeLog('warn', message, meta);
  }

  public error(message: string, meta?: Record<string, unknown>): void {
    this.writeLog('error', message, meta);
  }

  public getLogDir(): string {
    return this.logDirAbsolute;
  }

  public getCurrentLogFileName(): string {
    return `${this.accessLogPrefix}-${this.currentDate}.${this.currentFileIndex}.log`;
  }

  private writeLog(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (!this.config.enabled || !this.shouldLog(level)) return;

    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` | ${JSON.stringify(meta)}` : '';
    const line = `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;

    if (this.config.consoleEnabled) {
      this.writeToConsole(level, line);
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.config.level];
  }

  private writeToConsole(level: LogLevel, line: string): void {
    switch (level) {
      case 'error':
        console.error(line);
        break;
      case 'warn':
        console.warn(line);
        break;
      case 'debug':
        console.debug(line);
        break;
      default:
        console.log(line);
    }
  }

  private async writeToFile(line: string): Promise<void> {
    try {
      this.rotateIfNeeded();

      const filePath = this.getCurrentFilePath();
      const buffer = Buffer.from(line + '\n', 'utf8');

      await fs.promises.appendFile(filePath, buffer);
      this.currentFileSize += buffer.length;

      this.cleanupOldFiles();
    } catch (err) {
      console.error('[Logger] 写入日志文件失败:', err);
    }
  }

  private formatAccessLog(entry: AccessLogEntry): string {
    const parts = [
      new Date(entry.timestamp).toISOString(),
      entry.requestId,
      entry.apiKey ? entry.apiKey.slice(0, 8) + '...' : 'NO_KEY',
      `"${entry.keyName}"`,
      entry.method,
      entry.path,
      String(entry.statusCode),
      `${entry.durationMs}ms`,
      entry.cacheHit ? `CACHE_HIT(x${entry.cacheHitCount})` : 'CACHE_MISS',
    ];

    if (entry.error) {
      parts.push(`err="${entry.error.replace(/"/g, "'")}"`);
    }
    if (entry.clientIp) {
      parts.push(`ip="${entry.clientIp}"`);
    }

    return parts.join(' | ');
  }

  private ensureLogDir(): void {
    if (!fs.existsSync(this.logDirAbsolute)) {
      try {
        fs.mkdirSync(this.logDirAbsolute, { recursive: true });
      } catch (err) {
        console.error('[Logger] 创建日志目录失败:', err);
      }
    }
  }

  private detectCurrentFileState(): void {
    try {
      const files = fs
        .readdirSync(this.logDirAbsolute)
        .filter((f) => f.startsWith(`${this.accessLogPrefix}-${this.currentDate}.`))
        .sort()
        .reverse();

      if (files.length > 0) {
        const latest = files[0] as string;
        const match = /\.(\d+)\.log$/.exec(latest);
        if (match) {
          this.currentFileIndex = parseInt(match[1] as string, 10);
          const filePath = path.join(this.logDirAbsolute, latest);
          try {
            const stat = fs.statSync(filePath);
            this.currentFileSize = stat.size;
          } catch {
            this.currentFileSize = 0;
          }
        }
      }
    } catch {
      // ignore
    }
  }

  private rotateIfNeeded(): void {
    const today = this.formatDate(new Date());

    if (today !== this.currentDate) {
      this.currentDate = today;
      this.currentFileIndex = 0;
      this.currentFileSize = 0;
      return;
    }

    if (this.currentFileSize >= this.maxSizeBytes) {
      this.currentFileIndex++;
      this.currentFileSize = 0;
    }
  }

  private getCurrentFilePath(): string {
    return path.join(this.logDirAbsolute, this.getCurrentLogFileName());
  }

  private cleanupOldFiles(): void {
    try {
      const prefixPattern = new RegExp(`^${this.accessLogPrefix}-\\d{4}-\\d{2}-\\d{2}\\.`);
      const files = fs
        .readdirSync(this.logDirAbsolute)
        .filter((f) => prefixPattern.test(f))
        .sort();

      if (files.length > this.config.maxFiles) {
        const toRemove = files.length - this.config.maxFiles;
        for (let i = 0; i < toRemove; i++) {
          const fileName = files[i] as string;
          try {
            fs.unlinkSync(path.join(this.logDirAbsolute, fileName));
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }
  }

  private formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}
