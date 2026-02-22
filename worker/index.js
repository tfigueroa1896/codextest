const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
  });
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value || ""
  );
}

async function getRandomChallenge(env, userId) {
  if (userId) {
    return env.DB.prepare(
      `
      SELECT c.id, c.type, c.target_value, c.animal_name, c.animal_image_url, c.audio_prompt_url
      FROM challenges c
      LEFT JOIN progress p
        ON p.challenge_id = c.id
       AND p.user_id = ?
       AND p.is_unlocked = 1
      WHERE p.challenge_id IS NULL
      ORDER BY RANDOM()
      LIMIT 1
      `
    )
      .bind(userId)
      .first();
  }

  return env.DB.prepare(
    `
    SELECT id, type, target_value, animal_name, animal_image_url, audio_prompt_url
    FROM challenges
    ORDER BY RANDOM()
    LIMIT 1
    `
  ).first();
}

async function saveFound(env, userId, challengeId) {
  await env.DB.prepare(
    `
    INSERT INTO progress (user_id, challenge_id, is_unlocked)
    VALUES (?, ?, 1)
    ON CONFLICT(user_id, challenge_id)
    DO UPDATE SET is_unlocked = 1, unlocked_at = CURRENT_TIMESTAMP
    `
  )
    .bind(userId, challengeId)
    .run();

  return env.DB.prepare(
    `
    SELECT c.id, c.type, c.target_value, c.animal_name, c.animal_image_url
    FROM challenges c
    WHERE c.id = ?
    `
  )
    .bind(challengeId)
    .first();
}

async function getUnlockedStickers(env, userId) {
  return env.DB.prepare(
    `
    SELECT c.id AS challenge_id, c.animal_name, c.animal_image_url, c.type, c.target_value, p.unlocked_at
    FROM progress p
    INNER JOIN challenges c ON c.id = p.challenge_id
    WHERE p.user_id = ? AND p.is_unlocked = 1
    ORDER BY p.unlocked_at DESC
    `
  )
    .bind(userId)
    .all();
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (request.method === "GET" && path === "/api/challenge") {
        const userId = url.searchParams.get("user_id");
        if (userId && !isUuid(userId)) {
          return json({ error: "user_id must be a UUID" }, 400);
        }

        const challenge = await getRandomChallenge(env, userId);
        if (!challenge) {
          return json({ error: "No available challenges found" }, 404);
        }

        return json({ challenge });
      }

      if (request.method === "POST" && path === "/api/found") {
        const body = await request.json();
        const userId = body?.user_id;
        const challengeId = Number.parseInt(body?.challenge_id, 10);

        if (!isUuid(userId)) {
          return json({ error: "user_id must be a UUID" }, 400);
        }
        if (!Number.isInteger(challengeId) || challengeId <= 0) {
          return json({ error: "challenge_id must be a positive integer" }, 400);
        }

        const unlocked = await saveFound(env, userId, challengeId);
        if (!unlocked) {
          return json({ error: "Challenge not found" }, 404);
        }

        return json({ ok: true, unlocked });
      }

      if (request.method === "GET" && path === "/api/progress") {
        const userId = url.searchParams.get("user_id");
        if (!isUuid(userId)) {
          return json({ error: "user_id must be a UUID" }, 400);
        }

        const result = await getUnlockedStickers(env, userId);
        return json({ stickers: result.results || [] });
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      return json(
        {
          error: "Internal server error",
          detail: error instanceof Error ? error.message : String(error),
        },
        500
      );
    }
  },
};
