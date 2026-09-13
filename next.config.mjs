/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source:"/:path*",
        headers:[
          { key:"X-Content-Type-Options",value:"nosniff" },
          { key:"X-Frame-Options",value:"DENY" },
          { key:"Referrer-Policy",value:"strict-origin-when-cross-origin" },
          { key:"Permissions-Policy",value:"camera=(self), microphone=(), geolocation=()" }
        ]
      },
      {
        source:"/sw.js",
        headers:[
          { key:"Cache-Control",value:"no-cache, no-store, must-revalidate" },
          { key:"Service-Worker-Allowed",value:"/" }
        ]
      },
      {
        source:"/manifest.webmanifest",
        headers:[
          { key:"Cache-Control",value:"public, max-age=0, must-revalidate" }
        ]
      }
    ];
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
