import type { MetadataRoute } from 'next';
import { serverExtensions } from '@/extensions/server';

/** The public website's pages (the local edition has none). */
export default function sitemap(): MetadataRoute.Sitemap {
  return serverExtensions.sitemap();
}
