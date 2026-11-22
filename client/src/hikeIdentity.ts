import type { GameIdentity } from "@csarkosh/engine/identity";

/** Day Hike's identity: its name, its word for a session, what a nameless hiker is called, and the prefix of its keys in the browser. */
export const HIKE_IDENTITY: GameIdentity = { title: "Day Hike", session: "hike", player: "Hiker", storage: "dayhike" };

/** Where the tokens line on Day Hike's landing page goes: the donate page's door for this game. */
export const HIKE_TOKENS_URL = "https://donate.csarko.sh/dayhike";
