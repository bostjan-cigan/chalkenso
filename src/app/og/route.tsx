import { brandOgImage } from '@/lib/og-image';
import { PRODUCT_TAGLINE } from '@/lib/site';

export const runtime = 'nodejs';
export const revalidate = 86400;

/** The product's Open Graph image: an exercise-book page with the name, the promise and the tagline. */
export async function GET() {
  return brandOgImage({ headline: ['Courses that get better', 'every time you teach them'], badge: PRODUCT_TAGLINE });
}
