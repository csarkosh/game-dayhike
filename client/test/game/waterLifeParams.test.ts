import { describe, expect, it } from "vitest";
import {
  DREAD_QUIET_FROM, DREAD_QUIET_SPAN, WATER_LIFE_WIND_MPS,
  dreadQuiet, midgeHumPitch, summerTemperature, waterLifePresenceUnder, type WaterLifePresence,
} from "../../src/game/waterLifeParams.js";
import { WEATHER_NAMES, WEATHER_PRESETS, type WeatherPresetName } from "../../src/game/weather.js";

const CLEAR = WEATHER_PRESETS.clear;

/** Six places, and −0 read as 0, so a table of literals can hold a value. */
const six = (x: number): number => Math.round(x * 1e6) / 1e6 + 0;

/** A record as a row of the tables below: midge, fullness, darner, skimmer
 * and damselfly as [seen, flying], frog. */
function row(p: WaterLifePresence): (number | number[])[] {
  return [
    six(p.midge), six(p.midgeFullness),
    [six(p.darner.seen), six(p.darner.flying)],
    [six(p.skimmer.seen), six(p.skimmer.flying)],
    [six(p.damselfly.seen), six(p.damselfly.flying)],
    six(p.frog),
  ];
}

describe("the water life's presence", () => {
  it("reads the wind and the dread on the stated scales", () => {
    expect(WATER_LIFE_WIND_MPS).toBe(8);
    expect(DREAD_QUIET_FROM).toBe(0.3);
    expect(DREAD_QUIET_SPAN).toBe(0.2);
  });

  it("brings the midges out at dawn and dusk, fullest just after sunset", () => {
    const table: [number, number][] = [
      [5, 0], [5.25, 0], [5.375, 0.15625], [5.5, 0.5], [5.75, 1], [6.5, 1], [6.75, 0.5], [7, 0],
      [12, 0], [17.75, 0], [18, 0.5], [18.25, 1], [19.25, 1], [19.5, 0.5], [19.75, 0], [22, 0],
    ];
    for (const [hour, midge] of table) expect([hour, six(waterLifePresenceUnder(CLEAR, hour, 0).midge)]).toEqual([hour, midge]);
  });

  it("flies the dragonflies by day and the darners on into dusk at a third", () => {
    // [hour, darner seen, skimmer seen, damselfly seen]
    const table: [number, number, number, number][] = [
      [7.5, 0, 0, 0], [8, 0, 0, 0], [8.25, 0.15625, 0.15625, 0.15625], [8.5, 0.5, 0.5, 0.5], [9, 1, 1, 1],
      [12, 1, 1, 1], [17, 1, 1, 1], [17.5, 0.666667, 0.5, 0.5], [18, 0.333333, 0, 0], [18.5, 0.333333, 0, 0],
      [18.75, 0.166667, 0, 0], [19, 0, 0, 0], [22, 0, 0, 0],
    ];
    for (const [hour, darner, skimmer, damselfly] of table) {
      const p = waterLifePresenceUnder(CLEAR, hour, 0);
      expect([hour, six(p.darner.seen), six(p.skimmer.seen), six(p.damselfly.seen)]).toEqual([hour, darner, skimmer, damselfly]);
    }
  });

  it("starts the chorus at 19:30, fullest from 21:00 to midnight, gone by 05:00", () => {
    const table: [number, number][] = [
      [12, 0], [18.5, 0], [19, 0], [19.25, 0], [19.5, 0], [19.75, 0.3], [20, 0.6], [20.5, 0.8], [21, 1], [22, 1], [23.99, 1],
      [0, 1], [0.25, 0.8], [0.5, 0.6], [2, 0.6], [4.5, 0.6], [4.75, 0.3], [5, 0], [6, 0],
    ];
    for (const [hour, frog] of table) expect([hour, six(waterLifePresenceUnder(CLEAR, hour, 0).frog)]).toEqual([hour, frog]);
  });

  it("wraps the hour, so 24:00 is midnight", () => {
    expect(waterLifePresenceUnder(CLEAR, 24, 0)).toEqual(waterLifePresenceUnder(CLEAR, 0, 0));
    expect(waterLifePresenceUnder(CLEAR, 42.5, 0)).toEqual(waterLifePresenceUnder(CLEAR, 18.5, 0));
    expect(waterLifePresenceUnder(CLEAR, -5.5, 0)).toEqual(waterLifePresenceUnder(CLEAR, 18.5, 0));
  });

  it("holds every weather preset's table at dawn, noon, dusk and night", () => {
    // [midge, fullness, darner, skimmer, damselfly, frog] at 06:00, 12:00, 18:30 and 22:00
    const expected: Record<WeatherPresetName, (number | number[])[][]> = {
      clear: [
        [1, 1, [0, 1], [0, 1], [0, 1], 0],
        [0, 1, [1, 1], [1, 1], [1, 1], 0],
        [1, 1, [0.333333, 1], [0, 1], [0, 1], 0],
        [0, 1, [0, 1], [0, 1], [0, 1], 1],
      ],
      // cloud 0.45: sun at 0.925926, so the dragonflies fly at that share and mist 0.12 fills the swarms a little
      bright: [
        [1, 1.036, [0, 0.925926], [0, 0.925926], [0, 0.925926], 0],
        [0, 1.036, [0.925926, 0.925926], [1, 0.925926], [0.925926, 0.925926], 0],
        [1, 1.036, [0.308642, 0.925926], [0, 0.925926], [0, 0.925926], 0],
        [0, 1.036, [0, 0.925926], [0, 0.925926], [0, 0.925926], 1],
      ],
      // cloud 0.8: no sun, so the skimmers sit seen on their perches and the rest take cover
      overcast: [
        [1, 1.075, [0, 0], [0, 0], [0, 0], 0],
        [0, 1.075, [0, 0], [1, 0], [0, 0], 0],
        [1, 1.075, [0, 0], [0, 0], [0, 0], 0],
        [0, 1.075, [0, 0], [0, 0], [0, 0], 1],
      ],
      mist: [
        [1, 1.3, [0, 0], [0, 0], [0, 0], 0],
        [0, 1.3, [0, 0], [1, 0], [0, 0], 0],
        [1, 1.3, [0, 0], [0, 0], [0, 0], 0],
        [0, 1.3, [0, 0], [0, 0], [0, 0], 1],
      ],
      // the frogs call on in the rain
      rain: [
        [0, 1.18, [0, 0], [0, 0], [0, 0], 0],
        [0, 1.18, [0, 0], [0, 0], [0, 0], 0],
        [0, 1.18, [0, 0], [0, 0], [0, 0], 0],
        [0, 1.18, [0, 0], [0, 0], [0, 0], 1],
      ],
      eerie: [
        [0, 1.3, [0, 0], [0, 0], [0, 0], 0],
        [0, 1.3, [0, 0], [0, 0], [0, 0], 0],
        [0, 1.3, [0, 0], [0, 0], [0, 0], 0],
        [0, 1.3, [0, 0], [0, 0], [0, 0], 0],
      ],
    };
    expect(Object.keys(expected).sort()).toEqual([...WEATHER_NAMES].sort());
    for (const name of WEATHER_NAMES) {
      const rows = [6, 12, 18.5, 22].map((hour) => row(waterLifePresenceUnder(WEATHER_PRESETS[name], hour, 0)));
      expect([name, rows]).toEqual([name, expected[name]]);
    }
  });

  it("thins the swarms from wind 0.5 to none by 0.75 and grounds the dragonflies above 0.7", () => {
    // [wind, midge at 18:30, darner seen at noon, darner flying at noon, skimmer flying at noon]
    const table: [number, number, number, number, number][] = [
      [0.5, 1, 1, 1, 1], [0.625, 0.5, 1, 0.84375, 0.84375], [0.65, 0.352, 1, 0.5, 0.5], [0.75, 0, 1, 0, 0], [1, 0, 1, 0, 0],
    ];
    for (const [wind, midge, seen, flying, skimmer] of table) {
      const dusk = waterLifePresenceUnder(CLEAR, 18.5, wind);
      const noon = waterLifePresenceUnder(CLEAR, 12, wind);
      expect([wind, six(dusk.midge), six(noon.darner.seen), six(noon.darner.flying), six(noon.skimmer.flying)])
        .toEqual([wind, midge, seen, flying, skimmer]);
    }
  });

  it("fades the midges out by rain 0.3, the dragonflies by rain 0.05 and by cloud 0.7, the skimmers still seen under cloud", () => {
    // [cloud, rain, midge at 18:30, then at noon: darner seen, skimmer seen, damselfly seen, darner flying]
    const table: [number, number, number, number, number, number, number][] = [
      [0.4, 0, 1, 1, 1, 1, 1],
      [0.55, 0, 1, 0.5, 1, 0.5, 0.5],
      [0.7, 0, 1, 0, 1, 0, 0],
      [0, 0.025, 0.980324, 0.5, 0.5, 0.5, 1],
      [0, 0.05, 0.925926, 0, 0, 0, 1],
      [0, 0.15, 0.5, 0, 0, 0, 1],
      [0, 0.3, 0, 0, 0, 0, 1],
    ];
    for (const [cloudCover, rain, midge, darner, skimmer, damselfly, flying] of table) {
      const w = { ...CLEAR, cloudCover, rain };
      const dusk = waterLifePresenceUnder(w, 18.5, 0);
      const noon = waterLifePresenceUnder(w, 12, 0);
      expect([cloudCover, rain, six(dusk.midge), six(noon.darner.seen), six(noon.skimmer.seen), six(noon.damselfly.seen), six(noon.darner.flying)])
        .toEqual([cloudCover, rain, midge, darner, skimmer, damselfly, flying]);
    }
  });

  it("quiets the whole lake from dread 0.3 to silence at 0.5", () => {
    expect([dreadQuiet(0), dreadQuiet(0.3), six(dreadQuiet(0.4)), dreadQuiet(0.5), dreadQuiet(1)]).toEqual([0, 0, 0.5, 1, 1]);
    // [dread, midge at 18:30, darner seen at noon, skimmer flying at noon, frog at 22:00]
    const table: [number, number, number, number, number][] = [
      [0.3, 1, 1, 1, 1], [0.4, 0.5, 0.5, 0.5, 0.5], [0.5, 0, 0, 0, 0],
    ];
    for (const [dread, midge, darner, skimmer, frog] of table) {
      const w = { ...CLEAR, dread };
      expect([
        dread,
        six(waterLifePresenceUnder(w, 18.5, 0).midge),
        six(waterLifePresenceUnder(w, 12, 0).darner.seen),
        six(waterLifePresenceUnder(w, 12, 0).skimmer.flying),
        six(waterLifePresenceUnder(w, 22, 0).frog),
      ]).toEqual([dread, midge, darner, skimmer, frog]);
    }
  });

  it("writes into the record it is handed", () => {
    const out = waterLifePresenceUnder(CLEAR, 12, 0);
    const darner = out.darner, skimmer = out.skimmer, damselfly = out.damselfly;
    expect(waterLifePresenceUnder(CLEAR, 22, 0, out)).toBe(out);
    expect(out.darner).toBe(darner);
    expect(out.skimmer).toBe(skimmer);
    expect(out.damselfly).toBe(damselfly);
    expect(out.frog).toBe(1);
    expect(out.darner.seen).toBe(0);
  });

  it("never holds NaN or leaves its range over the day under any preset or wind", () => {
    for (const name of WEATHER_NAMES) {
      for (const wind of [0, 0.5, 0.75, 1]) {
        for (let i = 0; i <= 480; i++) {
          const hour = i * 0.05;
          const p = waterLifePresenceUnder(WEATHER_PRESETS[name], hour, wind);
          const shares = [p.midge, p.darner.seen, p.darner.flying, p.skimmer.seen, p.skimmer.flying, p.damselfly.seen, p.damselfly.flying, p.frog];
          for (const s of shares) {
            if (!(s >= 0 && s <= 1)) throw new Error(`${name} at ${hour} h, wind ${wind}: share ${s}`);
          }
          if (!(p.midgeFullness >= 1 && p.midgeFullness <= 1.3)) throw new Error(`${name} at ${hour} h: fullness ${p.midgeFullness}`);
          const pitch = midgeHumPitch(summerTemperature(hour, WEATHER_PRESETS[name]));
          if (!(pitch >= 180 && pitch <= 330)) throw new Error(`${name} at ${hour} h: pitch ${pitch}`);
        }
      }
    }
  });
});

describe("the summer air and the hum", () => {
  it("swings from 11 °C in the small hours to 21 °C at 15:00, less under cloud, cooler in rain", () => {
    // [preset, at 03:00, 09:00, 15:00, 21:00]
    const table: [WeatherPresetName, number, number, number, number][] = [
      ["clear", 11, 16, 21, 16],
      ["overcast", 13, 16, 19, 16],
      ["mist", 13.25, 16, 18.75, 16],
      ["rain", 10.5, 13, 15.5, 13],
      ["eerie", 12.6, 15.1, 17.6, 15.1],
    ];
    for (const [name, h3, h9, h15, h21] of table) {
      const temps = [3, 9, 15, 21].map((hour) => six(summerTemperature(hour, WEATHER_PRESETS[name])));
      expect([name, ...temps]).toEqual([name, h3, h9, h15, h21]);
    }
  });

  it("hums at 230 Hz at 15 °C, 10 Hz higher a degree, held between 180 and 330 Hz", () => {
    const table: [number, number][] = [[5, 180], [10, 180], [11, 190], [15, 230], [21, 290], [25, 330], [26, 330]];
    for (const [tempC, hz] of table) expect([tempC, midgeHumPitch(tempC)]).toEqual([tempC, hz]);
  });
});
