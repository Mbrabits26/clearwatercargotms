import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  // Keep fetched lists for 2 min and don't refetch everything on every tab focus —
  // re-downloading thousands of rows on each navigation was freezing the app.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 2 * 60_000, gcTime: 10 * 60_000, refetchOnWindowFocus: false, retry: 1 } },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
