import { Module } from '@nestjs/common';
import { TeachersModule } from '../teachers/teachers.module.js';
import { FavoritesController } from './favorites.controller.js';
import { FavoritesRepository } from './favorites.repository.js';
import { FavoritesService } from './favorites.service.js';

@Module({
	imports: [TeachersModule],
	controllers: [FavoritesController],
	providers: [FavoritesService, FavoritesRepository],
})
export class FavoritesModule {}
