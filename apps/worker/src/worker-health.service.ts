import { Injectable } from "@nestjs/common";

@Injectable()
export class WorkerHealthService {
  getStatus() {
    return {
      status: "ready",
      queues: []
    };
  }
}
