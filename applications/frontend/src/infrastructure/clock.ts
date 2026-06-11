import { type Clock } from "../usecase/port/clock";

export const createSystemClock = (): Clock => ({
  now: () => new Date(),
});
