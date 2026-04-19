const sizes = {
  xs: 'h-3 w-3',
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  lg: 'h-8 w-8',
  xl: 'h-12 w-12',
};

const borderWidths = {
  xs: 'border',
  sm: 'border-[1.5px]',
  md: 'border-2',
  lg: 'border-2',
  xl: 'border-[3px]',
};

export function Spinner({ size = 'md' }: { size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' }) {
  return (
    <span
      className={`inline-block rounded-full border-zinc-700 border-t-indigo-400 animate-smooth-spin ${sizes[size]} ${borderWidths[size]}`}
      role="status"
      aria-label="Loading"
    />
  );
}
