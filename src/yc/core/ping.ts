import { spawn } from "child_process";

export async function pingHost(ip: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("ping", ["-c", "1", "-n", ip], { stdio: "ignore" });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(false);
    }, timeoutMs);

    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });

    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}
