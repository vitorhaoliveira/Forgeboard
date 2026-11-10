import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // The shared package ships TypeScript source.
  transpilePackages: ["@forgeboard/shared"],
  // The dev badge would sit on top of the rail's settings button.
  devIndicators: false,
};

export default withNextIntl(nextConfig);
