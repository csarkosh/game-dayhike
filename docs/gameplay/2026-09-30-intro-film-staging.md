# The intro with the film's own models, as it looks on the scene route

**Date:** 2026-09-30
**Commit:** on `worktree-intro-assets` after `f42838e` (main `65ed63e` plus the film's car and ranger).
**Spec:** [`2026-09-29-intro-scene.md`](2026-09-29-intro-scene.md), §2, §3 and §6.
**Machine:** Apple M4, Chrome 154 headed through DevTools, the dev server, a 1200 by 736 viewport at twice the pixels, `?tier=high`. `dayhikeScene.engine()` reads `"webgpu"`.
**Models:** `intro.car` (wheels, steering wheel, driver's door, handset and cradle as parts, the cab inside) and `intro.ranger` (ten clips). The frames are in the look's archive outside the repository.

## What was seen

Each time as `dayhikeScene.seek(t)` then `frame()`:

| t (s) | What | Result |
| --- | --- | --- |
| 5 | The wide from the sea | **Met.** The car small on the road in the mist. |
| 12, 50 | Along the road; the wide as it brakes | **Changed, then met.** The car read as hovering over the road. Its tyres touch the road's height (the road grade and the ground agree there, the wheels' centres one tyre radius, 0.348 m, above it); what it lacked was the dark under a car, the hike's parked car's soft patch. The film's car now carries that patch, laid in its own frame and riding with it. |
| 12 | The wheels roll | **Met, measured.** Over one frame at 12 m/s (1.44 rad of spin), the rim point at the top moves 20.4 m/s ahead and 7.3 m/s down, and the one at the bottom 3.8 m/s ahead and 7.2 m/s up; a wheel rolling forward gives 20.3, 7.27, 3.7 and 7.27. |
| 6, 26, 47 | The front wheels and the steering wheel on the bends | **Changed, then met, measured.** The front wheels turned against the road (+0.0025 rad where the car yawed at −0.011 rad/s): the wheel's part frame, under the model's mirrored root, reverses a turn about y. The stage now writes the turn negated; the wheels turn with the road on every bend sampled. A positive steer moves the steering wheel's top toward the car's right (clockwise from the seat), the way a positive yaw turns: unchanged. The turns are small on this road (0.15° at the wheels, 2.2° at the steering wheel). |
| 15.3 to 16.4 | The reach and the take | **Changed, then met.** The hand met the cradle 0.1 m below the handset, so the handset jumped down into the console as it left; the reach now meets it where it sits (0.028 m left of a jump). The fist holds the handset turned from how it lies in the cradle, a 70° turn in one frame; the car's pose now carries `grip`, the handset eased from its cradle pose to the fist over 0.3 s after the take and before the put-back (52.4 to 52.7 s). |
| 20 | The cab from the back seat | **Changed, then met.** The ranger sat as on a chair: his hat through the roof, his feet below the floor. `intro.ranger`'s seated clips now lean the upper body back 18° with both feet in the footwell and the hands on the wheel's rim; the chest sits 0.109 m below the steering wheel's centre and 0.457 m behind it (was 0.1 m above and 0.4 m behind), the hips 0.41 m below the chest and 0.095 m ahead of it. The hat clears the roof. At 5 s the right wrist is in the steering wheel's plane (0.002 m off it) and 0.201 m from its axis, the rim's outer edge 0.184 m out. |
| 31, 34, 36 | The insert | **Changed, then met.** Three faults. The handset hung 0.085 m down the forearm: the grip is written in the hand joint's frame (the fingers along +y), and it was applied in the frame Babylon's `decompose` returns for the joint's mirrored matrix, whose y is the joint's −y; the grip is now applied in the joint's own frame, its size taken out and its mirror kept, at 0.075 m along the fingers and 0.03 m toward the palm. The fist lay flat, knuckles across the mouth; the talk clip now turns the wrist so the knuckles stand upright, the handset's length along them. The handset's centre was 0.09 m ahead of the head's joint, at the mouth itself rather than before it; the talk clip's hand is now 0.07 m further forward, which puts the handset's centre 0.137 m ahead of the chest (was 0.045 m). The camera framed the chest with a 0.3 rad lens aimed at the wrist; see below for where it is now. |
| 41.6 | Low on the shoulder | **Met.** The car passes the camera. |
| 56 | The door | **Met.** The door opens outward; he turns out of the seat. |
| 58 | Beside the door | **Met.** He stands outside the door on the ground. |
| 59 to 64 | The walk | **Changed, then met.** The walk was a straight line from the door to the spawn, which is beside the car's passenger side, and went through the car. It now goes round the car's rear (the end on the spawn's side of the door, in view of shot 7's camera), 0.4 m clear of the footprint at its corners, turning into each corner by looking 0.8 m ahead; 6 s with a 0.6 s start and stop (was 5 s, eased): 8.97 m on this world, at most 1.67 m/s. He reaches the trail's start and faces it at 64 s; shot 7 now holds until then (see below). The turns were jumps: at 58 s the root took the first leg's heading in one frame while the pose still held the door clip's last frame, whose body is turned −1.654 rad (−94.8°) from the root, a 181° turn of the body in a frame on this world; at 64 s the heading jumped 0.86 rad to the spawn's facing. The root now turns over the pose's 0.3 s blend out of the door clip, the body the short way (−85° between 58.0 and 58.3 s, at most 0.30 rad in 0.04 s), and to the spawn's facing over the walk's 0.6 s stop (1.456 to 1.458 rad across 64 s). |
| 67, 71 | The push onto the trail | **Met.** The board and the trail, the push past him. |

## What the frames could not settle

- The door clip's stand-up keeps the arms pushed wide; he reads as getting out, not as pulling himself up by the door frame.
- A take 0.028 m from the handset's place in its cradle is within a frame's motion of the hand, and was left.

## What is owed

- The record: the film captured at 24 frames a second from this route on WebGPU at the high tier, with the mix.

## After the fast drafts, 2026-10-01

The whole film was recorded at one sample a frame (1,728 frames in about 11 minutes, against about 40 for the record's eight) and played back at 24 fps, and each frame was checked against the midpoint of the frames either side of it, in 8 by 4 tiles: a one-frame change of a shadow-sized patch stands out there, where a plain frame-to-frame difference loses it in the camera's motion (a 30-level patch planted in one frame of shot 2 was found by the midpoint and missed by the difference).

| What | Result |
| --- | --- |
| The car's dark patch in the wides | **Changed.** In the mist the patch stayed nearly black under a car the mist had paled: its material read Babylon's own fog, lighter than the atmosphere's fog the ground gets. The film's patch is a PBR material the atmosphere reaches, and half as dark (its alpha 0.5). |
| Shot 7's camera at 58 s | **Changed.** It looks at the ranger's hips plus 0.6 m while he stands up and at his feet plus a fixed height once he walks; that height was 1.5 m, 0.05 m under the stand-up's end, and the picture tilted 0.0064 rad in a frame. It is now the stand-up's end height (1.55 m). |
| The insert's haze | **Changed.** The haze over the whole insert was the windscreen: the camera, at (0.25, 1.3, 0.75) in the car's frame, stood outside the glass. It is now inside the cab by the passenger seat at (0.3, 1.2, 0.45), with a 0.3 rad lens on the handset's centre: the whole handset and the fist, his chin at the top of the frame (spec §3 keeps his face no closer than shot 3). |
| Shot 8's start | **Changed.** With the walk ending at 64 s, shot 8 opened at 62 s on the ranger crossing the lens from the right. Shot 7 now holds to 64 s, when he is at the trail's start and turned to it, and shot 8 pushes past his shoulder for 5 s and holds its last 3 s. |
| The handset | **Changed.** A plain box is now a palm microphone on its radio (a rounded charcoal body 0.105 by 0.032 by 0.062 m, a slotted grille, a push-to-talk key, the radio's faceplate, display and knobs toward the back seat), held 0.025 m further toward the index finger with its grille turned to the mouth, on a coiled cord from the radio's socket redrawn every frame. The two parts first read pale grey: the environment's reflected sky lit them as if no roof were over them, which the cab's own textures carry in their darkness and these plain parts do not; they take 0.3 of it. |
| Pops | **Met.** Past the cuts the midpoint check flagged the 58 s tilt (above) and three runs of motion, none a pop: the pass at 41.9 s (shot 5's camera turning fast after the car going by), the opening frames of shot 6 at 48.0 s (its camera stands still but turns after the car, still at 12 m/s, so the background slides fast), and the ranger crossing the lens at 62.6 to 63.6 s (above). A slow drift is the eye's to judge, on the draft. |
