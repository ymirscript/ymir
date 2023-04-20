import * as path from "https://deno.land/std@0.182.0/path/mod.ts";

import { CompilationContext } from "./context.ts";
import { Logger, PluginBase } from "../library/mod.ts";

import JavaScriptExpressJsTargetPlugin from "../targets/javascript/expressjs.ts";
import JavaSpringBootTargetPlugin from "../targets/java/springboot.ts";

const plugins = [
    new JavaScriptExpressJsTargetPlugin(),
    new JavaSpringBootTargetPlugin()
];

function getTargetPlugin(name: string): PluginBase | undefined {
    return plugins.find(plugin => plugin.targetFor === name);
}

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
    
    const start = Date.now();
    const context = new CompilationContext(indexFile);

    if (!context.isIndexFilePrepared) {
        if (context.diagnostics) {
            context.diagnostics.print(context);
        }

        Logger.fatal("Aborting.");
        return;
    }

    Logger.info("Compiling %s", args[0]);

    const targetPlugin = getTargetPlugin(context.projectNode.target);

    if (targetPlugin === undefined) {
        Logger.fatal("No plugin for target \"%s\" found.", context.projectNode.target);
        return;
    }

    await context.initBuildDir();

    targetPlugin.compile(context);

    const end = Date.now();

    Logger.success("Compilation finished.");

    const seconds = ((end - start) / 1000).toFixed(2);
    const writtenLocs = context.linesOfCode;
    const generatedLocs = await context.countGeneratedLinesOfCode();
    const savedLocs = generatedLocs - writtenLocs;
    const savedLocsPercent = ((savedLocs / writtenLocs) * 100).toFixed(2);
    const avgDevWritingLocsPerDay = 10;
    const savedDays = (savedLocs / avgDevWritingLocsPerDay).toFixed(2);

    if (savedLocs > 0) {
        console.log("");
        console.log(`%cSaved %c${savedLocs}%c lines of code ( %c${savedLocsPercent}% %c) in %c${seconds} %cseconds. That's %c${savedDays} %cdays of development time saved! 😉`,
            "color: white",
            "color: cyan; font-weight: bold",
            "color: white",
            "color: purple; font-weight: bold",
            "color: white",
            "color: yellow; font-weight: bold",
            "color: white",
            "color: #00ff00; font-weight: bold",
            "color: white");
    }
}

await run(Deno.args);