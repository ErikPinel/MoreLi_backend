import { Injectable } from '@nestjs/common';
import { isAvailableAt } from '../availability/availability-time.js';
import { CreateRequestDto } from '../requests/dto/create-request.dto.js';
import { RequestsRepository } from '../requests/requests.repository.js';
import { RequestsService } from '../requests/requests.service.js';
import { SearchTeachersDto } from '../teachers/dto/search-teachers.dto.js';
import {
  PublicTeacher,
  TeachersRepository,
} from '../teachers/teachers.repository.js';
import { MatchScores, MatchingPolicy } from './matching.policy.js';
import { Match, MatchingRepository } from './matching.repository.js';

export type RankedTeacher = MatchScores & { teacher: PublicTeacher };

@Injectable()
export class MatchingService {
  constructor(
    private readonly requestsService: RequestsService,
    private readonly requestsRepository: RequestsRepository,
    private readonly teachersRepository: TeachersRepository,
    private readonly matchingRepository: MatchingRepository,
    private readonly matchingPolicy: MatchingPolicy,
  ) {}

  async preview(dto: CreateRequestDto): Promise<RankedTeacher[]> {
    this.requestsService.validate(dto);
    return this.rank(await this.requestsRepository.resolveSlugs(dto));
  }

  async run(userId: string, requestId: string): Promise<RankedTeacher[]> {
    const request = await this.requestsRepository.findOwned(userId, requestId);
    const dto: CreateRequestDto = {
      subjectId: request.subject_id,
      levelId: request.level_id ?? undefined,
      cityId: request.city_id ?? undefined,
      onlineOk: request.online_ok,
      inPersonOk: request.in_person_ok,
      budgetMin: request.budget_min ?? undefined,
      budgetMax: request.budget_max ?? undefined,
      desiredAt: request.desired_start_at ?? undefined,
      goal: request.goal,
      notes: request.notes ?? undefined,
    };
    const ranked = await this.rank(dto);
    await this.matchingRepository.persist(
      requestId,
      ranked.map(({ teacher: _teacher, ...scores }) => scores),
    );
    return ranked;
  }

  async findForRequest(userId: string, requestId: string) {
    const matches = await this.matchingRepository.findForOwnedRequest(
      userId,
      requestId,
    );
    return this.attachTeachers(matches);
  }

  private async rank(dto: CreateRequestDto): Promise<RankedTeacher[]> {
    const query = Object.assign(new SearchTeachersDto(), {
      subjectId: dto.subjectId,
      levelId: dto.levelId,
      cityId: dto.cityId,
      onlineOk: dto.onlineOk,
      inPersonOk: dto.inPersonOk,
      budgetMin: dto.budgetMin,
      budgetMax: dto.budgetMax,
      page: 1,
      limit: 100,
    });
    const candidates = await this.teachersRepository.searchCandidates(query, 100, 0);
    const availability = await this.matchingRepository.findAvailability(
      candidates.map((teacher) => teacher.id),
    );
    const desiredAt = dto.desiredAt ? new Date(dto.desiredAt) : null;
    const availableTeacherIds = new Set(
      candidates
        .filter((teacher) => {
          const slots = availability.filter(
            (slot) => slot.teacher_id === teacher.id,
          );
          return desiredAt ? isAvailableAt(slots, desiredAt) : slots.length > 0;
        })
        .map((teacher) => teacher.id),
    );
    const scores = this.matchingPolicy.rank(candidates, {
      cityId: dto.cityId ?? null,
      budgetMin: dto.budgetMin ?? null,
      budgetMax: dto.budgetMax ?? null,
      availableTeacherIds,
    });
    return this.attachTeachers(scores);
  }

  private async attachTeachers(
    scores: (MatchScores | Match)[],
  ): Promise<RankedTeacher[]> {
    const teachers = await this.teachersRepository.findPublicByIds(
      scores.map((match) => match.teacher_id),
    );
    const byId = new Map(teachers.map((teacher) => [teacher.id, teacher]));
    return scores
      .map((match) => {
        const teacher = byId.get(match.teacher_id);
        return teacher ? { ...match, teacher } : null;
      })
      .filter((match): match is RankedTeacher => match !== null);
  }
}