import type { NextConfig } from "next";

const config: NextConfig = {
  // Keep development output separate so a production build cannot break HMR.
  distDir: process.env.NODE_ENV === "development" ? ".next/dev" : ".next",
};
export default config;
