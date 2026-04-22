import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export function createRunLogger(logDir: string, filePrefix = "patrol") {
  mkdirSync(logDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = join(logDir, `${filePrefix}-${stamp}.log`);

  const write = (line: string) => {
    const full = `[${new Date().toISOString()}] ${line}\n`;
    appendFileSync(file, full, "utf8");
    process.stdout.write(full);
  };

  return { info: (m: string) => write(`INFO ${m}`), warn: (m: string) => write(`WARN ${m}`), error: (m: string) => write(`ERROR ${m}`), logPath: file };
}
