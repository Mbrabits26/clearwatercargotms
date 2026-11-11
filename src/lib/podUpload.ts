export type PodPhoto<T> = { id: string; file: T; path?: string };

/** Keep successful pages on retry; finish only once every selected page is saved. */
export async function savePodPhotos<T>(
  photos: PodPhoto<T>[],
  upload: (file: T) => Promise<string>,
  saved: (id: string, path: string) => void,
  finish: (paths: string[]) => Promise<void>,
) {
  if (!photos.length) throw new Error("Add at least one POD photo.");
  const paths: string[] = [];
  for (const photo of photos) {
    const path = photo.path ?? await upload(photo.file);
    paths.push(path);
    if (!photo.path) saved(photo.id, path);
  }
  await finish(paths);
}