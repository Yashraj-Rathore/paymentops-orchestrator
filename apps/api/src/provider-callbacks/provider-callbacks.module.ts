import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module.js";
import { ProviderCallbacksController } from "./provider-callbacks.controller.js";
import { ProviderCallbacksRepository } from "./provider-callbacks.repository.js";
import { ProviderCallbacksService } from "./provider-callbacks.service.js";

@Module({
  imports: [DatabaseModule],
  controllers: [ProviderCallbacksController],
  providers: [ProviderCallbacksRepository, ProviderCallbacksService]
})
export class ProviderCallbacksModule {}
