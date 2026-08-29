import { NextAuthOptions } from "next-auth";
import GithubProvider from "next-auth/providers/github";
import { saveUser } from "@/lib/db";

export const authOptions: NextAuthOptions = {
  providers: [
    GithubProvider({
      clientId: process.env.GITHUB_ID || "demo_client_id",
      clientSecret: process.env.GITHUB_CLIENT_SECRET || "demo_client_secret",
      authorization: {
        url: "https://github.com/login/oauth/authorize",
        params: {
          scope: "read:user user:email repo",
        },
      },
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET || "demo_secret_key_for_hackathon_12345",
  callbacks: {
    async redirect({ url, baseUrl }) {
      console.log("[DEBUG NextAuth Redirect Callback]", { url, baseUrl });
      return url.startsWith(baseUrl) ? url : baseUrl;
    },
    async jwt({ token, account, profile }) {
      if (account && profile) {
        token.accessToken = account.access_token;
        const ghProfile = profile as { id?: number; login?: string };
        token.githubId = ghProfile.id?.toString();
        token.username = ghProfile.login;

        if (
          token.sub &&
          typeof token.username === "string" &&
          typeof token.githubId === "string" &&
          typeof token.accessToken === "string"
        ) {
          try {
            saveUser(token.sub, token.username, token.githubId, token.accessToken);
          } catch {
            // Ignore DB save errors
          }
        }
      }
      return token;
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken as string;
      if (session.user) {
        session.user.id = token.sub;
        session.user.username = token.username as string;
      }
      return session;
    },
  },
};
