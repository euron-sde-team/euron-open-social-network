/**
 * Demo data: a fictional company network, "Northwind Labs", so a fresh install has
 * something to look at. Run with `pnpm demo:seed` (or `node dist/cli.js demo:seed`).
 *
 *   - 24 synthetic people (obviously fictional names, @example.com addresses), one
 *     platform admin and one platform moderator
 *   - 8 communities (public and private, OPEN, APPROVAL and INVITE_ONLY), with
 *     "Northwind Lobby" as the default community every new account joins
 *   - about 120 posts with tags, mentions, images, reactions, comments and replies,
 *     3 polls, Q&A with accepted answers, 6 events (one full, with a waitlist),
 *     follows and a couple of blocks
 *
 * Images are abstract gradients and shapes rendered in code with sharp: no stock
 * photos, no faces. Everything goes through the real services, so counters, points
 * and notifications are exactly what real use would produce.
 *
 * Refuses to run with NODE_ENV=production. If the demo admin already exists it only
 * prints the logins and exits.
 */
import crypto from "node:crypto";
import sharp from "sharp";
import type { Actor } from "../core/context";
import { config } from "../core/config";
import { newId } from "../core/ids";
import { db } from "../db/kysely";
import { storage } from "../integrations/storage";
import { closeRedis } from "../integrations/redis";
import { closeQueues } from "../jobs/registry";
import { hashPassword } from "../security/passwords";
import * as comments from "../services/comment.service";
import * as communities from "../services/community.service";
import { reconcileCounters } from "../services/counters.service";
import * as events from "../services/event.service";
import * as membership from "../services/membership.service";
import * as polls from "../services/poll.service";
import * as posts from "../services/post.service";
import * as qa from "../services/question.service";
import * as reactions from "../services/reaction.service";
import * as users from "../services/user.service";

const ADMIN_EMAIL = "admin@example.com";
const DOMAIN = "example.com";

// ─── Deterministic randomness ───────────────────────────────────────────────

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260401);
const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
function sample<T>(xs: readonly T[], n: number): T[] {
  const copy = [...xs];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy.slice(0, Math.max(0, Math.min(n, copy.length)));
}

// ─── Images ─────────────────────────────────────────────────────────────────

const PALETTES = [
  ["#0f766e", "#14b8a6", "#ccfbf1"],
  ["#1e3a8a", "#3b82f6", "#dbeafe"],
  ["#7c2d12", "#f97316", "#ffedd5"],
  ["#581c87", "#a855f7", "#f3e8ff"],
  ["#14532d", "#22c55e", "#dcfce7"],
  ["#831843", "#ec4899", "#fce7f3"],
  ["#713f12", "#eab308", "#fef9c3"],
  ["#0c4a6e", "#0ea5e9", "#e0f2fe"],
] as const;

/** An abstract composition: a diagonal gradient with soft circles and a band. */
function abstractSvg(width: number, height: number, variant: number): string {
  const [dark, mid, light] = PALETTES[variant % PALETTES.length] as readonly string[];
  const shapes: string[] = [];
  const count = 3 + (variant % 4);
  for (let i = 0; i < count; i++) {
    const r = Math.round(Math.min(width, height) * (0.12 + rand() * 0.35));
    shapes.push(`<circle cx="${Math.round(rand() * width)}" cy="${Math.round(rand() * height)}" r="${r}" fill="${i % 2 ? light : mid}" fill-opacity="${(0.18 + rand() * 0.35).toFixed(2)}"/>`);
  }
  const bandY = Math.round(height * (0.3 + rand() * 0.4));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${dark}"/><stop offset="1" stop-color="${mid}"/></linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  ${shapes.join("\n  ")}
  <rect x="0" y="${bandY}" width="${width}" height="${Math.round(height * 0.08)}" fill="${light}" fill-opacity="0.25" transform="rotate(-8 ${width / 2} ${bandY})"/>
</svg>`;
}

let imageCounter = 0;
async function makeImage(ownerId: string, purpose: "AVATAR" | "COVER" | "POST" | "COMMUNITY_ICON" | "COMMUNITY_COVER" | "EVENT_COVER", width: number, height: number): Promise<string> {
  imageCounter += 1;
  const png = await sharp(Buffer.from(abstractSvg(width, height, imageCounter))).png({ compressionLevel: 9 }).toBuffer();
  const id = newId();
  const key = `demo/${purpose.toLowerCase()}/${id}.png`;
  await storage().put(key, png, "image/png");
  await db
    .insertInto("media_uploads")
    .values({
      id,
      owner_id: ownerId,
      purpose,
      kind: "IMAGE",
      mime_type: "image/png",
      file_name: `${purpose.toLowerCase()}-${imageCounter}.png`,
      declared_size: png.length,
      size_bytes: png.length,
      storage_key: key,
      width,
      height,
      status: "READY",
      moderation_state: "CLEAN",
      completed_at: new Date(),
    })
    .execute();
  return id;
}

// ─── People ─────────────────────────────────────────────────────────────────

const PEOPLE: { name: string; headline: string; role?: "ADMIN" | "MODERATOR" }[] = [
  { name: "Morgan Northwind", headline: "Network admin at Northwind Labs", role: "ADMIN" },
  { name: "Quinn Lantern", headline: "Community moderator", role: "MODERATOR" },
  { name: "Juniper Vale", headline: "Staff engineer, platform" },
  { name: "Orrin Featherstone", headline: "Product designer" },
  { name: "Saffron Quill", headline: "Data scientist" },
  { name: "Bramble Okoro", headline: "Engineering manager" },
  { name: "Tamsin Wren", headline: "Frontend engineer" },
  { name: "Caspian Holloway", headline: "Head of product" },
  { name: "Marigold Ashby", headline: "UX researcher" },
  { name: "Thaddeus Pike", headline: "Site reliability engineer" },
  { name: "Wilhelmina Reed", headline: "Analytics lead" },
  { name: "Fennel Hart", headline: "Mobile engineer" },
  { name: "Isolde Marsh", headline: "People operations" },
  { name: "Ravi Thistle", headline: "Backend engineer" },
  { name: "Odessa Crane", headline: "Brand designer" },
  { name: "Lucan Birch", headline: "Security engineer" },
  { name: "Primrose Dunmore", headline: "Technical writer" },
  { name: "Ezra Kettle", headline: "Data engineer" },
  { name: "Clementine Rowe", headline: "Product manager" },
  { name: "Atlas Pembrook", headline: "Solutions architect" },
  { name: "Hazel Ferncastle", headline: "QA engineer" },
  { name: "Silas Merriweather", headline: "Finance partner" },
  { name: "Nova Galloway", headline: "Developer advocate" },
  { name: "Rowan Thornbury", headline: "Chief of staff" },
];

function usernameOf(name: string): string {
  return name.toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "").slice(0, 30);
}

function emailOf(p: (typeof PEOPLE)[number]): string {
  return p.role === "ADMIN" ? ADMIN_EMAIL : `${usernameOf(p.name).replace(/_/g, ".")}@${DOMAIN}`;
}

function printLogins(password: string | null, fresh: boolean): void {
  const lines = [
    "",
    `${config.PRODUCT_NAME} demo data: Northwind Labs`,
    "",
    `  admin      ${ADMIN_EMAIL}`,
    `  moderator  ${emailOf(PEOPLE[1]!)}`,
    `  member     ${emailOf(PEOPLE[2]!)}  (and 21 more, see /admin/users)`,
    "",
    password ? `  password   ${password}   (shared by every demo account${fresh ? "; shown once" : ", from DEMO_PASSWORD"})` : "  password   the one printed when the demo was first seeded, or DEMO_PASSWORD",
    "",
  ];
  process.stdout.write(lines.join("\n") + "\n");
}

// ─── Content ────────────────────────────────────────────────────────────────

const COMMUNITIES = [
  { name: "Northwind Lobby", visibility: "PUBLIC", joinPolicy: "OPEN", description: "Company-wide news, introductions and the odd celebration.", isDefault: true, owner: 0, tags: ["welcome", "news", "allhands", "kudos"] },
  { name: "Engineering Guild", visibility: "PUBLIC", joinPolicy: "OPEN", description: "Architecture notes, code review culture and on-call stories.", owner: 2, tags: ["architecture", "postgres", "typescript", "oncall", "testing"] },
  { name: "Design Studio", visibility: "PUBLIC", joinPolicy: "APPROVAL", description: "Critique, design systems and research readouts.", owner: 3, tags: ["design", "critique", "research", "accessibility"] },
  { name: "Product Council", visibility: "PRIVATE", joinPolicy: "APPROVAL", description: "Roadmap drafts and decisions before they go wide.", owner: 7, tags: ["roadmap", "planning", "decisions"] },
  { name: "Data and Analytics", visibility: "PUBLIC", joinPolicy: "OPEN", description: "Dashboards, experiments and SQL questions.", owner: 4, tags: ["sql", "experiments", "dashboards", "metrics"] },
  { name: "Leadership Circle", visibility: "PRIVATE", joinPolicy: "INVITE_ONLY", description: "A quiet room for people leads.", owner: 23, tags: ["leadership", "hiring", "feedback"] },
  { name: "Running Club", visibility: "PUBLIC", joinPolicy: "OPEN", description: "Lunch runs, weekend long runs and race reports.", owner: 9, tags: ["running", "5k", "trail"] },
  { name: "Book Nook", visibility: "PUBLIC", joinPolicy: "APPROVAL", description: "One book a month, discussed slowly.", owner: 16, tags: ["books", "fiction", "nonfiction"] },
] as const;

const OPENERS = [
  "Quick update from this week:",
  "Sharing something that helped our team:",
  "Question for the group:",
  "A small win worth celebrating:",
  "Notes from today's session:",
  "Hot take, happy to be argued out of it:",
  "Looking for input before Friday:",
  "Lesson learned the hard way:",
];
const BODIES = [
  "we cut the build time in half by caching dependencies per lockfile hash.",
  "short written proposals beat long meetings for most decisions.",
  "pairing on the gnarly migration made it boring, which is the goal.",
  "the new onboarding checklist got three people productive in their first week.",
  "we tried timeboxing reviews to 30 minutes and quality went up, not down.",
  "the dashboard now shows the median, not the mean, and arguments stopped.",
  "keeping the scope tiny let us ship on Tuesday instead of next month.",
  "accessibility checks in CI caught two regressions before release.",
  "a weekly demo keeps everyone honest about progress.",
  "writing the runbook before the incident is underrated.",
  "the prototype answered in two days what the spec could not in two weeks.",
  "we retired four feature flags and nobody noticed, which is perfect.",
];
const COMMENTS = [
  "Love this, thanks for writing it up.",
  "We saw the same thing last quarter.",
  "Could you share the before and after numbers?",
  "Strong agree.",
  "Saving this for our next retro.",
  "How did you get buy-in for that?",
  "This is the kind of post I come here for.",
  "Counterpoint: it depends on team size.",
  "Nice work, all of you.",
  "Adding this to the wiki.",
];

const QUESTIONS = [
  { title: "How do we choose between a queue and a cron job?", body: "Both work for our nightly sync. What do you weigh?", community: 1 },
  { title: "What is a good default for Postgres connection pools?", body: "Several services, a few replicas each.", community: 1 },
  { title: "How should we name events in product analytics?", body: "Verb first or noun first? #metrics", community: 4 },
  { title: "Is a 50/50 split always best for experiments?", body: "Traffic is small on some pages.", community: 4 },
  { title: "What makes a design critique useful rather than painful?", body: "We want more of the useful kind.", community: 2 },
  { title: "Which beginner trail runs are close to the office?", body: "Looking for something under 8 km.", community: 6 },
];
const ANSWERS = [
  "Start simple, measure, then change it when the numbers say so.",
  "We wrote a short decision record and it settled the debate.",
  "It depends on failure handling: retries and visibility favour the queue.",
  "Keep it boring and documented; future you will be grateful.",
  "Ask for the problem first, then the solution. It changes the tone.",
  "Small and consistent beats clever.",
];

async function quietly<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

export async function seedDemo(): Promise<void> {
  if (config.NODE_ENV === "production") throw new Error("demo:seed refuses to run with NODE_ENV=production");
  try {
    const existing = await db.selectFrom("users").select("id").where("email", "=", ADMIN_EMAIL).executeTakeFirst();
    if (existing) {
      printLogins(config.DEMO_PASSWORD ?? null, false);
      return;
    }
    await seed();
  } finally {
    await closeQueues().catch(() => undefined);
    await closeRedis().catch(() => undefined);
  }
}

async function seed(): Promise<void> {
  const password = config.DEMO_PASSWORD || crypto.randomBytes(9).toString("base64url");
  const hash = await hashPassword(password);
  const day = 86400_000;
  const now = Date.now();

  // People, with abstract avatars and covers.
  const people: Actor[] = [];
  for (const [i, p] of PEOPLE.entries()) {
    const id = newId();
    const username = usernameOf(p.name);
    await db
      .insertInto("users")
      .values({
        id,
        email: emailOf(p),
        username,
        display_name: p.name,
        password_hash: hash,
        role: p.role ?? "USER",
        status: "ACTIVE",
        email_verified_at: new Date(),
        headline: p.headline,
        bio: `${p.headline} at Northwind Labs, a fictional company used for this demo.`,
        location: pick(["Harbour Office", "Hill Street Office", "Remote"]),
        dm_privacy: i % 7 === 0 ? "FOLLOWING" : "COMMUNITIES",
        created_at: new Date(now - (60 + int(0, 30)) * day),
      })
      .execute();
    const avatar = await makeImage(id, "AVATAR", 256, 256);
    const cover = await makeImage(id, "COVER", 1200, 400);
    await db.updateTable("users").set({ avatar_upload_id: avatar, cover_upload_id: cover }).where("id", "=", id).execute();
    people.push({ id, username, displayName: p.name, role: p.role ?? "USER", status: "ACTIVE" });
  }
  const at = (i: number) => people[i] as Actor;

  // Communities, through the real service (owners become OWNER members).
  const made: { id: string; spec: (typeof COMMUNITIES)[number]; members: Actor[] }[] = [];
  for (const spec of COMMUNITIES) {
    const owner = at(spec.owner);
    const icon = await makeImage(owner.id, "COMMUNITY_ICON", 256, 256);
    const coverImg = await makeImage(owner.id, "COMMUNITY_COVER", 1600, 500);
    const c = await communities.create(owner, {
      name: spec.name,
      description: spec.description,
      visibility: spec.visibility,
      joinPolicy: spec.joinPolicy,
      rules: [
        { title: "Be kind", body: "Critique ideas, not people." },
        { title: "Stay on topic", body: "Off-topic threads belong in the Lobby." },
      ],
      color: PALETTES[made.length % PALETTES.length]![1],
      iconUploadId: icon,
      coverUploadId: coverImg,
    });
    if ("isDefault" in spec && spec.isDefault) await db.updateTable("communities").set({ is_default: true }).where("id", "=", c.id).execute();
    made.push({ id: c.id, spec, members: [owner] });
  }

  // Memberships: everyone is in the Lobby; others by interest. Approval communities get
  // a few pending requests; the invite-only one is joined through an invite.
  for (const [ci, c] of made.entries()) {
    const target = ci === 0 ? people.length : int(7, 14);
    const candidates = sample(people.filter((p) => !c.members.some((m) => m.id === p.id)), target);
    const invite = c.spec.joinPolicy === "INVITE_ONLY" ? await membership.createInvite(c.members[0]!, c.id, { maxUses: 20 }) : null;
    for (const [k, person] of candidates.entries()) {
      const res = await membership.join(person, c.id, invite?.code);
      if (res.status === "PENDING" && k % 4 !== 3) await membership.approve(c.members[0]!, c.id, person.id);
      if (res.status === "ACTIVE" || k % 4 !== 3) c.members.push(person);
    }
  }
  // Moderators in the larger communities; the platform moderator helps in the Lobby.
  for (const c of made) {
    const mod = c.members.find((m, i) => i > 0 && m.role === "USER");
    if (mod) await membership.setRole(c.members[0]!, c.id, mod.id, "MODERATOR");
  }
  if (!made[0]!.members.some((m) => m.id === at(1).id)) made[0]!.members.push(at(1));

  // Follows and two blocks.
  for (const person of people) {
    for (const other of sample(people.filter((p) => p.id !== person.id), int(3, 8))) await quietly(() => users.follow(person, other.id));
  }
  const meta = { requestId: "demo-seed", ip: null, userAgent: "demo-seed" };
  await users.block(at(14), at(21).id, meta);
  await users.block(at(19), at(12).id, meta);

  // Posts with tags, mentions, images, polls, reactions, comments and replies.
  const createdPosts: { id: string; communityIndex: number; at: Date }[] = [];
  const PER_COMMUNITY = [24, 20, 14, 12, 16, 8, 14, 12];
  for (const [ci, c] of made.entries()) {
    for (let n = 0; n < (PER_COMMUNITY[ci] ?? 10); n++) {
      const author = pick(c.members);
      const mention = rand() < 0.3 ? pick(c.members.filter((m) => m.id !== author.id)) : null;
      const tags = sample(c.spec.tags, int(1, 2));
      const body = `${pick(OPENERS)} ${pick(BODIES)}${mention ? ` Thanks @${mention.username} for the nudge.` : ""} ${tags.map((t) => `#${t}`).join(" ")}`;
      const mediaIds = rand() < 0.2 ? [await makeImage(author.id, "POST", 1200, 800)] : [];
      const kind = n === 0 ? "ANNOUNCEMENT" : "POST";
      const postAuthor = kind === "ANNOUNCEMENT" ? c.members[0]! : author;
      const post = await posts.create(postAuthor, { communityId: c.id, body, kind, tags, mediaIds: postAuthor.id === author.id ? mediaIds : [] });
      const createdAt = new Date(now - (int(0, 28) * day + int(0, 86_000) * 1000));
      createdPosts.push({ id: post.id, communityIndex: ci, at: createdAt });
      if (n === 0) await posts.pin(c.members[0]!, post.id);

      for (const reactor of sample(c.members.filter((m) => m.id !== post.author.id), int(0, 9))) {
        await quietly(() => reactions.setPostReaction(reactor, post.id, pick(["LIKE", "LIKE", "LIKE", "LOVE", "CARE", "HAHA", "WOW"] as const)));
      }
      for (let k = 0; k < int(0, 4); k++) {
        const commenter = pick(c.members);
        const comment = await quietly(() => comments.create(commenter, post.id, { body: pick(COMMENTS) }));
        if (comment && rand() < 0.5) {
          const replier = pick(c.members);
          const reply = await quietly(() => comments.create(replier, post.id, { body: `@${commenter.username} ${pick(COMMENTS)}`, parentId: comment.id }));
          if (reply && rand() < 0.5) await quietly(() => reactions.setCommentReaction(commenter, reply.id, "LIKE"));
        }
      }
    }
  }

  // Three polls.
  const pollSpecs = [
    { ci: 0, q: "Which day works best for the all-hands?", options: ["Monday", "Wednesday", "Friday"], multiple: false, anonymous: false },
    { ci: 1, q: "Which topics should the next guild session cover?", options: ["Observability", "Testing strategy", "Postgres tuning", "Incident reviews"], multiple: true, anonymous: false },
    { ci: 6, q: "How far was your longest run this month?", options: ["Under 5 km", "5 to 10 km", "10 to 21 km", "Further"], multiple: false, anonymous: true },
  ];
  for (const spec of pollSpecs) {
    const c = made[spec.ci]!;
    const post = await posts.create(c.members[0]!, { communityId: c.id, body: `${spec.q} Vote below.`, poll: { question: spec.q, options: spec.options, allowMultiple: spec.multiple, isAnonymous: spec.anonymous } });
    createdPosts.push({ id: post.id, communityIndex: spec.ci, at: new Date(now - int(1, 6) * day) });
    const options = post.poll!.options;
    for (const voter of sample(c.members, Math.min(c.members.length, 14))) {
      const choice = spec.multiple ? sample(options, int(1, 2)).map((o) => o.id) : [pick(options).id];
      await quietly(() => polls.vote(voter, post.poll!.id, choice));
    }
  }

  // Q&A with votes and accepted answers.
  for (const [qi, spec] of QUESTIONS.entries()) {
    const c = made[spec.community]!;
    const asker = pick(c.members);
    const question = await qa.create(asker, { communityId: c.id, title: spec.title, body: spec.body, tags: sample(c.spec.tags, 1) });
    const answerIds: string[] = [];
    for (const answerer of sample(c.members.filter((m) => m.id !== asker.id), int(2, 4))) {
      const a = await qa.createAnswer(answerer, question.id, pick(ANSWERS));
      answerIds.push(a.id);
      for (const voter of sample(c.members.filter((m) => m.id !== answerer.id), int(0, 5))) await quietly(() => qa.voteAnswer(voter, a.id, 1));
    }
    for (const voter of sample(c.members.filter((m) => m.id !== asker.id), int(1, 6))) await quietly(() => qa.voteQuestion(voter, question.id, 1));
    if (qi % 3 !== 2 && answerIds.length) await qa.accept(asker, question.id, pick(answerIds));
  }

  // Six events: one full with a waitlist, one past, one network-wide.
  const hours = (h: number) => new Date(now + h * 3600_000).toISOString();
  const eventSpecs = [
    { ci: 0, title: "Quarterly all-hands", start: 24 * 6, capacity: null, virtual: true, location: null },
    { ci: 1, title: "Architecture review: search service", start: 24 * 3, capacity: 3, virtual: true, location: null },
    { ci: 2, title: "Design critique hour", start: 24 * 9, capacity: 12, virtual: false, location: "Studio room, Harbour Office" },
    { ci: 6, title: "Saturday long run", start: 24 * 4, capacity: null, virtual: false, location: "North gate of the park" },
    { ci: 7, title: "Book club: chapter one to five", start: -24 * 5, capacity: 15, virtual: true, location: null },
    { ci: null, title: "Northwind Labs open house", start: 24 * 14, capacity: 200, virtual: false, location: "Hill Street Office" },
  ];
  for (const spec of eventSpecs) {
    const c = spec.ci === null ? null : made[spec.ci]!;
    const organizer = c ? c.members[0]! : at(0);
    const cover = await makeImage(organizer.id, "EVENT_COVER", 1200, 600);
    const startsAt = hours(spec.start);
    const endsAt = hours(spec.start + 2);
    const event = await events.create(organizer, {
      communityId: c?.id ?? null,
      title: spec.title,
      description: `${spec.title}. Everyone welcome; bring questions.`,
      location: spec.location,
      isVirtual: spec.virtual,
      virtualLink: spec.virtual ? `https://meet.example.com/northwind-${crypto.randomBytes(3).toString("hex")}` : null,
      startsAt: spec.start < 0 ? hours(1) : startsAt,
      endsAt: spec.start < 0 ? hours(3) : endsAt,
      timezone: "Europe/London",
      capacity: spec.capacity,
      coverUploadId: cover,
    });
    const crowd = c ? c.members.filter((m) => m.id !== organizer.id) : people.filter((p) => p.id !== organizer.id);
    const going = spec.capacity === 3 ? 5 : int(3, Math.min(10, crowd.length));
    for (const [k, person] of sample(crowd, going + 3).entries()) {
      await quietly(() => events.rsvp(person, event.id, k < going ? "GOING" : "INTERESTED"));
    }
    if (spec.start < 0) await db.updateTable("events").set({ starts_at: new Date(startsAt), ends_at: new Date(endsAt), reminded_at: new Date() }).where("id", "=", event.id).execute();
  }

  // Spread the timeline over the last four weeks (comments follow their post).
  for (const p of createdPosts) {
    await db.updateTable("posts").set({ created_at: p.at }).where("id", "=", p.id).execute();
    await db.updateTable("comments").set({ created_at: new Date(p.at.getTime() + int(5, 600) * 60_000) }).where("post_id", "=", p.id).execute();
    await db.updateTable("post_tags").set({ created_at: p.at }).where("post_id", "=", p.id).execute();
  }
  await db.updateTable("points_ledger").set({ created_at: new Date(now - int(0, 20) * day) }).where("created_at", ">", new Date(now - 3600_000)).execute();
  await reconcileCounters();

  printLogins(password, true);
}
