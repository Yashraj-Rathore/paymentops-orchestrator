import { Module } from "@nestjs/common";

import { WorkerHealthService } from "./worker-health.service.js";

@Module({
  providers: [WorkerHealthService]
})
export class AppModule {}