import "reflect-metadata";

import { createLogger } from "@paymentops/logger";

import { DatabaseService } from "./database/database.service.js";

const logger = createLogger({
  service: "api",
  environment: process.env.NODE_ENV ?? "development"
});

const database = new DatabaseService();

try {
  await database.initialize();
  logger.info("migrations applied", {
    resourceType: "database",
    resourceId: "paymentops"
  });
} finally {
  await database.onApplicationShutdown();
}