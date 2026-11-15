/**
 * Remote photography for the storefront sections. NO local binary assets:
 * the deploy pipeline accepts text files only, so every photo is a Pexels
 * CDN URL. Each URL was fetched and visually checked before use.
 *
 * - hero: woman lying among tall wildflowers at golden hour, serene,
 *   warm cinematic light, darker flower field lower-left for the headline.
 *   Chosen over the previous clover-field photo: visibly closer to the
 *   reference (tall meadow flowers, golden hour, serene eyes-nearly-closed
 *   mood) in the same 1600x1000 centre crop.
 * - serumBottles: amber dropper bottles on a mirror, warm beige.
 * - creamTile / creamTall: woman applying cream to her cheek (same photo,
 *   two crops) — used for the bento tile and the How-it-works section,
 *   matching the artifact which reuses one photo in both places.
 * - favourites: amber bottle with stone blocks, warm beige.
 */
export const PHOTOS = {
  hero: "https://images.pexels.com/photos/14504663/pexels-photo-14504663.jpeg?auto=compress&cs=tinysrgb&w=1600&h=1000&fit=crop",
  serumBottles:
    "https://images.pexels.com/photos/7796455/pexels-photo-7796455.jpeg?auto=compress&cs=tinysrgb&w=1200",
  creamTile:
    "https://images.pexels.com/photos/9774655/pexels-photo-9774655.jpeg?auto=compress&cs=tinysrgb&w=900&h=620&fit=crop",
  creamTall:
    "https://images.pexels.com/photos/9774655/pexels-photo-9774655.jpeg?auto=compress&cs=tinysrgb&w=900&h=1100&fit=crop",
  favourites:
    "https://images.pexels.com/photos/6693975/pexels-photo-6693975.jpeg?auto=compress&cs=tinysrgb&w=1000&h=900&fit=crop",
} as const;
