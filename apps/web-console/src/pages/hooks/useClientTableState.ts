import { useEffect, useMemo, useState } from "react";

export type TableSortOrder = "asc" | "desc";

export type TableQueryState<K extends string = string> = {
  search: string;
  sortKey?: K;
  sortOrder: TableSortOrder;
  page: number;
  pageSize: number;
};

type UseClientTableStateInput<T, K extends string> = {
  items: T[];
  initialPageSize?: number;
  initialSortKey?: K;
  initialSortOrder?: TableSortOrder;
  searchableText?: (item: T) => string;
  comparators?: Partial<Record<K, (left: T, right: T) => number>>;
};

export function useClientTableState<T, K extends string = string>(
  input: UseClientTableStateInput<T, K>
): {
  query: TableQueryState<K>;
  total: number;
  totalPages: number;
  filteredItems: T[];
  pageItems: T[];
  setSearch: (next: string) => void;
  setSort: (sortKey?: K, sortOrder?: TableSortOrder) => void;
  setPage: (next: number) => void;
  setPageSize: (next: number) => void;
  resetPage: () => void;
} {
  const [query, setQuery] = useState<TableQueryState<K>>({
    search: "",
    sortKey: input.initialSortKey,
    sortOrder: input.initialSortOrder ?? "asc",
    page: 1,
    pageSize: input.initialPageSize ?? 10
  });

  const filteredItems = useMemo(() => {
    const keyword = query.search.trim().toLowerCase();
    const base = keyword
      ? input.items.filter((item) => {
          const text = (input.searchableText ? input.searchableText(item) : String(item ?? "")).toLowerCase();
          return text.includes(keyword);
        })
      : input.items;
    const sortKey = query.sortKey;
    const comparator = sortKey ? input.comparators?.[sortKey] : undefined;
    if (!comparator) {
      return base;
    }
    const copied = [...base];
    copied.sort((left, right) => {
      const value = comparator(left, right);
      return query.sortOrder === "desc" ? value * -1 : value;
    });
    return copied;
  }, [input.comparators, input.items, input.searchableText, query.search, query.sortKey, query.sortOrder]);

  const total = filteredItems.length;
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));

  useEffect(() => {
    if (query.page > totalPages) {
      setQuery((prev) => ({ ...prev, page: totalPages }));
    }
  }, [query.page, totalPages]);

  const pageItems = useMemo(() => {
    const start = (query.page - 1) * query.pageSize;
    const end = start + query.pageSize;
    return filteredItems.slice(start, end);
  }, [filteredItems, query.page, query.pageSize]);

  return {
    query,
    total,
    totalPages,
    filteredItems,
    pageItems,
    setSearch: (next) => {
      setQuery((prev) => ({
        ...prev,
        search: next,
        page: 1
      }));
    },
    setSort: (sortKey, sortOrder = "asc") => {
      setQuery((prev) => ({
        ...prev,
        sortKey,
        sortOrder,
        page: 1
      }));
    },
    setPage: (next) => {
      setQuery((prev) => ({
        ...prev,
        page: Math.max(1, next)
      }));
    },
    setPageSize: (next) => {
      const pageSize = Math.max(1, next);
      setQuery((prev) => ({
        ...prev,
        pageSize,
        page: 1
      }));
    },
    resetPage: () => {
      setQuery((prev) => ({ ...prev, page: 1 }));
    }
  };
}

