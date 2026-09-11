import { Logger } from '@nestjs/common';
import { Level, LevelsRepository } from './levels.repository.js';
import { LevelsService } from './levels.service.js';

describe('LevelsService', () => {
  it('returns active levels and logs them', async () => {
    const levels: Level[] = [
      {
        id: 1,
        name_he: 'יסודי',
        name_en: 'Elementary school',
        slug: 'elementary-school',
        sort_order: 10,
      },
    ];
    const levelsRepository = {
      findAllActive: vi.fn().mockResolvedValue(levels),
    } as unknown as LevelsRepository;
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const service = new LevelsService(levelsRepository);

    await expect(service.findAll()).resolves.toEqual(levels);
    expect(levelsRepository.findAllActive).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(
      `Fetched levels: ${JSON.stringify(levels)}`,
    );
  });
});
