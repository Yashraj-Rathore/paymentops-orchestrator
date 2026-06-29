import { Injectable } from "@nestjs/common";

import { asyncQueueNames } from "./async.constants.js";

@Injectable()
export class WorkerHealthService {
  getStatus() {
    return {
      status: "ready",
      queues: [
        asyncQueueNames.payoutDispatch,
        asyncQueueNames.webhookDelivery,
        asyncQueueNames.deadLetter
      ]
    };
  }
}