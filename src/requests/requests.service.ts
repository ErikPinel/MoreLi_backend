import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateRequestDto } from './dto/create-request.dto.js';
import { ListRequestsDto } from './dto/list-requests.dto.js';
import { RequestsRepository, StudentRequest } from './requests.repository.js';

@Injectable()
export class RequestsService {
  constructor(private readonly requestsRepository: RequestsRepository) {}

  create(userId: string, dto: CreateRequestDto): Promise<StudentRequest> {
    this.validate(dto);
    return this.requestsRepository.create(userId, dto);
  }

  update(
    userId: string,
    requestId: string,
    dto: CreateRequestDto,
  ): Promise<StudentRequest> {
    this.validate(dto);
    return this.requestsRepository.updateOwned(userId, requestId, dto);
  }

  findOne(userId: string, requestId: string): Promise<StudentRequest> {
    return this.requestsRepository.findOwned(userId, requestId);
  }

  async findAll(userId: string, query: ListRequestsDto) {
    const items = await this.requestsRepository.findAllOwned(
      userId,
      (query.page - 1) * query.limit,
      query.limit + 1,
    );
    return {
      items: items.slice(0, query.limit),
      page: query.page,
      limit: query.limit,
      hasMore: items.length > query.limit,
    };
  }

  close(userId: string, requestId: string): Promise<StudentRequest> {
    return this.requestsRepository.closeOwned(userId, requestId);
  }

  validate(dto: CreateRequestDto): void {
    if (!dto.onlineOk && !dto.inPersonOk) {
      throw new BadRequestException('At least one teaching mode is required');
    }
    if (
      dto.budgetMin !== undefined &&
      dto.budgetMax !== undefined &&
      dto.budgetMin > dto.budgetMax
    ) {
      throw new BadRequestException('budgetMin cannot exceed budgetMax');
    }
  }
}