import { Logger, ProjectNode } from "../../library/mod.ts";
import { IFrontendConfig } from "../config.ts";
import * as path from "https://deno.land/std@0.182.0/path/mod.ts";
import { VanillaGenerator } from "./vanilla/index.ts";

const FRONTEND_GENERATORS: {[key: string]: IFrontendGenerator} = {
    "vanilla": new VanillaGenerator
};

export interface IFrontendGenerator {
    /**
     * Generates the frontend.
     * 
     * @param project The project to generate.
     * @param directory The directory to generate to.
     */
    generate(project: ProjectNode, directory: string): Promise<void>;
}

/**
 * Generates the frontend.
 * 
 * @param config The frontend config.
 * @param project The project.
 * @param currentDir The current directory.
 */
export async function generateFrontend(config: IFrontendConfig, project: ProjectNode, currentDir: string) {
    const fullOutputPath = path.resolve(currentDir, config.output ?? "./frontend");
    if (!await Deno.stat(fullOutputPath).then(x => x.isDirectory).catch(() => false)) {
        Logger.fatal(`You must create a frontend project beforehand.`);
        Deno.exit(1);
    }

    const generator = FRONTEND_GENERATORS[config.mode as string];
    if (!generator) {
        Logger.fatal(`Unknown frontend generation mode '${config.mode}'.`);
        Deno.exit(1);
    }

    await generator.generate(project, fullOutputPath);
}