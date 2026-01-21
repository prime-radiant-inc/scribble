type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

const LOG_LEVELS: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

interface LogEntry {
  timestamp: string;
  level: string;
  logger: string;
  message: string;
  data?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

export class Logger {
  private prefix: string;
  private level: number;
  private structured: boolean;

  constructor(prefix: string) {
    this.prefix = prefix;
    const envLevel = (process.env.LOG_LEVEL || 'info').toLowerCase() as LogLevel;
    this.level = LOG_LEVELS[envLevel] ?? LOG_LEVELS.info;
    this.structured = process.env.LOG_FORMAT === 'json';
  }

  private formatEntry(level: string, message: string, data?: Record<string, unknown>, error?: unknown): string {
    if (this.structured) {
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level,
        logger: this.prefix,
        message,
        data,
      };

      if (error) {
        if (error instanceof Error) {
          entry.error = {
            name: error.name,
            message: error.message,
            stack: error.stack,
          };
        } else {
          entry.error = { name: 'Unknown', message: String(error) };
        }
      }

      return JSON.stringify(entry);
    }

    // Legacy format
    const timestamp = new Date().toISOString();
    let output = `[${timestamp}] [${this.prefix}] ${level.toUpperCase()}: ${message}`;
    if (data) {
      output += ' ' + JSON.stringify(data);
    }
    if (error) {
      output += ' ' + (error instanceof Error ? error.stack || error.message : String(error));
    }
    return output;
  }

  info(message: string, data?: Record<string, unknown>): void {
    if (this.level >= LOG_LEVELS.info) {
      console.log(this.formatEntry('info', message, data));
    }
  }

  warn(message: string, data?: Record<string, unknown>): void {
    if (this.level >= LOG_LEVELS.warn) {
      console.warn(this.formatEntry('warn', message, data));
    }
  }

  error(message: string, error?: unknown): void {
    if (this.level >= LOG_LEVELS.error) {
      console.error(this.formatEntry('error', message, undefined, error));
    }
  }

  debug(message: string, data?: Record<string, unknown>): void {
    if (this.level >= LOG_LEVELS.debug) {
      console.debug(this.formatEntry('debug', message, data));
    }
  }
}
