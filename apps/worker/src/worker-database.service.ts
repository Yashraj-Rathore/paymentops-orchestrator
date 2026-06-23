import { Injectable, OnApplicationShutdown } from "@nestjs/common";
import { loadConfig } from "@paymentops/config";
import sql from "mssql";

interface SqlServerSettings {
  user: string;
  password: string;
  server: string;
  port: number;
  database: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
}

@Injectable()
export class WorkerDatabaseService implements OnApplicationShutdown {
  private readonly settings = parseSqlServerUrl(loadConfig("worker").databaseUrl);
  private pool: sql.ConnectionPool | null = null;

  async connect(): Promise<sql.ConnectionPool> {
    if (this.pool?.connected) {
      return this.pool;
    }

    this.pool = await new sql.ConnectionPool(toSqlConfig(this.settings)).connect();
    return this.pool;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool?.close();
    this.pool = null;
  }
}

function parseSqlServerUrl(databaseUrl: string): SqlServerSettings {
  if (!databaseUrl.startsWith("sqlserver://")) {
    throw new Error("DATABASE_URL must use the sqlserver:// user:password@host:port;database=name format");
  }

  const withoutScheme = databaseUrl.slice("sqlserver://".length);
  const atIndex = withoutScheme.lastIndexOf("@");

  if (atIndex === -1) {
    throw new Error("DATABASE_URL is missing SQL Server credentials");
  }

  const credentials = withoutScheme.slice(0, atIndex);
  const serverAndOptions = withoutScheme.slice(atIndex + 1);
  const colonIndex = credentials.indexOf(":");

  if (colonIndex === -1) {
    throw new Error("DATABASE_URL credentials must include user and password");
  }

  const user = decodeURIComponent(credentials.slice(0, colonIndex));
  const password = decodeURIComponent(credentials.slice(colonIndex + 1));
  const [hostPort, ...optionParts] = serverAndOptions.split(";");
  const [server, rawPort] = splitHostPort(hostPort);
  const options = new Map<string, string>();

  for (const part of optionParts) {
    const [key, ...valueParts] = part.split("=");
    if (key && valueParts.length > 0) {
      options.set(key.toLowerCase(), valueParts.join("="));
    }
  }

  return {
    user,
    password,
    server,
    port: Number(rawPort ?? "1433"),
    database: options.get("database") ?? "paymentops",
    encrypt: options.get("encrypt") === "true",
    trustServerCertificate: options.get("trustservercertificate") !== "false"
  };
}

function splitHostPort(hostPort: string): [string, string | undefined] {
  const portIndex = hostPort.lastIndexOf(":");

  if (portIndex === -1) {
    return [hostPort, undefined];
  }

  return [hostPort.slice(0, portIndex), hostPort.slice(portIndex + 1)];
}

function toSqlConfig(settings: SqlServerSettings): sql.config {
  return {
    user: settings.user,
    password: settings.password,
    server: settings.server,
    port: settings.port,
    database: settings.database,
    options: {
      encrypt: settings.encrypt,
      trustServerCertificate: settings.trustServerCertificate
    },
    pool: {
      max: 5,
      min: 0,
      idleTimeoutMillis: 30000
    }
  };
}
