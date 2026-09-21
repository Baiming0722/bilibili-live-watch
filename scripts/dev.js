import { spawn } from "node:child_process";
import process from "node:process";

const processes = [
  spawn(process.execPath, ["server/index.js"], {
    env: { ...process.env, HOST: "127.0.0.1", PORT: "4174" },
    stdio: "inherit",
    shell: false
  }),
  spawn(/^win/.test(process.platform) ? "npm.cmd" : "npm", ["run", "dev:web", "--", "--port", "5173"], {
    stdio: "inherit",
    shell: true
  })
];

let shuttingDown = false;

function stopAll(exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  for (const child of processes) {
    if (!child.killed) {
      child.kill();
    }
  }
  process.exit(exitCode);
}

for (const child of processes) {
  child.on("exit", (code) => {
    if (!shuttingDown) {
      stopAll(code ?? 0);
    }
  });
}

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));
