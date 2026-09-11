export const COURSE_SLUGS = [
  "cero", "ptw", "altura", "espacios", "caliente",
  "loto", "izaje", "quimicas", "riesgos", "emergencias",
];

export const MODULES_PER_COURSE = 10;
export const PASS_MIN = 6;
export const TOTAL_QUESTIONS = 10;
export const EVAL_DURATION_SECONDS = 10 * 60;

export function isValidCourse(slug) {
  return typeof slug === "string" && COURSE_SLUGS.includes(slug);
}
