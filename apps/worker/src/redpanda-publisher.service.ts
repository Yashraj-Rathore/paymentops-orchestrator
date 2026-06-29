import { Injectable, OnApplicationShutdown } from "@nestjs/common";
import { loadConfig } from "@paymentops/config";
import type { EventEnvelope } from "@paymentops/contracts";
import { Kafka, logLevel, type Producer } from "kafkajs";

import type { ClaimedOutboxEvent } from "./outbox.repository.js";

@Injectable()
export class RedpandaPublisherService implements OnApplicationShutdown {
  private readonly config = loadConfig("worker");
  private readonly producer: Producer;
  private connectPromise: Promise<void> | null = null;
  private connected = false;

  constructor() {
    const kafka = new Kafka({
      clientId: `paymentops-worker-${process.pid}`,
      brokers: this.config.redpandaBrokers,
      logLevel: logLevel.NOTHING,
      retry: {
        initialRetryTime: 300,
        retries: 8
      }
    });

    this.producer = kafka.producer({
      allowAutoTopicCreation: true,
      idempotent: true,
      maxInFlightRequests: 1
    });
  }

  async publish(event: ClaimedOutboxEvent): Promise<void> {
    await this.ensureConnected();
    const envelope: EventEnvelope = {
      eventId: event.id,
      eventType: event.eventType,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      tenantId: event.tenantId,
      schemaVersion: 1,
      occurredAt: event.createdAt.toISOString(),
      traceId: event.id,
      correlationId: event.id,
      causationId: event.id,
      payload: parsePayload(event.payloadJson)
    };

    await this.producer.send({
      topic: topicForEventType(event.eventType),
      acks: -1,
      messages: [
        {
          key: event.aggregateId,
          value: JSON.stringify(envelope),
          headers: {
            "paymentops-event-id": event.id,
            "paymentops-tenant-id": event.tenantId,
            "paymentops-event-type": event.eventType
          }
        }
      ]
    });
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.connected) {
      await this.producer.disconnect();
      this.connected = false;
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected) {
      return;
    }

    this.connectPromise ??= this.producer
      .connect()
      .then(() => {
        this.connected = true;
      })
      .finally(() => {
        this.connectPromise = null;
      });

    await this.connectPromise;
  }
}

export function topicForEventType(eventType: string): string {
  return eventType.startsWith("paymentops.") ? eventType : `paymentops.${eventType}`;
}

function parsePayload(payloadJson: string): Record<string, unknown> {
  const payload = JSON.parse(payloadJson) as unknown;

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Outbox payload must be a JSON object");
  }

  return payload as Record<string, unknown>;
}
