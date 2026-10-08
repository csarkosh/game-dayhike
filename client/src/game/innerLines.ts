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
  | "trailhead" | "rain" | "offTrailDay" | "offTrailNight" | "dusk" | "lamp" | "birds" | "mist"
  | "cryFirst" | "cryAgain" | "shadeFirst" | "shadeGone" | "still" | "dontLook" | "crest" | "cap"
  | "body" | "chaseStart" | "chaseOffTrail" | "safe";

export const INNER_LINES: Readonly<Record<VoiceScenario, readonly string[]>> = {
  trailhead: [
    "Last seen up this trail. Three days ago.",
    "Fine day for it. Shouldn't take long.",
    "Day hike, they said. Three days ago.",
  ],
  rain: [
    "There it is. Knew I should've left earlier.",
    "Hope they found cover.",
    "Wet all the way up, then.",
  ],
  offTrailDay: [
    "Trail's that way.",
    "They wouldn't have come through here. Back to the path.",
    "I'm drifting. Trail.",
  ],
  offTrailNight: [
    "Not out here. Not in the dark.",
    "Get back on the trail. Now.",
    "Nothing good happens off the path at night.",
  ],
  dusk: [
    "Losing the light. Keep moving.",
    "Should've been down by now.",
    "Dusk already. Where did the day go?",
  ],
  lamp: [
    "Lamp.",
    "Can't see. Lamp on.",
    "Light. I need light.",
  ],
  birds: [
    "Why did the birds stop?",
    "When did it get so quiet?",
    "What stopped the birds?",
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
    "Same sound. Nearer.",
  ],
  shadeFirst: [
    "...Someone there?",
    "Hello? ...Hello?",
    "Who's there?",
  ],
  shadeGone: [
    "Nobody. Nobody there.",
    "Just the fog. Just the fog.",
    "I saw someone. I did.",
  ],
  still: [
    "Moving's better than this.",
    "Keep going. Don't stop.",
    "Why have I stopped? Go.",
  ],
  dontLook: [
    "Don't look at them.",
    "Eyes on the trail. Not on that.",
    "Look away. Look away.",
  ],
  crest: [
    "Almost there. Just see what's up there and go.",
    "The top. Find them, and get down.",
    "Top's close. Whatever's there, be quick.",
  ],
  cap: [
    "That's theirs. That's their cap.",
    "Their cap. They came this way.",
    "Their cap. Why would they leave it?",
  ],
  body: [
    "...Oh. Oh no.",
    "Found you. ...Oh god.",
    "Three days. Oh, no.",
  ],
  chaseStart: [
    "Run.",
    "Go. Go. GO.",
    "Down. Down the trail. Run.",
  ],
  chaseOffTrail: [
    "The trail. Stay on the trail.",
    "Not through there. The trail!",
    "Off the path. No. Back!",
  ],
  safe: [
    "The car. The car.",
    "Get in. Get in, get in.",
    "In. Lock it. Go.",
  ],
};
