# The intro with the film's own models, as it looks on the scene route

**Date:** 2026-09-30
**Commit:** on `worktree-intro-assets` after `f42838e` (main `65ed63e` plus part 3).
**Spec:** [`2026-09-29-intro-scene.md`](2026-09-29-intro-scene.md), §2, §3 and §6. **Plan:** [`2026-09-30-intro-scene-plan-3.md`](2026-09-30-intro-scene-plan-3.md), Task 8.
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
| 31, 34, 36 | The insert | **Changed, then met.** Three faults. The handset hung 0.085 m down the forearm: the grip is written in the hand joint's frame (the fingers along +y), and it was applied in the frame Babylon's `decompose` returns for the joint's mirrored matrix, whose y is the joint's −y; the grip is now applied in the joint's own frame, its size taken out and its mirror kept, at 0.075 m along the fingers and 0.03 m toward the palm. The fist lay flat, knuckles across the mouth; the talk clip now turns the wrist so the knuckles stand upright, the handset's length along them. The handset's centre was 0.09 m ahead of the head's joint, at the mouth itself rather than before it; the talk clip's hand is now 0.07 m further forward, which puts the handset's centre 0.137 m ahead of the chest (was 0.045 m). The camera framed the chest with a 0.3 rad lens aimed at the wrist; it is aimed at the handset's measured centre in the fist (`HANDSET_HELD`) plus 0.06 m, with a 0.5 rad lens: the face three-quarters, the fist and handset at the mouth, the other hand on the wheel. |
| 41.6 | Low on the shoulder | **Met.** The car passes the camera. |
| 56 | The door | **Met.** The door opens outward; he turns out of the seat. |
| 58 | Beside the door | **Met.** He stands outside the door on the ground. |
| 59 to 64 | The walk | **Changed, then met.** The walk was a straight line from the door to the spawn, which is beside the car's passenger side, and went through the car. It now goes round the car's rear (the end on the spawn's side of the door, in view of shot 7's camera), 0.4 m clear of the footprint at its corners, turning into each corner by looking 0.8 m ahead; 6 s with a 0.6 s start and stop (was 5 s, eased): 8.97 m on this world, at most 1.67 m/s. He steps into the foreground of shot 8 at 63.5 s as the camera pushes past his shoulder. |
| 67, 71 | The push onto the trail | **Met.** The board and the trail, the push past him. |

## What the look could not settle

- The cab and the insert are milky: the `mist` preset fogs the cab's inside as it fogs the road. Whether the film's weather is thinned for the record (`INTRO_WEATHER`), or the cab's shots are drawn without the mist's haze, is a choice for the record.
- The door clip's stand-up keeps the arms pushed wide as it was made; he reads as getting out, not as pulling himself up by the door frame.
- A take 0.028 m from the handset's place in its cradle is within a frame's motion of the hand, and was left.

## What is owed

- The record: the film captured at 24 frames a second from this route on WebGPU at the high tier, with the mix.
