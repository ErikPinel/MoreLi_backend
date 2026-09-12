import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { ApprovalTokenService } from './approval-token.service.js';

describe('ApprovalTokenService', () => {
  const config = {
    get: vi.fn((key: string) =>
      key === 'email.approvalSecret'
        ? 'a-secure-test-secret-with-32-characters'
        : undefined,
    ),
    getOrThrow: vi.fn(() => 'https://moreli.example'),
  } as unknown as ConfigService;

  it('creates and verifies a signed, expiring teacher approval token', () => {
    const service = new ApprovalTokenService(config);
    const token = service.create('a143b2e6-917e-4c5b-b3a0-5dc29aaebc54');

    expect(token).toBeTruthy();
    expect(service.verify(token!).teacherId).toBe(
      'a143b2e6-917e-4c5b-b3a0-5dc29aaebc54',
    );
    expect(service.approvalUrl(token!)).toContain('/teacher-approval?token=');
    expect(() => service.verify(`${token}tampered`)).toThrow();
  });
});