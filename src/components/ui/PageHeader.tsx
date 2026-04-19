interface PageHeaderProps {
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
}

export function PageHeader({ title, subtitle, badge, actions }: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800/60">
      <div className="flex items-center gap-3 min-w-0">
        <h1 className="text-lg font-semibold text-zinc-200">{title}</h1>
        {badge}
        {subtitle && <span className="text-sm text-zinc-500">{subtitle}</span>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  );
}
