// Reusable UI components for better maintainability

import type { ReactNode } from 'react';

interface LoadingStateProps {
  message?: string;
  className?: string;
}

export function LoadingState({ message = 'Loading...', className = 'loading' }: LoadingStateProps) {
  return (
    <div className={className} role="status" aria-live="polite">
      {message}
    </div>
  );
}

interface ErrorStateProps {
  message?: string;
  className?: string;
}

export function ErrorState({ message = 'An error occurred', className = 'error' }: ErrorStateProps) {
  return (
    <div className={className} role="alert">
      {message}
    </div>
  );
}

interface BackButtonProps {
  onClick: () => void;
  label?: string;
  className?: string;
}

export function BackButton({ onClick, label = '← Back', className = 'btn-secondary' }: BackButtonProps) {
  return (
    <button onClick={onClick} className={className} aria-label="Go back">
      {label}
    </button>
  );
}

interface CardProps {
  children: ReactNode;
  className?: string;
  title?: string;
  titleClassName?: string;
}

export function Card({ children, className = '', title, titleClassName = 'h3' }: CardProps) {
  return (
    <div className={`card ${className}`.trim()}>
      {title && <div className={titleClassName}>{title}</div>}
      {children}
    </div>
  );
}

interface InfoGridProps {
  children: ReactNode;
  className?: string;
}

export function InfoGrid({ children, className = 'info-grid' }: InfoGridProps) {
  return (
    <div className={className}>
      {children}
    </div>
  );
}

interface InfoItemProps {
  label: string;
  value: ReactNode;
  className?: string;
}

export function InfoItem({ label, value, className = 'info-item' }: InfoItemProps) {
  return (
    <div className={className}>
      <span className="info-label">{label}:</span>
      <span className="info-value">{value}</span>
    </div>
  );
}