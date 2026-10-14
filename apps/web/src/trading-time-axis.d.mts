export type GddTimelineInput={time?:string;datetime?:string;price:number|string;avgPrice?:number|string;average?:number|string;volume?:number|string};
export type GddSessionAxis={labels:string[];auction:Array<number|null>;morning:Array<number|null>;afternoon:Array<number|null>;average:Array<number|null>;volume:Array<number|null>;fixedTicks:number[];actualMinutes:number};
export const GDD_SESSION_TIMES:string[];
export const GDD_SESSION_TICKS:Set<string>;
export function buildGddSessionAxis(items:GddTimelineInput[]):GddSessionAxis;
