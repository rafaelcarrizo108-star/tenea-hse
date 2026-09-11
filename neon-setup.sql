-- Esquema inicial de TENEA: usuarios, inscripciones y progreso por módulo.

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('student', 'professor')),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  nombre TEXT,
  apellido TEXT,
  dni TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE enrollments (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_slug TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  enabled_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, course_slug)
);

CREATE TABLE progress (
  id SERIAL PRIMARY KEY,
  enrollment_id INTEGER NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  module_index INTEGER NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  eval_score INTEGER,
  eval_passed BOOLEAN,
  eval_started_at TIMESTAMP,
  completed_at TIMESTAMP,
  UNIQUE (enrollment_id, module_index)
);

-- Cuenta del profesor (Rafael Carrizo). La contraseña se guarda como hash
-- salt:scrypt-hex — nunca en texto plano en el código ni en la base.
INSERT INTO users (role, email, password_hash, nombre, apellido)
VALUES (
  'professor',
  'rafaelcarrizo108@gmail.com',
  'bcdb30307c341c7ce0f53134f3e7e7db:84c7b3980804031fd6e6f4700d4f9e18857c2bdca2f4640400fdca572e10bea853b50768beb79b3e192a37d3b0aa89a4deeae61f06af0af5936413da29aff0f5',
  'Rafael',
  'Carrizo'
);
