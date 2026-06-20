import { Inject, Injectable } from "@nestjs/common";
import { createLogger } from "@paymentops/logger";

import { DatabaseService } from "./database.service.js";

@Injectable()
export class DatabaseInitializer {
  private readonly logger = createLogger({ service: "api", environment: process.env.NODE_ENV ?? "development" });

  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async initialize(): Promise<void> {
    await this.database.initialize();

    this.logger.info("database initialized", {
      resourceType: "database",
      resourceId: "paymentops"
    });
  }
}