import { join } from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // The shared package ships TypeScript source.
  transpilePackages: ["@forgeboard/shared"],
  // The dev badge would sit on top of the rail's settings button.
  devIndicators: false,
  // The `forgeboard` npm package ships a standalone build (see packages/cli).
  ...(process.env.FORGEBOARD_STANDALONE === "1" ? { output: "standalone", outputFileTracingRoot: join(import.meta.dirname, "../..") } : {}),
};

export default withNextIntl(nextConfig);
