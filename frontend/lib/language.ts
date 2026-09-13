/** Detected-language display names. Mirrors the backend LANGUAGE_NAMES map
 *  (apps/graph_api/services/language.py). Unknown codes echo back raw —
 *  never blank, never a guessed name. */

const NAMES: Record<string, string> = {
  en: "English",
  hi: "Hindi",
  mr: "Marathi",
  bn: "Bengali",
  ta: "Tamil",
  te: "Telugu",
  kn: "Kannada",
  ml: "Malayalam",
  gu: "Gujarati",
  pa: "Punjabi",
  or: "Odia",
  as: "Assamese",
  ur: "Urdu",
};

export function languageName(code?: string | null): string {
  if (!code) return "Unknown";
  return NAMES[code.toLowerCase()] ?? code;
}
