import React, { useEffect, useMemo, useState } from "react";
import CameraContainer from "./components/CameraContainer";
import StickerBook from "./components/StickerBook";

const STORAGE_KEY = "magic-lens-user-id";

function getOrCreateUserId() {
  const existing = window.localStorage.getItem(STORAGE_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  window.localStorage.setItem(STORAGE_KEY, id);
  return id;
}

export default function App() {
  const [userId, setUserId] = useState("");
  const [stickers, setStickers] = useState([]);

  const apiBaseUrl = useMemo(
    () => (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, ""),
    []
  );

  useEffect(() => {
    setUserId(getOrCreateUserId());
  }, []);

  useEffect(() => {
    if (!userId) return;

    let active = true;
    const loadProgress = async () => {
      try {
        const response = await fetch(
          `${apiBaseUrl}/api/progress?user_id=${encodeURIComponent(userId)}`
        );
        if (!response.ok) return;
        const data = await response.json();
        if (active) setStickers(data.stickers || []);
      } catch {
        if (active) setStickers([]);
      }
    };

    loadProgress();

    return () => {
      active = false;
    };
  }, [apiBaseUrl, userId]);

  return (
    <main className="app-shell min-h-screen px-2 py-3 md:px-5 md:py-6">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-3 lg:grid-cols-[1.3fr_1fr] lg:gap-4">
        <CameraContainer
          userId={userId}
          apiBaseUrl={apiBaseUrl}
          onStickerUnlocked={(sticker) => {
            if (!sticker) return;
            setStickers((prev) => {
              const exists = prev.some(
                (item) =>
                  Number(item.challenge_id || item.id) === Number(sticker.id)
              );
              if (exists) return prev;
              return [
                { ...sticker, challenge_id: sticker.id, unlocked_at: new Date().toISOString() },
                ...prev,
              ];
            });
          }}
        />
        <StickerBook userId={userId} apiBaseUrl={apiBaseUrl} stickers={stickers} />
      </div>
    </main>
  );
}
