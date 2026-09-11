import { BadRequestException } from '@nestjs/common';
import { RequestsRepository } from './requests.repository.js';
import { RequestsService } from './requests.service.js';

const validRequest = {
  subjectId: 1,
  onlineOk: true,
  inPersonOk: false,
  goal: 'Prepare for an exam',
};

describe('RequestsService', () => {
  const repository = {
    create: vi.fn(),
  } as unknown as RequestsRepository;
  const service = new RequestsService(repository);

  it('rejects requests without a teaching mode', () => {
    expect(() =>
      service.validate({
        ...validRequest,
        onlineOk: false,
        inPersonOk: false,
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects an inverted budget range', () => {
    expect(() =>
      service.validate({ ...validRequest, budgetMin: 200, budgetMax: 100 }),
    ).toThrow(BadRequestException);
  });
});