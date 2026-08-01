// Example custom provider - copy this folder and modify
// Each folder under custom-providers/ is a provider

// catalog.ts - define categories shown on home page
export const catalog = [
  { title: "Popular Movies", filter: "/category/popular" },
  { title: "Latest Movies", filter: "/category/latest" },
];

export const genres = [
  { title: "Action", filter: "/genre/action" },
  { title: "Comedy", filter: "/genre/comedy" },
];
