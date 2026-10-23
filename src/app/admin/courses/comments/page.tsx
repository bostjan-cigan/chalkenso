import { redirect } from 'next/navigation';

/** Feedback lives with its group and its course now; what waits on you is on Home. */
export default function CommentsIndexPage() {
  redirect('/admin');
}
