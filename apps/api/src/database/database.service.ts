import { Injectable, OnApplicationShutdown } from "@nestjs/common";
import { loadConfig } from "@paymentops/config";
import sql from "mssql";

import { sqlMigrations } from "./migrations.js";

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
export class DatabaseService implements OnApplicationShutdown {
  private readonly settings = parseSqlServerUrl(loadConfig("api").databaseUrl);
  private pool: sql.ConnectionPool | null = null;

  async initialize(): Promise<void> {
    await retry(async () => {
      await this.ensureDatabase();
      await this.connect();
      await this.runMigrations();
    });
  }

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

  private async ensureDatabase(): Promise<void> {
    assertSafeIdentifier(this.settings.database, "database");

    const masterPool = await new sql.ConnectionPool(toSqlConfig({ ...this.settings, database: "master" })).connect();

    try {
      const databaseName = quoteSqlIdentifier(this.settings.database);
      await masterPool.request().batch(`
IF DB_ID(N'${escapeSqlLiteral(this.settings.database)}') IS NULL
BEGIN
  CREATE DATABASE ${databaseName};
END;
`);
    } finally {
      await masterPool.close();
    }
  }

  private async runMigrations(): Promise<void> {
    const pool = await this.connect();

    await pool.request().batch(`
IF OBJECT_ID(N'dbo.schema_migrations', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.schema_migrations (
    version NVARCHAR(128) NOT NULL CONSTRAINT pk_schema_migrations PRIMARY KEY,
    name NVARCHAR(256) NOT NULL,
    applied_at DATETIME2(3) NOT NULL CONSTRAINT df_schema_migrations_applied_at DEFAULT SYSUTCDATETIME()
  );
END;
`);

    for (const migration of sqlMigrations) {
      const applied = await pool
        .request()
        .input("version", sql.NVarChar(128), migration.version)
        .query("SELECT version FROM dbo.schema_migrations WHERE version = @version");

      if (applied.recordset.length > 0) {
        continue;
      }

      const transaction = new sql.Transaction(pool);
      await transaction.begin();

      try {
        await new sql.Request(transaction).batch(migration.sql);
        await new sql.Request(transaction)
          .input("version", sql.NVarChar(128), migration.version)
          .input("name", sql.NVarChar(256), migration.name)
          .query(
            "INSERT INTO dbo.schema_migrations (version, name) VALUES (@version, @name)"
          );
        await transaction.commit();
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
    }
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
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000
    }
  };
}

async function retry(operation: () => Promise<void>, attempts = 30): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await operation();
      return;
    } catch (error) {
      lastError = error;
      await delay(Math.min(attempt * 1000, 5000));
    }
  }

  throw lastError;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertSafeIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`Unsafe SQL ${label} identifier: ${value}`);
  }
}

function quoteSqlIdentifier(value: string): string {
  return `[${value.replace(/]/g, "]]")}]`;
}

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}