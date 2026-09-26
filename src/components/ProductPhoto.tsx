"use client";

import { useState } from "react";
import { Box } from "lucide-react";

/** Product photo that falls back to the generic box icon when there is no image or it fails to load. */
export function ProductPhoto({ src, alt, iconSize }: { src?: string; alt: string; iconSize: number }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) return <Box size={iconSize} aria-hidden="true" />;
  return <img className="product-photo" src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailedSrc(src)} />;
}
