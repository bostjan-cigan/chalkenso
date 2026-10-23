import { redirect } from 'next/navigation';

/** Short URL for the sign-in page. */
export default function LoginRedirect() {
  redirect('/admin/login');
}
