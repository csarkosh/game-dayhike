<p align="center"><a href="https://games.csarko.sh/dayhike"><img src="branding/previews/postcards.png" alt="Postcards from Trail 14: the trailhead in front, the old wood, the tarn, the meadow, the crest and the beach behind it" width="900"></a></p>

<h1 align="center">Day Hike</h1>

<p align="center"><em>A mild morning; an easy trail; and the peculiar conviction that the woods were counting us.</em></p>

<p align="center">
<b>Play now</b> at <a href="https://games.csarko.sh/dayhike">games.csarko.sh/dayhike</a> · <b>1 to 5</b> players · <b>in the browser</b>, no account, no install · <b>free</b>
</p>

One hiker is missing, last seen at Trail 14, and the poster at the trailhead is the whole
briefing. You are the park ranger sent to find them. Lead a search party of up to five up the
trail to the crest, where the hiker is waiting, and so is whatever left them there. Then get
everyone back down to the road.

## Trail 14

*From the park's leaflet, as you'd find it in the box at the trailhead.*

A day hike of moderate difficulty from the coast road to the crest and back. Allow the day.
Carry water and a light. The trail is marked at every fork; please keep to it, for the ground's
sake and your own.

<table>
<tr>
<td width="56%" align="left" valign="top"><img src="branding/previews/forest.card.png" alt="Old growth: trunks and ferns on a mossy slope under the canopy" width="540"></td>
<td valign="bottom"><b>The old wood.</b> From the trailhead the trail climbs through old-growth forest: fir and pine on a floor of fern and moss, the light coming down green through the canopy. Elk browse at the edges; a raven may follow you a while.</td>
</tr>
<tr>
<td valign="top"><b>The tarn.</b> Halfway up, a still lake in a hollow of the hill, lilies on the water and rock at its shore. A good place to stop. The loop around it rejoins the trail; the far shore is the quieter one.</td>
<td align="right" valign="top"><img src="branding/previews/tarn.card.png" alt="A tarn with lily pads, rocks and ferns on its shore, the forest round it" width="460"></td>
</tr>
<tr>
<td align="center" valign="top"><img src="branding/previews/meadow.card.png" alt="A mountain meadow, the forest's edge beyond it" width="400"></td>
<td valign="middle"><b>The meadow.</b> Above the lake the trees open on a meadow: grass to the knee, lupine and beargrass in their season, the first long view back down to the sea. Rabbits in the grass, if you are quiet.</td>
</tr>
<tr>
<td valign="bottom"><b>The crest.</b> Past the treeline the trail finds bare rock and the top. On a clear day the whole coast lies below; on most, the cloud comes and goes, and the cloud is its own reward. Turn back here.</td>
<td align="left" valign="top"><img src="branding/previews/crest.card.png" alt="The trail over bare ground at the crest, the last trees below it" width="540"></td>
</tr>
<tr>
<td align="right" valign="top"><img src="branding/previews/beach.card.png" alt="Wet sand and pebbles at low tide, a sea stack standing off the shore" width="440"></td>
<td valign="top"><b>The beach.</b> Below the road the forest ends on a shore of sand, pebbles and driftwood, a stack standing off it, the sea birds working the tide line. Walk it before you set out, or after, when the light comes back.</td>
</tr>
</table>

Every hike is its own forest: the world is built from a seed, so a party that sets out together
walks one world, and a new seed is a new one.

## Under the hood

Three layers, one direction of dependency: `game/ → net/ → sim/`. The simulation is pure
TypeScript with zero dependencies, steps at a fixed 60 Hz from a seed, and never imports the
renderer, which is what makes the netcode testable headless and a replay bit-identical. A match
runs peer to peer over WebRTC; a small signaling server introduces the party and steps out, so
the game costs nothing to keep online. Solo play is a host with no peers, the same code path.

Built with TypeScript, Babylon.js 9, Vite, Vitest and WebRTC. The details, from the world's
generation to the rendering to the hosting, are in [`ARCHITECTURE.md`](ARCHITECTURE.md) and
[`docs/`](docs/).

Write-ups of the work, with measurements, are on csarko.sh:
[WebGPU vs WebGL2](https://csarko.sh/research/webgpu-vs-webgl2),
[photorealistic water](https://csarko.sh/research/photorealistic-water-rendering),
[atmosphere and dread shaders](https://csarko.sh/research/atmosphere-and-dread-shaders),
[host-authoritative co-op netcode](https://csarko.sh/research/browser-coop-netcode), and
[20+ more](https://csarko.sh/research).

## Run it yourself

```bash
npm install      # Node >= 22.13
git lfs install  # the models and textures are LFS objects
npm run dev      # signaling server and Vite together, then open http://localhost:5173
npm test         # headless: determinism, movement, collision, the protocol, the world
```

A desktop launcher for macOS and Windows that loads the site lives in [`desktop/`](desktop/).

## License

[GPL-3.0](./LICENSE). Use it, study it, change it and share it, and share your changes under the
same terms. Third-party models and sounds are credited in [`CREDITS.md`](CREDITS.md).
