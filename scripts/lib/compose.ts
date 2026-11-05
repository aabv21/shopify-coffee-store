import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT';
}

export function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch (err) {
    if (isEnoent(err)) throw new Error('.env not found; copy .env.example to .env and fill in local values.', { cause: err });
    throw err;
  }
}

/** The shape `promisify(execFile)` rejects with, so callers treat both branches of `compose` alike. */
function composeError(message: string, stdout: string, stderr: string): Error & { stdout: string; stderr: string } {
  return Object.assign(new Error(message), { stdout, stderr });
}

/** `opts.input` goes to stdin, so credential JSON reaches the container without a host file. */
export function compose(args: readonly string[], opts?: { input?: string }): Promise<{ stdout: string; stderr: string }> {
  if (opts?.input === undefined) return execFileAsync('docker', ['compose', ...args]);
  const input = opts.input;

  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['compose', ...args]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    // EPIPE when the child exits before reading everything; unhandled, it would crash the process.
    child.stdin.on('error', (err: Error) => {
      const message = `docker compose ${args.join(' ')} failed to write to stdin: ${err.message}`;
      reject(composeError(stderr ? `${message}\n${stderr}` : message, stdout, stderr));
    });
    child.on('error', (err) => {
      reject(composeError(err.message, stdout, stderr));
    });
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      // stderr goes in the message too: the CLIs print only err.message, as with execFile's errors.
      else reject(composeError(`docker compose ${args.join(' ')} exited with code ${String(code)}\n${stderr}`, stdout, stderr));
    });
    child.stdin.end(input);
  });
}
