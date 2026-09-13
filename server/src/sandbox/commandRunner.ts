import { execFile } from "node:child_process";

// Real command execution for the testing/QA agent. Deliberately narrow allow-list,
// no shell interpolation (execFile with an argv array, never a shell string), a hard
// timeout, and a capped output buffer. This is process-level isolation, not a full
// container sandbox -- acceptable for running test/build tooling against files the
// agents themselves just wrote, but it is not a defense against a hostile workspace.
const ALLOWED_COMMANDS = new Set(["node", "npm", "npx", "python3", "pip3", "pytest"]);
const TIMEOUT_MS = 30_000;
const MAX_BUFFER = 5 * 1024 * 1024;

export interface CommandResult {
  command: string;
  args: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  allowed: boolean;
}

export function runCommand(workspaceDir: string, command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolvePromise) => {
    if (!ALLOWED_COMMANDS.has(command)) {
      resolvePromise({
        command,
        args,
        exitCode: 126,
        stdout: "",
        stderr: `Command "${command}" is not on the allow-list. Allowed commands: ${[...ALLOWED_COMMANDS].join(", ")}`,
        durationMs: 0,
        timedOut: false,
        allowed: false,
      });
      return;
    }

    const start = Date.now();
    execFile(
      command,
      args,
      { cwd: workspaceDir, timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - start;
        const timedOut = !!error?.signal && error.signal === "SIGTERM";
        const rawCode = error ? error.code : 0;
        const exitCode = !error ? 0 : typeof rawCode === "number" ? rawCode : 1;
        const stderrOut = stderr || (error && !stdout ? error.message : "");
        resolvePromise({ command, args, exitCode, stdout, stderr: stderrOut, durationMs, timedOut, allowed: true });
      }
    );
  });
}
