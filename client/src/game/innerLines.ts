/**
 * The ranger's own lines (docs/gameplay/2026-10-07-the-inner-voice.md): what
 * goes through their head, by scenario. Plain and short, never the end
 * cards' voice. Three a scenario: enough that a once-only scenario reads
 * differently across three matches and a capped one never repeats within
 * one (the draw is seeded, no repeat until spent), and few enough that the
 * clips of them (voiceClips.ts) stay small. Each line is a clip:
 * `audio/voice.<scenario>.<n>.mp3`, n from 1 in the pool's order.
 */
export type VoiceScenario =
  | "trailhead" | "rain" | "offTrailDay" | "offTrailNight" | "dusk" | "lamp" | "mist"
  | "cryFirst" | "cryAgain" | "shadeFirst" | "shadeGone" | "still" | "dontLook" | "crest" | "cap"
  | "body" | "hollow" | "chaseStart" | "chaseOffTrail" | "safe";

export const INNER_LINES: Readonly<Record<VoiceScenario, readonly string[]>> = {
  trailhead: [
    "Hmm... last seen up this trail. Three days ago.",
    "Fine day for it. Shouldn't take long.",
    "Hmm... day hike, they said. Three days ago.",
  ],
  rain: [
    "There it is. Knew I should've left earlier.",
    "Hope they found cover.",
    "Wet all the way up, then.",
  ],
  offTrailDay: [
    "Trail's that way.",
    "They wouldn't have come through here.",
    "I'm drifting. I should get back to the trail.",
  ],
  offTrailNight: [
    "They wouldn't be out here. Not in the dark.",
    "I need to get back on the trail. Now.",
    "Nothing good happens off the path at night.",
  ],
  dusk: [
    "Losing the light. I need to keep moving.",
    "Should've been down by now.",
    "Dusk already. Where did the day go?",
  ],
  lamp: [
    "Lamp.",
    "Can't see. Lamp on.",
    "Light. I need light.",
  ],
  mist: [
    "Fog's coming up off the ground.",
    "The ground's smoking. It's just fog. Just fog.",
    "This fog came out of nowhere.",
  ],
  cryFirst: [
    "What was that?!",
    "That didn't sound right.",
    "No. That's not an animal.",
  ],
  cryAgain: [
    "Again.",
    "There it is again.",
    "That sounded nearer.",
  ],
  shadeFirst: [
    "...Someone there?",
    "Hello? ...Hello?",
    "Who's there?",
  ],
  shadeGone: [
    "Nobody. No one's there.",
    "Must have just been the fog.",
    "I swear I saw someone.",
  ],
  still: [
    "Moving's better than this.",
    "I need to keep going.",
    "Why have I stopped?",
  ],
  dontLook: [
    "Don't look at them.",
    "Eyes on the trail. Not on that.",
    "I need to look away.",
  ],
  crest: [
    "Almost there. Just see what's up there and go.",
    "Just check the summit, and get down.",
    "Top's close. I'll be quick.",
  ],
  cap: [
    "That's theirs. That's their cap.",
    "Their cap. They came this way.",
    "Their cap. Why would they leave it?",
  ],
  body: [
    "...Oh. Oh no.",
    "...Oh god.",
    "...What is this?!",
  ],
  hollow: [
    "Oh god. Oh god, oh god.",
    "What... what is that?!",
    "No. No, no, no, no.",
  ],
  chaseStart: [
    "Run. NOW.",
    "I need to go. NOW.",
    "I need to get down the trail. NOW.",
  ],
  chaseOffTrail: [
    "The trail. Stay on the trail.",
    "Not through there. The trail!",
    "I'm off the path. Go back. Now!",
  ],
  safe: [
    "There's the car!",
    "Get in, get in, get in.",
    "Get in. Lock it. Go.",
  ],
};
