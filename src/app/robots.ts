import type { MetadataRoute } from 'next';
import { serverExtensions } from '@/extensions/server';

export default function robots(): MetadataRoute.Robots {
  return serverExtensions.robots();
}
