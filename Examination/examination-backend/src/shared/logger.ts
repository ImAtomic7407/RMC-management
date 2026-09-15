/**
 * Lightweight structured logger for examination-backend.
 * No external dependencies -- pure Node.js ANSI escape codes.
 *
 * Output format:
 *   HH:MM:SS [LEVEL] [tag] message  key=value key=value ...
 */

const IS_TTY = process.stdout.isTTY ?? false;

// ANSI helpers -- no-op when not a real terminal (e.g. piped to a file).
const C = {
  reset:   IS_TTY ? "\x1b[0m"  : "",
  bold:    IS_TTY ? "\x1b[1m"  : "",
  dim:     IS_TTY ? "\x1b[2m"  : "",
  red:     IS_TTY ? "\x1b[31m" : "",
  green:   IS_TTY ? "\x1b[32m" : "",
  yellow:  IS_TTY ? "\x1b[33m" : "",
  blue:    IS_TTY ? "\x1b[34m" : "",
  magenta: IS_TTY ? "\x1b[35m" : "",
  cyan:    IS_TTY ? "\x1b[36m" : "",
  white:   IS_TTY ? "\x1b[37m" : "",
  gray:    IS_TTY ? "\x1b[90m" : "",
};

type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

const LEVEL_COLOR: Record<LogLevel, string> = {
  DEBUG: C.gray,
  INFO:  C.blue,
  WARN:  C.yellow,
  ERROR: C.red + C.bold,
};

const LEVEL_PAD: Record<LogLevel, string> = {
  DEBUG: "DEBUG",
  INFO:  "INFO ",
  WARN:  "WARN ",
  ERROR: "ERROR",
};

function timestamp(): string {
  const now = new Date();
  const h  = String(now.getHours()).padStart(2, "0");
  const m  = String(now.getMinutes()).padStart(2, "0");
  const s  = String(now.getSeconds()).padStart(2, "0");
  const ms = String(now.getMilliseconds()).padStart(3, "0");
  return `${h}:${m}:${s}.${ms}`;
}

function formatFields(fields: Record<string, unknown>): string {
  return Object.entries(fields)
    .map(([k, v]) => {
      const val = v === null || v === undefined ? "null" : String(v);
      return `${C.gray}${k}${C.reset}=${C.cyan}${val}${C.reset}`;
    })
    .join("  ");
}

function write(level: LogLevel, tag: string, message: string, fields?: Record<string, unknown>): void {
  const ts    = `${C.dim}${timestamp()}${C.reset}`;
  const lvl   = `${LEVEL_COLOR[level]}${LEVEL_PAD[level]}${C.reset}`;
  const tg    = `${C.magenta}[${tag}]${C.reset}`;
  const msg   = level === "ERROR"
    ? `${C.red}${C.bold}${message}${C.reset}`
    : level === "WARN"
    ? `${C.yellow}${message}${C.reset}`
    : message;
  const extra = fields && Object.keys(fields).length > 0 ? "  " + formatFields(fields) : "";
  const line  = `${ts} ${lvl} ${tg} ${msg}${extra}`;

  if (level === "ERROR") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

// ─── HTTP method colours ──────────────────────────────────────────────────────

const METHOD_COLOR: Record<string, string> = {
  GET:     C.green,
  POST:    C.cyan,
  PUT:     C.blue,
  PATCH:   C.blue,
  DELETE:  C.red,
  OPTIONS: C.gray,
  HEAD:    C.gray,
};

export function colorMethod(method: string): string {
  const color = METHOD_COLOR[method.toUpperCase()] ?? C.white;
  return `${color}${method.padEnd(7)}${C.reset}`;
}

export function colorStatus(status: number): string {
  if (status < 300) return `${C.green}${status}${C.reset}`;
  if (status < 400) return `${C.cyan}${status}${C.reset}`;
  if (status < 500) return `${C.yellow}${status}${C.reset}`;
  return `${C.red}${C.bold}${status}${C.reset}`;
}

// ─── Public logger interface ──────────────────────────────────────────────────

type Fields = Record<string, unknown>;

function makeLogger(tag: string) {
  return {
    debug: (msg: string, fields?: Fields) => write("DEBUG", tag, msg, fields),
    info:  (msg: string, fields?: Fields) => write("INFO",  tag, msg, fields),
    warn:  (msg: string, fields?: Fields) => write("WARN",  tag, msg, fields),
    error: (msg: string, fields?: Fields) => write("ERROR", tag, msg, fields),
  };
}

// Named loggers for each subsystem -- import whichever you need.
export const log = {
  http:    makeLogger("http"),
  ws:      makeLogger("ws"),
  gate:    makeLogger("gate"),
  student: makeLogger("student"),
  auth:    makeLogger("auth"),
  exam:    makeLogger("exam"),
  media:   makeLogger("media"),
  db:      makeLogger("db"),
  system:  makeLogger("system"),

  // Generic factory for any module.
  for: (tag: string) => makeLogger(tag),
};
