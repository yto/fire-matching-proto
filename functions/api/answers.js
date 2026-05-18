export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const { uuid, username, answers } = body || {};
  if (typeof uuid !== "string" || !uuid) {
    return json({ error: "uuid required" }, 400);
  }
  if (typeof username !== "string" || !username) {
    return json({ error: "username required" }, 400);
  }
  if (!Array.isArray(answers) || !answers.every((a) => a === "Yes" || a === "No")) {
    return json({ error: "answers must be array of Yes/No" }, 400);
  }

  const now = new Date().toISOString();
  const answersJson = JSON.stringify(answers);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (uuid, username, updated_at) VALUES (?1, ?2, ?3)
       ON CONFLICT(uuid) DO UPDATE SET username = excluded.username, updated_at = excluded.updated_at`
    ).bind(uuid, username, now),
    env.DB.prepare(
      `INSERT INTO answers (uuid, answers, updated_at) VALUES (?1, ?2, ?3)
       ON CONFLICT(uuid) DO UPDATE SET answers = excluded.answers, updated_at = excluded.updated_at`
    ).bind(uuid, answersJson, now),
  ]);

  return json({ ok: true });
}

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT u.uuid, u.username, a.answers, a.updated_at
     FROM users u JOIN answers a ON a.uuid = u.uuid
     ORDER BY a.updated_at DESC`
  ).all();
  const rows = (results || []).map((r) => ({ ...r, answers: JSON.parse(r.answers) }));
  return json({ rows });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
