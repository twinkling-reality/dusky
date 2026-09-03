import { describe, expect, it } from "vitest";
import { isDevicePosition, POSITION_DECIMALS, roundCoordinate } from "./index.js";

/**
 * The precision bound, tested here because it is a claim rather than a detail.
 *
 * "Dusky never holds a position finer than about eleven metres" is only true
 * if one function decides that and both ends use it. The Display rounds before
 * sending and the relay rejects anything finer on arrival; if these two ever
 * disagreed, the wearer would be told one thing and a site would receive
 * another.
 */
describe("the bound on a shared coordinate", () => {
  it("keeps four decimal places, which is roughly eleven metres", () => {
    expect(POSITION_DECIMALS).toBe(4);
    expect(roundCoordinate(45.51523891)).toBe(45.5152);
    expect(roundCoordinate(-122.67845)).toBe(-122.6784);
    expect(roundCoordinate(0)).toBe(0);
  });

  it("is idempotent, so a rounded value survives being checked again", () => {
    for (const raw of [45.51523891, -122.67845, 89.99999, -179.98765]) {
      expect(roundCoordinate(roundCoordinate(raw))).toBe(roundCoordinate(raw));
    }
  });

  it("accepts a reading that is in range and already rounded", () => {
    expect(isDevicePosition({ latitude: 45.5152, longitude: -122.6784 })).toBe(true);
    expect(isDevicePosition({ latitude: 0, longitude: 0 })).toBe(true);
    expect(isDevicePosition({ latitude: -90, longitude: 180 })).toBe(true);
  });

  it("refuses anything finer than the bound the wearer was shown", () => {
    expect(isDevicePosition({ latitude: 45.51523891, longitude: -122.6784 })).toBe(false);
    expect(isDevicePosition({ latitude: 45.5152, longitude: -122.678412 })).toBe(false);
  });

  it("refuses a value that is not a coordinate at all", () => {
    expect(isDevicePosition(null)).toBe(false);
    expect(isDevicePosition("45.5152,-122.6784")).toBe(false);
    expect(isDevicePosition({ latitude: 45.5152 })).toBe(false);
    expect(isDevicePosition({ latitude: 91, longitude: 0 })).toBe(false);
    expect(isDevicePosition({ latitude: 0, longitude: -181 })).toBe(false);
    expect(isDevicePosition({ latitude: Number.NaN, longitude: 0 })).toBe(false);
    expect(isDevicePosition({ latitude: Number.POSITIVE_INFINITY, longitude: 0 })).toBe(false);
    expect(isDevicePosition({ latitude: "45.5152", longitude: "-122.6784" })).toBe(false);
  });
});
