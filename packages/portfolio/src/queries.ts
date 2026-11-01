import { ApiError, useApi, type ApiRequest } from '@offerpath/learn';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';

import type {
  CollectionInputs,
  CollectionItems,
  CollectionKind,
  CollectionPatch,
  MessageItem,
  PortfolioView,
  SiteSettings,
} from './types';

/**
 * Every Portfolio request, so cache invalidation is decided here. Any edit
 * can change the overview's counts, so mutations also refresh `portfolio`.
 */
export const portfolioKeys = {
  all: ['portfolio'] as const,
  view: ['portfolio', 'view'] as const,
  collection: (kind: CollectionKind) => ['portfolio', 'collection', kind] as const,
  messages: ['portfolio', 'messages'] as const,
};

function refreshView(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: portfolioKeys.view });
}

/** Whether a failure is the API's "no portfolio yet". */
export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

// -- The portfolio --------------------------------------------------------------

async function fetchView(api: ApiRequest): Promise<PortfolioView | null> {
  try {
    return await api<PortfolioView>('/portfolio');
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/**
 * The user's portfolio; `null` before one is created (the API's 404), so the
 * page can show the setup instead of an error.
 */
export function usePortfolio(): UseQueryResult<PortfolioView | null> {
  const api = useApi();
  return useQuery({
    queryKey: portfolioKeys.view,
    queryFn: () => fetchView(api),
  });
}

/**
 * Unread contact messages, for the sidebar's badge; 0 when there's no
 * portfolio. `enabled: false` skips the request (a desktop not signed in).
 */
export function usePortfolioUnread({ enabled = true }: { enabled?: boolean } = {}): number {
  const api = useApi();
  const query = useQuery({
    queryKey: portfolioKeys.view,
    queryFn: () => fetchView(api),
    retry: false,
    staleTime: 60_000,
    enabled,
  });
  return enabled ? (query.data?.counts.unreadMessages ?? 0) : 0;
}

export function useCreatePortfolio() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (handle: string) =>
      api<PortfolioView>('/portfolio', { method: 'POST', body: { handle } }),
    onSuccess: (view) => {
      queryClient.setQueryData(portfolioKeys.view, view);
      // Creating also imports the profile as drafts.
      void queryClient.invalidateQueries({ queryKey: portfolioKeys.all });
    },
  });
}

export function useUpdatePortfolio() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { handle?: string; settings?: Partial<SiteSettings> }) =>
      api<PortfolioView>('/portfolio', { method: 'PATCH', body }),
    onSuccess: (view) => queryClient.setQueryData(portfolioKeys.view, view),
  });
}

export interface CloudinaryInput {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

export function useSaveCloudinary() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CloudinaryInput) =>
      api<PortfolioView>('/portfolio/cloudinary', { method: 'PUT', body }),
    onSuccess: (view) => queryClient.setQueryData(portfolioKeys.view, view),
  });
}

export function useRemoveCloudinary() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<PortfolioView>('/portfolio/cloudinary', { method: 'DELETE' }),
    onSuccess: (view) => queryClient.setQueryData(portfolioKeys.view, view),
  });
}

/** Uploads an image to the user's Cloudinary; resolves its URL. */
export function useUploadImage() {
  const api = useApi();
  return useMutation({
    mutationFn: (body: { fileName: string; contentBase64: string }) =>
      api<{ url: string }>('/portfolio/uploads', { method: 'POST', body }),
  });
}

export function useImportProfile() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<{ created: number; updated: number }>('/portfolio/import-profile', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: portfolioKeys.all }),
  });
}

// -- Projects, skills, experience, developer tools --------------------------------

export function useCollection<K extends CollectionKind>(
  kind: K,
): UseQueryResult<CollectionItems[K][]> {
  const api = useApi();
  return useQuery({
    queryKey: portfolioKeys.collection(kind),
    queryFn: async () =>
      (await api<{ items: CollectionItems[K][] }>(`/portfolio/${kind}`)).items ?? [],
  });
}

export function useCreateItem<K extends CollectionKind>(kind: K) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CollectionInputs[K]) =>
      api<CollectionItems[K]>(`/portfolio/${kind}`, { method: 'POST', body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: portfolioKeys.collection(kind) });
      void refreshView(queryClient);
    },
  });
}

function replaceItem<T extends { id: string }>(items: T[] | undefined, item: T): T[] | undefined {
  return items?.map((existing) => (existing.id === item.id ? item : existing));
}

export function useUpdateItem<K extends CollectionKind>(kind: K) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: CollectionPatch<K> }) =>
      api<CollectionItems[K]>(`/portfolio/${kind}/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: patch,
      }),
    onSuccess: (item) => {
      queryClient.setQueryData<CollectionItems[K][]>(portfolioKeys.collection(kind), (items) =>
        replaceItem(items, item),
      );
      void queryClient.invalidateQueries({ queryKey: portfolioKeys.collection(kind) });
      void refreshView(queryClient);
    },
  });
}

export function useDeleteItem(kind: CollectionKind) {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<void>(`/portfolio/${kind}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: (_void, id) => {
      queryClient.setQueryData<{ id: string }[]>(portfolioKeys.collection(kind), (items) =>
        items?.filter((item) => item.id !== id),
      );
      void queryClient.invalidateQueries({ queryKey: portfolioKeys.collection(kind) });
      void refreshView(queryClient);
    },
  });
}

/** Saves a new order. The list moves at once and settles on the server's answer. */
export function useReorder<K extends CollectionKind>(kind: K) {
  const api = useApi();
  const queryClient = useQueryClient();
  const key = portfolioKeys.collection(kind);
  return useMutation({
    mutationFn: (ids: string[]) =>
      api<{ items: CollectionItems[K][] }>(`/portfolio/${kind}/reorder`, {
        method: 'POST',
        body: { ids },
      }),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<CollectionItems[K][]>(key);
      if (previous) {
        const byId = new Map(previous.map((item) => [item.id, item]));
        const moved = ids.map((id) => byId.get(id)).filter((item) => item !== undefined);
        queryClient.setQueryData(key, moved);
      }
      return { previous };
    },
    onError: (_error, _ids, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSuccess: (reply) => {
      if (reply?.items) queryClient.setQueryData(key, reply.items);
    },
  });
}

// -- Messages ---------------------------------------------------------------------

export function useMessages(): UseQueryResult<MessageItem[]> {
  const api = useApi();
  return useQuery({
    queryKey: portfolioKeys.messages,
    queryFn: async () => (await api<{ items: MessageItem[] }>('/portfolio/messages')).items ?? [],
  });
}

export function useMarkMessage() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, read }: { id: string; read: boolean }) =>
      api<MessageItem>(`/portfolio/messages/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: { read },
      }),
    onSuccess: (message) => {
      queryClient.setQueryData<MessageItem[]>(portfolioKeys.messages, (items) =>
        replaceItem(items, message),
      );
      void refreshView(queryClient);
    },
  });
}

export function useDeleteMessage() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<void>(`/portfolio/messages/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: (_void, id) => {
      queryClient.setQueryData<MessageItem[]>(portfolioKeys.messages, (items) =>
        items?.filter((item) => item.id !== id),
      );
      void refreshView(queryClient);
    },
  });
}
