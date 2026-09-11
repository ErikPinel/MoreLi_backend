import { Injectable, NotFoundException } from '@nestjs/common';
import { TeachersRepository } from '../teachers/teachers.repository.js';
import { FavoritesRepository, Favorite } from './favorites.repository.js';

@Injectable()
export class FavoritesService {
  constructor(
    private readonly favoritesRepository: FavoritesRepository,
    private readonly teachersRepository: TeachersRepository,
  ) {}

  async add(userId: string, teacherId: string): Promise<Favorite> {
    const teachers = await this.teachersRepository.findPublicByIds([teacherId]);
    if (teachers.length === 0) throw new NotFoundException('Teacher not found');
    return this.favoritesRepository.add(userId, teacherId);
  }

  remove(userId: string, teacherId: string): Promise<void> {
    return this.favoritesRepository.remove(userId, teacherId);
  }

  async findAll(userId: string) {
    const ids = await this.favoritesRepository.findTeacherIds(userId);
    const teachers = await this.teachersRepository.findPublicByIds(ids);
    const byId = new Map(teachers.map((teacher) => [teacher.id, teacher]));
    return ids.map((id) => byId.get(id)).filter(Boolean);
  }
}