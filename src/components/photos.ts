/**
 * Remote photography for the storefront sections. NO local binary assets:
 * the deploy pipeline accepts text files only, so every photo is a Pexels
 * CDN URL. Each URL was fetched and visually checked before use.
 *
 * - hero: woman lying in a sunlit field of wildflowers, golden hour.
 * - serumBottles: amber dropper bottles on a mirror, warm beige.
 * - creamTile / creamTall: woman applying cream to her cheek (same photo,
 *   two crops) — used for the bento tile and the How-it-works section,
 *   matching the artifact which reuses one photo in both places.
 * - favourites: amber bottle with stone blocks, warm beige.
 */
export const PHOTOS = {
  hero: "https://images.pexels.com/photos/17378978/pexels-photo-17378978.jpeg?auto=compress&cs=tinysrgb&w=1600&h=1000&fit=crop",
  serumBottles:
    "https://images.pexels.com/photos/7796455/pexels-photo-7796455.jpeg?auto=compress&cs=tinysrgb&w=1200",
  creamTile:
    "https://images.pexels.com/photos/9774655/pexels-photo-9774655.jpeg?auto=compress&cs=tinysrgb&w=900&h=620&fit=crop",
  creamTall:
    "https://images.pexels.com/photos/9774655/pexels-photo-9774655.jpeg?auto=compress&cs=tinysrgb&w=900&h=1100&fit=crop",
  favourites:
    "https://images.pexels.com/photos/6693975/pexels-photo-6693975.jpeg?auto=compress&cs=tinysrgb&w=1000&h=900&fit=crop",
} as const;
