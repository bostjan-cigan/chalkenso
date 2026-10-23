import AdminSkeleton from './components/AdminSkeleton';

/** Fallback for the admin dashboard (and any /admin route without a closer loading state). */
export default function AdminLoading() {
  return <AdminSkeleton cards={2} />;
}
