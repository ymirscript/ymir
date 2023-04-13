import * as path from "https://deno.land/std@0.182.0/path/mod.ts";

import { CompilationContext } from "./context.ts";
import { Logger } from "./logger.ts";

/**
 * Runs the compiler as CLI.
 * 
 * @param args The arguments to pass to the compiler. 
 */
async function run(args: string[]): Promise<void> {
    if (args.length <= 0) {
        Logger.error("No input file specified.");
        return;
    }

    const indexFile = args[0];
    if (path.extname(indexFile) !== ".ymr") {
        Logger.error("The input file must be a Ymir file of kind script.");
        return;
    }

    if (!await Deno.stat(indexFile).then(stat => stat.isFile).catch(() => false)) {
        Logger.error("The input file does not exist.");
        return;
    }
    

    const context = new CompilationContext(indexFile);
    Logger.info("Compiling %s", args[0]);
}

await run(Deno.args);