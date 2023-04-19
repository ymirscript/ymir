import * as path from "https://deno.land/std@0.157.0/path/mod.ts";

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
}

function getDefaultConfig(): IYmirConfig {
    return {
        output: "build",
        debug: false,
        detailedErrors: false,
    };
}