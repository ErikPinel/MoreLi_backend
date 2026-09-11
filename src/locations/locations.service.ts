import { Injectable } from '@nestjs/common';
import { City, LocationsRepository } from './locations.repository.js';

@Injectable()
export class LocationsService {
  constructor(private readonly locationsRepository: LocationsRepository) {}

  findAll(): Promise<City[]> {
    return this.locationsRepository.findAllActive();
  }
}