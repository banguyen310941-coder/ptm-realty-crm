/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{
      source:"/:path*",
      headers:[
        { key:"X-Content-Type-Options",value:"nosniff" },
        { key:"X-Frame-Options",value:"DENY" },
        { key:"Referrer-Policy",value:"strict-origin-when-cross-origin" },
        { key:"Permissions-Policy",value:"camera=(self), microphone=(), geolocation=()" }
      ]
    }];
  },
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
