import fs from "fs";
import path from "path";

const LOG_DIR = path.resolve(process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, `yc-run-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
type Listener = (line: string) => void;
const listeners: Listener[] = [];

export async function logLine(message: string): Promise<void> {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  await fs.promises.mkdir(LOG_DIR, { recursive: true });
  await fs.promises.appendFile(LOG_FILE, `${line}\n`, "utf8");
  listeners.forEach((cb) => {
    try {
      cb(line);
    } catch {
      // ignore listener errors
    }
  });
}

export { LOG_DIR, LOG_FILE };

export function addLogListener(listener: Listener): void {
  listeners.push(listener);
}

export function removeLogListener(listener: Listener): void {
  const idx = listeners.indexOf(listener);
  if (idx >= 0) {
    listeners.splice(idx, 1);
  }
}
