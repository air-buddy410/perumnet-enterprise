"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import styles from "../site.module.css";

export function PublicHeroVideo({ language }: { language: "id" | "en" }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      video.pause();
      return;
    }

    void video.play().catch(() => undefined);
  }, []);

  function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      void video.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    } else {
      video.pause();
      setIsPlaying(false);
    }
  }

  function toggleSound() {
    const video = videoRef.current;
    if (!video) return;
    const nextMuted = !video.muted;
    video.muted = nextMuted;
    setIsMuted(nextMuted);
  }

  const videoLabel = language === "id"
    ? "Video sinematik perangkat dan infrastruktur PerumNet Enterprise"
    : "Cinematic video of PerumNet Enterprise devices and infrastructure";

  return (
    <div className={styles.heroMedia} data-reveal data-reveal-delay="120">
      <video
        ref={videoRef}
        src="/hero-network-video/perumnet-enterprise-hero-v2.mp4"
        aria-label={videoLabel}
        autoPlay
        loop
        muted={isMuted}
        playsInline
        poster="/hero-network-posters/perumnet-enterprise-hero-v2.jpg"
        preload="metadata"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
      />
      <div className={styles.heroMediaControls} aria-label={language === "id" ? "Kontrol video" : "Video controls"}>
        <button
          type="button"
          onClick={toggleSound}
          aria-label={language === "id" ? (isMuted ? "Aktifkan suara" : "Matikan suara") : (isMuted ? "Unmute video" : "Mute video")}
          aria-pressed={!isMuted}
        >
          {isMuted ? <VolumeX size={17} /> : <Volume2 size={17} />}
        </button>
        <button
          type="button"
          onClick={togglePlayback}
          aria-label={language === "id" ? (isPlaying ? "Jeda video" : "Putar video") : (isPlaying ? "Pause video" : "Play video")}
          aria-pressed={!isPlaying}
        >
          {isPlaying ? <Pause size={17} /> : <Play size={17} />}
        </button>
      </div>
    </div>
  );
}
