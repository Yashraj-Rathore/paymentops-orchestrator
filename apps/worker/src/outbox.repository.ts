import { Inject, Injectable } from "@nestjs/common";
import sql from "mssql";

import { WorkerDatabaseService } from "./worker-database.service.js";

export interface ClaimedOutboxEvent {
  id: string;
  tenantId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payloadJson: string;
  attempts: number;
  createdAt: Date;
}

@Injectable()
export class OutboxRepository {
  constructor(@Inject(WorkerDatabaseService) private readonly database: WorkerDatabaseService) {}

  async claimBatch(workerId: string, limit = 25): Promise<ClaimedOutboxEvent[]> {
    const pool = await this.database.connect();
    const result = await pool
      .request()
      .input("workerId", sql.NVarChar(128), workerId)
      .input("limit", sql.Int, limit).query<OutboxEventRow>(`
;WITH candidate AS (
  SELECT TOP (@limit) *
  FROM dbo.outbox_events WITH (UPDLOCK, READPAST, ROWLOCK)
  WHERE status IN (N'pending', N'failed')
    AND available_at <= SYSUTCDATETIME()
    AND (locked_until IS NULL OR locked_until < SYSUTCDATETIME())
  ORDER BY created_at ASC
)
UPDATE candidate
SET locked_by = @workerId,
    locked_until = DATEADD(SECOND, 30, SYSUTCDATETIME())
OUTPUT
  CONVERT(NVARCHAR(36), inserted.id) AS id,
  CONVERT(NVARCHAR(36), inserted.tenant_id) AS tenant_id,
  inserted.event_type,
  inserted.aggregate_type,
  inserted.aggregate_id,
  inserted.payload_json,
  inserted.attempts,
  inserted.created_at;
`);

    return result.recordset.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      eventType: row.event_type,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      payloadJson: row.payload_json,
      attempts: row.attempts,
      createdAt: row.created_at
    }));
  }

  async markPublished(eventId: string, workerId: string): Promise<void> {
    const pool = await this.database.connect();
    await pool
      .request()
      .input("eventId", sql.UniqueIdentifier, eventId)
      .input("workerId", sql.NVarChar(128), workerId).query(`
UPDATE dbo.outbox_events
SET status = N'published',
    published_at = SYSUTCDATETIME(),
    locked_by = NULL,
    locked_until = NULL,
    last_error = NULL
WHERE id = @eventId AND locked_by = @workerId;
`);
  }

  async markFailed(input: {
    eventId: string;
    workerId: string;
    error: string;
    nextAttemptAt: Date | null;
    deadLetter: boolean;
  }): Promise<void> {
    const pool = await this.database.connect();
    await pool
      .request()
      .input("eventId", sql.UniqueIdentifier, input.eventId)
      .input("workerId", sql.NVarChar(128), input.workerId)
      .input("error", sql.NVarChar(1000), input.error)
      .input("nextAttemptAt", sql.DateTime2, input.nextAttemptAt)
      .input("status", sql.NVarChar(32), input.deadLetter ? "dead_letter" : "failed").query(`
UPDATE dbo.outbox_events
SET status = @status,
    attempts = attempts + 1,
    available_at = COALESCE(@nextAttemptAt, available_at),
    locked_by = NULL,
    locked_until = NULL,
    last_error = @error
WHERE id = @eventId AND locked_by = @workerId;
`);
  }
}

interface OutboxEventRow {
  id: string;
  tenant_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload_json: string;
  attempts: number;
  created_at: Date;
}
