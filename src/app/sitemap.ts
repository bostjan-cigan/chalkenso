import type { MetadataRoute } from 'next';
import { serverExtensions } from '@/extensions/server';

// Rendered again at most every 15 minutes, so pages that go public later are listed
export const revalidate = 900;

/** The public website's pages (the local edition has none). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return serverExtensions.sitemap();
}
