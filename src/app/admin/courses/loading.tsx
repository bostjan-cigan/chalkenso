import AdminSkeleton from '../components/AdminSkeleton';

/** Instant fallback for /admin/courses/* (list, course detail, versions, lessons, groups, partners). */
export default function CoursesSegmentLoading() {
  return <AdminSkeleton cards={2} />;
}
