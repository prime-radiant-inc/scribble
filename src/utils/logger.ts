type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

const LOG_LEVELS: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

function getLogLevel(): LogLevel {
  const level = process.env.LOG_LEVEL?.toLowerCase();
  if (level && level in LOG_LEVELS) {
    return level as LogLevel;
  }
  return 'info';
}

export class Logger {
  private prefix: string;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  private shouldLog(level: LogLevel): boolean {
    const currentLevel = getLogLevel();
    return LOG_LEVELS[level] <= LOG_LEVELS[currentLevel];
  }

  info(message: string, data?: Record<string, unknown>) {
    if (!this.shouldLog('info')) return;
    console.log(`[${new Date().toISOString()}] [${this.prefix}] INFO:`, message, data ?? '');
  }

  error(message: string, error?: unknown) {
    if (!this.shouldLog('error')) return;
    console.error(`[${new Date().toISOString()}] [${this.prefix}] ERROR:`, message, error);
  }

  warn(message: string, data?: Record<string, unknown>) {
    if (!this.shouldLog('warn')) return;
    console.warn(`[${new Date().toISOString()}] [${this.prefix}] WARN:`, message, data ?? '');
  }

  debug(message: string, data?: Record<string, unknown>) {
    if (!this.shouldLog('debug')) return;
    console.debug(`[${new Date().toISOString()}] [${this.prefix}] DEBUG:`, message, data ?? '');
  }
}
