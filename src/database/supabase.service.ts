import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Database } from './database.types.js';

@Injectable()
export class SupabaseService {
  readonly client: SupabaseClient<Database>;

  constructor(configService: ConfigService) {
    const url = configService.getOrThrow<string>('supabase.url');
    const secretKey = configService.getOrThrow<string>('supabase.secretKey');

    this.client = createClient<Database>(url, secretKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
  }
}
