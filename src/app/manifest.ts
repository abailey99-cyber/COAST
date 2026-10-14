import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "COAST",
    short_name: "COAST",
    description: "Centralised Order And Shipment Tracking",
    start_url: "/app",
    display: "standalone",
    background_color: "#0A1F2C",
    theme_color: "#0E2A3B",
    icons: [
      { src: "/brand/coast-app-icon-180.png", sizes: "180x180", type: "image/png" },
      { src: "/brand/coast-app-icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/brand/coast-app-icon-1024.png", sizes: "1024x1024", type: "image/png" },
    ],
  };
}
