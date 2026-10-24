import { Injectable, InternalServerErrorException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service.js';
import { throwSupabaseError } from '../common/database/supabase-error.js';

const SITE_URL = 'https://morehli.co.il';
const BATCH_SIZE = 500;
const MAX_URLS = 50_000;
const PUBLIC_PAGE_PATHS = [
  '/',
  '/teachers',
  '/teach',
  '/support',
  '/teacher-access-terms',
  '/about.html',
  '/about-en.html',
];

@Injectable()
export class SeoService {
  private readonly logger = new Logger(SeoService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async sitemap(): Promise<string> {
    const entries = PUBLIC_PAGE_PATHS.map(path => `  <url><loc>${SITE_URL}${path}</loc></url>`);
    let afterId: string | undefined;
    while (true) {
      let query = this.supabase.client.from('teacher_profiles')
        .select('id, slug')
        .eq('profile_status', 'published')
        .order('id', { ascending: true })
        .limit(BATCH_SIZE);
      if (afterId) query = query.gt('id', afterId);
      const { data, error } = await query;
      if (error) throwSupabaseError(error, 'Failed to generate public sitemap');
      if (!data) throw new InternalServerErrorException('Sitemap query returned no data');
      for (const teacher of data) {
        if (!teacher.slug) throw new InternalServerErrorException('Published teacher has no public slug');
        entries.push(`  <url><loc>${SITE_URL}/teachers/${encodeURIComponent(teacher.slug)}</loc></url>`);
      }
      if (entries.length > MAX_URLS) {
        this.logger.error('The single sitemap exceeds the 50,000 URL protocol limit');
        throw new ServiceUnavailableException('Sitemap capacity exceeded');
      }
      if (data.length < BATCH_SIZE) break;
      afterId = data[data.length - 1].id;
    }
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`;
  }
}
