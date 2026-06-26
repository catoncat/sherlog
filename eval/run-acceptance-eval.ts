#!/usr/bin/env -S node --import tsx

import { runAcceptanceGate } from "./acceptance-gate";

const keepTemp = process.argv.includes("--keep-temp");
const result = await runAcceptanceGate({ keepTemp });

console.log(JSON.stringify(result, null, 2));
if (result.scoreboard.hardFail > 0) process.exitCode = 1;
