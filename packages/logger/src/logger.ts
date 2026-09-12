/**
 * Structured logging (P0-13).
 *
 * JSON in production so a log aggregator can filter by requestId, level or userId;
 * a readable single line in development. Every value passes through the shared
 * redaction in `@drivenx/core/redaction`, so a log call that happens to include a
 * whole user record cannot print a password hash.
 *
 * No logging library: the requirement is a JSON line on stdout with consistent fields.
 * A dependency here would be another thing to hand over (SOW §20) and another thing to
 * keep patched, for about eighty lines of code.
 */

import { redactValue, serialiseError } from "@drivenx/core/redaction";

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogFields {
  [key: string]: unknown;
}

export interface LogEntry {
  time: string;
  level: LogLevel;
  msg: string;
  [key: string]: unknown;
}

export interface LoggerOptions {
  level?: LogLevel;
  /** Pretty single-line output instead of JSON. Defaults to on outside production. */
  pretty?: boolean;
  /** Injected for tests. */
  write?: (entry: LogEntry) => void;
  /** Injected for tests so timestamps are deterministic. */
  now?: () => Date;
  /** Fields attached to every entry from this logger. */
  base?: LogFields;
}

function defaultLevel(): LogLevel {
  const configured = process.env["LOG_LEVEL"]?.toLowerCase();
  if (configured && (LOG_LEVELS as readonly string[]).includes(configured)) {
    return configured as LogLevel;
  }
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

function formatPretty(entry: LogEntry): string {
  const { time, level, msg, ...rest } = entry;
  const clock = time.slice(11, 23);
  const extras = Object.entries(rest)
    .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join(" ");
  return `${clock} ${level.toUpperCase().padEnd(5)} ${msg}${extras ? `  ${extras}` : ""}`;
}

export class Logger {
  private readonly level: LogLevel;
  private readonly pretty: boolean;
  private readonly base: LogFields;
  private readonly now: () => Date;
  private readonly write: (entry: LogEntry) => void;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? defaultLevel();
    this.pretty = options.pretty ?? process.env.NODE_ENV !== "production";
    this.base = options.base ?? {};
    this.now = options.now ?? (() => new Date());
    this.write =
      options.write ??
      ((entry) => {
        const line = this.pretty ? formatPretty(entry) : JSON.stringify(entry);
        const isProblem = entry.level === "error" || entry.level === "warn";

        // The Edge runtime has no process.stdout, and this module is reachable from
        // Next's instrumentation hook. Prefer the stream where it exists — stderr for
        // warn and error, so `app 2>errors.log` captures exactly what someone would
        // page on — and fall back to console everywhere else.
        const stream = isProblem ? process?.stderr : process?.stdout;
        if (stream?.write) stream.write(`${line}\n`);
        else if (isProblem) console.error(line);
        else console.log(line);
      });
  }

  /** A logger carrying additional fields — typically a requestId for one request. */
  child(fields: LogFields): Logger {
    return new Logger({
      level: this.level,
      pretty: this.pretty,
      base: { ...this.base, ...fields },
      now: this.now,
      write: this.write,
    });
  }

  private emit(level: LogLevel, msg: string, fields: LogFields = {}): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[this.level]) return;

    const merged = { ...this.base, ...fields };
    const entry: LogEntry = {
      time: this.now().toISOString(),
      level,
      msg,
    };

    for (const [key, value] of Object.entries(merged)) {
      if (key === "time" || key === "level" || key === "msg") continue;
      entry[key] = value instanceof Error ? serialiseError(value) : redactValue(value);
    }

    this.write(entry);
  }

  debug(msg: string, fields?: LogFields): void {
    this.emit("debug", msg, fields);
  }
  info(msg: string, fields?: LogFields): void {
    this.emit("info", msg, fields);
  }
  warn(msg: string, fields?: LogFields): void {
    this.emit("warn", msg, fields);
  }

  /** `error` accepts the thrown value directly; it is serialised, never stringified. */
  error(msg: string, error?: unknown, fields?: LogFields): void {
    this.emit("error", msg, {
      ...fields,
      ...(error !== undefined ? { err: serialiseError(error) } : {}),
    });
  }
}

export const logger = new Logger();
