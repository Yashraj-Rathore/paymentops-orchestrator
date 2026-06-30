import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { GlobalSetupContext } from "vitest/node";

const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url));
const composeFiles = ["-f", "docker-compose.yml", "-f", "docker-compose.e2e.yml"];

export default async function setup({ provide }: GlobalSetupContext) {
  const projectName = `paymentops-e2e-${process.pid}`;
  const composeArgs = ["compose", "--project-name", projectName, ...composeFiles];

  try {
    runDocker([...composeArgs, "up", "--detach", "--build", "--wait", "api", "worker"]);
    const apiPort = publishedPort(composeArgs, "api", 3000);

    provide("apiBaseUrl", `http://127.0.0.1:${apiPort}`);
  } catch (error) {
    writeDiagnostics(composeArgs);
    down(composeArgs);
    throw error;
  }

  return async () => {
    writeDiagnostics(composeArgs);

    if (process.env.PAYMENTOPS_E2E_KEEP_RUNNING !== "true") {
      down(composeArgs);
    }
  };
}

function publishedPort(composeArgs: string[], service: string, containerPort: number): number {
  const output = execFileSync("docker", [...composeArgs, "port", service, String(containerPort)], {
    cwd: workspaceRoot,
    encoding: "utf8"
  }).trim();
  const match = output.match(/:(\d+)$/);

  if (!match) {
    throw new Error(`Could not determine the published ${service} port from: ${output}`);
  }

  return Number(match[1]);
}

function runDocker(args: string[]): void {
  execFileSync("docker", args, {
    cwd: workspaceRoot,
    stdio: "inherit"
  });
}

function writeDiagnostics(composeArgs: string[]): void {
  try {
    const logs = execFileSync("docker", [...composeArgs, "logs", "--no-color"], {
      cwd: workspaceRoot,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024
    });
    const outputDirectory = fileURLToPath(new URL("../../test-results", import.meta.url));
    mkdirSync(outputDirectory, { recursive: true });
    writeFileSync(`${outputDirectory}/e2e-compose.log`, logs, "utf8");
  } catch {
    // The original startup or test error is more useful than a diagnostics failure.
  }
}

function down(composeArgs: string[]): void {
  try {
    runDocker([...composeArgs, "down", "--volumes", "--remove-orphans"]);
  } catch {
    // Preserve the original failure if Docker is already unavailable.
  }
}
