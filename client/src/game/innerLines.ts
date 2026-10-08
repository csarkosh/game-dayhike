/**
 * The ranger's own lines (docs/gameplay/2026-10-07-the-inner-voice.md): what
 * goes through their head, by scenario. Plain and short, never the end
 * cards' voice. Each pool is wide enough that a match uses a few of them
 * and the next match others: the woods are made afresh each time, and the
 * voice should not be the one thing that repeats.
 */
export type VoiceScenario =
  | "trailhead" | "rain" | "offTrailDay" | "offTrailNight" | "dusk" | "lamp" | "birds" | "mist"
  | "cryFirst" | "cryAgain" | "shadeFirst" | "shadeGone" | "still" | "dontLook" | "crest" | "cap"
  | "body" | "chaseStart" | "chaseOffTrail" | "safe";

export const INNER_LINES: Readonly<Record<VoiceScenario, readonly string[]>> = {
  trailhead: [
    "Last seen up this trail. Three days ago.",
    "Fine day for it. Shouldn't take long.",
    "Their car's still in the lot. They're up here somewhere.",
    "One hiker, overdue. Start where they were last seen.",
    "Easy trail. People get lost on easy trails.",
    "Day hike, they said. Three days ago.",
  ],
  rain: [
    "There it is. Knew I should've left earlier.",
    "Rain. Of course.",
    "Hope they found cover.",
    "That's the weather turning. Keep going.",
    "Wet all the way up, then.",
    "Three days in this. Hope they had a shell.",
  ],
  offTrailDay: [
    "Trail's that way.",
    "Easy to lose the path in this.",
    "Back to the trail. Cover ground, not brush.",
    "They wouldn't have come through here. Back to the path.",
    "I'm drifting. Trail.",
    "This isn't the way. The trail.",
  ],
  offTrailNight: [
    "Not out here. Not in the dark.",
    "Get back on the trail. Now.",
    "It's dangerous off the trail at this hour.",
    "Can't see a thing out here. The trail.",
    "Nothing good happens off the path at night.",
    "Off the trail, in the dark. Brilliant. Back.",
  ],
  dusk: [
    "Losing the light. Keep moving.",
    "Sun's going. Didn't plan on that.",
    "Getting dark faster than I thought.",
    "Should've been down by now.",
    "Dark soon. Move.",
    "Dusk already. Where did the day go?",
  ],
  lamp: [
    "Lamp.",
    "Can't see. Lamp on.",
    "Turn the lamp on.",
    "Light. I need light.",
  ],
  birds: [
    "Why did the birds stop?",
    "When did it get so quiet?",
    "Where did the birds go?",
    "No birds. Why no birds?",
    "Did the birds just... stop?",
    "What stopped the birds?",
  ],
  mist: [
    "Fog's coming up off the ground.",
    "Where's this mist coming from?",
    "The ground's smoking. It's just fog. Just fog.",
    "Mist. Can't see my feet.",
    "This fog came out of nowhere.",
    "Cold. And the fog's rising with it.",
  ],
  cryFirst: [
    "What was that?!",
    "That wasn't an elk.",
    "That didn't sound right.",
    "What... what makes a sound like that?",
    "No. That's not an animal.",
    "What in god's name was that?",
  ],
  cryAgain: [
    "Again.",
    "There it is again.",
    "It's closer.",
    "That's the same thing. It's closer.",
    "Same sound. Nearer.",
  ],
  shadeFirst: [
    "...Someone there?",
    "Hello? ...Hello?",
    "Is that you? Hey!",
    "Who's there?",
    "Did something move?",
    "There. Someone's standing there.",
  ],
  shadeGone: [
    "Nobody. Nobody there.",
    "It's gone. Was it ever there?",
    "Just the fog. Just the fog.",
    "Nothing. There was nothing.",
    "I saw someone. I did.",
    "Gone. Like it was never there.",
  ],
  still: [
    "Moving's better than this.",
    "Standing here isn't finding them.",
    "Keep going. Don't stop.",
    "Don't stand in the dark. Walk.",
    "Why have I stopped? Go.",
  ],
  dontLook: [
    "Don't look at them.",
    "Eyes on the trail. Not on that.",
    "Stop looking. Walk.",
    "Don't look. Don't.",
    "Look away. Look away.",
  ],
  crest: [
    "Almost there. Just see what's up there and go.",
    "Nearly the top. Look, then leave.",
    "The top. Find them, and get down.",
    "Just a little further. Then home.",
    "Top's close. Whatever's there, be quick.",
  ],
  cap: [
    "That's theirs. That's their cap.",
    "Their cap. They came this way.",
    "The cap from the photo. They were here.",
    "Their cap. Why would they leave it?",
    "That's the cap. So they made it this far.",
  ],
  body: [
    "...Oh. Oh no.",
    "No. No, no.",
    "Found you. ...Oh god.",
    "That's them. That's... oh no.",
    "Three days. Oh, no.",
  ],
  chaseStart: [
    "Run.",
    "RUN.",
    "Go. Go. GO.",
    "Move. Move!",
    "Down. Down the trail. Run.",
  ],
  chaseOffTrail: [
    "The trail. Stay on the trail.",
    "Trail! Back to the trail!",
    "Not through there. The trail!",
    "The path. The path!",
    "Off the path. No. Back!",
  ],
  safe: [
    "The car. The car.",
    "Get in. Get in, get in.",
    "Made it. ...Did I?",
    "The car. Go.",
    "In. Lock it. Go.",
  ],
};
