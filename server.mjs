import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sql from "./lib/db.mjs";
import {
  hashPassword,
  verifyPassword,
  genTempPassword,
  getSession,
  setSessionCookie,
  clearSessionCookie,
} from "./lib/auth.mjs";
import {
  isValidCourse,
  MODULES_PER_COURSE,
  PASS_MIN,
  TOTAL_QUESTIONS,
  EVAL_DURATION_SECONDS,
} from "./lib/courses.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());

function sessionFrom(req) {
  return getSession(req.headers.cookie);
}

// Envuelve handlers async para que los errores no dejen la request colgada.
function wrap(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

// ---------- API ----------

app.post("/api/register", wrap(async (req, res) => {
  const body = req.body || {};
  const nombre = String(body.nombre || "").trim();
  const apellido = String(body.apellido || "").trim();
  const dni = String(body.dni || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const course = body.course;

  if (!nombre || !apellido || !dni || !email || !password) {
    return res.status(400).json({ error: "Completá todos los campos." });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "La contraseña tiene que tener al menos 6 caracteres." });
  }
  if (course !== undefined && course !== null && course !== "" && !isValidCourse(course)) {
    return res.status(400).json({ error: "Curso inválido." });
  }

  const existing = await sql`SELECT id FROM users WHERE email = ${email}`;
  if (existing.length > 0) {
    return res.status(409).json({ error: "Ya existe una cuenta con ese correo. Iniciá sesión." });
  }

  const passwordHash = hashPassword(password);
  const [user] = await sql`
    INSERT INTO users (role, email, password_hash, nombre, apellido, dni)
    VALUES ('student', ${email}, ${passwordHash}, ${nombre}, ${apellido}, ${dni})
    RETURNING id, email, nombre, apellido, dni
  `;

  let enrollment = null;
  if (isValidCourse(course)) {
    const [enr] = await sql`
      INSERT INTO enrollments (user_id, course_slug, enabled)
      VALUES (${user.id}, ${course}, FALSE)
      ON CONFLICT (user_id, course_slug) DO NOTHING
      RETURNING id, course_slug, enabled
    `;
    if (enr) {
      for (let i = 0; i < MODULES_PER_COURSE; i++) {
        await sql`
          INSERT INTO progress (enrollment_id, module_index)
          VALUES (${enr.id}, ${i})
          ON CONFLICT (enrollment_id, module_index) DO NOTHING
        `;
      }
      enrollment = enr;
    }
  }

  const cookie = setSessionCookie({ uid: user.id, role: "student", email: user.email });
  res.set("set-cookie", cookie);
  return res.status(201).json({ ok: true, user, enrollment });
}));

app.post("/api/login", wrap(async (req, res) => {
  const body = req.body || {};
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const course = body.course;

  if (!email || !password) return res.status(400).json({ error: "Completá correo y contraseña." });

  const [user] = await sql`SELECT id, email, password_hash, role, nombre, apellido FROM users WHERE email = ${email}`;

  if (!user || user.role !== "student" || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: "Correo o contraseña incorrectos." });
  }

  let enrollment = null;
  if (isValidCourse(course)) {
    const [enr] = await sql`
      INSERT INTO enrollments (user_id, course_slug, enabled)
      VALUES (${user.id}, ${course}, FALSE)
      ON CONFLICT (user_id, course_slug) DO NOTHING
      RETURNING id, course_slug, enabled
    `;
    if (enr) {
      for (let i = 0; i < MODULES_PER_COURSE; i++) {
        await sql`
          INSERT INTO progress (enrollment_id, module_index)
          VALUES (${enr.id}, ${i})
          ON CONFLICT (enrollment_id, module_index) DO NOTHING
        `;
      }
      enrollment = enr;
    } else {
      const [existingEnr] = await sql`
        SELECT id, course_slug, enabled FROM enrollments WHERE user_id = ${user.id} AND course_slug = ${course}
      `;
      enrollment = existingEnr || null;
    }
  }

  const cookie = setSessionCookie({ uid: user.id, role: "student", email: user.email });
  res.set("set-cookie", cookie);
  return res.status(200).json({
    ok: true,
    user: { id: user.id, email: user.email, nombre: user.nombre, apellido: user.apellido },
    enrollment,
  });
}));

app.post("/api/admin-login", wrap(async (req, res) => {
  const body = req.body || {};
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!email || !password) return res.status(400).json({ error: "Completá correo y contraseña." });

  const [user] = await sql`SELECT id, email, password_hash, role, nombre, apellido FROM users WHERE email = ${email}`;

  if (!user || user.role !== "professor" || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: "Correo o contraseña incorrectos." });
  }

  const cookie = setSessionCookie({ uid: user.id, role: "professor", email: user.email });
  res.set("set-cookie", cookie);
  return res.status(200).json({
    ok: true,
    user: { id: user.id, email: user.email, nombre: user.nombre, apellido: user.apellido },
  });
}));

app.get("/api/me", wrap(async (req, res) => {
  const session = sessionFrom(req);
  if (!session) return res.status(401).json({ error: "No autenticado" });

  const [user] = await sql`SELECT id, email, role, nombre, apellido, dni FROM users WHERE id = ${session.uid}`;
  if (!user) return res.status(401).json({ error: "No autenticado" });

  if (user.role === "professor") {
    return res.status(200).json({ role: "professor", user });
  }

  const enrollments = await sql`
    SELECT id, course_slug, enabled, enabled_at FROM enrollments WHERE user_id = ${user.id} ORDER BY created_at ASC
  `;

  const result = [];
  for (const enr of enrollments) {
    const modules = await sql`
      SELECT module_index, completed, eval_score, eval_passed, eval_started_at
      FROM progress WHERE enrollment_id = ${enr.id} ORDER BY module_index ASC
    `;
    result.push({
      course: enr.course_slug,
      enabled: enr.enabled,
      enabledAt: enr.enabled_at,
      modules,
    });
  }

  return res.status(200).json({ role: "student", user, enrollments: result });
}));

const ALLOWED_REDIRECTS = new Set(["/index.html", "/login.html", "/admin-login.html", "/"]);

app.get("/api/logout", (req, res) => {
  let to = req.query.to || "/index.html";
  if (!ALLOWED_REDIRECTS.has(to)) to = "/index.html";
  res.set("set-cookie", clearSessionCookie());
  return res.redirect(302, to);
});

app.get("/api/admin/students", wrap(async (req, res) => {
  const session = sessionFrom(req);
  if (!session || session.role !== "professor") return res.status(403).json({ error: "No autorizado" });

  const rows = await sql`
    SELECT
      e.id AS enrollment_id,
      e.course_slug,
      e.enabled,
      u.id AS user_id,
      u.nombre,
      u.apellido,
      u.dni,
      u.email,
      COALESCE(pm.total, 0) AS total_modules,
      COALESCE(pm.done, 0) AS done_modules,
      COALESCE(pm.evals_total, 0) AS evals_total,
      COALESCE(pm.evals_pass, 0) AS evals_pass,
      pm.avg_score AS avg_score
    FROM enrollments e
    JOIN users u ON u.id = e.user_id
    LEFT JOIN (
      SELECT
        enrollment_id,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE completed) AS done,
        COUNT(*) FILTER (WHERE eval_score IS NOT NULL) AS evals_total,
        COUNT(*) FILTER (WHERE eval_passed) AS evals_pass,
        AVG(eval_score) FILTER (WHERE eval_score IS NOT NULL) AS avg_score
      FROM progress
      GROUP BY enrollment_id
    ) pm ON pm.enrollment_id = e.id
    ORDER BY e.created_at DESC
  `;

  return res.status(200).json({ students: rows });
}));

app.post("/api/admin/action", wrap(async (req, res) => {
  const session = sessionFrom(req);
  if (!session || session.role !== "professor") return res.status(403).json({ error: "No autorizado" });

  const body = req.body || {};

  if (body.type === "toggle-access") {
    const enrollmentId = Number(body.enrollmentId);
    if (!enrollmentId) return res.status(400).json({ error: "Falta enrollmentId" });

    const [current] = await sql`SELECT id, enabled FROM enrollments WHERE id = ${enrollmentId}`;
    if (!current) return res.status(404).json({ error: "Inscripción no encontrada" });

    const next = !current.enabled;
    await sql`
      UPDATE enrollments SET enabled = ${next}, enabled_at = ${next ? new Date() : null} WHERE id = ${enrollmentId}
    `;
    return res.status(200).json({ ok: true, enabled: next });
  }

  if (body.type === "reset-password") {
    const userId = Number(body.userId);
    if (!userId) return res.status(400).json({ error: "Falta userId" });

    const [user] = await sql`SELECT id, role FROM users WHERE id = ${userId}`;
    if (!user || user.role !== "student") return res.status(404).json({ error: "Alumno no encontrado" });

    const tempPassword = genTempPassword();
    await sql`UPDATE users SET password_hash = ${hashPassword(tempPassword)} WHERE id = ${userId}`;
    return res.status(200).json({ ok: true, tempPassword });
  }

  return res.status(400).json({ error: "Acción desconocida" });
}));

app.post("/api/progress", wrap(async (req, res) => {
  const session = sessionFrom(req);
  if (!session || session.role !== "student") return res.status(403).json({ error: "No autorizado" });

  const body = req.body || {};
  const course = body.course;
  const moduleIndex = Number(body.moduleIndex);
  if (!isValidCourse(course) || Number.isNaN(moduleIndex)) {
    return res.status(400).json({ error: "Datos inválidos" });
  }

  const [enrollment] = await sql`
    SELECT id, enabled FROM enrollments WHERE user_id = ${session.uid} AND course_slug = ${course}
  `;
  if (!enrollment) return res.status(404).json({ error: "No estás inscripto en este curso." });
  if (!enrollment.enabled) {
    return res.status(403).json({ error: "Tu acceso a este curso todavía no fue habilitado." });
  }

  const [row] = await sql`
    SELECT * FROM progress WHERE enrollment_id = ${enrollment.id} AND module_index = ${moduleIndex}
  `;
  if (!row) return res.status(404).json({ error: "Módulo inválido" });

  if (body.action === "start-eval") {
    if (row.completed) return res.status(200).json({ ok: true, alreadyCompleted: true });
    await sql`
      UPDATE progress SET eval_started_at = NOW() WHERE enrollment_id = ${enrollment.id} AND module_index = ${moduleIndex}
    `;
    return res.status(200).json({ ok: true, startedAt: new Date().toISOString(), durationSeconds: EVAL_DURATION_SECONDS });
  }

  if (body.action === "submit-eval") {
    const correctCount = Math.max(0, Math.min(TOTAL_QUESTIONS, Number(body.correctCount) || 0));

    let withinTime = true;
    if (row.eval_started_at) {
      const elapsed = (Date.now() - new Date(row.eval_started_at).getTime()) / 1000;
      if (elapsed > EVAL_DURATION_SECONDS + 15) withinTime = false;
    }

    const passed = withinTime && correctCount >= PASS_MIN;

    await sql`
      UPDATE progress
      SET eval_score = ${correctCount}, eval_passed = ${passed}, completed = ${passed},
          completed_at = ${passed ? new Date() : null}
      WHERE enrollment_id = ${enrollment.id} AND module_index = ${moduleIndex}
    `;

    return res.status(200).json({ ok: true, passed, withinTime, score: correctCount, passMin: PASS_MIN });
  }

  return res.status(400).json({ error: "Acción desconocida" });
}));

// ---------- Archivos estáticos (HTML) ----------
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, "public", "index.html"));
});

// Manejo de errores no atrapados en rutas async
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Error interno del servidor." });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`TENEA escuchando en el puerto ${PORT}`);
});
