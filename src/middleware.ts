export { auth as middleware } from '@/auth';

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - /login (auth page)
     * - /api/auth/* (NextAuth routes)
     * - /health (health check endpoint)
     * - /_next/static (static files)
     * - /_next/image (image optimization)
     * - /favicon.ico
     */
    '/((?!login|features|api/auth|api/health|health|ws|_next/static|_next/image|favicon\\.ico).*)',
  ],
};
