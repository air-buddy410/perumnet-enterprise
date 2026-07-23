"use client";

import { Network } from "lucide-react";
import { useState } from "react";
import styles from "../site.module.css";

export function PublicPortfolioImage({
  src,
  alt,
}: {
  src: string;
  alt: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className={styles.imageFallback} role="img" aria-label={`Ilustrasi ${alt}`}>
        <Network size={42} aria-hidden="true" />
      </div>
    );
  }

  return <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
}
