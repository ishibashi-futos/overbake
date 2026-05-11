export interface LoggerConfig {
  quiet: boolean;
  verbose: boolean;
  noColor: boolean;
}

export class Logger {
  private config: LoggerConfig;

  constructor(config: LoggerConfig) {
    this.config = config;
  }

  info(...args: unknown[]): void {
    if (!this.config.quiet) {
      console.log(...args);
    }
  }

  error(...args: unknown[]): void {
    console.error(...args);
  }

  verbose(...args: unknown[]): void {
    if (this.config.verbose && !this.config.quiet) {
      console.log(...args);
    }
  }

  static create(flags: {
    quiet?: boolean;
    verbose?: boolean;
    noColor?: boolean;
  }): Logger {
    return new Logger({
      quiet: flags.quiet ?? false,
      verbose: flags.verbose ?? false,
      noColor: flags.noColor ?? false,
    });
  }
}
