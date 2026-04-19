import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  pages: {
    signIn: '/login',
  },
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider === 'google') {
        const allowedDomain = process.env.AUTH_ALLOWED_DOMAIN;
        // If AUTH_ALLOWED_DOMAIN is set, restrict to that domain. Otherwise allow all Google accounts.
        if (allowedDomain) {
          return profile?.email?.endsWith(`@${allowedDomain}`) ?? false;
        }
        return true;
      }
      return false;
    },
    async session({ session }) {
      return session;
    },
    authorized({ auth: session, request: { nextUrl } }) {
      const isLoggedIn = !!session?.user;
      const isOnLogin = nextUrl.pathname.startsWith('/login');
      if (isOnLogin) {
        // Redirect to home if already logged in
        if (isLoggedIn) return Response.redirect(new URL('/', nextUrl));
        return true;
      }
      // Require auth for all other pages
      return isLoggedIn;
    },
  },
});
