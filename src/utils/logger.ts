export class Logger {
  private prefix: string;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  info(message: string, data?: Record<string, unknown>) {
    console.log(`[${new Date().toISOString()}] [${this.prefix}] INFO:`, message, data ?? '');
  }

  error(message: string, error?: unknown) {
    console.error(`[${new Date().toISOString()}] [${this.prefix}] ERROR:`, message, error);
  }

  warn(message: string, data?: Record<string, unknown>) {
    console.warn(`[${new Date().toISOString()}] [${this.prefix}] WARN:`, message, data ?? '');
  }

  debug(message: string, data?: Record<string, unknown>) {
    if (process.env.DEBUG || process.env.LOG_LEVEL === 'debug') {
      console.debug(`[${new Date().toISOString()}] [${this.prefix}] DEBUG:`, message, data ?? '');
    }
  }
}
