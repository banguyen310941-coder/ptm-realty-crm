/** @type {import('next').NextConfig} */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "media-src 'self' data: blob:",
  "upgrade-insecure-requests"
].join("; ");

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
          { key:"Permissions-Policy",value:"camera=(self), microphone=(), geolocation=()" },
          { key:"Content-Security-Policy",value:CONTENT_SECURITY_POLICY },
          { key:"Cross-Origin-Opener-Policy",value:"same-origin" },
          { key:"Cross-Origin-Resource-Policy",value:"same-origin" }
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
