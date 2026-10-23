import { ReactNode } from 'react';
import { adminNavItems, type AdminSection } from '@/app/admin/nav';
import AdminFrame from '../../components/AdminFrame';
import CourseManagementPageContext, {
  type CoursePageContextProps,
} from './CourseManagementPageContext';
import CourseTabs, { type CourseTab } from './CourseTabs';
import { CourseSection } from '../types';

interface CourseManagementFrameProps {
  /** Which place the page belongs to (the sidebar marks it): Courses, Groups, or Settings (partners). */
  activeSection: CourseSection;
  children: ReactNode;
  /** Slim strip at the top: title, optional subtitle, back link, actions. */
  pageContext?: CoursePageContextProps;
  /** One course's tabs (Lessons, Groups, Feedback, Insights, Settings), under the page strip. */
  courseTabs?: { courseId: string; active: CourseTab };
  notice?: ReactNode;
  /** Highlights the account control when on `/admin/profile`. */
  accountPageActive?: boolean;
  /** When false, no place is marked (e.g. Profile uses this frame but is no place of its own). */
  highlightCourseManagementTab?: boolean;
}

const PLACE: Record<CourseSection, AdminSection> = {
  courses: 'courses',
  groups: 'groups',
  comments: 'overview',
  partners: 'settings',
};

/** The frame of the course and group pages: the sidebar, a page strip, and a course's tabs. */
export default function CourseManagementFrame({
  activeSection,
  children,
  pageContext,
  courseTabs,
  notice,
  accountPageActive = false,
  highlightCourseManagementTab = true,
}: CourseManagementFrameProps) {
  return (
    <AdminFrame
      showHero={false}
      accountPageActive={accountPageActive}
      navItems={adminNavItems(highlightCourseManagementTab ? PLACE[activeSection] : null)}
    >
      {pageContext ? <CourseManagementPageContext {...pageContext} /> : null}
      {courseTabs ? <CourseTabs {...courseTabs} /> : null}
      {notice}
      {children}
    </AdminFrame>
  );
}
