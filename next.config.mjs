/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  async redirects() {
    return [
      "/dashboard",
      "/leads",
      "/deals",
      "/properties",
      "/tasks",
      "/team",
      "/login"
    ].map((source) => ({ source, destination: "/", permanent: false }));
  }
};

export default nextConfig;
