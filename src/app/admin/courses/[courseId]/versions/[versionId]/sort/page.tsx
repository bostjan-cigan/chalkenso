import { redirect } from 'next/navigation';

/** The old address of a version's Improve page ("Sort with AI"): links to it still work. */
export default async function SortFeedbackPage({ params }: { params: Promise<{ courseId: string; versionId: string }> }) {
  const { courseId, versionId } = await params;
  redirect(`/admin/courses/${courseId}/versions/${versionId}/improve`);
}
