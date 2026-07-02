import { PactV4 } from "@pact-foundation/pact";
import { describe, expect, it } from "vitest";

describe("worker to provider simulator contract", () => {
  it("submits an idempotent payout", async () => {
    const payoutRequest = {
      payoutId: "po_contract_123",
      tenantId: "mer_contract",
      amountMinor: 4200,
      currency: "USD",
      destinationAccount: "acct_contract",
      callbackUrl: "http://api:3000/v1/provider-callbacks/payouts"
    };

    await new PactV4({
      consumer: "paymentops-worker",
      provider: "paymentops-provider-simulator",
      dir: "pacts"
    })
      .addInteraction()
      .given("the provider simulator accepts payouts")
      .uponReceiving("an idempotent payout submission")
      .withRequest("POST", "/v1/provider/payouts", (builder) => {
        builder
          .headers({
            "idempotency-key": payoutRequest.payoutId
          })
          .jsonBody(payoutRequest);
      })
      .willRespondWith(201, (builder) => {
        builder.jsonBody({
          providerPayoutId: "prov_contract_123",
          status: "processing",
          callbackDelayMs: 250
        });
      })
      .executeTest(async (server) => {
        const response = await fetch(server.url + "/v1/provider/payouts", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": payoutRequest.payoutId
          },
          body: JSON.stringify(payoutRequest)
        });

        expect(response.status).toBe(201);
        expect(await response.json()).toEqual({
          providerPayoutId: "prov_contract_123",
          status: "processing",
          callbackDelayMs: 250
        });
      });
  });
});
