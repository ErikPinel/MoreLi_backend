import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ListNotificationsDto } from './dto/list-notifications.dto.js';
import {
  Notification,
  NotificationsRepository,
} from './notifications.repository.js';

const EXPIRY_INTERVAL_MS = 15 * 60 * 1000;
const EXPIRY_RETRY_MS = 60 * 1000;

@Injectable()
export class NotificationsService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(NotificationsService.name);
  private expiryTimer?: NodeJS.Timeout;
  private stopping = false;
  private expiryFailures = 0;

  constructor(
    private readonly notificationsRepository: NotificationsRepository,
  ) {}

  onApplicationBootstrap(): void {
    void this.expireStaleInquiries();
  }

  onApplicationShutdown(): void {
    this.stopping = true;
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
  }

  async findAll(userId: string, query: ListNotificationsDto) {
    const items = await this.notificationsRepository.findOwned(
      userId,
      query.unreadOnly,
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

  async unreadCount(userId: string) {
    return { count: await this.notificationsRepository.countUnread(userId) };
  }

  markRead(userId: string, notificationId: string): Promise<Notification> {
    return this.notificationsRepository.markRead(userId, notificationId);
  }

  async markAllRead(userId: string) {
    await this.notificationsRepository.markAllRead(userId);
    return { updated: true };
  }

  private async expireStaleInquiries(): Promise<void> {
    let nextDelay = EXPIRY_INTERVAL_MS;
    try {
      const count = await this.notificationsRepository.expireStaleInquiries();
      this.expiryFailures = 0;
      if (count > 0) this.logger.log(`Expired ${count} stale inquiries`);
    } catch (error) {
      this.expiryFailures += 1;
      if (this.expiryFailures === 1) nextDelay = EXPIRY_RETRY_MS;
      this.logger.error(
        `Failed to expire stale inquiries; retrying in ${nextDelay / 1000} seconds`,
        error,
      );
    }
    if (!this.stopping) {
      this.expiryTimer = setTimeout(
        () => void this.expireStaleInquiries(),
        nextDelay,
      );
      this.expiryTimer.unref();
    }
  }
}