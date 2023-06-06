import * as path from "https://deno.land/std@0.157.0/path/mod.ts";
import { BearerAuthGenerationMode } from "../library/mod.ts";

/**
 * Loads the config from the working directory.
 * 
 * @param workingDir The working directory of the compiler.
 * @returns The config.
 */
export function loadConfig(workingDir: string): IYmirConfig {
    const configPath = path.join(workingDir, "ymir.json");
    
    try {
        if (!Deno.statSync(configPath).isFile) {
            return getDefaultConfig();
        }
    } catch {
        return getDefaultConfig();
    }

    const config = JSON.parse(Deno.readTextFileSync(configPath)) as IYmirConfig;
    return {
        ...getDefaultConfig(),
        ...config,
        frontend: config.frontend ? {
            mode: FrontendGenerationMode.Vanilla,
            output: "./frontend",
            ...config.frontend,
        } : undefined,
    };
}

/**
 * Describes the schema of the ymir.json file.
 */
export interface IYmirConfig {
    /**
     * The directory where the build files will be placed.
     */
    readonly output?: string;

    /**
     * Whether or not to enable debug mode.
     */
    readonly debug?: boolean;

    /**
     * Whether to display more detailed errors (experimental; improve later).
     */
    readonly detailedErrors?: boolean;

    /**
     * The target specific configuration.
     */
    readonly target?: {[key: string]: unknown};

    /**
     * The generation mode of the bearer authentication.
     */
    readonly generateBearerAuth?: BearerAuthGenerationMode;

    /**
     * The frontend config. If not specified, the frontend will not be generated.
     */
    readonly frontend?: IFrontendConfig;
}

/**
 * Describes the schema of the frontend configuration.
 */
export interface IFrontendConfig {
    /**
     * The generation mode of the frontend.
     */
    mode?: FrontendGenerationMode;
    /**
     * The output is another directory where the frontend will be generated.
     */
    output?: string;
}

/**
 * The generation mode of the frontend.
 */
export enum FrontendGenerationMode {
    /**
     * Pure HTML frontend with Vite.
     */
    Vanilla = "vanilla",
}

function getDefaultConfig(): IYmirConfig {
    return {
        output: "build",
        debug: false,
        detailedErrors: false,
    };
}