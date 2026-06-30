"use client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { fetchRepositories } from "../actions";

export const useRepositories = () => {
  return useInfiniteQuery({
    queryKey: ["repositories"],
    queryFn: async ({ pageParam = 1 }) => {
      const data = await fetchRepositories(pageParam, 10);
      return data;
    },
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length < 10) return undefined; // No more pages if the last page has less than 10 items
      return allPages.length + 1; // Next page number
    },
    initialPageParam: 1
  });
}