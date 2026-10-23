import { ReactNode, ComponentPropsWithoutRef } from 'react';
import styles from '../styles/Link.module.css';
import { cn } from '../utils/cn';

interface BaseLinkProps {
  className?: string;
}

interface AnchorLinkProps extends BaseLinkProps, Omit<ComponentPropsWithoutRef<'a'>, 'className'> {
  as?: 'a';
  children: ReactNode;
}

interface ButtonLinkProps extends BaseLinkProps, Omit<ComponentPropsWithoutRef<'button'>, 'className'> {
  as: 'button';
  children: ReactNode;
}

type LinkProps = AnchorLinkProps | ButtonLinkProps;

export default function Link({ 
  children, 
  as = 'a', 
  className,
  ...props 
}: LinkProps) {
  const Component = as;

  return (
    <Component
      className={cn(styles.link, className)}
      {...(props as any)}
    >
      {children}
    </Component>
  );
}

