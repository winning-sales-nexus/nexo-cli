#!/usr/bin/env node
import { processContext } from './context.js';
import type { ExitCode } from './exit-codes.types.js';
import { run } from './run.js';

const code: ExitCode = await run(processContext(), process.argv.slice(2));
process.exitCode = code;
