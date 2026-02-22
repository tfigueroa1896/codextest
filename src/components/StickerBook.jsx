import React, { useEffect, useState } from "react";

export default function StickerBook({
  userId,
  apiBaseUrl = "",
  stickers: stickersProp,
}) {
  const [stickers, setStickers] = useState(stickersProp || []);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setStickers(stickersProp || []);
  }, [stickersProp]);

  useEffect(() => {
    if (stickersProp || !userId) return;

    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `${apiBaseUrl}/api/progress?user_id=${encodeURIComponent(userId)}`
        );
        if (!response.ok) return;
        const data = await response.json();
        if (active) setStickers(data.stickers || []);
      } finally {
        if (active) setLoading(false);
      }
    };

    load();
    return () => {
      active = false;
    };
  }, [apiBaseUrl, stickersProp, userId]);

  return (
    <section className="w-full rounded-3xl border-4 border-black bg-pink-200 p-3 shadow-[0_8px_0_#111] md:p-4 md:shadow-[0_10px_0_#111]">
      <h2 className="text-center text-3xl font-black text-black md:text-4xl">Sticker Book</h2>
      {loading && <p className="mt-2 text-center text-lg font-bold md:text-xl">Loading stickers...</p>}

      {!loading && stickers.length === 0 && (
        <p className="mt-2 text-center text-lg font-bold md:text-xl">
          No stickers yet. Complete a challenge to unlock your first animal.
        </p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {stickers.map((sticker) => (
          <article
            key={sticker.challenge_id || sticker.id}
            className="rounded-2xl border-4 border-black bg-white p-2 text-center md:p-3"
          >
            <img
              src={sticker.animal_image_url}
              alt={sticker.animal_name}
              className="mx-auto h-20 w-20 rounded-xl object-cover md:h-24 md:w-24"
            />
            <h3 className="mt-1 text-base font-black text-black md:mt-2 md:text-lg">{sticker.animal_name}</h3>
            <p className="text-xs font-bold text-black md:text-sm">
              {sticker.type}: {sticker.target_value}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
