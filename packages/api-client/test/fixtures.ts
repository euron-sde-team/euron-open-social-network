import type { AuthResult, Me } from "@open-social/types";

export const me: Me = {
  id: "01J00000000000000000000001",
  username: "ada",
  displayName: "Ada L",
  avatarUrl: null,
  headline: null,
  role: "USER",
  email: "ada@example.org",
  status: "ACTIVE",
  emailVerified: true,
  totpEnabled: false,
  dmPrivacy: "COMMUNITIES",
  emailDigest: false,
  suspendedUntil: null,
  reputation: 0,
  level: 1,
};

export const authResult = (token: string): AuthResult => ({ accessToken: token, expiresIn: 900, user: me });

export function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? {} : { "content-type": "application/json" },
  });
}
