import * as path from "https://deno.land/std@0.182.0/path/mod.ts";
import dir from "https://deno.land/x/dir@1.5.1/mod.ts";
import { decompress } from "https://deno.land/x/zip@v1.2.5/mod.ts";
import { encode as encodeB64 } from "https://deno.land/std@0.182.0/encoding/base64.ts";

import { CompilationContext } from "./context.ts";
import { AbortError, Logger, PluginBase } from "../library/mod.ts";

import JavaScriptExpressJsTargetPlugin from "../targets/javascript/expressjs.ts";
import JavaSpringBootTargetPlugin from "../targets/java/springboot.ts";

const plugins = [
    new JavaScriptExpressJsTargetPlugin(),
    new JavaSpringBootTargetPlugin()
];

/**
 * Runs the compiler as CLI.
 * 
 * @param args The arguments to pass to the compiler. 
 */
async function run(args: string[]): Promise<void> {
    if (args.length <= 0) {
        Logger.error("No input file or subcommand specified.");
        return;
    }

    if (!await Deno.stat(args[0]).then(stat => stat.isFile).catch(() => false)) {
        if (args[0] === "install") {
            if (args.length <= 1) {
                Logger.error("No target URL specified.");
                return;
            }

            await installExternalTarget(args[1]);
        } else if (args[0] === "remove") {
            if (args.length <= 1) {
                Logger.error("No target name specified.");
                return;
            }

            await uninstallExternalTarget(args[1]);
        } else if (args[0] === "list") {
            await listExternalTargets();
        } else if (args[0] === "help") {
            Logger.info("Usage: ymir <[file]|help|install|remove|list> (<options>)");
            console.log("");
            console.log("\t%c[file]%c: %cThe Ymir file to compile.", "color: cyan", "color: white", "color: yellow");
            console.log("\t%chelp%c: %cShows this help message.", "color: cyan", "color: white", "color: yellow");
            console.log("\t%cinstall <external URL>%c: %cInstalls the target from the specified URL.", "color: cyan", "color: white", "color: yellow");
            console.log("\t%cremove <target name>%c: %cRemoves the specified target.", "color: cyan", "color: white", "color: yellow");
            console.log("\t%clist%c: %cLists all installed targets.", "color: cyan", "color: white", "color: yellow");
        } else {
            Logger.error("The input file must be a Ymir file of kind script.");
        }
        return;
    }

    const indexFile = args[0];
    if (path.extname(indexFile) !== ".ymr") {
        Logger.error("The input file must be a Ymir file of kind script.");
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
    await context.initBuildDir();

    if (targetPlugin) {
        try {
            targetPlugin.compile(context);
        } catch (e) {
            if (e instanceof AbortError) {
                Logger.fatal("Aborting.");
                return;
            } else {
                throw e;
            }
        }
    } else {
        if (!(await runExternalCompiler(context))) {
            Logger.fatal("Aborting.");
            return;
        }
    }

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

function getTargetPlugin(name: string): PluginBase | undefined {
    return plugins.find(plugin => plugin.targetFor === name);
}

async function getExternalTarget(name: string): Promise<string | undefined> {
    const appData = dir("data");
    if (!appData) {
        return undefined;
    }

    const targetsConfig = path.join(appData, "ymir", "ext_targets.json");
    if (!await Deno.stat(targetsConfig).then(stat => stat.isFile).catch(() => false)) {
        return undefined;
    }

    const config = JSON.parse(await Deno.readTextFile(targetsConfig));
    if (!config[name]) {
        return undefined;
    }

    return config[name];
}

async function installExternalTarget(url: string) {
    const appData = dir("data");
    if (!appData) {
        return;
    }

    const ymirDir = path.join(appData, "ymir");
    if (!await Deno.stat(ymirDir).then(stat => stat.isDirectory).catch(() => false)) {
        await Deno.mkdir(ymirDir, {recursive: true});
    }

    Logger.info("Downloading metadata...");
    const metadata = await fetch(url + "/metadata.json").then(res => res.json());
    if (!metadata.name || !metadata.download || !metadata.executable) {
        Logger.error("Invalid metadata.");
        return;
    }

    Logger.info("Downloading target...");
    const zip = await fetch(metadata.download).then(res => res.arrayBuffer());
    const tmp = path.join(ymirDir, "tmp.zip");
    await Deno.writeFile(tmp, new Uint8Array(zip));

    const targetHome = path.join(ymirDir, "homes", metadata.name);
    if (await Deno.stat(targetHome).then(stat => stat.isDirectory).catch(() => false)) {
        await Deno.mkdir(targetHome, {recursive: true});
    }

    await decompress(tmp, targetHome, {overwrite: true});

    const executablePath = path.join(targetHome, metadata.executable);

    const targetsConfig = path.join(ymirDir, "ext_targets.json");
    let config: {[key: string]: string} = {};
    if (await Deno.stat(targetsConfig).then(stat => stat.isFile).catch(() => false)) {
        config = JSON.parse(await Deno.readTextFile(targetsConfig));
    }

    config[metadata.name] = executablePath;
    await Deno.writeTextFile(targetsConfig, JSON.stringify(config, null, 4));

    Logger.success("Target installed.");
}

async function uninstallExternalTarget(name: string) {
    const appData = dir("data");
    if (!appData) {
        return;
    }

    const targetsConfig = path.join(appData, "ymir", "ext_targets.json");
    if (!await Deno.stat(targetsConfig).then(stat => stat.isFile).catch(() => false)) {
        return;
    }

    const config = JSON.parse(await Deno.readTextFile(targetsConfig));
    if (!config[name]) {
        return;
    }

    const targetHome = path.join(appData, "ymir", "homes", name);
    if (await Deno.stat(targetHome).then(stat => stat.isDirectory).catch(() => false)) {
        await Deno.remove(targetHome, {recursive: true});
    }

    delete config[name];
    await Deno.writeTextFile(targetsConfig, JSON.stringify(config, null, 4));

    Logger.success("Target uninstalled.");
}

async function listExternalTargets() {
    const appData = dir("data");
    if (!appData) {
        return;
    }

    const targetsConfig = path.join(appData, "ymir", "ext_targets.json");
    if (!await Deno.stat(targetsConfig).then(stat => stat.isFile).catch(() => false)) {
        return;
    }

    const config = JSON.parse(await Deno.readTextFile(targetsConfig));
    for (const key in config) {
        console.log(`%c${key}%c: %c${config[key]}`, "color: cyan", "color: white", "color: yellow");
    }
}

async function runExternalCompiler(context: CompilationContext): Promise<boolean> {
    const target = await getExternalTarget(context.projectNode.target);
    if (!target) {
        Logger.error("The target '%s' is not supported.", context.projectNode.target);
        return false;
    }

    const data = {
        project: context.projectNode,
        config: context.config,
        output: context.outputDirectory
    };

    const formattedData = JSON.stringify(data);
    const arg = encodeB64(formattedData);

    const command = [target, arg];
    const process = Deno.run({
        cmd: command,
        stdout: "piped",
        stderr: "piped"
    });

    const [status, _, stderr] = await Promise.all([
        process.status(),
        process.output(),
        process.stderrOutput()
    ]);

    process.close();

    if (!status.success) {
        Logger.error("The external compiler failed with the following error:");
        console.log(new TextDecoder().decode(stderr));
        return false;
    }

    return true;
}

await run(Deno.args);