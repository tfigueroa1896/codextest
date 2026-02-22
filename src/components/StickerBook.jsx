import { useEffect, useState } from "react";

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
    <section className="w-full rounded-3xl border-4 border-black bg-pink-200 p-4 shadow-[0_10px_0_#111]">
      <h2 className="text-center text-3xl font-black text-black">Sticker Book</h2>
      {loading && <p className="mt-3 text-center text-xl font-bold">Loading stickers...</p>}

      {!loading && stickers.length === 0 && (
        <p className="mt-3 text-center text-xl font-bold">
          No stickers yet. Complete a challenge to unlock your first animal.
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {stickers.map((sticker) => (
          <article
            key={sticker.challenge_id || sticker.id}
            className="rounded-2xl border-4 border-black bg-white p-3 text-center"
          >
            <img
              src={sticker.animal_image_url}
              alt={sticker.animal_name}
              className="mx-auto h-24 w-24 rounded-xl object-cover"
            />
            <h3 className="mt-2 text-lg font-black text-black">{sticker.animal_name}</h3>
            <p className="text-sm font-bold text-black">
              {sticker.type}: {sticker.target_value}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
