import { Module } from "@nestjs/common";

import { DatabaseInitializer } from "./database.initializer.js";
import { DatabaseService } from "./database.service.js";

@Module({
  providers: [DatabaseService, DatabaseInitializer],
  exports: [DatabaseService, DatabaseInitializer]
})
export class DatabaseModule {}