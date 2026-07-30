/**
 * Client-safe display strings for the chat widget.
 *
 * Deliberately separate from lib/system-prompt.ts. That file now pulls in
 * lib/services.ts -> lib/db.ts -> the `pg` driver to build the agent's prompt,
 * which is Node-only and cannot be bundled into the browser. ChatWidget.tsx is
 * a client component, so importing anything from system-prompt.ts there breaks
 * the build with "Module not found: Can't resolve 'fs'". Keep it that way —
 * this file must never import lib/services, lib/db, or lib/system-prompt.
 */

export const GREETING =
  "Hi! I'm the CLOUDSUFI assistant. What are you looking to solve? Pick one below — or tell me in a line.";

export const SUGGESTED_PROMPTS = [
  "Data Platform & Warehouse Modernization",
  "Generative AI & LLM Applications",
  "Antifragile Supply Chain",
  "Application & Database Modernization",
  "Enterprise Integration",
  "Managed Data Services",
];
