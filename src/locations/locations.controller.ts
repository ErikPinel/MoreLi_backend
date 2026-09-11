import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator.js';
import { City } from './locations.repository.js';
import { LocationsService } from './locations.service.js';

@Public()
@Controller('cities')
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Get()
  findAll(): Promise<City[]> {
    return this.locationsService.findAll();
  }
}