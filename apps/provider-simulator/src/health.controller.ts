import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { loadConfig } from "@paymentops/config";
import type { HealthResponse } from "@paymentops/contracts";

@ApiTags("foundation")
@Controller()
export class HealthController {
  @Get("health")
  @ApiOkResponse({
    description: "Provider simulator health response."
  })
  getHealth(): HealthResponse {
    const config = loadConfig("provider-simulator");

    return {
      status: "ok",
      service: config.serviceName,
      environment: config.nodeEnv,
      version: process.env.npm_package_version ?? "0.1.0",
      timestamp: new Date().toISOString()
    };
  }
}
