import Link from 'next/link';

interface EmptyStateProps {
  icon: string;
  title: string;
  description: string;
  action?: { label: string; href: string };
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex items-center justify-center py-20 animate-fade-in-up">
      <div className="text-center max-w-md">
        {/* Icon with subtle background ring */}
        <div className="relative inline-flex items-center justify-center mb-5">
          <div className="absolute inset-0 w-16 h-16 rounded-2xl bg-zinc-800/50 ring-1 ring-zinc-700/50 -translate-x-1/2 -translate-y-1/2 top-1/2 left-1/2" />
          <span className="relative text-3xl leading-none">{icon}</span>
        </div>
        <h2 className="text-lg font-semibold text-zinc-200 mb-2">{title}</h2>
        <p className="text-sm text-zinc-500 leading-relaxed max-w-xs mx-auto">{description}</p>
        {action && (
          <Link
            href={action.href}
            className="inline-flex items-center gap-1.5 mt-5 text-sm font-medium text-indigo-400 hover:text-indigo-300 transition-colors duration-200 group"
          >
            {action.label}
            <svg
              className="w-3.5 h-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        )}
      </div>
    </div>
  );
}
