import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Zenote",
    short_name: "Zenote",
    description: "Chat, analyze files, work with images, and access powerful AI models from one place.",
    start_url: "/",
    display: "standalone",
    background_color: "#171717",
    theme_color: "#171717",
    icons: [
      { src: "/icon-192x192.svg", sizes: "192x192", type: "image/svg+xml" },
      { src: "/icon-512x512.svg", sizes: "512x512", type: "image/svg+xml" },
    ],
  }
}
