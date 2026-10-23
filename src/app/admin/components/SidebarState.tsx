'use client';

import { useTranslations } from 'next-intl';
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { TbLayoutSidebarLeftCollapse, TbLayoutSidebarLeftExpand } from 'react-icons/tb';
import { SIDEBAR_COOKIE } from '../sidebar-cookie';
import styles from '../admin.module.css';

const SidebarContext = createContext<{ collapsed: boolean; toggle: () => void }>({
  collapsed: false,
  toggle: () => {},
});

/**
 * Whether the app sidebar is the full one or its icon strip, for every `/admin/*` page. Lives in the
 * admin layout, so it holds across navigations; `data-sidebar` on the wrapper lets the stylesheet
 * collapse the real sidebar and the loading skeleton's alike.
 */
export function SidebarState({ initialCollapsed, children }: { initialCollapsed: boolean; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? 'collapsed' : 'expanded'}; path=/admin; max-age=31536000; samesite=lax`;
  }

  return (
    <SidebarContext.Provider value={{ collapsed, toggle }}>
      <div className={styles.adminLayoutShell} data-admin-segment data-sidebar={collapsed ? 'collapsed' : 'expanded'}>
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

/** Whether the sidebar is its icon strip (menus opened from it then open to its right). */
export function useSidebarCollapsed() {
  return useContext(SidebarContext).collapsed;
}

/** Collapses the sidebar to its icon strip, or opens it again. */
export function SidebarToggle() {
  const { collapsed, toggle } = useContext(SidebarContext);
  const t = useTranslations('app.sidebar');
  const label = collapsed ? t('expand') : t('collapse');
  const Icon = collapsed ? TbLayoutSidebarLeftExpand : TbLayoutSidebarLeftCollapse;
  return (
    <button
      type="button"
      className={styles.sidebarToggle}
      aria-label={label}
      aria-expanded={!collapsed}
      data-tip={label}
      onClick={toggle}
    >
      <Icon aria-hidden size={18} />
    </button>
  );
}

/**
 * While the sidebar is an icon strip: the name of whatever is under the pointer or has focus (any
 * `[data-tip]` in the sidebar), to its right. Drawn in a portal, since the sidebar scrolls and would
 * clip it.
 */
export function SidebarTooltips() {
  const { collapsed } = useContext(SidebarContext);
  const markerRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ label: string; target: HTMLElement } | null>(null);

  useEffect(() => {
    const sidebar = markerRef.current?.closest('aside');
    if (!sidebar || !collapsed) return;
    const show = (event: Event) => {
      const target = (event.target as Element | null)?.closest<HTMLElement>('[data-tip]');
      // Not over a menu it has opened (the organisation switcher).
      if (target?.getAttribute('aria-expanded') === 'true') return;
      if (target?.dataset.tip && sidebar.contains(target)) setTip({ label: target.dataset.tip, target });
    };
    const hide = (event: PointerEvent | FocusEvent) => {
      const target = (event.target as Element | null)?.closest('[data-tip]');
      // Moving between the icon and the rest of the same item keeps its name up.
      if (target && event.relatedTarget instanceof Node && target.contains(event.relatedTarget)) return;
      setTip(null);
    };
    const clear = () => setTip(null);
    sidebar.addEventListener('pointerover', show);
    sidebar.addEventListener('focusin', show);
    sidebar.addEventListener('pointerout', hide);
    sidebar.addEventListener('focusout', hide);
    sidebar.addEventListener('pointerdown', clear);
    sidebar.addEventListener('scroll', clear);
    return () => {
      sidebar.removeEventListener('pointerover', show);
      sidebar.removeEventListener('focusin', show);
      sidebar.removeEventListener('pointerout', hide);
      sidebar.removeEventListener('focusout', hide);
      sidebar.removeEventListener('pointerdown', clear);
      sidebar.removeEventListener('scroll', clear);
      setTip(null);
    };
  }, [collapsed]);

  useLayoutEffect(() => {
    const element = tipRef.current;
    if (!tip || !element) return;
    const rect = tip.target.getBoundingClientRect();
    element.style.left = `${rect.right + 10}px`;
    element.style.top = `${rect.top + rect.height / 2}px`;
  }, [tip]);

  return (
    <>
      <span ref={markerRef} hidden />
      {collapsed && tip
        ? createPortal(
            <div ref={tipRef} className={styles.sidebarTip} role="tooltip">
              {tip.label}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
