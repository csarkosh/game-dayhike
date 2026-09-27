# Halation's vertical blur: quarter size instead of full

The halation glow around bright points was noticeably wider than tall: about
76 by 22 px at half its peak, on a small bright source at 1920 by 1080 (a
6 cm emissive sphere 8 m ahead, against a night sky). A blur pass's step is
one texel of the target it writes. The vertical blur pass was writing a
full-size target while the horizontal blur ahead of it wrote a quarter-size
one, so the vertical pass took a blur step a quarter as long — one full-size
pixel against the horizontal pass's four — on the same kernel, which is why
the glow measured 22 px tall against 76 wide.

## What was measured

Conditions: 1920 by 1080, the 6 cm emissive sphere 8 m ahead against a night
sky, and two further views — a white truck under the headlamp at night, and
sun glints on the sea at 16:00.

| vertical blur target | glow at half its peak | glow texture's peak value |
| --- | --- | --- |
| full size (as it read before this change) | 76 by 22 px | 0.080 |
| quarter size, its natural step there | 74 by 74 px | 0.022 |
| quarter size, step held at the full-size value | 74 by 24 px | 0.076 |

A round glow needs both the quarter-size target and its natural (quarter-size)
step; holding the step at the full-size value keeps the elongated shape even
with a quarter-size target — the step, not the target size, is what widens
the glow along the vertical axis.

By day, at the poses tried, only glints on water pass the halation
threshold; the sun seen through the canopy does not glow (its glow texture
reads exactly 0 there).

## What was chosen

The vertical blur pass now writes a quarter-size target and takes its
natural step there. The glow becomes round (74 by 74 px at half its peak)
and its peak value falls to about a quarter of what it was (0.080 to 0.022),
because the same light is spread over a larger area. That dimmer, rounder
glow is the one chosen; the halation's strength, threshold and kernel are
unchanged.

## Not yet measured

The frame time saved by filtering a sixteenth as many pixels in the vertical
blur pass every frame (480 by 270 instead of 1920 by 1080) is not yet
measured.
