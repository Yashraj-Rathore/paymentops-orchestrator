import { createHmac, randomUUID } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

interface TenantResponse {
  id: string;
}

interface ApiClientResponse {
  id: string;
}

interface ApiKeyResponse {
  id: string;
  secret: string;
}

interface WebhookEndpointResponse {
  id: string;
  secret: string;
}

interface PayoutDetails {
  id: string;
  status: string;
  replayed?: boolean;
  ledgerEntries: Array<{ direction: string; amountMinor: number }>;
  statusHistory: Array<{ toStatus: string }>;
  outboxEvents: Array<{ eventType: string }>;
}

interface TenantDashboard {
  webhookDeliveries: Array<{
    aggregateId: string;
    eventType: string;
    status: string;
  }>;
}

interface CapturedWebhook {
  body: string;
  headers: IncomingHttpHeaders;
  payload: {
    aggregateId: string;
    type: string;
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    apiBaseUrl: string;
  }
}

const adminHeaders = {
  "content-type": "application/json",
  "x-paymentops-dev-admin-token": "dev-admin-token"
};

describe("payout orchestration", () => {
  let webhookServer: Server | undefined;
  let webhookUrl = "";
  const receivedWebhooks: CapturedWebhook[] = [];

  beforeAll(async () => {
    webhookServer = createServer(async (request, response) => {
      const body = await readBody(request);

      if (request.method === "POST") {
        receivedWebhooks.push({
          body,
          headers: request.headers,
          payload: JSON.parse(body) as CapturedWebhook["payload"]
        });
      }

      response.writeHead(204);
      response.end();
    });

    await new Promise<void>((resolve, reject) => {
      webhookServer?.once("error", reject);
      webhookServer?.listen(0, "0.0.0.0", resolve);
    });

    const address = webhookServer.address() as AddressInfo;
    webhookUrl = `http://host.docker.internal:${address.port}/paymentops-webhooks`;
    await waitForApi(inject("apiBaseUrl"));
  });

  afterAll(async () => {
    if (!webhookServer) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      webhookServer?.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("moves an idempotent payout from API request to paid status and a signed webhook", async () => {
    const apiBaseUrl = inject("apiBaseUrl");
    const runId = randomUUID();
    const tenant = await requestJson<TenantResponse>(`${apiBaseUrl}/v1/tenants`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        name: `E2E Merchant ${runId}`,
        ownerEmail: `e2e-${runId}@paymentops.test`
      })
    });
    const client = await requestJson<ApiClientResponse>(
      `${apiBaseUrl}/v1/tenants/${tenant.id}/api-clients`,
      {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ name: "E2E checkout" })
      }
    );
    const apiKey = await requestJson<ApiKeyResponse>(
      `${apiBaseUrl}/v1/tenants/${tenant.id}/api-keys`,
      {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({
          apiClientId: client.id,
          name: "E2E payout key",
          permissions: ["payouts:create", "payouts:read"]
        })
      }
    );
    const webhook = await requestJson<WebhookEndpointResponse>(
      `${apiBaseUrl}/v1/tenants/${tenant.id}/webhook-endpoints`,
      {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({
          url: webhookUrl,
          description: "E2E webhook receiver",
          eventSubscriptions: ["payout.created.v1", "payout.processing.v1", "payout.paid.v1"]
        })
      }
    );
    const payoutHeaders = {
      "content-type": "application/json",
      "idempotency-key": `e2e-${runId}`,
      "x-api-key": apiKey.secret
    };
    const payoutBody = JSON.stringify({
      amountMinor: 4200,
      currency: "USD",
      destinationAccount: "acct_e2e_destination",
      reference: `e2e-${runId}`,
      description: "End-to-end payout proof"
    });
    const created = await requestJson<PayoutDetails>(
      `${apiBaseUrl}/v1/tenants/${tenant.id}/payouts`,
      {
        method: "POST",
        headers: payoutHeaders,
        body: payoutBody
      }
    );

    expect(created.status).toBe("queued");
    expect(created.ledgerEntries).toHaveLength(2);
    expect(created.ledgerEntries.map((entry) => entry.direction).sort()).toEqual([
      "credit",
      "debit"
    ]);

    const replayed = await requestJson<PayoutDetails>(
      `${apiBaseUrl}/v1/tenants/${tenant.id}/payouts`,
      {
        method: "POST",
        headers: payoutHeaders,
        body: payoutBody
      }
    );
    expect(replayed.id).toBe(created.id);
    expect(replayed.replayed).toBe(true);

    const paid = await pollUntil(
      async () =>
        requestJson<PayoutDetails>(`${apiBaseUrl}/v1/tenants/${tenant.id}/payouts/${created.id}`, {
          headers: { "x-api-key": apiKey.secret }
        }),
      (payout) => payout.status === "paid",
      "payout to reach paid status"
    );

    expect(paid.statusHistory.map((entry) => entry.toStatus)).toEqual(
      expect.arrayContaining(["queued", "processing", "paid"])
    );
    expect(paid.outboxEvents.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(["payout.created.v1", "payout.processing.v1", "payout.paid.v1"])
    );

    const paidWebhook = await pollUntil(
      async () =>
        receivedWebhooks.find(
          (delivery) =>
            delivery.payload.aggregateId === created.id &&
            delivery.payload.type === "payout.paid.v1"
        ),
      (delivery) => delivery !== undefined,
      "signed payout.paid webhook"
    );

    if (!paidWebhook) {
      throw new Error("The paid webhook disappeared after polling");
    }

    assertWebhookSignature(paidWebhook, webhook.secret);

    const dashboard = await pollUntil(
      async () =>
        requestJson<TenantDashboard>(`${apiBaseUrl}/v1/tenants/${tenant.id}/summary`, {
          headers: adminHeaders
        }),
      (value) =>
        value.webhookDeliveries.some(
          (delivery) =>
            delivery.aggregateId === created.id &&
            delivery.eventType === "payout.paid.v1" &&
            delivery.status === "delivered"
        ),
      "webhook delivery to be persisted"
    );

    expect(
      dashboard.webhookDeliveries.some(
        (delivery) => delivery.aggregateId === created.id && delivery.status === "delivered"
      )
    ).toBe(true);
  });
});

async function waitForApi(apiBaseUrl: string): Promise<void> {
  await pollUntil(
    async () => {
      const response = await fetch(`${apiBaseUrl}/health`);
      return response.ok;
    },
    (ready) => ready,
    "API health endpoint",
    120_000
  );
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`${init?.method ?? "GET"} ${url} returned ${response.status}: ${body}`);
  }

  return JSON.parse(body) as T;
}

async function pollUntil<T>(
  action: () => Promise<T>,
  predicate: (value: T) => boolean,
  description: string,
  timeoutMs = 90_000
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const value = await action();
      if (predicate(value)) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new Error(`Timed out waiting for ${description}.${suffix}`);
}

function assertWebhookSignature(webhook: CapturedWebhook, secret: string): void {
  const timestamp = requiredHeader(webhook.headers, "paymentops-timestamp");
  const eventId = requiredHeader(webhook.headers, "paymentops-event-id");
  const actual = requiredHeader(webhook.headers, "paymentops-signature");
  const expected = `v1=${createHmac("sha256", secret)
    .update(`${timestamp}.${eventId}.${webhook.body}`)
    .digest("hex")}`;

  expect(actual).toBe(expected);
  expect(requiredHeader(webhook.headers, "paymentops-delivery-id")).toMatch(/^whd_/);
}

function requiredHeader(headers: IncomingHttpHeaders, name: string): string {
  const value = headers[name];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Webhook header ${name} was missing`);
  }

  return value;
}

async function readBody(request: AsyncIterable<Buffer | string>): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}
