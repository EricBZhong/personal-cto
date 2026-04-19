'use client';

interface FilterOption {
  value: string;
  label: string;
}

interface SortOption {
  value: string;
  label: string;
}

interface FilterBarProps {
  filters?: FilterOption[];
  activeFilter?: string;
  onFilterChange?: (value: string) => void;
  sortOptions?: SortOption[];
  activeSort?: string;
  onSortChange?: (value: string) => void;
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
}

export function FilterBar({
  filters,
  activeFilter,
  onFilterChange,
  sortOptions,
  activeSort,
  onSortChange,
  searchPlaceholder = 'Search...',
  searchValue,
  onSearchChange,
}: FilterBarProps) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Filter chips */}
      {filters && filters.length > 0 && (
        <div className="flex items-center gap-1.5">
          {filters.map((f) => (
            <button
              key={f.value}
              onClick={() => onFilterChange?.(f.value)}
              className={`text-xs px-2.5 py-1.5 rounded-lg transition-all duration-200 font-medium ${
                activeFilter === f.value
                  ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-900/30'
                  : 'bg-zinc-800/60 text-zinc-400 ring-1 ring-zinc-700/50 hover:bg-zinc-700/60 hover:text-zinc-300 hover:ring-zinc-600/50'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {/* Search */}
      {onSearchChange && (
        <div className="relative flex-1 max-w-xs">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchValue ?? ''}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-zinc-800/60 text-zinc-200 rounded-lg ring-1 ring-zinc-700/50 focus:ring-indigo-500/50 focus:outline-none placeholder-zinc-500 transition-all duration-200"
          />
        </div>
      )}

      {/* Sort dropdown */}
      {sortOptions && sortOptions.length > 0 && (
        <select
          value={activeSort}
          onChange={(e) => onSortChange?.(e.target.value)}
          className="text-xs bg-zinc-800/60 text-zinc-300 rounded-lg ring-1 ring-zinc-700/50 px-2.5 py-1.5 focus:outline-none focus:ring-indigo-500/50 transition-all duration-200 cursor-pointer"
        >
          {sortOptions.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
