import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service.js';

@Injectable()
export class HealthRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async databaseIsReachable(): Promise<boolean> {
    const { error } = await this.supabase.client
      .from('levels')
      .select('id', { head: true })
      .limit(1);
    return error === null;
  }
}