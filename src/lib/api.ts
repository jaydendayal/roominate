export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload.detail === "string" ? payload.detail : "The analysis service is unavailable.");
  }
  return payload as T;
}

export async function normalizeImageUpload(file: File): Promise<File> {
  const isHeic = /\.(heic|heif)$/i.test(file.name) || ["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"].includes(file.type.toLowerCase());
  if (!isHeic) return file;
  const form = new FormData();
  form.set("file", file);
  const response = await fetch(`${API_BASE}/api/v1/media/normalize-heic`, { method: "POST", body: form });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(typeof payload.detail === "string" ? payload.detail : "The HEIC image could not be converted.");
  }
  const jpeg = await response.blob();
  const baseName = file.name.replace(/\.(heic|heif)$/i, "");
  return new File([jpeg], `${baseName || "image"}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
}
