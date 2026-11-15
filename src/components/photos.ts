/**
 * Remote photography for the storefront sections. NO local binary assets:
 * the deploy pipeline accepts text files only, so every photo is a remote
 * CDN URL. Each URL was fetched and visually checked before use.
 *
 * - hero: woman lying in wildflowers at golden hour, eyes closed, arms
 *   behind her head — sent by the user (Lummi asset), replacing the
 *   Pexels wildflower photo. Served as JPEG q80 at 1600px wide.
 * - serumBottles: amber dropper bottles on a mirror, warm beige.
 * - creamTile / creamTall: woman applying cream to her cheek (same photo,
 *   two crops) — used for the bento tile and the How-it-works section,
 *   matching the artifact which reuses one photo in both places.
 * - favourites: amber bottle with stone blocks, warm beige.
 */
export const PHOTOS = {
  hero: "https://assets.lummi.ai/assets/QmQoGqfRx6HqqtQmdZSVn1qr5suQd4rCZJVNtZmkcNBjVH?auto=format&w=1600&fm=jpg&q=80",
  serumBottles:
    "https://images.pexels.com/photos/7796455/pexels-photo-7796455.jpeg?auto=compress&cs=tinysrgb&w=1200",
  creamTile:
    "https://images.pexels.com/photos/9774655/pexels-photo-9774655.jpeg?auto=compress&cs=tinysrgb&w=900&h=620&fit=crop",
  creamTall:
    "https://images.pexels.com/photos/9774655/pexels-photo-9774655.jpeg?auto=compress&cs=tinysrgb&w=900&h=1100&fit=crop",
  favourites:
    "https://images.pexels.com/photos/6693975/pexels-photo-6693975.jpeg?auto=compress&cs=tinysrgb&w=1000&h=900&fit=crop",
} as const;
