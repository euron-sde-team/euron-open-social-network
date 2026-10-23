/** Types for server.mjs so the API's TypeScript tests can import the stub. */
export declare function startStub(port?: number): Promise<{ url: string; close(): Promise<void> }>;
export declare function score(input: unknown): { flagged: boolean; categories: Record<string, boolean>; category_scores: Record<string, number> };
