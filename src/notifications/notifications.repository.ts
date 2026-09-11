import { Injectable, NotFoundException } from '@nestjs/common';
import { throwSupabaseError } from '../common/database/supabase-error.js';
import { Database } from '../database/database.types.js';
import { SupabaseService } from '../database/supabase.service.js';

export type Notification = Database['public']['Tables']['notifications']['Row'];

@Injectable()
export class NotificationsRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async findOwned(
    userId: string,
    unreadOnly: boolean,
    offset: number,
    limit: number,
  ): Promise<Notification[]> {
    let request = this.supabase.client
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + limit - 1);
    if (unreadOnly) request = request.is('read_at', null);
    const { data, error } = await request;
    if (error) throwSupabaseError(error, 'Failed to load notifications');
    return data;
  }

  async countUnread(userId: string): Promise<number> {
    const { count, error } = await this.supabase.client
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('read_at', null);
    if (error) throwSupabaseError(error, 'Failed to count notifications');
    return count ?? 0;
  }

  async markRead(userId: string, notificationId: string): Promise<Notification> {
    const { data, error } = await this.supabase.client
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', notificationId)
      .eq('user_id', userId)
      .select()
      .maybeSingle();
    if (error) throwSupabaseError(error, 'Failed to mark notification read');
    if (!data) throw new NotFoundException('Notification not found');
    return data;
  }

  async markAllRead(userId: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('read_at', null);
    if (error) throwSupabaseError(error, 'Failed to mark notifications read');
  }

  async expireStaleInquiries(): Promise<number> {
    const { data, error } = await this.supabase.client.rpc(
      'expire_stale_inquiries',
    );
    if (error) throwSupabaseError(error, 'Failed to expire stale inquiries');
    return data;
  }
}