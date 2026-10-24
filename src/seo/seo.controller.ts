import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator.js';
import { SeoService } from './seo.service.js';

@Controller('seo')
export class SeoController {
  constructor(private readonly seo: SeoService) {}

  @Public()
  @Get('sitemap.xml')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=0, s-maxage=300')
  sitemap(): Promise<string> {
    return this.seo.sitemap();
  }
}
