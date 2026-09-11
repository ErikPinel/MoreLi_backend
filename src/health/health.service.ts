import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { HealthRepository } from './health.repository.js';

@Injectable()
export class HealthService {
  constructor(private readonly healthRepository: HealthRepository) {}

  async check() {
    const database = await this.healthRepository.databaseIsReachable();
    if (!database) {
      throw new ServiceUnavailableException({
        status: 'unhealthy',
        database: 'unreachable',
      });
    }
    return {
      status: 'ok',
      database: 'reachable',
      timestamp: new Date().toISOString(),
    };
  }
}